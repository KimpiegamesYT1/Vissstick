/**
 * Website koppeling (Rocket + Dagelijkse spin)
 * Een speler krijgt via Discord een persoonlijke link met een eenmalige code.
 * Die code wordt bij openen ingewisseld voor een sessie-cookie, daarna blijft de speler ingelogd.
 * In de database staan alleen hashes van codes en sessie-tokens.
 */

const crypto = require('crypto');
const { getDatabase } = require('../database');

const DEFAULT_CODE_TTL_MS = 10 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Maak een eenmalige inlogcode voor een Discord gebruiker
 * @param {{id: string, username: string, avatar: string|null}} user
 * @param {number} ttlMs - hoe lang de code geldig is (ochtend-DM's gebruiken een langere geldigheid)
 */
function createLoginCode(user, ttlMs = DEFAULT_CODE_TTL_MS) {
  const db = getDatabase();
  db.prepare('DELETE FROM web_login_codes WHERE expires_at <= ?').run(Date.now());
  const code = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO web_login_codes (code_hash, user_id, username, avatar_url, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(hashToken(code), user.id, user.username, user.avatar, Date.now() + ttlMs);
  return code;
}

/**
 * Wissel een inlogcode in voor een nieuwe sessie-token
 * @returns {string|null} sessie-token, of null als de code ongeldig/verlopen is
 */
function redeemLoginCode(code) {
  if (!code) return null;
  const db = getDatabase();
  const hash = hashToken(code);
  const entry = db.prepare('SELECT * FROM web_login_codes WHERE code_hash = ?').get(hash);
  if (!entry) return null;
  db.prepare('DELETE FROM web_login_codes WHERE code_hash = ?').run(hash);
  if (entry.expires_at <= Date.now()) return null;

  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(`
    INSERT INTO rocket_web_sessions (token_hash, user_id, username, avatar_url)
    VALUES (?, ?, ?, ?)
  `).run(hashToken(token), entry.user_id, entry.username, entry.avatar_url);
  return token;
}

/**
 * @returns {{id: string, username: string, avatar: string|null}|null}
 */
function getSessionUser(token) {
  if (!token) return null;
  const db = getDatabase();
  const hash = hashToken(token);
  const row = db.prepare('SELECT user_id, username, avatar_url FROM rocket_web_sessions WHERE token_hash = ?').get(hash);
  if (!row) return null;
  db.prepare(`UPDATE rocket_web_sessions SET last_seen = datetime('now') WHERE token_hash = ?`).run(hash);
  return { id: row.user_id, username: row.username, avatar: row.avatar_url };
}

function deleteSession(token) {
  if (!token) return;
  getDatabase().prepare('DELETE FROM rocket_web_sessions WHERE token_hash = ?').run(hashToken(token));
}

/**
 * Persoonlijke inloglink naar een pagina van de website
 * @param {string} webUrl - basis-URL zonder slash aan het eind
 * @param {'/rocket'|'/spin'} next - pagina na het inloggen
 */
function createLoginLink(webUrl, user, next = '/rocket', ttlMs = DEFAULT_CODE_TTL_MS) {
  return `${webUrl}/login?code=${createLoginCode(user, ttlMs)}&next=${encodeURIComponent(next)}`;
}

module.exports = {
  createLoginCode,
  createLoginLink,
  redeemLoginCode,
  getSessionUser,
  deleteSession
};
