const { getDatabase } = require('../database');
const OpenAI = require('openai');
const https = require('https');
const { plantumlPngUrl } = require('./plantumlEncoder');

const config = require('../config.json');
const TARGET_CHANNEL = '1414596895191334928'; // fixed channel as requested

// In-memory state per channel
const channelState = new Map();

function getState(channelId) {
  if (!channelState.has(channelId)) {
    channelState.set(channelId, {
      count: 0,
      waitingForQualifyingMessage: false,
      busy: false
    });
  }
  return channelState.get(channelId);
}

function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function fetchPngBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', err => reject(err));
    }).on('error', err => reject(err));
  });
}

async function generatePlantUmlWithAI(messageText) {
  const apiKey = config.GROQ_API_KEY || config.OPENAI_API_KEY || null;
  if (!apiKey) throw new Error('Geen AI API key beschikbaar in config');

  const client = new OpenAI({ apiKey: apiKey, baseURL: 'https://api.groq.com/openai/v1' });

  const prompt = `Produce only a PlantUML use-case diagram (between @startuml and @enduml) for the following user message. Keep it compact, 4-8 use cases, infer actors from roles or nouns. DO NOT output any explanation or metadata. Message: """${messageText.replace(/"""/g, '"')}"""`;

  const resp = await client.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 600,
    temperature: 0.2
  });

  const content = resp?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Geen AI response');

  // Ensure it contains @startuml / @enduml; if not, wrap it
  if (content.includes('@startuml') && content.includes('@enduml')) {
    const start = content.indexOf('@startuml');
    const end = content.indexOf('@enduml') + '@enduml'.length;
    return content.slice(start, end).trim();
  }

  // fallback: wrap content
  return `@startuml\nleft to right direction\n${content.trim()}\n@enduml`;
}

async function handleMessage(message, client) {
  try {
    if (!message || !message.channel) return;
    if (message.author?.bot) return; // only user messages
    if (message.channel.id !== TARGET_CHANNEL) return;

    const state = getState(message.channel.id);

    // Increment count for every user message
    state.count += 1;

    // If reached exact multiple of 30, start waiting for qualifying message
    if (state.count % 30 === 0) {
      state.waitingForQualifyingMessage = true;
      console.log(`[USECASE] Reached ${state.count} messages in ${message.channel.id}, waiting for qualifying message (>=10 words)`);
      return;
    }

    // If we are waiting, check if this message qualifies
    if (state.waitingForQualifyingMessage && !state.busy) {
      const words = countWords(message.content || '');
      if (words >= 10) {
        state.waitingForQualifyingMessage = false;
        state.busy = true;
        console.log('[USECASE] Found qualifying message, generating diagram...');
        try {
          const uml = await generatePlantUmlWithAI(message.content || '');
          const url = plantumlPngUrl(uml);
          const buffer = await fetchPngBuffer(url);

          await message.reply({ files: [{ attachment: buffer, name: 'usecase.png' }], allowedMentions: { repliedUser: false } });
          console.log('[USECASE] Diagram sent');
        } catch (err) {
          console.error('[USECASE] Fout bij genereren of sturen diagram:', err);
          // clear waiting flag to avoid stuck state
          state.waitingForQualifyingMessage = false;
        } finally {
          state.busy = false;
        }
      }
    }
  } catch (error) {
    console.error('[USECASE] Unexpected error in handleMessage:', error);
  }
}

module.exports = {
  handleMessage
};
