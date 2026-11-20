/**
 * Keys en kisten
 * Een admin deelt keys uit (/admin keys add of keyall). Op de website open je er een kist mee: het rad draait en
 * de uitslag wordt op de server bepaald (crypto.randomInt), de client animeert alleen naar het vak dat de server noemt.
 * Er zijn drie soorten kisten; hoe zeldzamer de key, hoe hoger de prijzen.
 *
 * Elk rad heeft 12 vakken. De volgorde hieronder is de volgorde op het rad (hoge en lage vakken wisselen elkaar af),
 * de gewichten tellen op tot 1000.
 */

const crypto = require('crypto');
const { getDatabase } = require('../database');
const casino = require('./casino');

const CRATES = {
  wood: {
    key: 'wood', name: 'Houten kist', keyName: 'Houten key', keyNamePlural: 'Houten keys',
    segments: [
      [80, 170], [650, 40], [160, 120], [1600, 15], [50, 180], [400, 60],
      [220, 100], [3600, 5], [120, 150], [500, 50], [300, 80], [900, 30]
    ]
  },
  iron: {
    key: 'iron', name: 'IJzeren kist', keyName: 'IJzeren key', keyNamePlural: 'IJzeren keys',
    segments: [
      [160, 170], [1300, 40], [350, 120], [3000, 15], [100, 180], [800, 60],
      [450, 100], [6600, 5], [250, 150], [1000, 50], [600, 80], [1800, 30]
    ]
  },
  gold: {
    key: 'gold', name: 'Gouden kist', keyName: 'Gouden key', keyNamePlural: 'Gouden keys',
    segments: [
      [350, 170], [2600, 40], [700, 120], [5500, 15], [200, 180], [1600, 60],
      [900, 100], [14500, 5], [500, 150], [2000, 50], [1200, 80], [3500, 30]
    ]
  }
};
const KINDS = Object.keys(CRATES);
const MAX_PER_GRANT = 100;
const HISTORY = 12;

// Zeldzaamheid hangt aan de kans van het vak
function rarityOf(weight) {
  if (weight <= 5) return 'legendary';
  if (weight <= 15) return 'epic';
  if (weight <= 50) return 'rare';
  if (weight <= 100) return 'uncommon';
  return 'common';
}

function isKind(kind) {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(CRATES, kind);
}

function rollSegment(crate) {
  let roll = crypto.randomInt(0, 1000);
  for (let i = 0; i < crate.segments.length; i++) {
    const weight = crate.segments[i][1];
    if (roll < weight) return i;
    roll -= weight;
  }
  return 0;
}

function getConfig() {
  const crates = KINDS.map(kind => {
    const c = CRATES[kind];
    return {
      key: kind,
      name: c.name,
      keyName: c.keyName,
      keyNamePlural: c.keyNamePlural,
      segments: c.segments.map(([points, weight]) => ({ points, chance: weight / 1000, rarity: rarityOf(weight) }))
    };
  });
  return { crates };
}

function getKeys(userId) {
  const keys = Object.fromEntries(KINDS.map(kind => [kind, 0]));
  for (const row of getDatabase().prepare('SELECT kind, count FROM crate_keys WHERE user_id = ?').all(userId)) {
    if (isKind(row.kind)) keys[row.kind] = row.count;
  }
  return keys;
}

function getStats(userId) {
  const row = getDatabase().prepare(`
    SELECT COUNT(*) AS opened, COALESCE(SUM(points), 0) AS earned, COALESCE(MAX(points), 0) AS best
    FROM crate_log WHERE user_id = ?
  `).get(userId);
  return { opened: row.opened, earned: row.earned, best: row.best };
}

function getHistory(userId) {
  return getDatabase().prepare(`
    SELECT kind, segment, points, opened_at AS openedAt FROM crate_log WHERE user_id = ? ORDER BY id DESC LIMIT ${HISTORY}
  `).all(userId).filter(row => isKind(row.kind)).map(row => {
    const seg = CRATES[row.kind].segments[row.segment];
    return { ...row, rarity: seg ? rarityOf(seg[1]) : 'common' };
  });
}

function getStatus(userId) {
  return { serverNow: Date.now(), keys: getKeys(userId), stats: getStats(userId), history: getHistory(userId) };
}

/** Keys erbij voor één speler. Geeft het nieuwe aantal terug. */
function addKeys(userId, username, kind, amount) {
  if (!isKind(kind)) throw new Error('Onbekende soort key.');
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_PER_GRANT) throw new Error('Ongeldig aantal.');
  const db = getDatabase();
  casino.getOrCreateUser(userId, username);
  db.prepare(`
    INSERT INTO crate_keys (user_id, kind, count) VALUES (?, ?, ?)
    ON CONFLICT(user_id, kind) DO UPDATE SET count = count + excluded.count
  `).run(userId, kind, amount);
  return getKeys(userId)[kind];
}

/** Keys eraf (nooit onder nul). Geeft { removed, count } terug. */
function removeKeys(userId, kind, amount) {
  if (!isKind(kind)) throw new Error('Onbekende soort key.');
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_PER_GRANT) throw new Error('Ongeldig aantal.');
  const have = getKeys(userId)[kind];
  const removed = Math.min(have, amount);
  if (removed > 0) {
    getDatabase().prepare('UPDATE crate_keys SET count = count - ? WHERE user_id = ? AND kind = ?').run(removed, userId, kind);
  }
  return { removed, count: have - removed };
}

// Wie telt als casinospeler: iemand die op de website is ingelogd of ergens heeft gespeeld.
// De users-tabel is te ruim (daar staat ook wie alleen een quiz of weddenschap deed), dus we kijken naar deze tabellen.
const PLAYER_SOURCES = [
  'rocket_web_sessions', 'rocket_stats', 'blackjack_stats', 'plinko_stats', 'slots_stats', 'roulette_stats',
  'sterrenrad_stats', 'routegok_stats', 'mines_stats', 'afwas_stats', 'fuik_stats', 'daily_spin_log', 'crate_log'
];

function getCasinoPlayers() {
  const db = getDatabase();
  const ids = new Set();
  for (const table of PLAYER_SOURCES) {
    try {
      for (const row of db.prepare(`SELECT DISTINCT user_id FROM ${table}`).all()) ids.add(row.user_id);
    } catch (error) {
      // tabel bestaat nog niet (bijv. mines_stats voordat iemand ooit mines speelde)
    }
  }
  const names = new Map(db.prepare('SELECT user_id, username FROM users').all().map(r => [r.user_id, r.username]));
  return [...ids].map(id => ({ id, username: names.get(id) || 'speler' }));
}

/**
 * Keyall: alle casinospelers krijgen de key(s). Wie nooit in het casino kwam, krijgt niets.
 * Geeft { recipients, skipped } terug (skipped = mensen in users die niet meetellen).
 */
function addKeysToAll(kind, amount) {
  if (!isKind(kind)) throw new Error('Onbekende soort key.');
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_PER_GRANT) throw new Error('Ongeldig aantal.');
  const db = getDatabase();
  return db.transaction(() => {
    const recipients = getCasinoPlayers();
    const upsert = db.prepare(`
      INSERT INTO crate_keys (user_id, kind, count) VALUES (?, ?, ?)
      ON CONFLICT(user_id, kind) DO UPDATE SET count = count + excluded.count
    `);
    for (const r of recipients) upsert.run(r.id, kind, amount);
    const known = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    return { recipients, skipped: Math.max(0, known - recipients.length) };
  })();
}

/**
 * Een kist openen: key eraf, vak bepalen, punten bijschrijven. Alles in één transactie.
 * @param {{id: string, username: string}} user
 */
function open(user, kind) {
  if (!isKind(kind)) return { ok: false, message: 'Die kist bestaat niet.' };
  casino.getOrCreateUser(user.id, user.username);
  const crate = CRATES[kind];
  return getDatabase().transaction(() => {
    const db = getDatabase();
    const taken = db.prepare('UPDATE crate_keys SET count = count - 1 WHERE user_id = ? AND kind = ? AND count > 0').run(user.id, kind);
    if (taken.changes === 0) return { ok: false, code: 'nokey', message: `Je hebt geen ${crate.keyName}.`, ...getStatus(user.id) };

    const index = rollSegment(crate);
    const [points, weight] = crate.segments[index];
    casino.addBalance(user.id, user.username, points, `Kist: ${crate.name}`);
    db.prepare('INSERT INTO crate_log (user_id, username, kind, segment, points, opened_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, user.username, kind, index, points, Date.now());
    return {
      ok: true, kind, index, points, rarity: rarityOf(weight),
      balance: casino.getUserBalance(user.id),
      ...getStatus(user.id)
    };
  })();
}

module.exports = {
  CRATES,
  KINDS,
  MAX_PER_GRANT,
  isKind,
  getConfig,
  getKeys,
  getStatus,
  addKeys,
  removeKeys,
  getCasinoPlayers,
  addKeysToAll,
  open
};
