/**
 * Statistieken voor de /stats pagina op de casino-website.
 *
 * - getOverview(): alles per speler samengevoegd (saldo, winst/verlies per spel, records, maandwinnaars)
 * - recordRocket() / recordBlackjackHand(): de website-spellen Rocket en de blackjack tafel
 *   hielden zelf geen stats bij; die worden hier opgeslagen (blackjack in dezelfde tabel als /blackjack in Discord).
 *
 * Opslaan mag een spel nooit laten mislukken, daarom vangen de record-functies hun eigen fouten af.
 */

const crypto = require('crypto');
const { getDatabase } = require('../database');

const CACHE_MS = 15000;
const HALL_OF_FAME_MONTHS = 12;

let cache = null;

// =====================================================
// OPSLAAN
// =====================================================

/**
 * Eén speler in een Rocket ronde. payout = 0 als de raket crashte voordat er uitgecasht werd.
 */
function recordRocket(userId, username, bet, payout, cashedAt) {
  try {
    getDatabase().prepare(`
      INSERT INTO rocket_stats (user_id, username, games_played, wins, total_bet, total_payout, biggest_win, best_multiplier, last_played)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        games_played = games_played + 1,
        wins = wins + excluded.wins,
        total_bet = total_bet + excluded.total_bet,
        total_payout = total_payout + excluded.total_payout,
        biggest_win = MAX(biggest_win, excluded.biggest_win),
        best_multiplier = MAX(best_multiplier, excluded.best_multiplier),
        last_played = excluded.last_played
    `).run(userId, username, payout > 0 ? 1 : 0, bet, payout, Math.max(0, payout - bet), payout > 0 ? cashedAt || 0 : 0);
    cache = null;
  } catch (error) {
    console.error('[STATS] Rocket opslaan mislukt:', error);
  }
}

/**
 * Eén hand aan de blackjack tafel (website). Zelfde betekenis als recordBlackjackResult in Discord:
 * total_won = nettowinst bij winst, total_lost = inzet bij verlies.
 * @param {'win'|'blackjack'|'push'|'lose'} outcome
 */
function recordBlackjackHand(userId, username, bet, payout, outcome) {
  try {
    const db = getDatabase();
    const isWin = outcome === 'win' || outcome === 'blackjack';
    const isLoss = outcome === 'lose';
    const net = payout - bet;
    const row = db.prepare('SELECT current_streak, best_streak FROM blackjack_stats WHERE user_id = ?').get(userId);
    const prev = row ? row.current_streak : 0;
    const streak = isWin ? (prev >= 0 ? prev + 1 : 1) : isLoss ? (prev <= 0 ? prev - 1 : -1) : 0;
    db.prepare(`
      INSERT INTO blackjack_stats (user_id, username, games_played, wins, losses, pushes, blackjacks, total_bet, total_won, total_lost,
        biggest_win, current_streak, best_streak, last_played)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        games_played = games_played + 1,
        wins = wins + excluded.wins,
        losses = losses + excluded.losses,
        pushes = pushes + excluded.pushes,
        blackjacks = blackjacks + excluded.blackjacks,
        total_bet = total_bet + excluded.total_bet,
        total_won = total_won + excluded.total_won,
        total_lost = total_lost + excluded.total_lost,
        biggest_win = MAX(biggest_win, excluded.biggest_win),
        current_streak = excluded.current_streak,
        best_streak = MAX(best_streak, excluded.best_streak),
        last_played = excluded.last_played
    `).run(
      userId, username,
      isWin ? 1 : 0, isLoss ? 1 : 0, outcome === 'push' ? 1 : 0, outcome === 'blackjack' ? 1 : 0,
      bet, net > 0 ? net : 0, isLoss ? bet : 0, net > 0 ? net : 0,
      streak, Math.max(row ? row.best_streak : 0, streak)
    );
    cache = null;
  } catch (error) {
    console.error('[STATS] Blackjack opslaan mislukt:', error);
  }
}

// =====================================================
// UITLEZEN
// =====================================================

function toMs(value) {
  if (!value) return 0;
  const ms = Date.parse(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  return Number.isFinite(ms) ? ms : 0;
}

// Openbare sleutel per speler (geen Discord ID op de pagina)
function publicKey(userId) {
  return crypto.createHash('sha256').update(`vissstick-stats:${userId}`).digest('hex').slice(0, 12);
}

function byUser(rows) {
  const map = new Map();
  for (const row of rows) map.set(row.user_id, row);
  return map;
}

function safeAll(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch (error) {
    // Tabel bestaat nog niet (bijv. mines_stats voordat iemand ooit mines speelde)
    return [];
  }
}

function buildOverview() {
  const db = getDatabase();

  const users = safeAll(db, 'SELECT user_id, username, balance, total_earned, total_spent FROM users');
  const avatars = byUser(safeAll(db, `
    SELECT user_id, avatar_url FROM rocket_web_sessions s
    WHERE avatar_url IS NOT NULL AND last_seen = (SELECT MAX(last_seen) FROM rocket_web_sessions WHERE user_id = s.user_id)`));

  const tables = {
    rocket: byUser(safeAll(db, 'SELECT * FROM rocket_stats')),
    blackjack: byUser(safeAll(db, 'SELECT * FROM blackjack_stats')),
    plinko: byUser(safeAll(db, 'SELECT * FROM plinko_stats')),
    slots: byUser(safeAll(db, 'SELECT * FROM slots_stats')),
    roulette: byUser(safeAll(db, 'SELECT * FROM roulette_stats')),
    sterrenrad: byUser(safeAll(db, 'SELECT * FROM sterrenrad_stats')),
    mines: byUser(safeAll(db, 'SELECT * FROM mines_stats'))
  };
  const spins = byUser(safeAll(db, 'SELECT user_id, COUNT(*) AS spins, SUM(amount) AS won, MAX(amount) AS best, MAX(created_at) AS last FROM daily_spin_log GROUP BY user_id'));
  const afwas = byUser(safeAll(db, 'SELECT * FROM afwas_stats'));
  const quiz = byUser(safeAll(db, "SELECT user_id, correct_count, total_count FROM quiz_scores WHERE month_key = 'all-time'"));
  const bets = byUser(safeAll(db, `
    SELECT e.user_id, COUNT(*) AS played, SUM(e.amount) AS bet, SUM(e.payout) AS payout, SUM(CASE WHEN e.payout > e.amount THEN 1 ELSE 0 END) AS wins
    FROM bet_entries e JOIN bets b ON b.id = e.bet_id WHERE b.status = 'resolved' GROUP BY e.user_id`));
  const medals = byUser(safeAll(db, `
    SELECT user_id, SUM(position = 1) AS gold, SUM(position = 2) AS silver, SUM(position = 3) AS bronze
    FROM monthly_reset_log WHERE position IN (1, 2, 3) GROUP BY user_id`));

  // Alle bekende spelers: uit users plus iedereen die ergens stats heeft
  const names = new Map(users.map(u => [u.user_id, u.username]));
  for (const map of [...Object.values(tables), spins, afwas, quiz, bets]) {
    for (const [id, row] of map) if (!names.has(id)) names.set(id, row.username || 'Onbekend');
  }
  const balances = byUser(users);

  const players = [];
  for (const [id, username] of names) {
    const games = {};
    let lastPlayed = 0;

    const r = tables.rocket.get(id);
    if (r && r.games_played) {
      games.rocket = { played: r.games_played, wins: r.wins, bet: r.total_bet, payout: r.total_payout, biggest: r.biggest_win, bestMult: r.best_multiplier };
      lastPlayed = Math.max(lastPlayed, toMs(r.last_played));
    }
    const b = tables.blackjack.get(id);
    if (b && b.games_played) {
      games.blackjack = {
        played: b.games_played, wins: b.wins, losses: b.losses, pushes: b.pushes, blackjacks: b.blackjacks,
        bet: b.total_bet, payout: b.total_bet + b.total_won - b.total_lost, biggest: b.biggest_win, bestStreak: b.best_streak
      };
      lastPlayed = Math.max(lastPlayed, toMs(b.last_played));
    }
    const p = tables.plinko.get(id);
    if (p && p.games_played) {
      games.plinko = { played: p.games_played, bet: p.total_bet, payout: p.total_payout, biggest: p.biggest_win, bestMult: p.biggest_multiplier };
      lastPlayed = Math.max(lastPlayed, toMs(p.last_played));
    }
    const s = tables.slots.get(id);
    if (s && s.spins) {
      games.slots = { played: s.spins, bet: s.total_bet, payout: s.total_payout, biggest: s.biggest_win, bestMult: s.biggest_multiplier, fevers: s.fevers, freeSpins: s.free_spins };
      lastPlayed = Math.max(lastPlayed, toMs(s.last_played));
    }
    const ro = tables.roulette.get(id);
    if (ro && ro.games_played) {
      games.roulette = { played: ro.games_played, bet: ro.total_bet, payout: ro.total_payout, biggest: ro.biggest_win };
      lastPlayed = Math.max(lastPlayed, toMs(ro.last_played));
    }
    const sr = tables.sterrenrad.get(id);
    if (sr && sr.games_played) {
      games.sterrenrad = { played: sr.games_played, bet: sr.total_bet, payout: sr.total_payout, biggest: sr.biggest_win, bestMult: sr.biggest_multiplier, bonuses: sr.bonuses };
      lastPlayed = Math.max(lastPlayed, toMs(sr.last_played));
    }
    const m = tables.mines.get(id);
    if (m && m.games_played) {
      games.mines = { played: m.games_played, wins: m.wins, losses: m.losses, bet: m.total_bet, payout: m.total_payout, biggest: m.biggest_win, bestStreak: m.best_streak };
      lastPlayed = Math.max(lastPlayed, toMs(m.last_played));
    }
    const bt = bets.get(id);
    if (bt && bt.played) {
      games.bets = { played: bt.played, wins: bt.wins, bet: bt.bet || 0, payout: bt.payout || 0, biggest: 0 };
    }

    const extras = {};
    const sp = spins.get(id);
    if (sp) {
      extras.spin = { spins: sp.spins, won: sp.won || 0, best: sp.best || 0 };
      lastPlayed = Math.max(lastPlayed, toMs(sp.last));
    }
    const a = afwas.get(id);
    if (a && (a.plates_cleaned || a.plates_rejected)) {
      extras.afwas = { plates: a.plates_cleaned, rejected: a.plates_rejected, earned: a.points_earned };
      lastPlayed = Math.max(lastPlayed, toMs(a.last_played));
    }
    const q = quiz.get(id);
    if (q && q.total_count) extras.quiz = { correct: q.correct_count, total: q.total_count };

    const balance = balances.has(id) ? balances.get(id).balance : 0;
    const hasActivity = Object.keys(games).length > 0 || Object.keys(extras).length > 0;
    if (!hasActivity && balance <= 0) continue;

    let wagered = 0, net = 0, played = 0, biggest = { amount: 0, game: null }, favorite = null;
    for (const [game, g] of Object.entries(games)) {
      g.net = g.payout - g.bet;
      wagered += g.bet;
      net += g.net;
      played += g.played;
      if (g.biggest > biggest.amount) biggest = { amount: g.biggest, game };
      if (!favorite || g.bet > games[favorite].bet) favorite = game;
    }

    const md = medals.get(id);
    const av = avatars.get(id);
    players.push({
      key: publicKey(id),
      userId: id,
      name: username,
      avatar: av ? av.avatar_url : null,
      balance,
      wagered,
      net,
      played,
      biggest,
      favorite,
      lastPlayed,
      games,
      extras,
      medals: md ? { gold: md.gold || 0, silver: md.silver || 0, bronze: md.bronze || 0 } : { gold: 0, silver: 0, bronze: 0 }
    });
  }
  players.sort((x, y) => y.balance - x.balance || y.net - x.net);

  // Maandwinnaars (meest recente eerst)
  const fameRows = safeAll(db, `
    SELECT month_key, user_id, username, final_balance, position, bonus_received FROM monthly_reset_log
    WHERE position IN (1, 2, 3) ORDER BY month_key DESC, position ASC`);
  const hallOfFame = [];
  for (const row of fameRows) {
    let month = hallOfFame[hallOfFame.length - 1];
    if (!month || month.month !== row.month_key) {
      if (hallOfFame.length >= HALL_OF_FAME_MONTHS) break;
      month = { month: row.month_key, top: [] };
      hallOfFame.push(month);
    }
    const player = players.find(pl => pl.userId === row.user_id);
    month.top.push({
      position: row.position,
      name: player ? player.name : row.username,
      avatar: player ? player.avatar : null,
      key: player ? player.key : null,
      balance: row.final_balance
    });
  }

  return { generatedAt: Date.now(), players, hallOfFame };
}

/**
 * @param {string|null} viewerId Discord ID van de ingelogde speler (voor "jij" in de lijst)
 */
function getOverview(viewerId) {
  if (!cache || Date.now() - cache.generatedAt > CACHE_MS) cache = buildOverview();
  return {
    generatedAt: cache.generatedAt,
    hallOfFame: cache.hallOfFame,
    players: cache.players.map(({ userId, ...rest }) => (viewerId && userId === viewerId ? { ...rest, me: true } : rest))
  };
}

module.exports = {
  recordRocket,
  recordBlackjackHand,
  getOverview
};
