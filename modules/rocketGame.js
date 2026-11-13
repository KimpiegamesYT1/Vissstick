/**
 * Rocket spelstatus
 * Het spel wordt volledig op de website gespeeld (api/casinoWeb.js). Een ronde heeft een lobby van 20s,
 * daarna stijgt de multiplier tot het crashpunt. Na een ronde met spelers wordt de uitslag in Discord gepost.
 */

const { EventEmitter } = require('events');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const rocket = require('./rocket');
const casino = require('./casino');

const LOBBY_DURATION = 20000; // 20 seconden om mee te doen
const CRASH_COOLDOWN = 6000;  // crash + uitslag blijven even staan voordat er een nieuwe ronde kan starten
const LIFTOFF_MS = 2000;      // Korte liftoff op 1.00x voordat de multiplier stijgt
const MIN_BET = 10;
const MAX_BET = 250;
const MAX_PLAYERS = 20;

// Er kan maar één ronde tegelijk actief zijn
let activeGame = null;
// Laatste ronde blijft zichtbaar op de website tot er een nieuwe start
let lastGame = null;
const crashHistory = [];

// Website luistert hierop om live updates te pushen
const events = new EventEmitter();

let discordClient = null;
let botConfig = {};

/**
 * Koppel de Discord client (voor het posten van uitslagen)
 */
function init(client, config) {
  discordClient = client;
  botConfig = config;
}

// Open inzet van een speler in deze ronde (zie casino.setStake: wordt teruggestort na een herstart)
const stakeRef = (game, userId) => `${game.gameId}:${userId}`;

function generateGameId() {
  return Math.random().toString(36).substring(2, 9);
}

function formatMult(m) {
  return `${m.toFixed(2)}x`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function emitUpdate() {
  events.emit('update');
}

/**
 * Huidige multiplier volgens de server klok
 */
function currentMultiplier(game) {
  const elapsed = (Date.now() - game.flightStart) / 1000;
  return Math.floor(rocket.multiplierAt(Math.max(0, elapsed)) * 100) / 100;
}

/**
 * Publieke spelstatus voor de website. Het crashpunt zit er pas in nadat de raket gecrasht is.
 */
function getPublicState() {
  const game = activeGame || lastGame;
  return {
    serverNow: Date.now(),
    config: {
      growth: rocket.GROWTH,
      minBet: MIN_BET,
      maxBet: MAX_BET,
      minCashout: rocket.MIN_CASHOUT,
      maxCashout: rocket.MAX_CASHOUT,
      maxPlayers: MAX_PLAYERS,
      lobbyMs: LOBBY_DURATION
    },
    nextStartAt: lastGame && lastGame.crashedAt ? lastGame.crashedAt + CRASH_COOLDOWN : 0,
    history: crashHistory,
    game: game && {
      id: game.gameId,
      phase: game.phase,
      hostName: game.hostName,
      launchAt: game.launchAt,
      flightStart: game.flightStart,
      crashPoint: game.phase === 'crashed' ? game.crashPoint : null,
      players: [...game.players.values()].map(p => ({
        userId: p.userId,
        username: p.username,
        avatar: p.avatar,
        bet: p.bet,
        balance: casino.getUserBalance(p.userId),
        autoCashout: p.autoCashout,
        cashedAt: p.cashedAt,
        payout: p.payout
      }))
    }
  };
}

// =====================================================
// ACTIES
// =====================================================

/**
 * Open een nieuwe lobby
 * @param {{id: string, username: string}} user
 */
function startGame(user) {
  if (activeGame) {
    return { ok: false, message: 'Er is al een ronde bezig. Wacht tot die klaar is.' };
  }
  const waitMs = lastGame && lastGame.crashedAt ? lastGame.crashedAt + CRASH_COOLDOWN - Date.now() : 0;
  if (waitMs > 0) {
    return { ok: false, message: `Even wachten: over ${Math.ceil(waitMs / 1000)} seconden kun je een nieuwe ronde starten.` };
  }

  const game = {
    gameId: generateGameId(),
    hostName: user.username,
    players: new Map(),
    phase: 'lobby',
    launchAt: Date.now() + LOBBY_DURATION,
    autoTimers: [],
    crashPoint: null,
    flightStart: null
  };
  activeGame = game;
  lastGame = game;
  emitUpdate();

  setTimeout(() => {
    launch(game).catch(err => {
      console.error('Fout bij Rocket ronde, open inzetten worden teruggestort:', err);
      if (game.phase !== 'crashed') {
        game.autoTimers.forEach(clearTimeout);
        for (const p of game.players.values()) {
          if (p.cashedAt) continue;
          casino.addBalance(p.userId, p.username, p.bet, 'Rocket: terugbetaling na fout');
          casino.releaseStake('rocket', stakeRef(game, p.userId));
        }
        game.phase = 'cancelled';
      }
      if (activeGame === game) activeGame = null;
      emitUpdate();
    });
  }, LOBBY_DURATION);

  return { ok: true, message: 'Nieuwe ronde gestart!' };
}

/**
 * Inzetten of je inzet aanpassen. Bij aanpassen wordt de oude inzet eerst teruggestort.
 * @param {{id: string, username: string, avatar: string|null}} user
 */
function join(user, betInput, cashoutInput) {
  const game = activeGame;
  if (!game || game.phase !== 'lobby') {
    return { ok: false, message: 'Je kunt nu niet instappen: er is geen ronde in de lobby. Start een nieuwe ronde of wacht tot de huidige klaar is.' };
  }

  const bet = parseInt(String(betInput).trim(), 10);
  const hasAuto = cashoutInput !== null && cashoutInput !== undefined && String(cashoutInput).trim() !== '';
  const autoCashout = hasAuto ? rocket.parseCashout(cashoutInput) : null;

  if (!Number.isInteger(bet) || bet < MIN_BET || bet > MAX_BET) {
    return { ok: false, message: `Ongeldige inzet: kies een bedrag tussen ${MIN_BET} en ${MAX_BET} punten.` };
  }
  if (hasAuto && (autoCashout === null || autoCashout < rocket.MIN_CASHOUT || autoCashout > rocket.MAX_CASHOUT)) {
    return { ok: false, message: `Ongeldige auto-cashout: kies een multiplier tussen ${formatMult(rocket.MIN_CASHOUT)} en ${formatMult(rocket.MAX_CASHOUT)}, of zet Auto uit.` };
  }

  const existing = game.players.get(user.id);
  if (!existing && game.players.size >= MAX_PLAYERS) {
    return { ok: false, message: `De raket zit vol: er doen al ${MAX_PLAYERS} spelers mee.` };
  }

  casino.getOrCreateUser(user.id, user.username);
  const available = casino.getUserBalance(user.id) + (existing ? existing.bet : 0);
  if (available < bet) {
    return { ok: false, message: `Niet genoeg punten: je wilt ${bet} inzetten, maar je hebt er maar ${available}.` };
  }

  if (existing) {
    casino.addBalance(user.id, user.username, existing.bet, 'Rocket inzet aangepast');
  }
  casino.subtractBalance(user.id, bet);
  casino.setStake('rocket', stakeRef(game, user.id), user.id, user.username, bet);
  game.players.set(user.id, { userId: user.id, username: user.username, avatar: user.avatar, bet, autoCashout, cashedAt: null, payout: 0 });
  emitUpdate();

  const strategy = autoCashout ? `auto-cashout op ${formatMult(autoCashout)}` : 'zelf uitcashen';
  return { ok: true, message: `${existing ? 'Inzet aangepast' : 'Ingestapt'}: ${bet} punten, ${strategy}.` };
}

function leave(user) {
  const game = activeGame;
  if (!game || game.phase !== 'lobby') {
    return { ok: false, message: 'De raket is al vertrokken.' };
  }
  const existing = game.players.get(user.id);
  if (!existing) {
    return { ok: false, message: 'Je zit niet in deze raket.' };
  }
  game.players.delete(user.id);
  casino.addBalance(user.id, user.username, existing.bet, 'Rocket uitgestapt');
  casino.releaseStake('rocket', stakeRef(game, user.id));
  emitUpdate();
  return { ok: true, message: `Uitgestapt, ${existing.bet} punten teruggestort.` };
}

function settleCashout(game, player, multiplier) {
  if (game.phase !== 'flying' || player.cashedAt) return false;
  if (multiplier >= game.crashPoint) return false;
  player.cashedAt = multiplier;
  player.payout = rocket.calculatePayout(player.bet, multiplier);
  casino.addBalance(player.userId, player.username, player.payout, `Rocket cashout @ ${formatMult(multiplier)}`);
  casino.releaseStake('rocket', stakeRef(game, player.userId));
  emitUpdate();
  return true;
}

/**
 * Uitcashen op de huidige multiplier
 */
function cashOut(user) {
  const game = activeGame;
  if (game && game.phase === 'lobby') {
    return { ok: false, message: 'De raket is nog niet vertrokken, uitcashen kan pas tijdens de vlucht.' };
  }
  if (!game || game.phase !== 'flying') {
    return { ok: false, message: 'Te laat, de raket is al gecrasht!' };
  }
  const player = game.players.get(user.id);
  if (!player) {
    return { ok: false, message: 'Je doet niet mee aan deze ronde.' };
  }
  if (player.cashedAt) {
    return { ok: false, message: `Je hebt al uitgecasht op ${formatMult(player.cashedAt)}.` };
  }
  const multiplier = currentMultiplier(game);
  if (!settleCashout(game, player, multiplier)) {
    return { ok: false, message: 'Te laat, de raket is al gecrasht!' };
  }
  return { ok: true, message: `Uitgecasht op ${formatMult(multiplier)}: ${player.payout} punten (+${player.payout - player.bet})` };
}

// =====================================================
// VLUCHT
// =====================================================

async function launch(game) {
  const players = [...game.players.values()];

  if (players.length === 0) {
    game.phase = 'cancelled';
    activeGame = null;
    emitUpdate();
    return;
  }

  game.crashPoint = rocket.generateCrashPoint();
  game.flightStart = Date.now() + LIFTOFF_MS;
  game.phase = 'flying';
  emitUpdate();

  // Auto-cashouts op het juiste moment uitvoeren (alleen als de raket die multiplier haalt)
  for (const p of players) {
    if (!p.autoCashout || p.autoCashout >= game.crashPoint) continue;
    const at = game.flightStart + rocket.timeForMultiplier(p.autoCashout) * 1000;
    game.autoTimers.push(setTimeout(() => settleCashout(game, p, p.autoCashout), at - Date.now()));
  }

  await sleep(game.flightStart + rocket.timeForMultiplier(game.crashPoint) * 1000 - Date.now());
  game.phase = 'crashed';
  game.crashedAt = Date.now();
  game.autoTimers.forEach(clearTimeout);
  // Wie niet heeft uitgecasht is zijn inzet kwijt: niets meer open
  for (const p of players) casino.releaseStake('rocket', stakeRef(game, p.userId));
  crashHistory.unshift(game.crashPoint);
  if (crashHistory.length > 10) crashHistory.pop();
  activeGame = null;
  emitUpdate();

  await postResults(game, players);
}

/**
 * Post de uitslag van een ronde in Discord
 */
async function postResults(game, players) {
  if (!discordClient) return;
  try {
    const image = await rocket.renderResults({ crashPoint: game.crashPoint, players, history: crashHistory });
    const channelId = botConfig.ROCKET_CHANNEL_ID || botConfig.CASINO_CHANNEL_ID;
    const channel = await discordClient.channels.fetch(channelId);
    const webUrl = (botConfig.ROCKET_WEB_URL || '').replace(/\/+$/, '');

    const embed = new EmbedBuilder()
      .setTitle(`💥 Rocket gecrasht op ${formatMult(game.crashPoint)}`)
      .setColor(players.some(p => p.cashedAt) ? '#57F287' : '#ED4245')
      .setImage('attachment://uitslag.png')
      .setFooter({ text: webUrl ? `Speel mee op ${webUrl}/rocket · /rocket voor je link` : 'Typ /rocket voor je link naar de website' })
      .setTimestamp();

    await channel.send({ embeds: [embed], files: [new AttachmentBuilder(image, { name: 'uitslag.png' })] });
  } catch (error) {
    console.error('Fout bij posten Rocket uitslag:', error);
  }
}

module.exports = {
  init,
  events,
  getPublicState,
  startGame,
  join,
  leave,
  cashOut
};
