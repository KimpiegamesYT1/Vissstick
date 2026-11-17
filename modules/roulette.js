/**
 * Roulette (Europees, één nul), multiplayer
 * Eén gedeelde tafel voor iedereen op de website (live via api/casinoWeb.js, net als Rocket).
 *   - De eerste fiche opent een ronde: BETTING_MS lang kan iedereen fiches leggen en weer weghalen.
 *     De inzet gaat meteen van je saldo af en staat in open_stakes (teruggestort na een herstart).
 *   - Daarna draait het wiel. De uitslag ligt vast zodra de inzetten sluiten; na LAND_MS ligt de bal
 *     in het vakje en worden de winsten uitbetaald. Na RESULT_MS kan de volgende ronde beginnen.
 *
 * Alle bekende inzetten zijn mogelijk:
 *   binnen: getal (35:1), split (17:1), street/trio (11:1), carré/eerste vier (8:1), sixline (5:1)
 *   buiten: dozijn en kolom (2:1), rood/zwart, even/oneven, 1-18/19-36 (1:1)
 * Een inzet op k getallen betaalt 36/k keer de inzet terug (inclusief inzet), dus overal 2,7% huisvoordeel.
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { getDatabase } = require('../database');
const casino = require('./casino');

const MIN_CHIP = 1;
const MAX_TOTAL_BET = 500;
const MAX_BETS = 80;        // verschillende vakken per spin
const HISTORY_SIZE = 20;
const MAX_PLAYERS = 30;
const BETTING_MS = 20000;  // inzetfase
const SPIN_MS = 7600;      // animatie van het wiel op de website
const LAND_MS = 5600;      // na zoveel ms ligt de bal stil (dan wordt er uitbetaald)
const RESULT_MS = 5000;    // uitslag blijft even staan voor de volgende ronde kan beginnen
const CHIPS = [1, 5, 10, 25, 100];

// Volgorde op het wiel (met de klok mee, vanaf 0)
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const colorOf = n => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const range = (from, to, step = 1) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

/**
 * Alle geldige inzetten: sleutel -> getallen die hij dekt.
 * Binnen-inzetten hebben als sleutel de gesorteerde getallen met streepjes ("17", "17-20", "0-1-2-3").
 */
const BETS = new Map();
function addBet(key, numbers) { BETS.set(key, numbers); }
function addInside(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  addBet(sorted.join('-'), sorted);
}

for (let n = 0; n <= 36; n++) addInside([n]);
for (let n = 1; n <= 36; n++) {
  if (n % 3 !== 0) addInside([n, n + 1]);                           // split omhoog
  if (n <= 33) addInside([n, n + 3]);                               // split opzij
  if (n % 3 !== 0 && n <= 32) addInside([n, n + 1, n + 3, n + 4]);  // carré
  if (n % 3 === 1) addInside([n, n + 1, n + 2]);                    // street
  if (n % 3 === 1 && n <= 31) addInside(range(n, n + 5));           // sixline
}
[[0, 1], [0, 2], [0, 3], [0, 1, 2], [0, 2, 3], [0, 1, 2, 3]].forEach(addInside);

addBet('red', range(1, 36).filter(n => RED.has(n)));
addBet('black', range(1, 36).filter(n => !RED.has(n)));
addBet('even', range(2, 36, 2));
addBet('odd', range(1, 35, 2));
addBet('low', range(1, 18));
addBet('high', range(19, 36));
for (let i = 1; i <= 3; i++) {
  addBet(`dozen${i}`, range(i * 12 - 11, i * 12));
  addBet(`col${i}`, range(i, 33 + i, 3));
}

const events = new EventEmitter();
const history = [];     // laatste uitslagen van de tafel
let round = null;       // huidige (of laatste) ronde
let roundSeq = 0;

const stakeRef = (r, userId) => `${r.id}:${userId}`;
const emitUpdate = () => events.emit('update');

function getConfig() {
  return {
    minChip: MIN_CHIP, maxTotalBet: MAX_TOTAL_BET, maxBets: MAX_BETS, maxPlayers: MAX_PLAYERS, chips: CHIPS,
    bettingMs: BETTING_MS, spinMs: SPIN_MS, landMs: LAND_MS, resultMs: RESULT_MS,
    wheel: WHEEL, red: [...RED], bets: Object.fromEntries(BETS)
  };
}

function getStats(userId) {
  return getDatabase().prepare('SELECT games_played, total_bet, total_payout, biggest_win FROM roulette_stats WHERE user_id = ?').get(userId) || null;
}

/**
 * Publieke tafelstatus. De uitslag zit er pas in als de inzetten gesloten zijn.
 */
function getPublicState() {
  const r = round;
  return {
    serverNow: Date.now(),
    history,
    round: r && {
      id: r.id,
      phase: r.phase,
      bettingEndsAt: r.bettingEndsAt,
      spinStartAt: r.spinStartAt,
      landAt: r.landAt,
      nextAt: r.nextAt,
      result: r.phase === 'betting' ? null : r.result,
      color: r.phase === 'betting' ? null : colorOf(r.result),
      players: [...r.players.values()].map(p => ({
        userId: p.userId,
        username: p.username,
        avatar: p.avatar,
        total: p.total,
        bets: p.bets,
        payout: p.payout,
        balance: casino.getUserBalance(p.userId)
      }))
    }
  };
}

/**
 * Inzetten controleren en samenvoegen (een lege lijst = alles weghalen)
 * @returns {{error: string} | {bets: Array<{key: string, amount: number}>, total: number}}
 */
function parseBets(input) {
  if (!Array.isArray(input)) return { error: 'Ongeldige inzet op de tafel.' };
  if (input.length > MAX_BETS) return { error: `Maximaal ${MAX_BETS} verschillende inzetten per ronde.` };
  const merged = new Map();
  for (const bet of input) {
    const key = String((bet && bet.key) || '');
    const amount = Number(bet && bet.amount);
    if (!BETS.has(key)) return { error: 'Ongeldige inzet op de tafel.' };
    if (!Number.isInteger(amount) || amount < MIN_CHIP) return { error: 'Ongeldig bedrag op de tafel.' };
    merged.set(key, (merged.get(key) || 0) + amount);
  }
  if (merged.size > MAX_BETS) return { error: `Maximaal ${MAX_BETS} verschillende inzetten per ronde.` };
  const bets = [...merged].map(([key, amount]) => ({ key, amount }));
  const total = bets.reduce((sum, bet) => sum + bet.amount, 0);
  if (total > MAX_TOTAL_BET) return { error: `Je mag maximaal ${MAX_TOTAL_BET} punten per ronde inzetten (nu ${total}).` };
  return { bets, total };
}

function openRound() {
  const now = Date.now();
  round = {
    id: `${now.toString(36)}${(++roundSeq).toString(36)}`,
    phase: 'betting',
    players: new Map(),
    bettingEndsAt: now + BETTING_MS,
    spinStartAt: null,
    landAt: null,
    nextAt: null,
    result: null
  };
  const r = round;
  setTimeout(() => {
    try {
      closeBets(r);
    } catch (error) {
      console.error('[ROULETTE] Fout bij draaien, inzetten worden teruggestort:', error);
      refundRound(r);
    }
  }, BETTING_MS);
  return r;
}

function refundRound(r) {
  for (const p of r.players.values()) {
    if (p.total > 0) casino.addBalance(p.userId, p.username, p.total, 'Roulette: terugbetaling na fout');
    casino.releaseStake('roulette', stakeRef(r, p.userId));
  }
  r.phase = 'cancelled';
  emitUpdate();
}

/**
 * Inzetten van een speler voor deze ronde vervangen door een nieuwe lijst.
 * De oude inzet wordt teruggestort, de nieuwe afgeschreven. De eerste fiche opent een nieuwe ronde.
 * @param {{id: string, username: string, avatar: string|null}} user
 */
function placeBets(user, betsInput) {
  const parsed = parseBets(betsInput);
  if (parsed.error) return { ok: false, message: parsed.error };
  const { bets, total } = parsed;

  if (round && round.phase === 'spinning') {
    return { ok: false, code: 'closed', message: 'De inzetten zijn gesloten, het wiel draait al.' };
  }
  if (round && round.phase === 'result' && Date.now() < round.nextAt) {
    return { ok: false, code: 'closed', message: 'Even wachten, de volgende ronde begint zo.' };
  }
  if (!round || round.phase !== 'betting') {
    if (!total) return { ok: true, message: '' };
    openRound();
  }
  const r = round;
  if (Date.now() >= r.bettingEndsAt) return { ok: false, code: 'closed', message: 'De inzetten zijn gesloten, het wiel draait al.' };

  const existing = r.players.get(user.id);
  if (!existing && total && r.players.size >= MAX_PLAYERS) {
    return { ok: false, message: `De tafel zit vol: er spelen al ${MAX_PLAYERS} spelers mee.` };
  }

  const db = getDatabase();
  casino.getOrCreateUser(user.id, user.username);
  const result = db.transaction(() => {
    const previous = existing ? existing.total : 0;
    const available = casino.getUserBalance(user.id) + previous;
    if (available < total) {
      return { ok: false, message: `Niet genoeg punten: je wilt ${total} inzetten, maar je hebt er maar ${available}.` };
    }
    if (previous) casino.addBalance(user.id, user.username, previous, 'Roulette inzet aangepast');
    if (total) casino.subtractBalance(user.id, total);
    casino.setStake('roulette', stakeRef(r, user.id), user.id, user.username, total);
    return { ok: true, message: '' };
  })();
  if (!result.ok) return result;

  if (total) {
    r.players.set(user.id, { userId: user.id, username: user.username, avatar: user.avatar || null, bets, total, payout: null });
  } else {
    r.players.delete(user.id);
  }
  emitUpdate();
  return { ok: true, message: '', roundId: r.id, bets, total };
}

function closeBets(r) {
  if (round !== r || r.phase !== 'betting') return;
  if (!r.players.size) {
    // Iedereen heeft zijn fiches weer weggehaald: ronde vervalt
    r.phase = 'cancelled';
    r.nextAt = Date.now();
    emitUpdate();
    return;
  }
  r.result = crypto.randomInt(0, 37);
  r.phase = 'spinning';
  r.spinStartAt = Date.now() + 300;
  r.landAt = r.spinStartAt + LAND_MS;
  emitUpdate();
  setTimeout(() => {
    try {
      settle(r);
    } catch (error) {
      console.error('[ROULETTE] Fout bij uitbetalen, inzetten worden teruggestort:', error);
      refundRound(r);
    }
  }, r.landAt - Date.now());
}

function settle(r) {
  if (r.phase !== 'spinning') return;
  const db = getDatabase();
  const insertStats = db.prepare(`
    INSERT INTO roulette_stats (user_id, username, games_played, total_bet, total_payout, biggest_win, last_played)
    VALUES (?, ?, 1, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      games_played = games_played + 1,
      total_bet = total_bet + excluded.total_bet,
      total_payout = total_payout + excluded.total_payout,
      biggest_win = MAX(biggest_win, excluded.biggest_win),
      last_played = excluded.last_played
  `);
  db.transaction(() => {
    for (const p of r.players.values()) {
      let payout = 0;
      for (const bet of p.bets) {
        const numbers = BETS.get(bet.key);
        if (numbers.includes(r.result)) payout += bet.amount * (36 / numbers.length);
      }
      p.payout = payout;
      if (payout > 0) casino.addBalance(p.userId, p.username, payout, `Roulette ${r.result}`);
      casino.releaseStake('roulette', stakeRef(r, p.userId));
      insertStats.run(p.userId, p.username, p.total, payout, Math.max(0, payout - p.total));
    }
  })();
  history.unshift(r.result);
  if (history.length > HISTORY_SIZE) history.pop();
  r.phase = 'result';
  r.nextAt = Date.now() + RESULT_MS;
  emitUpdate();
}

module.exports = {
  BETS,
  WHEEL,
  events,
  getConfig,
  getStats,
  getPublicState,
  placeBets
};
