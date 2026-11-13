/**
 * Slots (fruitautomaat) op de website
 * De uitslag (inclusief cascades, free spins, hold & win en het fever-rad) wordt hier bepaald;
 * inzet en uitbetaling gaan in één transactie. De spel-logica zelf staat in slotsEngine.js.
 *
 * Voortgang per speler: elke betaalde spin geeft 1 XP. Nieuwe niveaus zetten nieuwe features aan; je kunt
 * altijd een lager (ontgrendeld) niveau kiezen. De fever-meter vult per betaalde spin en draait na
 * FEVER_SPINS spins aan het fever-rad met je gemiddelde inzet van die spins.
 */

const crypto = require('crypto');
const { getDatabase } = require('../database');
const casino = require('./casino');
const engine = require('./slotsEngine');

const MIN_BET = 5;
const MAX_BET = 250;

// Snelle cryptografische random in [0, 1) (48 bits), uit een buffer
let pool = Buffer.alloc(0);
let offset = 0;
function rand() {
  if (offset + 6 > pool.length) { pool = crypto.randomBytes(6 * 4096); offset = 0; }
  const value = pool.readUIntBE(offset, 6);
  offset += 6;
  return value / 2 ** 48;
}

function levelForXp(xp) {
  let level = 1;
  for (const cfg of engine.LEVELS) if (xp >= cfg.xp) level = cfg.level;
  return level;
}

function getConfig() {
  return {
    minBet: MIN_BET,
    maxBet: MAX_BET,
    maxWinX: engine.MAX_WIN_X,
    levels: engine.publicLevels(),
    pay3: engine.PAY3,
    cherry3: engine.CHERRY3,
    pay5: engine.PAY5,
    cherry5: engine.CHERRY5_TWO,
    scatterPay: engine.SCATTER_PAY,
    scatterSpins: engine.SCATTER_SPINS,
    retrigger: engine.RETRIGGER_SPINS,
    cascadeMults: engine.CASCADE_MULTS,
    jackpots: engine.JACKPOTS,
    feverSpins: engine.FEVER_SPINS,
    feverWheel: engine.FEVER_WHEEL,
    rtp: engine.TARGET_RTP
  };
}

function getRow(userId) {
  return getDatabase().prepare('SELECT * FROM slots_stats WHERE user_id = ?').get(userId) || null;
}

function publicProgress(row) {
  const xp = row ? row.xp : 0;
  const level = levelForXp(xp);
  return {
    xp,
    level,
    fever: { spins: row ? row.fever_spins : 0, need: engine.FEVER_SPINS },
    stats: row ? {
      spins: row.spins, total_bet: row.total_bet, total_payout: row.total_payout, biggest_win: row.biggest_win,
      biggest_multiplier: row.biggest_multiplier, free_spins: row.free_spins, holds: row.holds, fevers: row.fevers
    } : null
  };
}

function getStatus(userId) {
  return publicProgress(getRow(userId));
}

/**
 * Eén spin
 * @param {{id: string, username: string}} user
 */
function spin(user, betInput, machineInput) {
  const bet = Number(betInput);
  if (!Number.isInteger(bet) || bet < MIN_BET || bet > MAX_BET) {
    return { ok: false, message: `Ongeldige inzet: kies een bedrag tussen ${MIN_BET} en ${MAX_BET} punten.` };
  }

  const db = getDatabase();
  casino.getOrCreateUser(user.id, user.username);

  return db.transaction(() => {
    const balance = casino.getUserBalance(user.id);
    if (balance < bet) {
      return { ok: false, message: `Niet genoeg punten: je wilt ${bet} inzetten, maar je hebt er maar ${balance}.` };
    }

    const row = getRow(user.id) || { xp: 0, fever_spins: 0, fever_wagered: 0 };
    const unlocked = levelForXp(row.xp);
    const machine = machineInput === undefined || machineInput === null ? unlocked : Number(machineInput);
    if (!Number.isInteger(machine) || machine < 1 || machine > unlocked) {
      return { ok: false, message: 'Dat niveau heb je nog niet vrijgespeeld.' };
    }

    const cfg = engine.LEVELS[machine - 1];
    const result = engine.spin(cfg, bet, rand);
    const payout = Math.max(0, Math.round(result.total));

    // Fever-meter
    let feverSpins = row.fever_spins + 1;
    let feverWagered = row.fever_wagered + bet;
    let fever = null;
    if (feverSpins >= engine.FEVER_SPINS) {
      const avgBet = Math.max(1, Math.round(feverWagered / feverSpins));
      fever = engine.spinFever(avgBet, rand);
      fever.bet = avgBet;
      fever.payout = Math.round(fever.win);
      feverSpins = 0;
      feverWagered = 0;
    }

    const xp = row.xp + 1;
    const level = levelForXp(xp);
    const totalPayout = payout + (fever ? fever.payout : 0);
    const multiplier = Math.round((payout / bet) * 100) / 100;

    casino.subtractBalance(user.id, bet);
    if (totalPayout > 0) casino.addBalance(user.id, user.username, totalPayout, `Slots ${multiplier}x`);

    db.prepare(`
      INSERT INTO slots_stats (user_id, username, spins, total_bet, total_payout, biggest_win, biggest_multiplier,
        free_spins, holds, fevers, xp, fever_spins, fever_wagered, last_played)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        spins = spins + 1,
        total_bet = total_bet + excluded.total_bet,
        total_payout = total_payout + excluded.total_payout,
        biggest_win = MAX(biggest_win, excluded.biggest_win),
        biggest_multiplier = MAX(biggest_multiplier, excluded.biggest_multiplier),
        free_spins = free_spins + excluded.free_spins,
        holds = holds + excluded.holds,
        fevers = fevers + excluded.fevers,
        xp = excluded.xp,
        fever_spins = excluded.fever_spins,
        fever_wagered = excluded.fever_wagered,
        last_played = excluded.last_played
    `).run(
      user.id, user.username, bet, totalPayout, Math.max(0, payout - bet), multiplier,
      result.free ? 1 : 0, result.hold ? 1 : 0, fever ? 1 : 0, xp, feverSpins, feverWagered
    );

    // Alleen wat de website nodig heeft
    delete result.lineWin;
    delete result.fixedWin;

    return {
      ok: true,
      message: '',
      bet,
      machine,
      result,
      payout,
      fever,
      progress: publicProgress(getRow(user.id)),
      levelUp: level > unlocked ? level : null
    };
  })();
}

module.exports = {
  getConfig,
  getStatus,
  spin
};
