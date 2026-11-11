/**
 * Rocket Discord Commands
 * Multiplayer crash spel: /rocket opent een lobby van 30s waarin spelers inzetten (auto-cashout optioneel).
 * Daarna vliegt de raket (geanimeerde GIF) en kan iedereen live uitcashen met een knop tot hij crasht.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const rocket = require('../modules/rocket');
const casino = require('../modules/casino');

// =====================================================
// STATE MANAGEMENT
// =====================================================

// Er kan maar één Rocket sessie tegelijk actief zijn
let activeRocketGame = null;
const crashHistory = [];

const LOBBY_DURATION = 30000; // 30 seconden om mee te doen
const MIN_BET = 10;
const MAX_BET = 250;
const MAX_PLAYERS = 20;
const GIF_LOAD_DELAY_MS = 500; // Discord clients laden de GIF iets na het versturen; server klok loopt hierop gelijk
const STATUS_UPDATE_MS = 1000; // Statusbericht max 1x per seconde bewerken (rate limits)

function generateGameId() {
  return Math.random().toString(36).substring(2, 9);
}

function formatMult(m) {
  return `${m.toFixed(2)}x`;
}

function floorMult(m) {
  return Math.floor(m * 100) / 100;
}

// =====================================================
// EMBEDS & BUTTONS
// =====================================================

function describeStrategy(p) {
  return p.autoCashout ? `auto ${formatMult(p.autoCashout)}` : 'zelf uitcashen';
}

function buildPlayerList(game) {
  const players = [...game.players.values()];
  if (players.length === 0) return 'Nog niemand. Druk op **Meedoen**!';
  return players
    .map(p => `**${p.username}** — ${p.bet} punten (${describeStrategy(p)})`)
    .join('\n');
}

function buildLobbyEmbed(game) {
  const embed = new EmbedBuilder()
    .setTitle('🚀 Rocket — Instappen!')
    .setColor('#FF9F1C')
    .setDescription(
      `De raket vertrekt <t:${Math.floor(game.launchAt / 1000)}:R>.\n\n` +
      `Druk op **Meedoen** en zet in. Tijdens de vlucht stijgt de multiplier vanaf 1.00x: ` +
      `druk op **Cash out** voordat de raket crasht en je wint **inzet × multiplier**. ` +
      `Crasht hij eerder, dan ben je je inzet kwijt.\n\n` +
      `Optioneel kun je een **auto-cashout** instellen, dan cash je automatisch uit op die multiplier.\n` +
      `Inzet: ${MIN_BET}–${MAX_BET} punten`
    )
    .addFields({ name: `Passagiers (${game.players.size}/${MAX_PLAYERS})`, value: buildPlayerList(game) })
    .setFooter({ text: `Gestart door ${game.hostName}` })
    .setTimestamp();

  if (crashHistory.length > 0) {
    embed.addFields({ name: 'Laatste crashes', value: crashHistory.map(formatMult).join(' · ') });
  }
  return embed;
}

function buildLobbyButtons(gameId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rk_join_${gameId}`)
        .setLabel('Meedoen / Aanpassen')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`rk_leave_${gameId}`)
        .setLabel('Uitstappen')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled)
    )
  ];
}

function buildCashoutButton(gameId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rk_cashout_${gameId}`)
        .setLabel('Cash out')
        .setStyle(ButtonStyle.Success)
    )
  ];
}

function buildJoinModal(gameId, existing) {
  const betInput = new TextInputBuilder()
    .setCustomId('bet')
    .setLabel(`Inzet (${MIN_BET}-${MAX_BET} punten)`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('100')
    .setRequired(true)
    .setMaxLength(5);

  const cashoutInput = new TextInputBuilder()
    .setCustomId('cashout')
    .setLabel(`Auto-cashout (optioneel, ${rocket.MIN_CASHOUT}-${rocket.MAX_CASHOUT}x)`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Leeg laten = zelf uitcashen')
    .setRequired(false)
    .setMaxLength(6);

  if (existing) {
    betInput.setValue(String(existing.bet));
    if (existing.autoCashout) cashoutInput.setValue(existing.autoCashout.toFixed(2));
  }

  return new ModalBuilder()
    .setCustomId(`rk_modal_${gameId}`)
    .setTitle('Rocket — Instappen')
    .addComponents(
      new ActionRowBuilder().addComponents(betInput),
      new ActionRowBuilder().addComponents(cashoutInput)
    );
}

function buildStatusEmbed(game) {
  const players = [...game.players.values()].sort((a, b) => (b.cashedAt || 0) - (a.cashedAt || 0));
  const lines = players.map(p => p.cashedAt
    ? `✅ **${p.username}** — uitgecasht @ ${formatMult(p.cashedAt)} → **${p.payout}** punten (+${p.payout - p.bet})`
    : `🚀 **${p.username}** — ${p.bet} punten (${describeStrategy(p)})`);

  return new EmbedBuilder()
    .setTitle('🚀 Rocket — In de lucht!')
    .setColor('#FF9F1C')
    .setDescription(`Druk op **Cash out** voordat de raket crasht!\n\n${lines.join('\n')}`.slice(0, 4096));
}

function buildResultEmbed(game, crashPoint) {
  const players = [...game.players.values()];
  const winners = players.filter(p => p.cashedAt).sort((a, b) => b.payout - a.payout);
  const losers = players.filter(p => !p.cashedAt).sort((a, b) => b.bet - a.bet);

  const winnerText = winners.length > 0
    ? winners.map(w => `**${w.username}** — uitgecasht @ ${formatMult(w.cashedAt)} → **${w.payout}** punten (winst +${w.payout - w.bet})`).join('\n')
    : 'Niemand heeft op tijd uitgecasht.';
  const loserText = losers.length > 0
    ? losers.map(l => `**${l.username}** — **-${l.bet}** punten`).join('\n')
    : 'Niemand!';

  const totalBet = players.reduce((sum, p) => sum + p.bet, 0);
  const totalPaid = players.reduce((sum, p) => sum + (p.payout || 0), 0);

  return new EmbedBuilder()
    .setTitle(`💥 Rocket gecrasht op ${formatMult(crashPoint)}`)
    .setColor(winners.length > 0 ? '#57F287' : '#ED4245')
    .addFields(
      { name: `Winnaars (${winners.length})`, value: winnerText.slice(0, 1024) },
      { name: `Verloren (${losers.length})`, value: loserText.slice(0, 1024) },
      { name: 'Totaal ingezet', value: `${totalBet} punten`, inline: true },
      { name: 'Totaal uitbetaald', value: `${totalPaid} punten`, inline: true }
    )
    .setFooter({ text: 'Start een nieuwe ronde met /rocket' })
    .setTimestamp();
}

// =====================================================
// SPELERS
// =====================================================

/**
 * Valideer en verwerk een inzet. Bij aanpassen wordt de oude inzet eerst teruggestort.
 * @returns {{ok: boolean, message: string}}
 */
function placeRocketBet(game, user, betInput, cashoutInput) {
  const bet = parseInt(String(betInput).trim(), 10);
  const hasAuto = String(cashoutInput || '').trim() !== '';
  const autoCashout = hasAuto ? rocket.parseCashout(cashoutInput) : null;

  if (!Number.isInteger(bet) || bet < MIN_BET || bet > MAX_BET) {
    return { ok: false, message: `❌ Inzet moet tussen ${MIN_BET} en ${MAX_BET} punten liggen.` };
  }
  if (hasAuto && (autoCashout === null || autoCashout < rocket.MIN_CASHOUT || autoCashout > rocket.MAX_CASHOUT)) {
    return { ok: false, message: `❌ Auto-cashout moet tussen ${formatMult(rocket.MIN_CASHOUT)} en ${formatMult(rocket.MAX_CASHOUT)} liggen (of leeg laten).` };
  }

  const existing = game.players.get(user.id);
  if (!existing && game.players.size >= MAX_PLAYERS) {
    return { ok: false, message: '❌ De raket zit vol!' };
  }

  casino.getOrCreateUser(user.id, user.username);
  const available = casino.getUserBalance(user.id) + (existing ? existing.bet : 0);
  if (available < bet) {
    return { ok: false, message: `❌ Je hebt niet genoeg punten. Saldo: ${available} punten.` };
  }

  if (existing) {
    casino.addBalance(user.id, user.username, existing.bet, 'Rocket inzet aangepast');
  }
  const newBalance = casino.subtractBalance(user.id, bet);
  game.players.set(user.id, { userId: user.id, username: user.username, bet, autoCashout, cashedAt: null, payout: 0 });

  const strategy = autoCashout
    ? `auto-cashout op **${formatMult(autoCashout)}** (${rocket.calculatePayout(bet, autoCashout)} punten)`
    : 'druk tijdens de vlucht op **Cash out**';
  return {
    ok: true,
    message: `🚀 ${existing ? 'Inzet aangepast' : 'Je bent ingestapt'}: **${bet} punten**, ${strategy}\n💰 Saldo: ${newBalance} punten`
  };
}

async function refreshLobby(game) {
  if (!game.lobbyMessage) return;
  await game.lobbyMessage.edit({ embeds: [buildLobbyEmbed(game)], components: buildLobbyButtons(game.gameId) }).catch(() => {});
}

/**
 * Huidige multiplier volgens de server klok (gelijk aan wat de GIF laat zien)
 */
function currentMultiplier(game) {
  const elapsed = (Date.now() - game.flightStart - rocket.PREROLL_MS) / 1000;
  return floorMult(rocket.multiplierAt(Math.max(0, elapsed)));
}

function cashOut(game, player, multiplier) {
  if (game.phase !== 'flying' || player.cashedAt) return false;
  if (multiplier >= game.crashPoint) return false;
  player.cashedAt = multiplier;
  player.payout = rocket.calculatePayout(player.bet, multiplier);
  casino.addBalance(player.userId, player.username, player.payout, `Rocket cashout @ ${formatMult(multiplier)}`);
  scheduleStatusUpdate(game);
  return true;
}

function scheduleStatusUpdate(game) {
  if (game.statusTimer || !game.statusMessage) return;
  game.statusTimer = setTimeout(() => {
    game.statusTimer = null;
    if (game.phase !== 'flying') return;
    game.statusMessage.edit({ embeds: [buildStatusEmbed(game)], components: buildCashoutButton(game.gameId) }).catch(() => {});
  }, STATUS_UPDATE_MS);
}

// =====================================================
// VLUCHT
// =====================================================

async function launchRocket(game, client, config) {
  game.phase = 'launching';
  const players = [...game.players.values()];

  if (players.length === 0) {
    const cancelled = new EmbedBuilder()
      .setTitle('🚀 Rocket — Geannuleerd')
      .setDescription('Niemand is ingestapt. Start een nieuwe ronde met `/rocket`.')
      .setColor('#ED4245');
    await game.lobbyMessage?.edit({ embeds: [cancelled], components: [] }).catch(() => {});
    activeRocketGame = null;
    return;
  }

  const closedEmbed = buildLobbyEmbed(game)
    .setTitle('🚀 Rocket — Deuren dicht')
    .setDescription('De raket wordt getankt... ⛽');
  await game.lobbyMessage?.edit({ embeds: [closedEmbed], components: buildLobbyButtons(game.gameId, true) }).catch(() => {});

  game.crashPoint = rocket.generateCrashPoint();

  try {
    const [flightGif, crash] = await Promise.all([rocket.getFlightGif(), rocket.renderCrash(game.crashPoint)]);

    const flightEmbed = new EmbedBuilder()
      .setTitle('🚀 Rocket — Gelanceerd!')
      .setColor('#FF9F1C')
      .setImage('attachment://rocket.gif');

    const flightMessage = await game.channel.send({
      embeds: [flightEmbed],
      files: [new AttachmentBuilder(flightGif, { name: 'rocket.gif' })]
    });
    game.flightStart = Date.now() + GIF_LOAD_DELAY_MS;
    game.phase = 'flying';

    game.statusMessage = await game.channel.send({
      embeds: [buildStatusEmbed(game)],
      components: buildCashoutButton(game.gameId)
    });

    // Auto-cashouts op het juiste moment uitvoeren (alleen als de raket die multiplier haalt)
    const flightOffset = game.flightStart + rocket.PREROLL_MS;
    for (const p of players) {
      if (!p.autoCashout || p.autoCashout >= game.crashPoint) continue;
      const at = flightOffset + rocket.timeForMultiplier(p.autoCashout) * 1000;
      setTimeout(() => cashOut(game, p, p.autoCashout), Math.max(0, at - Date.now()));
    }

    // Wacht tot het crashmoment
    const crashAt = flightOffset + rocket.timeForMultiplier(game.crashPoint) * 1000;
    await new Promise(resolve => setTimeout(resolve, Math.max(0, crashAt - Date.now())));
    game.phase = 'crashed';
    clearTimeout(game.statusTimer);

    await flightMessage.edit({
      embeds: [new EmbedBuilder().setTitle(`💥 Gecrasht op ${formatMult(game.crashPoint)}`).setColor('#ED4245').setImage('attachment://crash.gif')],
      files: [new AttachmentBuilder(crash.gif, { name: 'crash.gif' })],
      attachments: []
    }).catch(() => {});

    await game.statusMessage.edit({ embeds: [buildResultEmbed(game, game.crashPoint)], components: [] }).catch(() => {});

    await game.lobbyMessage?.edit({
      embeds: [buildLobbyEmbed(game).setTitle('🚀 Rocket — Vertrokken').setDescription(`Gecrasht op **${formatMult(game.crashPoint)}**.`)],
      components: []
    }).catch(() => {});

    crashHistory.unshift(game.crashPoint);
    if (crashHistory.length > 10) crashHistory.pop();

    const { sendLog } = require('./casinoCommands');
    const summary = players.map(p => `${p.username}: ${p.bet} → ${p.cashedAt ? `cashout @ ${formatMult(p.cashedAt)} +${p.payout}` : `-${p.bet}`}`).join('\n');
    await sendLog(client, config.LOG_CHANNEL_ID, `🚀 Rocket gecrasht op ${formatMult(game.crashPoint)}\n${summary}`);

    // Na de explosie de GIF vervangen door een stilstaand eindbeeld (sommige clients herhalen GIFs)
    await new Promise(resolve => setTimeout(resolve, crash.durationMs + 500));
    await flightMessage.edit({
      embeds: [new EmbedBuilder().setTitle(`💥 Gecrasht op ${formatMult(game.crashPoint)}`).setColor('#ED4245').setImage('attachment://rocket.png')],
      files: [new AttachmentBuilder(crash.finalImage, { name: 'rocket.png' })],
      attachments: []
    }).catch(() => {});
  } catch (error) {
    console.error('Fout bij Rocket vlucht:', error);
    if (game.phase !== 'crashed') {
      game.phase = 'crashed';
      // Iets ging mis: wie nog niet uitgecasht had krijgt zijn inzet terug
      for (const p of players) {
        if (!p.cashedAt) casino.addBalance(p.userId, p.username, p.bet, 'Rocket refund (fout)');
      }
      await game.channel.send('❌ Er ging iets mis met de raket. Inzetten die nog niet uitgecasht waren zijn teruggestort.').catch(() => {});
    }
  } finally {
    activeRocketGame = null;
  }
}

// =====================================================
// COMMAND HANDLER
// =====================================================

async function handleRocketCommands(interaction, client, config) {
  if (interaction.commandName !== 'rocket') return false;

  if (activeRocketGame) {
    const where = activeRocketGame.channel.id === interaction.channelId ? 'hier' : `in <#${activeRocketGame.channel.id}>`;
    await interaction.reply({ content: `🚀 Er is al een Rocket ronde bezig ${where}. Doe daar mee!`, flags: 64 });
    return true;
  }

  const gameId = generateGameId();
  const game = {
    gameId,
    hostId: interaction.user.id,
    hostName: interaction.user.username,
    channel: interaction.channel,
    players: new Map(),
    phase: 'lobby',
    launchAt: Date.now() + LOBBY_DURATION,
    lobbyMessage: null,
    statusMessage: null,
    statusTimer: null,
    crashPoint: null,
    flightStart: null,
    timeout: null
  };
  activeRocketGame = game;

  // Vlucht-GIF alvast renderen tijdens de lobby (eenmalig, daarna uit cache)
  rocket.getFlightGif().catch(err => console.error('Fout bij renderen Rocket GIF:', err));

  await interaction.reply({ embeds: [buildLobbyEmbed(game)], components: buildLobbyButtons(gameId) });
  game.lobbyMessage = await interaction.fetchReply();

  game.timeout = setTimeout(() => {
    launchRocket(game, client, config).catch(err => {
      console.error('Fout bij lanceren Rocket:', err);
      activeRocketGame = null;
    });
  }, LOBBY_DURATION);

  return true;
}

// =====================================================
// BUTTON & MODAL HANDLER
// =====================================================

async function handleRocketInteraction(interaction) {
  if (!interaction.customId.startsWith('rk_')) return false;

  const [, action, gameId] = interaction.customId.split('_');
  const game = activeRocketGame && activeRocketGame.gameId === gameId ? activeRocketGame : null;

  if (action === 'cashout') {
    if (game && (game.phase === 'lobby' || game.phase === 'launching')) {
      await interaction.reply({ content: '🚀 De raket is nog niet vertrokken.', flags: 64 });
      return true;
    }
    if (!game || game.phase !== 'flying') {
      await interaction.reply({ content: '💥 Te laat, de raket is al gecrasht!', flags: 64 });
      return true;
    }
    const player = game.players.get(interaction.user.id);
    if (!player) {
      await interaction.reply({ content: 'Je zit niet in deze raket.', flags: 64 });
      return true;
    }
    if (player.cashedAt) {
      await interaction.reply({ content: `Je hebt al uitgecasht op ${formatMult(player.cashedAt)}.`, flags: 64 });
      return true;
    }
    const multiplier = currentMultiplier(game);
    if (!cashOut(game, player, multiplier)) {
      await interaction.reply({ content: '💥 Te laat, de raket is al gecrasht!', flags: 64 });
      return true;
    }
    await interaction.reply({ content: `💰 Uitgecasht op **${formatMult(multiplier)}** → **${player.payout}** punten (+${player.payout - player.bet})`, flags: 64 });
    return true;
  }

  if (!game || game.phase !== 'lobby') {
    await interaction.reply({ content: '🚀 Deze raket is al vertrokken. Start een nieuwe ronde met `/rocket`.', flags: 64 });
    return true;
  }

  if (action === 'join') {
    await interaction.showModal(buildJoinModal(gameId, game.players.get(interaction.user.id)));
    return true;
  }

  if (action === 'leave') {
    const existing = game.players.get(interaction.user.id);
    if (!existing) {
      await interaction.reply({ content: 'Je zit niet in deze raket.', flags: 64 });
      return true;
    }
    game.players.delete(interaction.user.id);
    const newBalance = casino.addBalance(interaction.user.id, interaction.user.username, existing.bet, 'Rocket uitgestapt');
    await interaction.reply({ content: `Je bent uitgestapt. ${existing.bet} punten teruggestort. Saldo: ${newBalance} punten`, flags: 64 });
    await refreshLobby(game);
    return true;
  }

  if (action === 'modal') {
    const result = placeRocketBet(
      game,
      interaction.user,
      interaction.fields.getTextInputValue('bet'),
      interaction.fields.getTextInputValue('cashout')
    );
    await interaction.reply({ content: result.message, flags: 64 });
    if (result.ok) await refreshLobby(game);
    return true;
  }

  return false;
}

const rocketCommands = [
  {
    name: 'rocket',
    description: 'Start een Rocket ronde — stap in en cash uit voordat de raket crasht'
  }
];

module.exports = {
  rocketCommands,
  handleRocketCommands,
  handleRocketInteraction
};
