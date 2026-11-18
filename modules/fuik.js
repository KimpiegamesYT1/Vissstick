/**
 * Fuiken
 * Iedereen heeft SLOTS fuiken in de vijver. Een fuik zet je uit met één tik; na READY_MS zit er iets in.
 * Haal je hem op, dan krijg je de vangst (punten) en gaat de fuik meteen weer het water in.
 * Blijf je te lang weg (langer dan ESCAPE_MS na het uitzetten), dan is de vangst weggezwommen en
 * levert die ronde niets op. Wie vaak langskomt, verdient dus het meest.
 *
 * De vangst wordt pas bij het ophalen bepaald (op de server), en alle tijden komen van de server.
 * De stand staat in de database, dus een herstart van de bot kost niemand zijn fuiken.
 */

const crypto = require('crypto');
const { getDatabase } = require('../database');
const casino = require('./casino');

const SLOTS = 3;
const READY_MS = 15 * 60 * 1000;   // zo lang moet een fuik in het water liggen
const ESCAPE_MS = 45 * 60 * 1000;  // na zo lang (vanaf uitzetten) is de vangst weg

// Gewichten tellen op tot 1000. Gemiddeld ~8 punten per fuik.
const CATCHES = [
  { key: 'laars', name: 'Oude laars', points: 0, weight: 150, color: '#7a6a58' },
  { key: 'voorn', name: 'Voorn', points: 4, weight: 300, color: '#b9c6cf' },
  { key: 'baars', name: 'Baars', points: 7, weight: 240, color: '#9fb44a' },
  { key: 'brasem', name: 'Brasem', points: 10, weight: 150, color: '#c9a86a' },
  { key: 'snoekbaars', name: 'Snoekbaars', points: 16, weight: 90, color: '#8aa3a8' },
  { key: 'paling', name: 'Paling', points: 25, weight: 45, color: '#5d6b3a' },
  { key: 'snoek', name: 'Snoek', points: 40, weight: 20, color: '#6f8f4e' },
  { key: 'goudkarper', name: 'Gouden karper', points: 125, weight: 5, color: '#f2c14e' }
];
const CATCH_BY_KEY = Object.fromEntries(CATCHES.map(c => [c.key, c]));
const TOTAL_WEIGHT = CATCHES.reduce((sum, c) => sum + c.weight, 0);

function rollCatch() {
  let roll = crypto.randomInt(0, TOTAL_WEIGHT);
  for (const c of CATCHES) {
    if (roll < c.weight) return c;
    roll -= c.weight;
  }
  return CATCHES[0];
}

function getConfig() {
  return {
    slots: SLOTS,
    readyMs: READY_MS,
    escapeMs: ESCAPE_MS,
    catches: CATCHES.map(({ key, name, points, weight, color }) => ({ key, name, points, color, chance: weight / TOTAL_WEIGHT }))
  };
}

function getTraps(userId) {
  const rows = getDatabase().prepare('SELECT slot, set_at FROM fuik_traps WHERE user_id = ?').all(userId);
  const traps = Array.from({ length: SLOTS }, () => null);
  for (const row of rows) {
    if (row.slot >= 0 && row.slot < SLOTS) {
      traps[row.slot] = { setAt: row.set_at, readyAt: row.set_at + READY_MS, escapeAt: row.set_at + ESCAPE_MS };
    }
  }
  return traps;
}

function getStats(userId) {
  return getDatabase().prepare(`
    SELECT hauls, fish_caught, escaped, points_earned, best_points, best_key
    FROM fuik_stats WHERE user_id = ?
  `).get(userId) || null;
}

function getBook(userId) {
  const book = {};
  for (const row of getDatabase().prepare('SELECT species, count FROM fuik_book WHERE user_id = ?').all(userId)) {
    book[row.species] = row.count;
  }
  return book;
}

function getStatus(userId) {
  return { serverNow: Date.now(), traps: getTraps(userId), stats: getStats(userId), book: getBook(userId) };
}

function bumpStats(user, { hauls = 0, fish = 0, escaped = 0, points = 0, best = null }) {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO fuik_stats (user_id, username, hauls, fish_caught, escaped, points_earned, best_points, best_key, last_played)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      hauls = hauls + excluded.hauls,
      fish_caught = fish_caught + excluded.fish_caught,
      escaped = escaped + excluded.escaped,
      points_earned = points_earned + excluded.points_earned,
      best_key = CASE WHEN excluded.best_points > best_points THEN excluded.best_key ELSE best_key END,
      best_points = MAX(best_points, excluded.best_points),
      last_played = excluded.last_played
  `).run(user.id, user.username, hauls, fish, escaped, points, best ? best.points : 0, best ? best.key : null);
}

function setTrap(userId, slot, now) {
  getDatabase().prepare(`
    INSERT INTO fuik_traps (user_id, slot, set_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id, slot) DO UPDATE SET set_at = excluded.set_at
  `).run(userId, slot, now);
}

/**
 * Eén fuik aantikken: leeg → uitzetten, vol → ophalen (en weer uitzetten), vergeten → opnieuw uitzetten.
 * Geeft { kind: 'set' | 'haul' | 'escaped' | 'wait', ... } terug.
 */
function handleSlot(user, slot, now, traps) {
  const trap = traps[slot];
  if (!trap) {
    setTrap(user.id, slot, now);
    return { slot, kind: 'set' };
  }
  if (now < trap.readyAt) return { slot, kind: 'wait', readyAt: trap.readyAt };
  if (now >= trap.escapeAt) {
    setTrap(user.id, slot, now);
    bumpStats(user, { escaped: 1 });
    return { slot, kind: 'escaped' };
  }

  const c = rollCatch();
  setTrap(user.id, slot, now);
  if (c.points > 0) casino.addBalance(user.id, user.username, c.points, `Fuik: ${c.name}`);
  bumpStats(user, { hauls: 1, fish: c.key === 'laars' ? 0 : 1, points: c.points, best: c });
  getDatabase().prepare(`
    INSERT INTO fuik_book (user_id, species, count) VALUES (?, ?, 1)
    ON CONFLICT(user_id, species) DO UPDATE SET count = count + 1
  `).run(user.id, c.key);
  return { slot, kind: 'haul', catch: { key: c.key, name: c.name, points: c.points, color: c.color } };
}

function finish(user, results) {
  const points = results.reduce((sum, r) => sum + (r.catch ? r.catch.points : 0), 0);
  return { ok: true, message: '', results, points, ...getStatus(user.id) };
}

/**
 * @param {{id: string, username: string}} user
 * @param {number} slot
 */
function tap(user, slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) return { ok: false, message: 'Die fuik bestaat niet.' };
  casino.getOrCreateUser(user.id, user.username);
  return getDatabase().transaction(() => {
    const now = Date.now();
    const result = handleSlot(user, slot, now, getTraps(user.id));
    if (result.kind === 'wait') {
      return { ok: false, code: 'wait', message: 'Deze fuik ligt nog maar net in het water.', ...getStatus(user.id) };
    }
    return finish(user, [result]);
  })();
}

/**
 * Alles wat kan in één keer: volle fuiken ophalen, lege en vergeten fuiken (weer) uitzetten.
 */
function tapAll(user) {
  casino.getOrCreateUser(user.id, user.username);
  return getDatabase().transaction(() => {
    const now = Date.now();
    const traps = getTraps(user.id);
    const results = [];
    for (let slot = 0; slot < SLOTS; slot++) {
      const result = handleSlot(user, slot, now, traps);
      if (result.kind !== 'wait') results.push(result);
    }
    if (!results.length) return { ok: false, code: 'wait', message: 'Er is nog niets op te halen.', ...getStatus(user.id) };
    return finish(user, results);
  })();
}

module.exports = {
  SLOTS,
  CATCH_BY_KEY,
  getConfig,
  getStatus,
  tap,
  tapAll
};
