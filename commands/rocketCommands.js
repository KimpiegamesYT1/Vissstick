/**
 * Rocket Discord Commands
 * Multiplayer crash spel: /rocket opent een lobby van 30s, spelers zetten in met een auto-cashout,
 * daarna vliegt de raket (geanimeerde GIF) en worden de winnaars uitbetaald.
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

function generateGameId() {
  return Math.random().toString(36).substring(2, 9);
}

function formatMult(m) {
  return `${m.toFixed(2)}x`;
}

// =====================================================
// EMBEDS & BUTTONS
// =====================================================

function buildPlayerList(game) {
  const players = [...game.players.values()];
  if (players.length === 0) return 'Nog niemand. Wees de eerste!';
  return players
    .map(p => `**${p.username}** — ${p.bet} punten @ ${formatMult(p.cashout)}`)
    .join('\n');
}

function buildLobbyEmbed(game) {
  const embed = new EmbedBuilder()
    .setTitle('🚀 Rocket — Instappen!')
    .setColor('#FF9F1C')
    .setDescription(
      `De raket vertrekt <t:${Math.floor(game.launchAt / 1000)}:R>.\n\n` +
      `Druk op **Meedoen**, zet in en kies je **auto-cashout**. Haalt de raket jouw multiplier voordat hij crasht, ` +
      `dan win je **inzet × cashout**. Crasht hij eerder, dan ben je je inzet kwijt.\n\n` +
      `Inzet: ${MIN_BET}–${MAX_BET} punten · Cashout: ${formatMult(rocket.MIN_CASHOUT)}–${formatMult(rocket.MAX_CASHOUT)}`
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
    .setLabel(`Auto-cashout (${rocket.MIN_CASHOUT}-${rocket.MAX_CASHOUT}x)`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('2.00')
    .setRequired(true)
    .setMaxLength(6);

  if (existing) {
    betInput.setValue(String(existing.bet));
    cashoutInput.setValue(existing.cashout.toFixed(2));
  }

  return new ModalBuilder()
    .setCustomId(`rk_modal_${gameId}`)
    .setTitle('Rocket — Instappen')
    .addComponents(
      new ActionRowBuilder().addComponents(betInput),
      new ActionRowBuilder().addComponents(cashoutInput)
    );
}

function buildResultEmbed(game, results, crashPoint) {
  const winners = results.filter(r => r.won).sort((a, b) => b.payout - a.payout);
  const losers = results.filter(r => !r.won).sort((a, b) => b.bet - a.bet);

  const winnerText = winners.length > 0
    ? winners.map(w => `**${w.username}** — cashout @ ${formatMult(w.cashout)} → **${w.payout}** punten (winst +${w.payout - w.bet})`).join('\n')
    : 'Niemand heeft op tijd uitgecasht.';
  const loserText = losers.length > 0
    ? losers.map(l => `**${l.username}** — wachtte op ${formatMult(l.cashout)} → **-${l.bet}** punten`).join('\n')
    : 'Niemand!';

  const totalBet = results.reduce((sum, r) => sum + r.bet, 0);
  const totalPaid = results.reduce((sum, r) => sum + r.payout, 0);

  return new EmbedBuilder()
    .setTitle(`💥 Rocket gecrasht op ${formatMult(crashPoint)}`)
    .setColor(winners.length > 0 ? '#57F287' : '#ED4245')
    .addFields(
      { name: `Winnaars (${winners.length})`, value: winnerText.slice(0, 1024) },
      { name: `Verloren (${losers.length})`, value: loserText.slice(0, 1024) },
      { name: 'Totaal ingezet', value: `${totalBet} punten`, inline: true },
      { name: 'Totaal uitbetaald', value: `${totalPaid} punten`, inline: true }
    )
    .setImage('attachment://rocket.png')
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
  const cashout = rocket.parseCashout(cashoutInput);

  if (!Number.isInteger(bet) || bet < MIN_BET || bet > MAX_BET) {
    return { ok: false, message: `❌ Inzet moet tussen ${MIN_BET} en ${MAX_BET} punten liggen.` };
  }
  if (cashout === null || cashout < rocket.MIN_CASHOUT || cashout > rocket.MAX_CASHOUT) {
    return { ok: false, message: `❌ Cashout moet tussen ${formatMult(rocket.MIN_CASHOUT)} en ${formatMult(rocket.MAX_CASHOUT)} liggen.` };
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
  game.players.set(user.id, { userId: user.id, username: user.username, bet, cashout });

  const potential = rocket.calculatePayout(bet, cashout);
  return {
    ok: true,
    message: `🚀 ${existing ? 'Inzet aangepast' : 'Je bent ingestapt'}: **${bet} punten** @ **${formatMult(cashout)}** (uitbetaling bij succes: ${potential} punten)\n💰 Saldo: ${newBalance} punten`
  };
}

async function refreshLobby(game) {
  if (!game.lobbyMessage) return;
  await game.lobbyMessage.edit({ embeds: [buildLobbyEmbed(game)], components: buildLobbyButtons(game.gameId) }).catch(() => {});
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

  const crashPoint = rocket.generateCrashPoint();
  const results = rocket.resolvePlayers(players, crashPoint);

  try {
    const { gif, finalImage, durationMs } = await rocket.renderFlight(players, crashPoint);

    const flightEmbed = new EmbedBuilder()
      .setTitle('🚀 Rocket — Gelanceerd!')
      .setColor('#FF9F1C')
      .setDescription(players.map(p => `**${p.username}** — ${p.bet} punten @ ${formatMult(p.cashout)}`).join('\n'))
      .setImage('attachment://rocket.gif');

    const flightMessage = await game.channel.send({
      embeds: [flightEmbed],
      files: [new AttachmentBuilder(gif, { name: 'rocket.gif' })]
    });

    // Wacht tot de animatie (ongeveer) klaar is voordat de uitslag zichtbaar wordt
    await new Promise(resolve => setTimeout(resolve, durationMs + 1500));

    for (const r of results) {
      if (r.won) casino.addBalance(r.userId, r.username, r.payout, `Rocket cashout @ ${formatMult(r.cashout)}`);
    }

    await flightMessage.edit({
      embeds: [buildResultEmbed(game, results, crashPoint)],
      files: [new AttachmentBuilder(finalImage, { name: 'rocket.png' })],
      attachments: []
    }).catch(() => {});

    await game.lobbyMessage?.edit({
      embeds: [buildLobbyEmbed(game).setTitle('🚀 Rocket — Vertrokken').setDescription(`Gecrasht op **${formatMult(crashPoint)}**.`)],
      components: []
    }).catch(() => {});

    crashHistory.unshift(crashPoint);
    if (crashHistory.length > 10) crashHistory.pop();

    const { sendLog } = require('./casinoCommands');
    const summary = results.map(r => `${r.username}: ${r.bet} @ ${formatMult(r.cashout)} → ${r.won ? `+${r.payout}` : `-${r.bet}`}`).join('\n');
    await sendLog(client, config.LOG_CHANNEL_ID, `🚀 Rocket gecrasht op ${formatMult(crashPoint)}\n${summary}`);
  } catch (error) {
    console.error('Fout bij Rocket vlucht:', error);
    // Iets ging mis: iedereen krijgt zijn inzet terug
    for (const p of players) {
      casino.addBalance(p.userId, p.username, p.bet, 'Rocket refund (fout)');
    }
    await game.channel.send('❌ Er ging iets mis met de raket. Alle inzetten zijn teruggestort.').catch(() => {});
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
    timeout: null
  };
  activeRocketGame = game;

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
  const game = activeRocketGame;

  if (!game || game.gameId !== gameId || game.phase !== 'lobby') {
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
