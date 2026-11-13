/**
 * Plinko
 * Een bal valt door een driehoek van pinnen en kaatst bij elke rij naar links of rechts.
 * Waar hij onderin landt bepaalt de multiplier. Spelers kiezen 8–16 rijen en laag/midden/hoog risico.
 * De uitslag (het pad van de bal) wordt op de server bepaald; de website speelt alleen de animatie af.
 * De multipliers zijn de bekende Plinko-tabellen met ~99% uitbetaling (1% huisvoordeel).
 */

const crypto = require('crypto');
const { getDatabase } = require('../database');
const casino = require('./casino');

const MIN_BET = 1;
const MAX_BET = 250;
const MIN_ROWS = 8;
const MAX_ROWS = 16;
const RISKS = ['low', 'medium', 'high'];

// Linker helft (tot en met het midden); de rechterkant is gespiegeld
const HALF_TABLES = {
  8: { low: [5.6, 2.1, 1.1, 1, 0.5], medium: [13, 3, 1.3, 0.7, 0.4], high: [29, 4, 1.5, 0.3, 0.2] },
  9: { low: [5.6, 2, 1.6, 1, 0.7], medium: [18, 4, 1.7, 0.9, 0.5], high: [43, 7, 2, 0.6, 0.2] },
  10: { low: [8.9, 3, 1.4, 1.1, 1, 0.5], medium: [22, 5, 2, 1.4, 0.6, 0.4], high: [76, 10, 3, 0.9, 0.3, 0.2] },
  11: { low: [8.4, 3, 1.9, 1.3, 1, 0.7], medium: [24, 6, 3, 1.8, 0.7, 0.5], high: [120, 14, 5.2, 1.4, 0.4, 0.2] },
  12: { low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5], medium: [33, 11, 4, 2, 1.1, 0.6, 0.3], high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2] },
  13: { low: [8.1, 4, 3, 1.9, 1.2, 0.9, 0.7], medium: [43, 13, 6, 3, 1.3, 0.7, 0.4], high: [260, 37, 11, 4, 1, 0.2, 0.2] },
  14: { low: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5], medium: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2], high: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2] },
  15: { low: [15, 8, 3, 2, 1.5, 1.1, 1, 0.7], medium: [88, 18, 11, 5, 3, 1.3, 0.5, 0.3], high: [620, 83, 27, 8, 3, 0.5, 0.2, 0.2] },
  16: { low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5], medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3], high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2] }
};

// Volledige tabellen: rows + 1 vakjes van links naar rechts
const PAYOUTS = {};
for (const [rows, risks] of Object.entries(HALF_TABLES)) {
  PAYOUTS[rows] = {};
  for (const [risk, half] of Object.entries(risks)) {
    const mirror = half.slice(0, Number(rows) % 2 ? half.length : half.length - 1).reverse();
    PAYOUTS[rows][risk] = [...half, ...mirror];
  }
}

/**
 * Instellingen + tabellen voor de website
 */
function getConfig() {
  return { minBet: MIN_BET, maxBet: MAX_BET, minRows: MIN_ROWS, maxRows: MAX_ROWS, risks: RISKS, payouts: PAYOUTS };
}

function getStats(userId) {
  return getDatabase().prepare('SELECT games_played, total_bet, total_payout, biggest_win, biggest_multiplier FROM plinko_stats WHERE user_id = ?').get(userId) || null;
}

/**
 * Laat één bal vallen
 * @param {{id: string, username: string}} user
 */
function drop(user, betInput, riskInput, rowsInput) {
  const bet = Number(betInput);
  const rows = Number(rowsInput);
  const risk = String(riskInput || '');
  if (!Number.isInteger(bet) || bet < MIN_BET || bet > MAX_BET) {
    return { ok: false, message: `Ongeldige inzet: kies een bedrag tussen ${MIN_BET} en ${MAX_BET} punten.` };
  }
  if (!Number.isInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS) {
    return { ok: false, message: `Kies tussen ${MIN_ROWS} en ${MAX_ROWS} rijen.` };
  }
  if (!RISKS.includes(risk)) {
    return { ok: false, message: 'Kies een risico: laag, midden of hoog.' };
  }

  const db = getDatabase();
  casino.getOrCreateUser(user.id, user.username);

  return db.transaction(() => {
    const balance = casino.getUserBalance(user.id);
    if (balance < bet) {
      return { ok: false, message: `Niet genoeg punten: je wilt ${bet} inzetten, maar je hebt er maar ${balance}.` };
    }

    // 0 = links, 1 = rechts; het aantal keer rechts is het vakje
    const path = Array.from({ length: rows }, () => crypto.randomInt(0, 2));
    const bucket = path.reduce((sum, step) => sum + step, 0);
    const multiplier = PAYOUTS[rows][risk][bucket];
    const payout = Math.floor(bet * multiplier);

    casino.subtractBalance(user.id, bet);
    if (payout > 0) casino.addBalance(user.id, user.username, payout, `Plinko ${multiplier}x`);

    db.prepare(`
      INSERT INTO plinko_stats (user_id, username, games_played, total_bet, total_payout, biggest_win, biggest_multiplier, last_played)
      VALUES (?, ?, 1, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        games_played = games_played + 1,
        total_bet = total_bet + excluded.total_bet,
        total_payout = total_payout + excluded.total_payout,
        biggest_win = MAX(biggest_win, excluded.biggest_win),
        biggest_multiplier = MAX(biggest_multiplier, excluded.biggest_multiplier),
        last_played = excluded.last_played
    `).run(user.id, user.username, bet, payout, Math.max(0, payout - bet), multiplier);

    return { ok: true, message: '', bet, rows, risk, path, bucket, multiplier, payout };
  })();
}

module.exports = {
  PAYOUTS,
  getConfig,
  getStats,
  drop
};
