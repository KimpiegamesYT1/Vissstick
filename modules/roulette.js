/**
 * Roulette (Europees, één nul)
 * Spelers leggen fiches op de tafel en draaien. Alle bekende inzetten zijn mogelijk:
 *   binnen: getal (35:1), split (17:1), street/trio (11:1), carré/basket (8:1), sixline (5:1)
 *   buiten: dozijn en kolom (2:1), rood/zwart, even/oneven, 1-18/19-36 (1:1)
 * Een inzet op k getallen betaalt 36/k keer de inzet terug (inclusief inzet), dus overal 2,7% huisvoordeel.
 * De uitslag wordt op de server bepaald; de website speelt alleen de animatie af.
 */

const crypto = require('crypto');
const { getDatabase } = require('../database');
const casino = require('./casino');

const MIN_CHIP = 1;
const MAX_TOTAL_BET = 500;
const MAX_BETS = 80;        // verschillende vakken per spin
const HISTORY_SIZE = 20;
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

// Laatste uitslagen per speler (alleen in het geheugen)
const histories = new Map();

function getConfig() {
  return { minChip: MIN_CHIP, maxTotalBet: MAX_TOTAL_BET, maxBets: MAX_BETS, chips: CHIPS, wheel: WHEEL, red: [...RED], bets: Object.fromEntries(BETS) };
}

function getStats(userId) {
  return getDatabase().prepare('SELECT games_played, total_bet, total_payout, biggest_win FROM roulette_stats WHERE user_id = ?').get(userId) || null;
}

function getHistory(userId) {
  return histories.get(userId) || [];
}

/**
 * Inzetten controleren en samenvoegen
 * @returns {{error: string} | {bets: Array<{key: string, amount: number}>, total: number}}
 */
function parseBets(input) {
  if (!Array.isArray(input) || input.length === 0) return { error: 'Leg eerst fiches op de tafel.' };
  if (input.length > MAX_BETS) return { error: `Maximaal ${MAX_BETS} verschillende inzetten per spin.` };
  const merged = new Map();
  for (const bet of input) {
    const key = String(bet && bet.key || '');
    const amount = Number(bet && bet.amount);
    if (!BETS.has(key)) return { error: 'Ongeldige inzet op de tafel.' };
    if (!Number.isInteger(amount) || amount < MIN_CHIP) return { error: 'Ongeldig bedrag op de tafel.' };
    merged.set(key, (merged.get(key) || 0) + amount);
  }
  const bets = [...merged].map(([key, amount]) => ({ key, amount }));
  const total = bets.reduce((sum, bet) => sum + bet.amount, 0);
  if (total > MAX_TOTAL_BET) return { error: `Je mag maximaal ${MAX_TOTAL_BET} punten per spin inzetten (nu ${total}).` };
  return { bets, total };
}

/**
 * Eén keer draaien
 * @param {{id: string, username: string}} user
 */
function spin(user, betsInput) {
  const parsed = parseBets(betsInput);
  if (parsed.error) return { ok: false, message: parsed.error };
  const { bets, total } = parsed;

  const db = getDatabase();
  casino.getOrCreateUser(user.id, user.username);

  return db.transaction(() => {
    const balance = casino.getUserBalance(user.id);
    if (balance < total) {
      return { ok: false, message: `Niet genoeg punten: je wilt ${total} inzetten, maar je hebt er maar ${balance}.` };
    }

    const result = crypto.randomInt(0, 37);
    let payout = 0;
    const settled = bets.map(bet => {
      const numbers = BETS.get(bet.key);
      const win = numbers.includes(result) ? bet.amount * (36 / numbers.length) : 0;
      payout += win;
      return { key: bet.key, amount: bet.amount, win };
    });

    casino.subtractBalance(user.id, total);
    if (payout > 0) casino.addBalance(user.id, user.username, payout, `Roulette ${result}`);

    db.prepare(`
      INSERT INTO roulette_stats (user_id, username, games_played, total_bet, total_payout, biggest_win, last_played)
      VALUES (?, ?, 1, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        games_played = games_played + 1,
        total_bet = total_bet + excluded.total_bet,
        total_payout = total_payout + excluded.total_payout,
        biggest_win = MAX(biggest_win, excluded.biggest_win),
        last_played = excluded.last_played
    `).run(user.id, user.username, total, payout, Math.max(0, payout - total));

    const history = [result, ...getHistory(user.id)].slice(0, HISTORY_SIZE);
    histories.set(user.id, history);

    return { ok: true, message: '', result, color: colorOf(result), bets: settled, totalBet: total, payout };
  })();
}

module.exports = {
  BETS,
  WHEEL,
  getConfig,
  getStats,
  getHistory,
  spin
};
