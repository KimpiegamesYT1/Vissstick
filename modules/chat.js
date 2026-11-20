/**
 * Site-chat: één gedeelde chat die op elke casino-pagina rechtsonder zit.
 *
 * - Berichten staan alleen in het geheugen (laatste HISTORY_SIZE), een herstart wist de chat.
 * - Lichte automatische moderatie (zie moderate()):
 *     * te snel / te veel berichten → geweigerd (flood)
 *     * links en Discord-uitnodigingen → geweigerd
 *     * hetzelfde bericht nog eens → geweigerd
 *     * scheldwoorden → worden vervangen door sterretjes
 *     * HOOFDLETTERS en uitgerekte letters ("heeeeeel") → vanzelf netjes gemaakt
 *     * wie steeds op de regels botst krijgt een korte time-out
 */
const { EventEmitter } = require('events');

const events = new EventEmitter();

const HISTORY_SIZE = 50;
const MAX_LENGTH = 200;
const MIN_GAP_MS = 1200;          // minimaal tussen twee berichten van dezelfde speler
const BURST_WINDOW_MS = 20000;
const BURST_MAX = 6;              // max berichten per BURST_WINDOW_MS
const DUPLICATE_WINDOW_MS = 30000;
const STRIKE_WINDOW_MS = 5 * 60 * 1000;
const STRIKE_LIMIT = 4;           // zoveel overtredingen binnen STRIKE_WINDOW_MS → time-out
const MUTE_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
const MUTE_MEMORY_MS = 30 * 60 * 1000;

// Scheldwoorden. 'exact' = alleen het hele woord (met evt. meervoud), 'stem' = ook in samenstellingen (kankerlijer).
// Woorden staan hier in gewone spelling; ze worden op dezelfde manier genormaliseerd als de berichten.
const EXACT_WORDS = [
  'kut', 'lul', 'hoer', 'slet', 'trut', 'eikel', 'mongool', 'flikker', 'neger',
  'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'retard', 'faggot', 'slut', 'whore'
];
// Begint een woord hiermee, dan telt het ook (kankerlijer, klootzak, teringlijer)
const PREFIX_WORDS = ['kanker', 'kloot', 'tering', 'tyfus', 'godver', 'nigger', 'nigga'];
// Ook als het ergens middenin een woord zit
const INFIX_WORDS = ['kanker', 'fuck', 'klootzak'];
// Woorden die op een scheldwoord lijken maar gewoon zijn (kutter = vissersboot!)
const SAFE_WORDS = ['kutter', 'kutters', 'kloof', 'klooster', 'shiitake'];

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '€': 'e' };

function normalizeWord(word) {
  return String(word)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[013457@$!€]/g, ch => LEET[ch] || ch)
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1'); // kuuuut → kut
}

const EXACT = new Set(EXACT_WORDS.map(normalizeWord));
const PREFIXES = PREFIX_WORDS.map(normalizeWord);
const INFIXES = INFIX_WORDS.map(normalizeWord);
const SAFE = new Set(SAFE_WORDS.map(normalizeWord));

function isBadWord(word) {
  const norm = normalizeWord(word);
  if (norm.length < 2 || SAFE.has(norm)) return false;
  if (EXACT.has(norm)) return true;
  // meervoud / verkleinwoord: kutje, lullen, hoeren, sletten
  const base = norm.replace(/(jes|je|en|s)$/, '');
  if (base !== norm && EXACT.has(base)) return true;
  return PREFIXES.some(stem => norm.startsWith(stem)) || INFIXES.some(stem => norm.includes(stem));
}

const LINK_PATTERN = /(https?:\/\/|www\.|discord\.gg|discord(?:app)?\.com\/invite|\b[a-z0-9-]{2,}\s?(?:\.|\(dot\)|\[dot\])\s?(?:com|nl|net|org|io|gg|me|xyz|ru|tk|ly|be|de|co|app|tv)\b)/i;

const messages = [];
let nextId = 1;
const lastMessage = new Map();  // userId → { text, at }
const recent = new Map();       // userId → [tijdstippen]
const strikes = new Map();      // userId → [tijdstippen]
const mutes = new Map();        // userId → { until, level, setAt }

function cleanText(raw) {
  let text = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Uitgerekte tekens: "heeeeeeel" → "heeel", "!!!!!!!" → "!!!"
  text = text.replace(/(.)\1{3,}/gu, '$1$1$1');
  // Schreeuwen: bijna alles in hoofdletters → kleine letters
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 8 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) text = text.toLowerCase();
  return text;
}

// Vervangt scheldwoorden door sterretjes. Geeft { text, masked } terug.
function maskProfanity(text) {
  let masked = false;
  const parts = text.split(/(\s+)/);
  // Losse letters achter elkaar ("k u t") worden als één woord gecontroleerd
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.trim()) continue;
    if (/^[^\s]$/.test(part)) {
      let j = i;
      let joined = '';
      while (j < parts.length && (parts[j].trim() === '' || /^[^\s]$/.test(parts[j]))) {
        joined += parts[j].trim();
        j++;
      }
      if (joined.length >= 3 && isBadWord(joined)) {
        for (let k = i; k < j; k++) if (parts[k].trim()) parts[k] = '*';
        masked = true;
        i = j - 1;
        continue;
      }
    }
    // Alleen het woord zelf maskeren, leestekens eromheen blijven staan
    const replaced = part.replace(/[^\s.,!?;:()"'*]+/g, word => {
      if (!isBadWord(word)) return word;
      masked = true;
      return '*'.repeat(Math.min(word.length, 8));
    });
    parts[i] = replaced;
  }
  return { text: parts.join(''), masked };
}

function addStrike(userId, now) {
  const list = (strikes.get(userId) || []).filter(at => now - at < STRIKE_WINDOW_MS);
  list.push(now);
  strikes.set(userId, list);
  if (list.length < STRIKE_LIMIT) return null;
  strikes.delete(userId);
  const previous = mutes.get(userId);
  const level = previous && now - previous.setAt < MUTE_MEMORY_MS ? Math.min(previous.level + 1, MUTE_MS.length - 1) : 0;
  const mute = { until: now + MUTE_MS[level], level, setAt: now };
  mutes.set(userId, mute);
  return mute;
}

function formatWait(ms) {
  const seconds = Math.ceil(ms / 1000);
  return seconds >= 90 ? `${Math.ceil(seconds / 60)} minuten` : `${seconds} seconden`;
}

function reject(message) {
  return { ok: false, message };
}

/**
 * Controleert en plaatst een bericht.
 * @returns {{ok: boolean, message?: string, notice?: string, chat?: object}}
 */
function send(user, raw, now = Date.now()) {
  if (!user || !user.id) return reject('Log in via Discord om te chatten.');

  const mute = mutes.get(user.id);
  if (mute && mute.until > now) return reject(`Je mag even niet chatten (nog ${formatWait(mute.until - now)}).`);

  const text = cleanText(raw);
  if (!text) return reject('Typ eerst iets.');
  if (text.length > MAX_LENGTH) return reject(`Bericht is te lang (max ${MAX_LENGTH} tekens).`);

  // Flood: te snel achter elkaar
  const times = (recent.get(user.id) || []).filter(at => now - at < BURST_WINDOW_MS);
  if (times.length && now - times[times.length - 1] < MIN_GAP_MS) return reject('Rustig aan, niet zo snel achter elkaar.');
  if (times.length >= BURST_MAX) return reject('Je typt te veel berichten, even wachten.');

  const violation = text => {
    const struck = addStrike(user.id, now);
    return struck ? `${text} Je krijgt een time-out van ${formatWait(struck.until - now)}.` : text;
  };

  if (LINK_PATTERN.test(text)) return reject(violation('Links zijn niet toegestaan in de chat.'));

  const previous = lastMessage.get(user.id);
  if (previous && now - previous.at < DUPLICATE_WINDOW_MS && previous.text === text.toLowerCase()) {
    return reject('Dit heb je net al gestuurd.');
  }

  const { text: finalText, masked } = maskProfanity(text);
  if (!/[^\s*.,!?]/.test(finalText)) return reject(violation('Dat bericht kan niet.'));

  times.push(now);
  recent.set(user.id, times);
  lastMessage.set(user.id, { text: text.toLowerCase(), at: now });

  const chat = { id: nextId++, userId: user.id, username: user.username, avatar: user.avatar || null, text: finalText, at: now };
  messages.push(chat);
  if (messages.length > HISTORY_SIZE) messages.shift();
  events.emit('message', toPublic(chat));

  let notice;
  if (masked) {
    const struck = addStrike(user.id, now);
    notice = struck
      ? `Let op je taalgebruik. Je krijgt een time-out van ${formatWait(struck.until - now)}.`
      : 'Let op je taalgebruik, scheldwoorden worden weggehaald.';
  }
  return { ok: true, notice, chat: toPublic(chat) };
}

function toPublic(chat) {
  return { id: chat.id, username: chat.username, avatar: chat.avatar, text: chat.text, at: chat.at };
}

function getHistory() {
  return messages.map(toPublic);
}

// Houdt de geheugenmappen klein
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of lastMessage) if (now - entry.at > DUPLICATE_WINDOW_MS) lastMessage.delete(id);
  for (const [id, list] of recent) if (!list.some(at => now - at < BURST_WINDOW_MS)) recent.delete(id);
  for (const [id, list] of strikes) if (!list.some(at => now - at < STRIKE_WINDOW_MS)) strikes.delete(id);
  for (const [id, mute] of mutes) if (now - mute.setAt > MUTE_MEMORY_MS && mute.until < now) mutes.delete(id);
}, 60000).unref();

module.exports = { events, send, getHistory, MAX_LENGTH };
