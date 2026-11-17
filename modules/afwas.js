/**
 * Afwassen
 * Voor spelers die (bijna) blut zijn: onder de 50 punten mag je in de keuken borden afwassen.
 * Borden komen over een lopende band binnen; elk bord dat op tijd schoon is levert POINTS_PER_PLATE (5) punten op.
 *
 * Het schrobben zelf gebeurt in de browser. De server deelt de borden uit en controleert alleen
 * dat het niet sneller gaat dan een mens kan: een nieuw bord pas na PLATE_INTERVAL_MS en een bord
 * telt pas als het minstens MIN_CLEAN_MS op de band heeft gelegen. Zo zijn het hooguit ~13 borden per minuut.
 */

const crypto = require('crypto');
const { getDatabase } = require('../database');
const casino = require('./casino');

const MAX_BALANCE = 50;          // alleen onder dit saldo mag je afwassen
const POINTS_PER_PLATE = 5;
const PLATE_INTERVAL_MS = 4500;  // minimale tijd tussen twee nieuwe borden
const MIN_CLEAN_MS = 6500;       // een bord moet minstens zo lang op de band liggen
const MAX_PLATE_MS = 3 * 60 * 1000;
const MAX_OPEN_PLATES = 5;

// userId -> { lastIssueAt, plates: Map<plateId, issuedAt> }
const shifts = new Map();

function getShift(userId) {
  if (!shifts.has(userId)) shifts.set(userId, { lastIssueAt: 0, plates: new Map() });
  return shifts.get(userId);
}

// Oude, vergeten borden opruimen
setInterval(() => {
  const now = Date.now();
  for (const [userId, shift] of shifts) {
    for (const [id, issuedAt] of shift.plates) {
      if (now - issuedAt > MAX_PLATE_MS) shift.plates.delete(id);
    }
    if (!shift.plates.size && now - shift.lastIssueAt > MAX_PLATE_MS) shifts.delete(userId);
  }
}, 60 * 1000).unref();

function canWash(userId) {
  return casino.getUserBalance(userId) < MAX_BALANCE;
}

function getConfig() {
  return { maxBalance: MAX_BALANCE, pointsPerPlate: POINTS_PER_PLATE, plateIntervalMs: PLATE_INTERVAL_MS, minCleanMs: MIN_CLEAN_MS };
}

function getStats(userId) {
  return getDatabase().prepare('SELECT plates_cleaned, plates_rejected, points_earned FROM afwas_stats WHERE user_id = ?').get(userId) || null;
}

function bumpStats(user, cleaned, rejected) {
  getDatabase().prepare(`
    INSERT INTO afwas_stats (user_id, username, plates_cleaned, plates_rejected, points_earned, last_played)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      plates_cleaned = plates_cleaned + excluded.plates_cleaned,
      plates_rejected = plates_rejected + excluded.plates_rejected,
      points_earned = points_earned + excluded.points_earned,
      last_played = excluded.last_played
  `).run(user.id, user.username, cleaned, rejected, cleaned * POINTS_PER_PLATE);
}

const tooRich = balance => ({
  ok: false,
  code: 'rich',
  message: `Je hebt ${balance} punten. Afwassen is alleen voor wie minder dan ${MAX_BALANCE} punten heeft.`
});

/**
 * Een nieuw vuil bord op de band
 * @param {{id: string, username: string}} user
 */
function nextPlate(user) {
  casino.getOrCreateUser(user.id, user.username);
  const balance = casino.getUserBalance(user.id);
  if (balance >= MAX_BALANCE) return tooRich(balance);

  const shift = getShift(user.id);
  const now = Date.now();
  const wait = shift.lastIssueAt + PLATE_INTERVAL_MS - now;
  if (wait > 0) return { ok: false, code: 'wait', retryMs: wait, message: 'Het volgende bord komt eraan.' };

  // Te veel open borden: de oudste is toch al van de band gevallen
  while (shift.plates.size >= MAX_OPEN_PLATES) {
    shift.plates.delete(shift.plates.keys().next().value);
  }

  const id = crypto.randomBytes(8).toString('hex');
  shift.plates.set(id, now);
  shift.lastIssueAt = now;
  return { ok: true, message: '', plate: { id, seed: crypto.randomInt(1, 2 ** 31) } };
}

function takePlate(user, plateId) {
  const shift = shifts.get(user.id);
  const id = String(plateId || '');
  if (!shift || !shift.plates.has(id)) return null;
  const issuedAt = shift.plates.get(id);
  shift.plates.delete(id);
  return issuedAt;
}

/**
 * Bord is schoon: POINTS_PER_PLATE punten
 */
function cleanPlate(user, plateId) {
  const issuedAt = takePlate(user, plateId);
  if (issuedAt === null) return { ok: false, code: 'unknown', message: 'Dit bord ken ik niet (meer).' };
  const age = Date.now() - issuedAt;
  if (age < MIN_CLEAN_MS) return { ok: false, code: 'fast', message: 'Dat ging verdacht snel. De chef keurt dit bord af.' };
  if (age > MAX_PLATE_MS) return { ok: false, code: 'old', message: 'Dit bord lag te lang op de band.' };

  return getDatabase().transaction(() => {
    const balance = casino.getUserBalance(user.id);
    if (balance >= MAX_BALANCE) return tooRich(balance);
    casino.addBalance(user.id, user.username, POINTS_PER_PLATE, 'Afwassen');
    bumpStats(user, 1, 0);
    return { ok: true, message: '', points: POINTS_PER_PLATE };
  })();
}

/**
 * Bord afgekeurd (niet op tijd schoon)
 */
function rejectPlate(user, plateId) {
  if (takePlate(user, plateId) !== null) bumpStats(user, 0, 1);
  return { ok: true, message: '' };
}

module.exports = {
  MAX_BALANCE,
  canWash,
  getConfig,
  getStats,
  nextPlate,
  cleanPlate,
  rejectPlate
};
