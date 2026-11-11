/**
 * Rocket website koppeling
 * Een speler vraagt in Discord een persoonlijke link op (eenmalige code, 10 min geldig).
 * Die code wordt bij openen ingewisseld voor een sessie-cookie, daarna blijft de speler ingelogd.
 * In de database staat alleen een hash van de sessie-token.
 */

const crypto = require('crypto');
const { getDatabase } = require('../database');

const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
const loginCodes = new Map();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function cleanupLoginCodes() {
  const now = Date.now();
  for (const [code, entry] of loginCodes) {
    if (entry.expiresAt <= now) loginCodes.delete(code);
  }
}

/**
 * Maak een eenmalige inlogcode voor een Discord gebruiker
 * @param {{id: string, username: string, avatar: string|null}} user
 */
function createLoginCode(user) {
  cleanupLoginCodes();
  const code = crypto.randomBytes(24).toString('base64url');
  loginCodes.set(code, { ...user, expiresAt: Date.now() + LOGIN_CODE_TTL_MS });
  return code;
}

/**
 * Wissel een inlogcode in voor een nieuwe sessie-token
 * @returns {string|null} sessie-token, of null als de code ongeldig/verlopen is
 */
function redeemLoginCode(code) {
  cleanupLoginCodes();
  const entry = loginCodes.get(String(code || ''));
  if (!entry) return null;
  loginCodes.delete(code);

  const token = crypto.randomBytes(32).toString('base64url');
  getDatabase().prepare(`
    INSERT INTO rocket_web_sessions (token_hash, user_id, username, avatar_url)
    VALUES (?, ?, ?, ?)
  `).run(hashToken(token), entry.id, entry.username, entry.avatar);
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

module.exports = {
  createLoginCode,
  redeemLoginCode,
  getSessionUser,
  deleteSession
};
