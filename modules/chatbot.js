const { getDatabase } = require('../database');
const OpenAI = require('openai');

// =====================================================
// RATE LIMITER
// =====================================================

class RateLimiter {
    constructor() {
        this.requestsPerMinute = [];
        this.requestsPerDay = [];
        this.tokensPerMinute = [];
        this.tokensPerDay = [];
        
        // Groq API limits
        this.LIMITS = {
            REQUESTS_PER_MINUTE: 30,
            REQUESTS_PER_DAY: 1000,
            TOKENS_PER_MINUTE: 8000,
            TOKENS_PER_DAY: 200000
        };
    }

    cleanupOldEntries() {
        const now = Date.now();
        const oneMinute = 60 * 1000;
        const oneDay = 24 * 60 * 60 * 1000;

        // Cleanup minute windows
        this.requestsPerMinute = this.requestsPerMinute.filter(ts => now - ts < oneMinute);
        this.tokensPerMinute = this.tokensPerMinute.filter(entry => now - entry.timestamp < oneMinute);

        // Cleanup day windows
        this.requestsPerDay = this.requestsPerDay.filter(ts => now - ts < oneDay);
        this.tokensPerDay = this.tokensPerDay.filter(entry => now - entry.timestamp < oneDay);
    }

    canMakeRequest(estimatedTokens = 500) {
        this.cleanupOldEntries();

        // Check requests per minute
        if (this.requestsPerMinute.length >= this.LIMITS.REQUESTS_PER_MINUTE) {
            return false;
        }

        // Check requests per day
        if (this.requestsPerDay.length >= this.LIMITS.REQUESTS_PER_DAY) {
            return false;
        }

        // Check tokens per minute
        const tokensThisMinute = this.tokensPerMinute.reduce((sum, entry) => sum + entry.tokens, 0);
        if (tokensThisMinute + estimatedTokens > this.LIMITS.TOKENS_PER_MINUTE) {
            return false;
        }

        // Check tokens per day
        const tokensToday = this.tokensPerDay.reduce((sum, entry) => sum + entry.tokens, 0);
        if (tokensToday + estimatedTokens > this.LIMITS.TOKENS_PER_DAY) {
            return false;
        }

        return true;
    }

    recordRequest(actualTokens) {
        const now = Date.now();
        
        this.requestsPerMinute.push(now);
        this.requestsPerDay.push(now);
        this.tokensPerMinute.push({ timestamp: now, tokens: actualTokens });
        this.tokensPerDay.push({ timestamp: now, tokens: actualTokens });

        this.cleanupOldEntries();
    }

    getStatus() {
        this.cleanupOldEntries();

        const tokensThisMinute = this.tokensPerMinute.reduce((sum, entry) => sum + entry.tokens, 0);
        const tokensToday = this.tokensPerDay.reduce((sum, entry) => sum + entry.tokens, 0);

        return {
            requestsPerMinute: this.requestsPerMinute.length,
            requestsPerDay: this.requestsPerDay.length,
            tokensPerMinute: tokensThisMinute,
            tokensPerDay: tokensToday,
            limits: this.LIMITS
        };
    }
}

// Singleton rate limiter
const rateLimiter = new RateLimiter();

// =====================================================
// HELPER FUNCTIONS
// =====================================================

function estimateTokens(text) {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
}

function normalizeText(text = '') {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function containsCrisisSignals(text = '') {
    const normalized = normalizeText(text);

    const crisisPatterns = [
        /\b(ik\s+wil\s+niet\s+meer|ik\s+kan\s+niet\s+meer)\b/,
        /\b(ga\s+dood|wil\s+dood|dood\s+gaan)\b/,
        /\b(zelfmoord|suicid|suicide)\b/,
        /\b(113|0800\s*-?\s*0113|hulplijn|ggz[-\s]?lijn)\b/
    ];

    return crisisPatterns.some(pattern => pattern.test(normalized));
}

function getRecentConversationMessages(conversationId, limit = 8) {
    const db = getDatabase();

    return db.prepare(`
        SELECT role, content
        FROM chatbot_messages
        WHERE conversation_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
    `).all(conversationId, limit);
}

function shouldRotateConversationForTopicShift(conversationId, userMessage) {
    if (containsCrisisSignals(userMessage)) {
        return false;
    }

    const recentMessages = getRecentConversationMessages(conversationId, 8);
    if (recentMessages.length < 4) {
        return false;
    }

    const recentCrisisContext = recentMessages.some(msg => containsCrisisSignals(msg.content));
    return recentCrisisContext;
}

// =====================================================
// CONVERSATION MANAGEMENT
// =====================================================

function getOrCreateConversation(channelId) {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - (60 * 60); // 60 minutes inactivity threshold
    const TOKEN_LIMIT = 6000; // 75% of 8000 token/minute limit

    try {
        // Find active conversation
        const activeConversation = db.prepare(`
            SELECT * FROM chatbot_conversations 
            WHERE channel_id = ? AND status = 'active'
            ORDER BY last_message_at DESC 
            LIMIT 1
        `).get(channelId);

        // Check if we need a new conversation
        let needNewConversation = false;
        let reason = '';

        if (!activeConversation) {
            needNewConversation = true;
            reason = 'geen actieve conversatie';
        } else if (activeConversation.last_message_at < oneHourAgo) {
            needNewConversation = true;
            reason = 'inactiviteit (>60min)';
            archiveConversation(activeConversation.id);
        } else if (activeConversation.total_tokens > TOKEN_LIMIT) {
            needNewConversation = true;
            reason = `token limiet (${activeConversation.total_tokens}/${TOKEN_LIMIT})`;
            archiveConversation(activeConversation.id);
        }

        if (needNewConversation) {
            console.log(`[CHATBOT] Nieuwe conversatie starten: ${reason}`);
            const result = db.prepare(`
                INSERT INTO chatbot_conversations (channel_id, created_at, last_message_at, total_tokens, status)
                VALUES (?, ?, ?, 0, 'active')
            `).run(channelId, now, now);

            return result.lastInsertRowid;
        }

        return activeConversation.id;
    } catch (error) {
        console.error('[CHATBOT] Fout bij getOrCreateConversation:', error);
        throw error;
    }
}

function archiveConversation(conversationId) {
    const db = getDatabase();
    
    try {
        db.prepare(`
            UPDATE chatbot_conversations 
            SET status = 'archived' 
            WHERE id = ?
        `).run(conversationId);

        console.log(`[CHATBOT] Conversatie ${conversationId} gearchiveerd`);
    } catch (error) {
        console.error('[CHATBOT] Fout bij archiveConversation:', error);
        throw error;
    }
}

function getConversationHistory(conversationId, limit = 20) {
    const db = getDatabase();

    try {
        const messages = db.prepare(`
            SELECT role, content, username, user_id
            FROM chatbot_messages
            WHERE conversation_id = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(conversationId, limit).reverse();

        // Build OpenAI chat format with system prompt
        const history = [
            {
                role: 'system',
                content: 'Je bent een behulpzame AI assistent in de Vissstick Discord server. Belangrijke regels:\n\n- Houd antwoorden KORT en bondig (max 2-3 zinnen tenzij expliciet om meer gevraagd)\n- Gebruik GEEN HTML tags of code blocks\n- Gebruik alleen plain text met Discord markdown (*vet*, _cursief_)\n- Wees vriendelijk en casual\n- Antwoord altijd in het Nederlands\n\nKort en krachtig is beter dan lang en uitgebreid!'
            }
        ];

        // Add conversation messages
        messages.forEach(msg => {
            history.push({
                role: msg.role,
                content: msg.content
            });
        });

        return history;
    } catch (error) {
        console.error('[CHATBOT] Fout bij getConversationHistory:', error);
        throw error;
    }
}

function addMessageToConversation(conversationId, role, content, userId = null, username = null) {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);
    const tokens = estimateTokens(content);

    try {
        // Insert message
        db.prepare(`
            INSERT INTO chatbot_messages (conversation_id, user_id, username, role, content, tokens, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(conversationId, userId, username, role, content, tokens, now);

        // Update conversation
        db.prepare(`
            UPDATE chatbot_conversations
            SET last_message_at = ?,
                total_tokens = total_tokens + ?
            WHERE id = ?
        `).run(now, tokens, conversationId);

        return tokens;
    } catch (error) {
        console.error('[CHATBOT] Fout bij addMessageToConversation:', error);
        throw error;
    }
}

// =====================================================
// GROQ API INTEGRATION
// =====================================================

async function generateResponse(channelId, userMessage, userId, username, groqApiKey) {
    // Constants
    const MAX_MESSAGE_LENGTH = 2000; // Discord message limit
    const MAX_OUTPUT_LENGTH = 4000; // Safe limit voor Discord embeds (max 4096)

    try {
        // Check message length
        if (userMessage.length > MAX_MESSAGE_LENGTH) {
            throw new Error(`Je bericht is te lang (${userMessage.length} karakters). Maximum is ${MAX_MESSAGE_LENGTH} karakters.`);
        }

        // Get or create conversation
        let conversationId = getOrCreateConversation(channelId);

        if (shouldRotateConversationForTopicShift(conversationId, userMessage)) {
            console.log(`[CHATBOT] Onderwerpwissel na crisis-context gedetecteerd, conversatie ${conversationId} reset`);
            archiveConversation(conversationId);
            conversationId = getOrCreateConversation(channelId);
        }

        // Check rate limits with conservative estimate (only new tokens, not full history)
        const estimatedNewTokens = estimateTokens(userMessage) + 300; // User message + estimated response
        if (!rateLimiter.canMakeRequest(estimatedNewTokens)) {
            const status = rateLimiter.getStatus();
            throw new Error(`Rate limit bereikt. Wacht even voordat je weer een bericht stuurt.\n\nRequests: ${status.requestsPerMinute}/${status.limits.REQUESTS_PER_MINUTE}/min\nTokens: ${status.tokensPerMinute}/${status.limits.TOKENS_PER_MINUTE}/min`);
        }

        // Add user message to database
        addMessageToConversation(conversationId, 'user', userMessage, userId, username);

        // Get conversation history
        const history = getConversationHistory(conversationId);

        // Call Groq API
        const client = new OpenAI({
            apiKey: groqApiKey,
            baseURL: 'https://api.groq.com/openai/v1',
            timeout: 15000,
            maxRetries: 1
        });

        console.log(`[CHATBOT] API call voor conversatie ${conversationId}, ${history.length} berichten in history`);

        const response = await client.chat.completions.create({
            model: 'openai/gpt-oss-120b',
            messages: history,
            temperature: 0.7,
            max_tokens: 220
        });

        let assistantMessage = response.choices?.[0]?.message?.content;
        if (!assistantMessage || typeof assistantMessage !== 'string') {
            assistantMessage = 'Ik kreeg geen geldig antwoord van de AI, probeer het nog eens.';
        }
        
        // Calculate only NEW tokens for rate limiter (user message + response, not full history)
        const userTokens = estimateTokens(userMessage);
        const responseTokens = estimateTokens(assistantMessage);
        const newTokens = userTokens + responseTokens;

        // Truncate response if too long for Discord embed
        if (assistantMessage.length > MAX_OUTPUT_LENGTH) {
            console.log(`[CHATBOT] Response te lang (${assistantMessage.length} chars), truncating...`);
            assistantMessage = assistantMessage.substring(0, MAX_OUTPUT_LENGTH - 50) + '\n\n_[...antwoord te lang, ingekort]_';
        }

        // Record request in rate limiter (only count new tokens, not full conversation history)
        rateLimiter.recordRequest(newTokens);

        // Add assistant response to database
        addMessageToConversation(conversationId, 'assistant', assistantMessage);

        console.log(`[CHATBOT] Response gegenereerd (${newTokens} nieuwe tokens, ${assistantMessage.length} chars)`);

        return {
            message: assistantMessage,
            conversationId
        };
    } catch (error) {
        console.error('[CHATBOT] Fout bij generateResponse:', error);
        
        // Handle specific errors
        if (error.status === 429) {
            throw new Error('Groq API rate limit bereikt. Probeer het over een paar minuten opnieuw.');
        } else if (error.status === 401) {
            throw new Error('Ongeldige Groq API key. Neem contact op met een admin.');
        } else if (error.status >= 500) {
            throw new Error('Groq API server error. Probeer het later opnieuw.');
        }
        
        throw error;
    }
}

// =====================================================
// ADMIN FUNCTIONS
// =====================================================

function resetConversation(channelId) {
    const db = getDatabase();

    try {
        const activeConversation = db.prepare(`
            SELECT id FROM chatbot_conversations
            WHERE channel_id = ? AND status = 'active'
            LIMIT 1
        `).get(channelId);

        if (activeConversation) {
            archiveConversation(activeConversation.id);
            return true;
        }

        return false;
    } catch (error) {
        console.error('[CHATBOT] Fout bij resetConversation:', error);
        throw error;
    }
}

function getConversationStats(channelId) {
    const db = getDatabase();

    try {
        const activeConversation = db.prepare(`
            SELECT * FROM chatbot_conversations
            WHERE channel_id = ? AND status = 'active'
            LIMIT 1
        `).get(channelId);

        if (!activeConversation) {
            return null;
        }

        const messageCount = db.prepare(`
            SELECT COUNT(*) as count FROM chatbot_messages
            WHERE conversation_id = ?
        `).get(activeConversation.id);

        const now = Math.floor(Date.now() / 1000);
        const ageMinutes = Math.floor((now - activeConversation.created_at) / 60);
        const lastMessageMinutes = Math.floor((now - activeConversation.last_message_at) / 60);

        return {
            conversationId: activeConversation.id,
            totalTokens: activeConversation.total_tokens,
            messageCount: messageCount.count,
            ageMinutes: ageMinutes,
            lastMessageMinutes: lastMessageMinutes,
            rateLimiterStatus: rateLimiter.getStatus()
        };
    } catch (error) {
        console.error('[CHATBOT] Fout bij getConversationStats:', error);
        throw error;
    }
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
    generateResponse,
    resetConversation,
    getConversationStats,
    getOrCreateConversation,
    archiveConversation
};
