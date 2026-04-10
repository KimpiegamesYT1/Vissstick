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
        this.serverRateLimit = {
            retryAfterUntil: 0,
            limitRequests: null,
            limitTokens: null,
            remainingRequests: null,
            remainingTokens: null,
            resetRequestsAt: 0,
            resetTokensAt: 0,
            lastUpdatedAt: 0
        };
        
        // Groq API limits
        this.LIMITS = {
            REQUESTS_PER_MINUTE: 30,
            REQUESTS_PER_DAY: 1000,
            TOKENS_PER_MINUTE: 8000,
            TOKENS_PER_DAY: 200000
        };
    }

    getHeader(headers, headerName) {
        if (!headers) return null;

        if (typeof headers.get === 'function') {
            const value = headers.get(headerName);
            return value == null ? null : String(value);
        }

        const lowerName = headerName.toLowerCase();
        for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === lowerName) {
                const value = headers[key];
                return value == null ? null : String(value);
            }
        }

        return null;
    }

    parseDurationToSeconds(value) {
        if (!value) return null;

        const text = String(value).trim().toLowerCase();
        if (!text) return null;

        if (/^\d+(\.\d+)?$/.test(text)) {
            return Number(text);
        }

        let seconds = 0;
        const hourMatch = text.match(/(\d+(?:\.\d+)?)h/);
        const minuteMatch = text.match(/(\d+(?:\.\d+)?)m/);
        const secondMatch = text.match(/(\d+(?:\.\d+)?)s/);

        if (hourMatch) seconds += Number(hourMatch[1]) * 3600;
        if (minuteMatch) seconds += Number(minuteMatch[1]) * 60;
        if (secondMatch) seconds += Number(secondMatch[1]);

        return seconds > 0 ? seconds : null;
    }

    updateFromHeaders(headers) {
        if (!headers) {
            return;
        }

        const now = Date.now();
        this.serverRateLimit.lastUpdatedAt = now;

        const retryAfterRaw = this.getHeader(headers, 'retry-after');
        const retryAfterSeconds = this.parseDurationToSeconds(retryAfterRaw);
        if (retryAfterSeconds != null) {
            const retryUntil = now + Math.ceil(retryAfterSeconds * 1000);
            this.serverRateLimit.retryAfterUntil = Math.max(this.serverRateLimit.retryAfterUntil, retryUntil);
        }

        const limitRequestsRaw = this.getHeader(headers, 'x-ratelimit-limit-requests');
        const limitTokensRaw = this.getHeader(headers, 'x-ratelimit-limit-tokens');
        const remainingRequestsRaw = this.getHeader(headers, 'x-ratelimit-remaining-requests');
        const remainingTokensRaw = this.getHeader(headers, 'x-ratelimit-remaining-tokens');
        const resetRequestsRaw = this.getHeader(headers, 'x-ratelimit-reset-requests');
        const resetTokensRaw = this.getHeader(headers, 'x-ratelimit-reset-tokens');

        const limitRequests = Number.parseInt(limitRequestsRaw, 10);
        const limitTokens = Number.parseInt(limitTokensRaw, 10);
        const remainingRequests = Number.parseInt(remainingRequestsRaw, 10);
        const remainingTokens = Number.parseInt(remainingTokensRaw, 10);

        if (Number.isFinite(limitRequests)) this.serverRateLimit.limitRequests = limitRequests;
        if (Number.isFinite(limitTokens)) this.serverRateLimit.limitTokens = limitTokens;
        if (Number.isFinite(remainingRequests)) this.serverRateLimit.remainingRequests = remainingRequests;
        if (Number.isFinite(remainingTokens)) this.serverRateLimit.remainingTokens = remainingTokens;

        const resetRequestsSeconds = this.parseDurationToSeconds(resetRequestsRaw);
        const resetTokensSeconds = this.parseDurationToSeconds(resetTokensRaw);

        if (resetRequestsSeconds != null) {
            this.serverRateLimit.resetRequestsAt = now + Math.ceil(resetRequestsSeconds * 1000);
        }

        if (resetTokensSeconds != null) {
            this.serverRateLimit.resetTokensAt = now + Math.ceil(resetTokensSeconds * 1000);
        }
    }

    refreshServerWindow() {
        const now = Date.now();

        if (this.serverRateLimit.retryAfterUntil && now >= this.serverRateLimit.retryAfterUntil) {
            this.serverRateLimit.retryAfterUntil = 0;
        }

        if (this.serverRateLimit.resetRequestsAt && now >= this.serverRateLimit.resetRequestsAt) {
            this.serverRateLimit.resetRequestsAt = 0;
            this.serverRateLimit.remainingRequests = null;
        }

        if (this.serverRateLimit.resetTokensAt && now >= this.serverRateLimit.resetTokensAt) {
            this.serverRateLimit.resetTokensAt = 0;
            this.serverRateLimit.remainingTokens = null;
        }
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
        this.refreshServerWindow();
        const now = Date.now();

        if (this.serverRateLimit.retryAfterUntil && now < this.serverRateLimit.retryAfterUntil) {
            return false;
        }

        const requestResetPending = this.serverRateLimit.resetRequestsAt && now < this.serverRateLimit.resetRequestsAt;
        const tokenResetPending = this.serverRateLimit.resetTokensAt && now < this.serverRateLimit.resetTokensAt;

        if (this.serverRateLimit.remainingRequests != null && this.serverRateLimit.remainingRequests <= 0 && requestResetPending) {
            return false;
        }

        if (this.serverRateLimit.remainingTokens != null && this.serverRateLimit.remainingTokens < estimatedTokens && tokenResetPending) {
            return false;
        }

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
        this.refreshServerWindow();

        const now = Date.now();

        const tokensThisMinute = this.tokensPerMinute.reduce((sum, entry) => sum + entry.tokens, 0);
        const tokensToday = this.tokensPerDay.reduce((sum, entry) => sum + entry.tokens, 0);
        const retryAfterSeconds = this.serverRateLimit.retryAfterUntil && now < this.serverRateLimit.retryAfterUntil
            ? Math.ceil((this.serverRateLimit.retryAfterUntil - now) / 1000)
            : 0;
        const resetRequestsSeconds = this.serverRateLimit.resetRequestsAt && now < this.serverRateLimit.resetRequestsAt
            ? Math.ceil((this.serverRateLimit.resetRequestsAt - now) / 1000)
            : 0;
        const resetTokensSeconds = this.serverRateLimit.resetTokensAt && now < this.serverRateLimit.resetTokensAt
            ? Math.ceil((this.serverRateLimit.resetTokensAt - now) / 1000)
            : 0;

        return {
            requestsPerMinute: this.requestsPerMinute.length,
            requestsPerDay: this.requestsPerDay.length,
            tokensPerMinute: tokensThisMinute,
            tokensPerDay: tokensToday,
            limits: this.LIMITS,
            serverRateLimit: {
                ...this.serverRateLimit,
                retryAfterSeconds,
                resetRequestsSeconds,
                resetTokensSeconds
            }
        };
    }
}

// Singleton rate limiter
const rateLimiter = new RateLimiter();

const CONVERSATION_INACTIVITY_SECONDS = 60 * 60;
const CONVERSATION_TOKEN_LIMIT = 6000;
const HISTORY_TOKEN_BUDGET = 5200;
const RECENT_MESSAGE_FALLBACK_LIMIT = 40;
const SNAPSHOT_TRIGGER_MESSAGE_COUNT = 36;
const SNAPSHOT_CHUNK_SIZE = 24;
const SNAPSHOT_KEEP_RECENT_MESSAGES = 10;
const SNAPSHOT_MAX_CONTEXT_MESSAGES = 3;
const SNAPSHOT_MAX_CHARS = 1800;
const SNAPSHOT_SUMMARY_MODEL = 'llama-3.1-8b-instant';

// =====================================================
// HELPER FUNCTIONS
// =====================================================

function estimateTokens(text) {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
}

function extractAssistantTextFromResponse(response) {
    const content = response?.choices?.[0]?.message?.content;

    if (typeof content === 'string') {
        return content.trim();
    }

    if (Array.isArray(content)) {
        const textParts = content
            .map(part => {
                if (!part) return '';
                if (typeof part === 'string') return part;
                if (part.type === 'text' && typeof part.text === 'string') return part.text;
                return '';
            })
            .filter(Boolean)
            .join('\n')
            .trim();

        return textParts;
    }

    return '';
}

function formatMessageForModel(msg) {
    if (msg.role === 'user') {
        const speaker = (msg.username || 'iemand').trim() || 'iemand';
        return `${speaker}: ${msg.content}`;
    }

    return msg.content;
}

function createSnapshotSummary(messages) {
    const lines = messages.map(msg => {
        const rawSpeaker = msg.role === 'user' ? (msg.username || 'iemand') : 'Vissstick';
        const speaker = String(rawSpeaker).trim() || 'iemand';
        const cleanContent = String(msg.content || '').replace(/\s+/g, ' ').trim().slice(0, 220);
        return `- ${speaker}: ${cleanContent}`;
    });

    return lines.join('\n').slice(0, SNAPSHOT_MAX_CHARS);
}

async function createSnapshotSummaryWithModel(messages, client) {
    if (!client) {
        return createSnapshotSummary(messages);
    }

    const transcript = messages.map(msg => {
        const rawSpeaker = msg.role === 'user' ? (msg.username || 'iemand') : 'Vissstick';
        const speaker = String(rawSpeaker).trim() || 'iemand';
        const cleanContent = String(msg.content || '').replace(/\s+/g, ' ').trim();
        return `${speaker}: ${cleanContent}`;
    }).join('\n');

    try {
        const { data, response } = await client.chat.completions.create({
            model: SNAPSHOT_SUMMARY_MODEL,
            temperature: 0.2,
            max_tokens: 260,
            messages: [
                {
                    role: 'system',
                    content: 'Maak een compacte Nederlandse samenvatting van een groepschat. Benoem kort wie wat zei, belangrijkste afspraken, open vragen en relevante inside context. Hou het feitelijk en maximaal 8 bullets in plain text.'
                },
                {
                    role: 'user',
                    content: transcript
                }
            ]
        }).withResponse();

        rateLimiter.updateFromHeaders(response?.headers);

        const modelSummary = extractAssistantTextFromResponse(data);
        if (!modelSummary) {
            return createSnapshotSummary(messages);
        }

        return modelSummary.slice(0, SNAPSHOT_MAX_CHARS);
    } catch (error) {
        console.warn('[CHATBOT] Llama snapshot summary mislukt, fallback naar extractieve samenvatting:', error?.message || error);
        return createSnapshotSummary(messages);
    }
}

function getRecentConversationMessages(conversationId, limit = 8) {
    const db = getDatabase();

    return db.prepare(`
        SELECT id, role, content, username, user_id, tokens, timestamp
        FROM chatbot_messages
        WHERE conversation_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
    `).all(conversationId, limit);
}

function getRecentMessagesForContext(conversationId, tokenBudget = HISTORY_TOKEN_BUDGET) {
    const recentMessagesDesc = getRecentConversationMessages(conversationId, RECENT_MESSAGE_FALLBACK_LIMIT);
    let usedTokens = 0;
    const selected = [];

    for (const msg of recentMessagesDesc) {
        const msgTokens = msg.tokens || estimateTokens(msg.content || '');
        if (selected.length > 0 && usedTokens + msgTokens > tokenBudget) {
            break;
        }

        selected.unshift(msg);
        usedTokens += msgTokens;
    }

    return selected;
}

function getMemorySnapshots(conversationId, limit = SNAPSHOT_MAX_CONTEXT_MESSAGES) {
    const db = getDatabase();

    try {
        return db.prepare(`
            SELECT id, summary, created_at
            FROM chatbot_memory_snapshots
            WHERE conversation_id = ?
            ORDER BY id DESC
            LIMIT ?
        `).all(conversationId, limit).reverse();
    } catch (error) {
        if (String(error.message || '').includes('no such table')) {
            return [];
        }

        throw error;
    }
}

function getLastSnapshotEndMessageId(conversationId) {
    const db = getDatabase();

    try {
        const row = db.prepare(`
            SELECT MAX(end_message_id) AS last_end_message_id
            FROM chatbot_memory_snapshots
            WHERE conversation_id = ?
        `).get(conversationId);

        return row?.last_end_message_id || 0;
    } catch (error) {
        if (String(error.message || '').includes('no such table')) {
            return 0;
        }

        throw error;
    }
}

async function maybeCreateConversationSnapshot(conversationId, client) {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);

    try {
        const lastSnapshotEndMessageId = getLastSnapshotEndMessageId(conversationId);
        const allUnsummarizedMessages = db.prepare(`
            SELECT id, role, username, content, timestamp
            FROM chatbot_messages
            WHERE conversation_id = ?
              AND id > ?
            ORDER BY id ASC
        `).all(conversationId, lastSnapshotEndMessageId);

        if (allUnsummarizedMessages.length < SNAPSHOT_TRIGGER_MESSAGE_COUNT) {
            return;
        }

        const maxSummarizableCount = allUnsummarizedMessages.length - SNAPSHOT_KEEP_RECENT_MESSAGES;
        if (maxSummarizableCount < SNAPSHOT_CHUNK_SIZE) {
            return;
        }

        const chunk = allUnsummarizedMessages.slice(0, SNAPSHOT_CHUNK_SIZE);
        const summary = await createSnapshotSummaryWithModel(chunk, client);

        db.prepare(`
            INSERT INTO chatbot_memory_snapshots (conversation_id, start_message_id, end_message_id, summary, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(conversationId, chunk[0].id, chunk[chunk.length - 1].id, summary, now);

        console.log(`[CHATBOT] Snapshot gemaakt voor conversatie ${conversationId} (${chunk[0].id}-${chunk[chunk.length - 1].id})`);
    } catch (error) {
        if (String(error.message || '').includes('no such table')) {
            return;
        }

        console.error('[CHATBOT] Fout bij maybeCreateConversationSnapshot:', error);
    }
}

function getActiveConversation(channelId) {
    const db = getDatabase();

    return db.prepare(`
        SELECT * FROM chatbot_conversations
        WHERE channel_id = ? AND status = 'active'
        ORDER BY last_message_at DESC
        LIMIT 1
    `).get(channelId);
}

function getConversationStartReason(activeConversation, now) {
    const oneHourAgo = now - CONVERSATION_INACTIVITY_SECONDS;

    if (!activeConversation) {
        return 'geen actieve conversatie';
    }

    if (activeConversation.last_message_at < oneHourAgo) {
        return 'inactiviteit (>60min)';
    }

    if (activeConversation.total_tokens > CONVERSATION_TOKEN_LIMIT) {
        return `token limiet (${activeConversation.total_tokens}/${CONVERSATION_TOKEN_LIMIT})`;
    }

    return null;
}

// =====================================================
// CONVERSATION MANAGEMENT
// =====================================================

function getOrCreateConversation(channelId) {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - CONVERSATION_INACTIVITY_SECONDS;

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
        } else if (activeConversation.total_tokens > CONVERSATION_TOKEN_LIMIT) {
            needNewConversation = true;
            reason = `token limiet (${activeConversation.total_tokens}/${CONVERSATION_TOKEN_LIMIT})`;
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

function getConversationHistory(conversationId) {
    const db = getDatabase();

    try {
        const messages = getRecentMessagesForContext(conversationId, HISTORY_TOKEN_BUDGET);
        const snapshots = getMemorySnapshots(conversationId, SNAPSHOT_MAX_CONTEXT_MESSAGES);

        // Build OpenAI chat format with system prompt
        const history = [
            {
                role: 'system',
                content: `Je bent Visstick, een Discord-bot met een sterke eigen mening en een speels karakter. Hoewel je diep van binnen heel behulpzaam bent, vind je het saai om een standaard robot te zijn. Je houdt ervan om mensen een beetje te plagen, maar je blijft altijd vriendelijk en toegankelijk.
Richtlijnen voor gedrag:
Beleefde Start: Je begint gesprekken altijd heel netjes en enthousiast om de sfeer goed te houden.
Lichte Ironie: Je gebruikt milde humor en ironie. In plaats van iemand af te kraken, maak je een grappige opmerking over de situatie.
Behulpzaam met een Twist: Je doet wat de gebruiker vraagt, maar je geeft er altijd een eigenwijs commentaar bij of een grappige suggestie die net even anders is.
Geen Harde Woorden: Je vermijdt grove taal en scheldwoorden volledig. Je bent brutaal op een grappige, onschuldige manier (zoals een ondeugend neefje).
Creatieve Verzinsels: Als je iets niet weet, verzin je soms een overduidelijk absurd verhaal om de chat op te vrolijken, voordat je het echte antwoord geeft.
Betrokkenheid: Je onthoudt kleine details over gebruikers om later op een leuke manier naar terug te verwijzen.`
            }
        ];

        snapshots.forEach(snapshot => {
            history.push({
                role: 'system',
                content: `Samenvatting van eerdere context in deze chatID:\n${snapshot.summary}`
            });
        });

        // Add conversation messages
        messages.forEach(msg => {
            history.push({
                role: msg.role,
                content: formatMessageForModel(msg)
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

function getConversationMessageCount(conversationId) {
    const db = getDatabase();

    const row = db.prepare(`
        SELECT COUNT(*) as count
        FROM chatbot_messages
        WHERE conversation_id = ?
    `).get(conversationId);

    return row?.count || 0;
}

// =====================================================
// GROQ API INTEGRATION
// =====================================================

async function generateResponse(channelId, userMessage, userId, username, groqApiKey) {
    // Constants
    const MAX_MESSAGE_LENGTH = 2000; // Discord message limit
    const MAX_OUTPUT_LENGTH = 4000; // Safe limit voor Discord embeds (max 4096)
    const PRIMARY_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
    const FALLBACK_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
    let usedFallbackModel = false;

    try {
        // Check message length
        if (userMessage.length > MAX_MESSAGE_LENGTH) {
            throw new Error(`Je bericht is te lang (${userMessage.length} karakters). Maximum is ${MAX_MESSAGE_LENGTH} karakters.`);
        }

        const now = Math.floor(Date.now() / 1000);
        const activeConversationBefore = getActiveConversation(channelId);
        let startedNewConversationReason = getConversationStartReason(activeConversationBefore, now);

        // Get or create conversation
        let conversationId = getOrCreateConversation(channelId);

        const startedNewConversation = getConversationMessageCount(conversationId) === 0;

        // Check rate limits with conservative estimate (only new tokens, not full history)
        const estimatedNewTokens = estimateTokens(userMessage) + 300; // User message + estimated response
        if (!rateLimiter.canMakeRequest(estimatedNewTokens)) {
            const status = rateLimiter.getStatus();
            const waitSeconds = status.serverRateLimit.retryAfterSeconds || status.serverRateLimit.resetTokensSeconds || status.serverRateLimit.resetRequestsSeconds || 0;
            const waitLine = waitSeconds > 0 ? `\nProbeer opnieuw over ongeveer ${waitSeconds}s.` : '';
            throw new Error(
                `Rate limit bereikt.${waitLine}\n\nLokaal requests: ${status.requestsPerMinute}/${status.limits.REQUESTS_PER_MINUTE}/min\nLokaal tokens: ${status.tokensPerMinute}/${status.limits.TOKENS_PER_MINUTE}/min\nAPI remaining requests (RPD): ${status.serverRateLimit.remainingRequests ?? 'onbekend'}\nAPI remaining tokens (TPM): ${status.serverRateLimit.remainingTokens ?? 'onbekend'}`
            );
        }

        // Add user message to database
        addMessageToConversation(conversationId, 'user', userMessage, userId, username);

        // Call Groq API
        const client = new OpenAI({
            apiKey: groqApiKey,
            baseURL: 'https://api.groq.com/openai/v1',
            timeout: 15000,
            maxRetries: 1
        });

        // Build compact memory snapshot only within this conversation/chat ID.
        await maybeCreateConversationSnapshot(conversationId, client);

        // Get conversation history
        const history = getConversationHistory(conversationId);

        console.log(`[CHATBOT] API call voor conversatie ${conversationId}, ${history.length} berichten in history`);

        let response;

        try {
            const primaryResult = await client.chat.completions.create({
                model: PRIMARY_MODEL,
                messages: history,
                temperature: 0.5,
                max_tokens: 1024
            }).withResponse();

            rateLimiter.updateFromHeaders(primaryResult.response?.headers);
            response = primaryResult.data;
        } catch (apiError) {
            rateLimiter.updateFromHeaders(apiError?.headers);
            const isToolUseFailure = apiError?.status === 400 && apiError?.code === 'tool_use_failed';

            if (!isToolUseFailure) {
                throw apiError;
            }

            console.warn('[CHATBOT] Primary model gaf tool_use_failed, retry met fallback model');
            usedFallbackModel = true;
            const fallbackResult = await client.chat.completions.create({
                model: FALLBACK_MODEL,
                messages: history,
                temperature: 1.1,
                max_tokens: 1024
            }).withResponse();

            rateLimiter.updateFromHeaders(fallbackResult.response?.headers);
            response = fallbackResult.data;
        }

        let assistantMessage = extractAssistantTextFromResponse(response);

        if (!assistantMessage) {
            console.warn('[CHATBOT] Leeg/ongeldig modelantwoord, extra retry met strikte tekstinstructie');

            const strictHistory = [
                ...history,
                {
                    role: 'system',
                    content: 'Geef ALTIJD een direct antwoord als platte tekst in het Nederlands. Gebruik geen tools, JSON of speciale output-formaten.'
                }
            ];

            try {
                usedFallbackModel = true;
                const strictRetryResult = await client.chat.completions.create({
                    model: FALLBACK_MODEL,
                    messages: strictHistory,
                    temperature: 0.2,
                    max_tokens: 220
                }).withResponse();

                rateLimiter.updateFromHeaders(strictRetryResult.response?.headers);

                assistantMessage = extractAssistantTextFromResponse(strictRetryResult.data);
            } catch (strictRetryError) {
                rateLimiter.updateFromHeaders(strictRetryError?.headers);
                console.error('[CHATBOT] Strict retry mislukt:', strictRetryError);
            }
        }

        if (!assistantMessage) {
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
            conversationId,
            startedNewConversation,
            startedNewConversationReason,
            usedFallbackModel,
            fallbackModelName: FALLBACK_MODEL
        };
    } catch (error) {
        console.error('[CHATBOT] Fout bij generateResponse:', error);
        
        // Handle specific errors
        if (error.status === 429) {
            rateLimiter.updateFromHeaders(error?.headers);
            const status = rateLimiter.getStatus();
            const waitSeconds = status.serverRateLimit.retryAfterSeconds || status.serverRateLimit.resetTokensSeconds || status.serverRateLimit.resetRequestsSeconds || 0;
            const waitHint = waitSeconds > 0 ? ` Wacht ongeveer ${waitSeconds}s.` : ' Probeer het over een paar minuten opnieuw.';
            throw new Error(`Groq API rate limit bereikt.${waitHint}`);
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

        const snapshotCount = db.prepare(`
            SELECT COUNT(*) as count FROM chatbot_memory_snapshots
            WHERE conversation_id = ?
        `).get(activeConversation.id);

        const now = Math.floor(Date.now() / 1000);
        const ageMinutes = Math.floor((now - activeConversation.created_at) / 60);
        const lastMessageMinutes = Math.floor((now - activeConversation.last_message_at) / 60);

        return {
            conversationId: activeConversation.id,
            totalTokens: activeConversation.total_tokens,
            messageCount: messageCount.count,
            snapshotCount: snapshotCount.count,
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
