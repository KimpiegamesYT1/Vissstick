/**
 * Casino Commands - Slash commands voor het casino systeem
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const casino = require('../modules/casino');
const quiz = require('../modules/quiz');
const blackjack = require('../modules/blackjack');
const { renderBlackjackTable } = require('../modules/cardRenderer');
const { getDatabase } = require('../database');

// =====================================================
// DOUBLE OR NOTHING - Game State
// =====================================================
const activeDoNGames = new Map();
const DON_WIN_CHANCE = 0.50;
const DON_MAX_ROUNDS = 5;

function generateDoNGameId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

// =====================================================
// BLACKJACK - Game State
// =====================================================
const activeBlackjackGames = new Map();
const KEEP_GAMBLING_IMG = 'https://i.imgur.com/MUNEEPD.jpeg';

// =====================================================
// BLACKJACK - Stats Database
// =====================================================

/**
 * Registreer een Blackjack spelresultaat in de database
 */
function recordBlackjackResult(userId, username, bet, payout, outcome) {
  const db = getDatabase();
  const netWin = payout - bet;
  const isWin = outcome === 'win' || outcome === 'blackjack';
  const isLoss = outcome === 'lose';

  // Maak tabel aan als die nog niet bestaat
  db.exec(`CREATE TABLE IF NOT EXISTS blackjack_stats (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    games_played INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    pushes INTEGER DEFAULT 0,
    blackjacks INTEGER DEFAULT 0,
    total_bet INTEGER DEFAULT 0,
    total_won INTEGER DEFAULT 0,
    total_lost INTEGER DEFAULT 0,
    biggest_win INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    last_played DATETIME
  )`);

  const existing = db.prepare('SELECT * FROM blackjack_stats WHERE user_id = ?').get(userId);

  if (!existing) {
    db.prepare(`INSERT INTO blackjack_stats (user_id, username, games_played, wins, losses, pushes, blackjacks, total_bet, total_won, total_lost, biggest_win, current_streak, best_streak, last_played)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(
      userId, username,
      isWin ? 1 : 0,
      isLoss ? 1 : 0,
      outcome === 'push' ? 1 : 0,
      outcome === 'blackjack' ? 1 : 0,
      bet,
      payout > bet ? payout - bet : 0,
      isLoss ? bet : 0,
      netWin > 0 ? netWin : 0,
      isWin ? 1 : (isLoss ? -1 : 0),
      isWin ? 1 : 0
    );
    return;
  }

  let newStreak = existing.current_streak;
  if (isWin) {
    newStreak = newStreak >= 0 ? newStreak + 1 : 1;
  } else if (isLoss) {
    newStreak = newStreak <= 0 ? newStreak - 1 : -1;
  } else {
    newStreak = 0; // push reset streak
  }
  const bestStreak = Math.max(existing.best_streak, newStreak);
  const biggestWin = Math.max(existing.biggest_win, netWin > 0 ? netWin : 0);

  db.prepare(`UPDATE blackjack_stats SET
    username = ?,
    games_played = games_played + 1,
    wins = wins + ?,
    losses = losses + ?,
    pushes = pushes + ?,
    blackjacks = blackjacks + ?,
    total_bet = total_bet + ?,
    total_won = total_won + ?,
    total_lost = total_lost + ?,
    biggest_win = ?,
    current_streak = ?,
    best_streak = ?,
    last_played = datetime('now')
    WHERE user_id = ?`).run(
    username,
    isWin ? 1 : 0,
    isLoss ? 1 : 0,
    outcome === 'push' ? 1 : 0,
    outcome === 'blackjack' ? 1 : 0,
    bet,
    payout > bet ? payout - bet : 0,
    isLoss ? bet : 0,
    biggestWin,
    newStreak,
    bestStreak,
    userId
  );
}

/**
 * Haal Blackjack stats op voor een user
 */
function getBlackjackStats(userId) {
  const db = getDatabase();
  try {
    return db.prepare('SELECT * FROM blackjack_stats WHERE user_id = ?').get(userId) || null;
  } catch {
    return null;
  }
}

function generateBJGameId() {
  return 'bj' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

function cleanupBJGame(gameId) {
  const game = activeBlackjackGames.get(gameId);
  if (game) {
    clearTimeout(game.timeout);
    activeBlackjackGames.delete(gameId);
  }
}

function getTotalBet(game) {
  if (game.hands) {
    return game.hands.reduce((sum, h) => sum + h.bet, 0);
  }
  return game.bet;
}

function resetBJTimeout(gameId) {
  const game = activeBlackjackGames.get(gameId);
  if (!game) return;
  clearTimeout(game.timeout);
  game.timeout = setTimeout(() => {
    const g = activeBlackjackGames.get(gameId);
    if (g) {
      const refund = getTotalBet(g);
      if (refund > 0) {
        casino.addBalance(g.userId, g.username, refund, 'Blackjack timeout refund');
      }
    }
    activeBlackjackGames.delete(gameId);
  }, 120000);
}

function cleanupDoNGame(gameId) {
  const game = activeDoNGames.get(gameId);
  if (game) {
    clearTimeout(game.timeout);
    activeDoNGames.delete(gameId);
  }
}

function resetDoNTimeout(gameId) {
  const game = activeDoNGames.get(gameId);
  if (!game) return;
  clearTimeout(game.timeout);
  game.timeout = setTimeout(() => {
    const g = activeDoNGames.get(gameId);
    if (g && g.pot > 0) {
      casino.addBalance(g.userId, g.username, g.pot, 'Double or Nothing timeout');
    }
    activeDoNGames.delete(gameId);
  }, 120000);
}

// Casino slash commands
const casinoCommands = [
  {
    name: 'balance',
    description: 'Bekijk saldo van jezelf of een andere user',
    options: [
      {
        name: 'user',
        description: 'De user waarvan je het saldo wilt zien (optioneel)',
        type: 6, // USER
        required: false
      }
    ]
  },
  {
    name: 'leaderboard',
    description: 'Bekijk de top 10 spelers'
  },
  {
    name: 'bet',
    description: 'Bekijk actieve weddenschappen',
    options: [
      {
        name: 'status',
        description: 'Bekijk alle actieve weddenschappen',
        type: 1 // SUB_COMMAND
      }
    ]
  },
  {
    name: 'shop',
    description: 'Bekijk de shop of koop items',
    options: [
      {
        name: 'bekijk',
        description: 'Bekijk de shop',
        type: 1 // SUB_COMMAND
      },
      {
        name: 'buy',
        description: 'Koop een item',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'item',
            description: 'Het item om te kopen',
            type: 3, // STRING
            required: true,
            choices: [
              { name: 'Haribo Zakje', value: 'haribo' }
            ]
          }
        ]
      }
    ]
  },
  {
    name: 'admin',
    description: 'Admin commands voor het casino',
    options: [
      {
        name: 'bet',
        description: 'Beheer weddenschappen',
        type: 2, // SUB_COMMAND_GROUP
        options: [
          {
            name: 'create',
            description: 'Maak een nieuwe weddenschap aan',
            type: 1, // SUB_COMMAND
            options: [
              {
                name: 'vraag',
                description: 'De vraag voor de weddenschap (JA/NEE vraag)',
                type: 3, // STRING
                required: true
              }
            ]
          },
          {
            name: 'resolve',
            description: 'Sluit een weddenschap en betaal uit',
            type: 1, // SUB_COMMAND
            options: [
              {
                name: 'id',
                description: 'Het ID van de weddenschap',
                type: 4, // INTEGER
                required: true
              },
              {
                name: 'uitslag',
                description: 'De uitslag: JA of NEE',
                type: 3, // STRING
                required: true,
                choices: [
                  { name: 'JA', value: 'JA' },
                  { name: 'NEE', value: 'NEE' }
                ]
              }
            ]
          },
          {
            name: 'delete',
            description: 'Verwijder een weddenschap (geeft inzetten terug)',
            type: 1, // SUB_COMMAND
            options: [
              {
                name: 'id',
                description: 'Het ID van de weddenschap',
                type: 4, // INTEGER
                required: true
              }
            ]
          }
        ]
      },
      {
        name: 'balance',
        description: 'Beheer user balances',
        type: 2, // SUB_COMMAND_GROUP
        options: [
          {
            name: 'add',
            description: 'Voeg punten toe aan een user',
            type: 1, // SUB_COMMAND
            options: [
              {
                name: 'user',
                description: 'De user',
                type: 6, // USER
                required: true
              },
              {
                name: 'amount',
                description: 'Aantal punten',
                type: 4, // INTEGER
                required: true
              }
            ]
          },
          {
            name: 'remove',
            description: 'Verwijder punten van een user',
            type: 1, // SUB_COMMAND
            options: [
              {
                name: 'user',
                description: 'De user',
                type: 6, // USER
                required: true
              },
              {
                name: 'amount',
                description: 'Aantal punten',
                type: 4, // INTEGER
                required: true
              }
            ]
          },
          {
            name: 'set',
            description: 'Zet de balance van een user',
            type: 1, // SUB_COMMAND
            options: [
              {
                name: 'user',
                description: 'De user',
                type: 6, // USER
                required: true
              },
              {
                name: 'amount',
                description: 'Nieuwe balance',
                type: 4, // INTEGER
                required: true
              }
            ]
          }
        ]
      },
      {
        name: 'quiz',
        description: 'Beheer quiz systeem',
        type: 2, // SUB_COMMAND_GROUP
        options: [
          {
            name: 'start',
            description: 'Start de dagelijkse quiz handmatig',
            type: 1 // SUB_COMMAND
          },
          {
            name: 'test',
            description: 'Start een test quiz',
            type: 1, // SUB_COMMAND
            options: [
              {
                name: 'tijd',
                description: 'Aantal minuten voordat de quiz eindigt (1-600, standaard: 1)',
                type: 4, // INTEGER
                required: false,
                min_value: 1,
                max_value: 600
              }
            ]
          },
          {
            name: 'reset',
            description: 'Reset quiz data',
            type: 1, // SUB_COMMAND
            options: [
              {
                name: 'type',
                description: 'Welke reset wil je uitvoeren?',
                type: 3, // STRING
                required: true,
                choices: [
                  { name: 'QuizDatabase (verwijder alle vragen)', value: 'database' },
                  { name: 'UsedQuestions (reset gebruikte vragen)', value: 'used' }
                ]
              }
            ]
          }
        ]
      },
      {
        name: 'reset',
        description: 'Voer maandelijkse reset uit (TEST)',
        type: 1 // SUB_COMMAND
      }
    ]
  },
  {
    name: 'double',
    description: 'Speel Double or Nothing - verdubbel je inzet of verlies alles!'
  },
  {
    name: 'blackjack',
    description: 'Speel Blackjack tegen de dealer!'
  },
  {
    name: 'blackjackstats',
    description: 'Bekijk Blackjack statistieken van een speler',
    options: [
      {
        name: 'user',
        description: 'De speler waarvan je stats wilt zien (optioneel)',
        type: 6, // USER
        required: false
      }
    ]
  }
];

/**
 * Update de casino status embed in het casino kanaal
 */
async function updateCasinoEmbed(client, casinoChannelId) {
  try {
    const channel = await client.channels.fetch(casinoChannelId);
    if (!channel) return;
    
    const bets = casino.getOpenBets();
    const embed = casino.buildCasinoStatusEmbed(bets);
    
    // Zoek bestaand bericht of stuur nieuw
    const messages = await channel.messages.fetch({ limit: 20 });
    const botMessage = messages.find(m => 
      m.author.id === client.user.id && 
      m.embeds.length > 0 && 
      m.embeds[0].title?.includes('Casino')
    );
    
    if (botMessage) {
      await botMessage.edit({ embeds: [embed] });
    } else {
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Fout bij updaten casino embed:', error);
  }
}

/**
 * Stuur log naar log kanaal
 */
async function sendLog(client, logChannelId, message, embed = null) {
  try {
    const channel = await client.channels.fetch(logChannelId);
    if (!channel) return;
    
    const options = { content: message };
    if (embed) options.embeds = [embed];
    
    await channel.send(options);
  } catch (error) {
    console.error('Fout bij sturen log:', error);
  }
}

// Handle casino commands
async function handleCasinoCommands(interaction, client, config) {
  const { commandName } = interaction;
  const casinoChannelId = config.CASINO_CHANNEL_ID;
  const logChannelId = config.LOG_CHANNEL_ID;
  const winnersChannelId = '1414596895191334925';

  // /balance
  if (commandName === 'balance') {
    const targetUser = interaction.options.getUser('user');
    
    const userId = targetUser ? targetUser.id : interaction.user.id;
    const username = targetUser ? targetUser.username : interaction.user.username;
    
    const embed = casino.buildSaldoEmbed(userId, username);
    await interaction.reply({ embeds: [embed], flags: 64 });
    return true;
  }

  // /leaderboard
  if (commandName === 'leaderboard') {
    const topUsers = casino.getTopUsers(10);
    
    const embed = new EmbedBuilder()
      .setTitle('🏆 Leaderboard - Top 10')
      .setColor('#FFD700')
      .setTimestamp();
    
    if (topUsers.length === 0) {
      embed.setDescription('Er zijn nog geen spelers met punten!');
    } else {
      let description = '';
      topUsers.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        description += `${medal} **${user.username}**: ${user.balance} punten\n`;
      });
      embed.setDescription(description);
    }
    
    await interaction.reply({ embeds: [embed] });
    return true;
  }

  // /bet
  if (commandName === 'bet') {
    const subCommand = interaction.options.getSubcommand();
    
    if (subCommand === 'status') {
      const bets = casino.getOpenBets();
      
      if (bets.length === 0) {
        const embed = casino.buildCasinoStatusEmbed(bets);
        await interaction.reply({ embeds: [embed] });
        return true;
      }
      
      // Stuur elke bet als aparte embed met buttons
      await interaction.deferReply();
      
      for (const bet of bets) {
        const { embed } = casino.buildBetEmbed(bet);
        const buttons = casino.buildBetButtons(bet.id);
        await interaction.followUp({ embeds: [embed], components: [buttons] });
      }
      
      return true;
    }
  }

  // /shop
  if (commandName === 'shop') {
    const subCommand = interaction.options.getSubcommand();
    
    if (subCommand === 'bekijk') {
      const embed = casino.buildShopEmbed();
      await interaction.reply({ embeds: [embed] });
      return true;
    }
    
    if (subCommand === 'buy') {
      const item = interaction.options.getString('item');
      
      if (item === 'haribo') {
        const result = casino.buyHaribo(interaction.user.id, interaction.user.username);
        
        if (!result.success) {
          await interaction.reply({ content: `❌ ${result.error}`, flags: 64 });
          return true;
        }
        
        await interaction.reply({ 
          content: `🍬 **Gefeliciteerd!** Je hebt een Haribo zakje gekocht!\n💰 Nieuw saldo: ${result.newBalance} punten\n📦 Voorraad over: ${result.remainingStock}/${4}`,
          flags: 64
        });
        
        // Log naar log kanaal
        const logEmbed = new EmbedBuilder()
          .setTitle('🍬 Haribo Aankoop!')
          .setColor('#FF69B4')
          .setDescription(`**${interaction.user.username}** heeft een Haribo zakje gekocht!`)
          .addFields(
            { name: 'User ID', value: interaction.user.id, inline: true },
            { name: 'Voorraad over', value: `${result.remainingStock}/4`, inline: true }
          )
          .setTimestamp();
        
        await sendLog(client, logChannelId, `<@${interaction.user.id}> heeft een Haribo gekocht! 🍬`, logEmbed);
        
        return true;
      }
    }
  }

  // /admin
  if (commandName === 'admin') {
    // Check admin permissions
    if (!interaction.member || !interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: '❌ Je hebt geen administrator rechten!', flags: 64 });
      return true;
    }
    
    const subCommandGroup = interaction.options.getSubcommandGroup(false);
    const subCommand = interaction.options.getSubcommand();
    
    // /admin bet create
    if (subCommandGroup === 'bet' && subCommand === 'create') {
      const vraag = interaction.options.getString('vraag');
      
      const betId = casino.createBet(vraag, interaction.user.id);
      
      // Stuur bet embed met buttons naar casino kanaal
      try {
        const casinoChannel = await client.channels.fetch(casinoChannelId);
        if (casinoChannel) {
          const bet = { id: betId, question: vraag };
          const { embed } = casino.buildBetEmbed(bet);
          const buttons = casino.buildBetButtons(betId);
          const message = await casinoChannel.send({ embeds: [embed], components: [buttons] });
          
          // Sla message ID op voor later updaten
          casino.updateBetMessageId(betId, message.id);
        }
      } catch (error) {
        console.error('Fout bij sturen bet naar casino kanaal:', error);
      }
      
      await interaction.reply({ 
        content: `✅ Weddenschap #${betId} aangemaakt: "${vraag}"`, 
        flags: 64 
      });
      
      // Log
      await sendLog(client, logChannelId, `📝 Nieuwe weddenschap #${betId} aangemaakt door ${interaction.user.username}: "${vraag}"`);
      
      return true;
    }
    
    // /admin bet resolve
    if (subCommandGroup === 'bet' && subCommand === 'resolve') {
      const betId = interaction.options.getInteger('id');
      const uitslag = interaction.options.getString('uitslag');
      
      await interaction.deferReply();
      
      const result = casino.resolveBet(betId, uitslag);
      
      if (!result.success) {
        await interaction.editReply({ content: `❌ ${result.error}` });
        return true;
      }
      
      const embed = casino.buildResolveEmbed(result);
      const closedEmbed = casino.buildClosedBetEmbed(result);
      
      await interaction.editReply({ embeds: [embed] });
      
      // Update het originele bet bericht in het casino kanaal
      try {
        const casinoChannel = await client.channels.fetch(casinoChannelId);
        if (casinoChannel && result.bet.message_id) {
          const betMessage = await casinoChannel.messages.fetch(result.bet.message_id).catch(() => null);
          if (betMessage) {
            await betMessage.edit({ embeds: [closedEmbed], components: [] });
          } else {
            console.warn(`Bet bericht niet gevonden voor message_id ${result.bet.message_id}`);
          }
        }
      } catch (error) {
        console.error('Fout bij updaten bet embed in casino kanaal:', error);
      }

      // Plaats overzicht van winnaars in apart kanaal
      try {
        const winnersChannel = await client.channels.fetch(winnersChannelId);
        if (winnersChannel) {
          await winnersChannel.send({ embeds: [embed] });
        }
      } catch (error) {
        console.error('Fout bij sturen naar winnaars kanaal:', error);
      }
      
      // Update casino embed
      await updateCasinoEmbed(client, casinoChannelId);
      
      // Log
      await sendLog(client, logChannelId, `🎲 Weddenschap #${betId} resolved met uitslag: ${uitslag}. Winnaars: ${result.winners.length}, Verliezers: ${result.losers.length}`);
      
      return true;
    }
    
    // /admin bet delete
    if (subCommandGroup === 'bet' && subCommand === 'delete') {
      const betId = interaction.options.getInteger('id');
      
      // Gebruik expire functie om inzetten terug te geven
      const { getDatabase } = require('../database');
      const db = getDatabase();
      
      const bet = casino.getBetWithEntries(betId);
      if (!bet) {
        await interaction.reply({ content: '❌ Weddenschap niet gevonden!', flags: 64 });
        return true;
      }
      
      if (bet.status !== 'open') {
        await interaction.reply({ content: '❌ Deze weddenschap is al gesloten!', flags: 64 });
        return true;
      }
      
      // Geef inzetten terug
      bet.entries.forEach(entry => {
        casino.addBalance(entry.user_id, entry.username, entry.amount, `Terugbetaling verwijderde bet #${betId}`);
      });
      
      // Verwijder bet
      db.prepare('DELETE FROM bets WHERE id = ?').run(betId);
      
      await interaction.reply({ content: `✅ Weddenschap #${betId} verwijderd. ${bet.entries.length} inzetten terugbetaald.`, flags: 64 });
      
      // Update casino embed
      await updateCasinoEmbed(client, casinoChannelId);
      
      return true;
    }
    
    // /admin balance add
    if (subCommandGroup === 'balance' && subCommand === 'add') {
      const user = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      
      const newBalance = casino.addBalance(user.id, user.username, amount, 'Admin add');
      
      await interaction.reply({ 
        content: `✅ ${amount} punten toegevoegd aan ${user.username}. Nieuw saldo: ${newBalance}`, 
        flags: 64 
      });
      
      // Stuur DM aan de gebruiker
      try {
        await user.send(`💰 Je hebt ${amount} punten ontvangen van een admin! Nieuw saldo: ${newBalance}`);
      } catch (err) {
        console.log(`Kon DM niet verzenden naar ${user.username}`);
      }
      
      await sendLog(client, logChannelId, `💰 Admin ${interaction.user.username} heeft ${amount} punten toegevoegd aan ${user.username}`);
      
      return true;
    }
    
    // /admin balance remove
    if (subCommandGroup === 'balance' && subCommand === 'remove') {
      const user = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      
      const newBalance = casino.subtractBalance(user.id, amount);
      
      await interaction.reply({ 
        content: `✅ ${amount} punten verwijderd van ${user.username}. Nieuw saldo: ${newBalance}`, 
        flags: 64 
      });
      
      // Stuur DM aan de gebruiker
      try {
        await user.send(`💸 ${amount} punten zijn van je account verwijderd. Nieuw saldo: ${newBalance}`);
      } catch (err) {
        console.log(`Kon DM niet verzenden naar ${user.username}`);
      }
      
      await sendLog(client, logChannelId, `💸 Admin ${interaction.user.username} heeft ${amount} punten verwijderd van ${user.username}`);
      
      return true;
    }
    
    // /admin balance set
    if (subCommandGroup === 'balance' && subCommand === 'set') {
      const user = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      
      const { getDatabase } = require('../database');
      const db = getDatabase();
      
      casino.getOrCreateUser(user.id, user.username);
      db.prepare('UPDATE users SET balance = ?, last_updated = datetime("now") WHERE user_id = ?').run(amount, user.id);
      
      await interaction.reply({ 
        content: `✅ Balance van ${user.username} gezet naar ${amount} punten.`, 
        flags: 64 
      });
      
      // Stuur DM aan de gebruiker
      try {
        await user.send(`⚙️ Je balance is ingesteld op ${amount} punten.`);
      } catch (err) {
        console.log(`Kon DM niet verzenden naar ${user.username}`);
      }
      
      await sendLog(client, logChannelId, `⚙️ Admin ${interaction.user.username} heeft balance van ${user.username} gezet naar ${amount}`);
      
      return true;
    }
    
    // /admin quiz start
    if (subCommandGroup === 'quiz' && subCommand === 'start') {
      await interaction.deferReply({ flags: 64 });
      
      try {
        // Check if there's already an active quiz
        const activeQuiz = quiz.getActiveQuiz(config.QUIZ_CHANNEL_ID);
        if (activeQuiz) {
          const quizType = activeQuiz.is_test_quiz ? 'test quiz' : 'dagelijkse quiz';
          await interaction.editReply({ 
            content: `⚠️ Er is al een ${quizType} actief! Sluit deze eerst af voordat je een nieuwe start.` 
          });
          return true;
        }

        // Start a regular daily quiz (no timeout)
        await quiz.startDailyQuiz(client, config.QUIZ_CHANNEL_ID, null);
        
        await interaction.editReply({ 
          content: `✅ Dagelijkse quiz handmatig gestart! De quiz zal normaal om 17:00 eindigen.` 
        });
      } catch (error) {
        console.error('Fout bij handmatig starten dagelijkse quiz:', error);
        await interaction.editReply({ 
          content: '❌ Er is een fout opgetreden bij het starten van de dagelijkse quiz.' 
        });
      }
      return true;
    }
    
    // /admin quiz test
    if (subCommandGroup === 'quiz' && subCommand === 'test') {
      await interaction.deferReply({ flags: 64 });
      
      try {
        // Check if there's already an active quiz (daily or test)
        const activeQuiz = quiz.getActiveQuiz(config.QUIZ_CHANNEL_ID);
        if (activeQuiz) {
          const quizType = activeQuiz.is_test_quiz ? 'test quiz' : 'dagelijkse quiz';
          await interaction.editReply({ 
            content: `⚠️ Er is al een ${quizType} actief! Een test quiz zou deze overschrijven.\n\n` +
                     `Wil je de huidige quiz eerst beëindigen? Gebruik dan eerst een command om de huidige quiz te stoppen.` 
          });
          return true;
        }

        const tijd = interaction.options.getInteger('tijd') || 1;
        
        const result = await quiz.startDailyQuiz(client, config.QUIZ_CHANNEL_ID, tijd);
        const usedMinutes = result && typeof result.timeoutMinutesUsed !== 'undefined' && result.timeoutMinutesUsed !== null ? result.timeoutMinutesUsed : tijd;
        
        await interaction.editReply({ 
          content: `✅ Test quiz gestart! De quiz eindigt automatisch na ${usedMinutes} ${usedMinutes === 1 ? 'minuut' : 'minuten'}.` 
        });
      } catch (error) {
        console.error('Fout bij starten test quiz:', error);
        await interaction.editReply({ 
          content: '❌ Er is een fout opgetreden bij het starten van de test quiz.' 
        });
      }
      return true;
    }
    
    // /admin quiz reset
    if (subCommandGroup === 'quiz' && subCommand === 'reset') {
      await interaction.deferReply({ flags: 64 });

      try {
        const resetType = interaction.options.getString('type');

        if (resetType === 'database') {
          // Remove all quiz questions
          const deleted = quiz.deleteAllQuestions();
          await interaction.editReply({ content: `✅ Alle quiz vragen verwijderd (${deleted} rijen).` });
        } else if (resetType === 'used') {
          // Reset only used questions
          const resetCount = quiz.resetUsedQuestions();
          await interaction.editReply({ content: `✅ Gebruikte vragen gereset (${resetCount} rijen).` });
        } else {
          await interaction.editReply({ content: '❌ Onbekende reset type.' });
        }
      } catch (error) {
        console.error('Fout bij uitvoeren resetquiz:', error);
        await interaction.editReply({ content: '❌ Er is een fout opgetreden bij het uitvoeren van de reset.' });
      }
      return true;
    }
    
    // /admin reset
    if (subCommand === 'reset' && !subCommandGroup) {
      await interaction.deferReply({ flags: 64 });
      
      const result = casino.performMonthlyReset();
      
      if (!result.success) {
        await interaction.editReply({ content: `❌ Reset mislukt: ${result.message}` });
        return true;
      }
      
      let message = `✅ Maandelijkse reset uitgevoerd!\n`;
      message += `📊 ${result.totalUsersReset} users gereset\n\n`;
      message += `🏆 **Top 3 met startbonus:**\n`;
      
      result.topUsers.forEach(user => {
        const medal = user.position === 1 ? '🥇' : user.position === 2 ? '🥈' : '🥉';
        message += `${medal} ${user.username}: ${user.final_balance} → ${user.bonus} bonus\n`;
      });
      
      await interaction.editReply({ content: message });
      
      // Log
      await sendLog(client, logChannelId, `🔄 Maandelijkse reset uitgevoerd door ${interaction.user.username}. ${result.totalUsersReset} users gereset.`);
      
      return true;
    }
    
    return true;
  }

  // /double
  if (commandName === 'double') {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // Check of user al een actief spel heeft
    for (const [, game] of activeDoNGames) {
      if (game.userId === userId) {
        await interaction.reply({ content: 'Je hebt al een actief Double or Nothing spel!', flags: 64 });
        return true;
      }
    }

    const user = casino.getOrCreateUser(userId, username);
    const balance = casino.getUserBalance(userId);

    if (balance < 25) {
      await interaction.reply({ content: 'Je hebt niet genoeg punten om te spelen! Je hebt minimaal 25 punten nodig.', flags: 64 });
      return true;
    }

    const gameId = generateDoNGameId();

    const embed = new EmbedBuilder()
      .setTitle('Double or Nothing')
      .setDescription('Kies je inzet om te beginnen.')
      .setColor(0x57F287)
      .setFooter({ text: `Saldo: ${balance} punten` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`don_25_${gameId}`)
        .setLabel('25 punten')
        .setStyle(ButtonStyle.Success)
        .setDisabled(balance < 25),
      new ButtonBuilder()
        .setCustomId(`don_50_${gameId}`)
        .setLabel('50 punten')
        .setStyle(ButtonStyle.Success)
        .setDisabled(balance < 50)
    );

    await interaction.reply({ embeds: [embed], components: [row] });

    activeDoNGames.set(gameId, {
      userId,
      username,
      pot: 0,
      round: 0,
      bet: 0,
      gameId,
      timeout: setTimeout(() => {
        activeDoNGames.delete(gameId);
      }, 120000)
    });

    return true;
  }

  // =====================================================
  // BLACKJACK - Command Handler
  // =====================================================
  if (commandName === 'blackjack') {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // Check of user al een actief blackjack spel heeft
    for (const [, game] of activeBlackjackGames) {
      if (game.userId === userId) {
        await interaction.reply({ content: 'Je hebt al een actief Blackjack spel!', flags: 64 });
        return true;
      }
    }

    const balance = casino.getUserBalance(userId);
    casino.getOrCreateUser(userId, username);

    if (balance < 25) {
      await interaction.reply({ content: 'Je hebt niet genoeg punten om te spelen! Je hebt minimaal 25 punten nodig.', flags: 64 });
      return true;
    }

    const gameId = generateBJGameId();

    const embed = new EmbedBuilder()
      .setTitle('🃏 Blackjack')
      .setDescription('Kies je inzet om te beginnen.')
      .setColor(0x2B2D31)
      .setFooter({ text: `Saldo: ${balance} punten` });

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bj_25_${gameId}`)
        .setLabel('25 punten')
        .setStyle(ButtonStyle.Success)
        .setDisabled(balance < 25),
      new ButtonBuilder()
        .setCustomId(`bj_50_${gameId}`)
        .setLabel('50 punten')
        .setStyle(ButtonStyle.Success)
        .setDisabled(balance < 50),
      new ButtonBuilder()
        .setCustomId(`bj_100_${gameId}`)
        .setLabel('100 punten')
        .setStyle(ButtonStyle.Success)
        .setDisabled(balance < 100),
      new ButtonBuilder()
        .setCustomId(`bj_200_${gameId}`)
        .setLabel('200 punten')
        .setStyle(ButtonStyle.Success)
        .setDisabled(balance < 200)
    );

    await interaction.reply({ embeds: [embed], components: [row1] });

    activeBlackjackGames.set(gameId, {
      userId,
      username,
      bet: 0,
      deck: null,
      playerCards: [],
      dealerCards: [],
      phase: 'betting',
      doubled: false,
      isSplit: false,
      hands: null,
      activeHandIndex: 0,
      gameId,
      timeout: setTimeout(() => {
        activeBlackjackGames.delete(gameId);
      }, 120000)
    });

    return true;
  }

  // =====================================================
  // BLACKJACK STATS - Command Handler
  // =====================================================
  if (commandName === 'blackjackstats') {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const stats = getBlackjackStats(targetUser.id);

    if (!stats) {
      await interaction.reply({ content: `${targetUser.username} heeft nog geen Blackjack gespeeld.`, flags: 64 });
      return true;
    }

    const winRate = stats.games_played > 0 ? (stats.wins / stats.games_played * 100).toFixed(1) : '0.0';
    const netProfit = stats.total_won - stats.total_lost;
    const profitEmoji = netProfit >= 0 ? '📈' : '📉';

    const embed = new EmbedBuilder()
      .setTitle(`🃏 Blackjack Stats — ${stats.username}`)
      .setColor(netProfit >= 0 ? 0x57F287 : 0xED4245)
      .addFields(
        { name: '🎮 Gespeeld', value: `${stats.games_played}`, inline: true },
        { name: '✅ Gewonnen', value: `${stats.wins}`, inline: true },
        { name: '❌ Verloren', value: `${stats.losses}`, inline: true },
        { name: '🎉 Blackjacks', value: `${stats.blackjacks}`, inline: true },
        { name: '🤝 Gelijk', value: `${stats.pushes}`, inline: true },
        { name: '📊 Winrate', value: `${winRate}%`, inline: true },
        { name: `${profitEmoji} Netto`, value: `${netProfit >= 0 ? '+' : ''}${netProfit} punten`, inline: true },
        { name: '💰 Totaal ingezet', value: `${stats.total_bet} punten`, inline: true },
        { name: '🏆 Grootste winst', value: `${stats.biggest_win} punten`, inline: true },
        { name: '🔥 Huidige streak', value: `${stats.current_streak > 0 ? '+' : ''}${stats.current_streak}`, inline: true },
        { name: '⭐ Beste streak', value: `${stats.best_streak}`, inline: true }
      );

    await interaction.reply({ embeds: [embed] });
    return true;
  }

  return false;
}
// =====================================================

/**
 * Speel een ronde Double or Nothing
 */
async function playDoNRound(interaction, game, gameId, client, config) {
  // Toon suspense animatie
  const spinEmbed = new EmbedBuilder()
    .setTitle('Double or Nothing')
    .setDescription(`Ronde ${game.round} van ${DON_MAX_ROUNDS}\n\nDe munt wordt opgegooid...`)
    .setColor(0x5865F2)
    .addFields({ name: 'Huidige Pot', value: `${game.pot} punten`, inline: true });

  await interaction.editReply({ embeds: [spinEmbed], components: [] });

  // Wacht 3 seconden voor spanning
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Bepaal uitkomst
  const won = Math.random() < DON_WIN_CHANCE;

  if (won) {
    game.pot *= 2;

    if (game.round >= DON_MAX_ROUNDS) {
      // Maximale rondes bereikt, automatisch uitbetalen
      casino.addBalance(game.userId, game.username, game.pot, 'Double or Nothing');
      const newBalance = casino.getUserBalance(game.userId);
      cleanupDoNGame(gameId);

      const embed = new EmbedBuilder()
        .setTitle('Double or Nothing')
        .setDescription(`Ronde ${game.round} van ${DON_MAX_ROUNDS}\n\nGewonnen! Maximale rondes bereikt, je pot wordt automatisch uitbetaald.`)
        .setColor(0x57F287)
        .addFields({ name: 'Uitbetaling', value: `${game.pot} punten`, inline: true })
        .setFooter({ text: `Nieuw saldo: ${newBalance} punten` });

      await interaction.editReply({ embeds: [embed], components: [] });

      // Jackpot @here ping
      try {
        await interaction.channel.send({ content: `@here **JACKPOT!** ${game.username} heeft ${game.pot} punten gewonnen bij Double or Nothing!`, allowedMentions: { parse: ['everyone'] } });
      } catch (error) {
        console.error('Fout bij sturen jackpot ping:', error);
      }

      // Log
      await sendLog(client, config.LOG_CHANNEL_ID, `Double or Nothing: ${game.username} wint ${game.pot} punten (${game.round} rondes, inzet: ${game.bet})`);
    } else {
      // Toon winst met keuze
      const embed = new EmbedBuilder()
        .setTitle('Double or Nothing')
        .setDescription(`Ronde ${game.round} van ${DON_MAX_ROUNDS}\n\nGewonnen!`)
        .setColor(0x57F287)
        .addFields(
          { name: 'Huidige Pot', value: `${game.pot} punten`, inline: true },
          { name: 'Potentiele Winst', value: `${game.pot * 2} punten`, inline: true }
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`don_double_${gameId}`)
          .setLabel('Verdubbelen')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`don_stop_${gameId}`)
          .setLabel('Stoppen en Uitbetalen')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
    }
  } else {
    // Verloren
    const lostPot = game.pot;
    cleanupDoNGame(gameId);
    const newBalance = casino.getUserBalance(game.userId);

    const embed = new EmbedBuilder()
      .setTitle('Double or Nothing')
      .setDescription(`Ronde ${game.round} van ${DON_MAX_ROUNDS}\n\nVerloren! Je pot van ${lostPot} punten is weg.`)
      .setColor(0xED4245)
      .setFooter({ text: `Saldo: ${newBalance} punten` });

    await interaction.editReply({ embeds: [embed], components: [] });
  }
}

/**
 * Handle Double or Nothing button interactions
 */
async function handleDoubleOrNothingButton(interaction, client, config) {
  const customId = interaction.customId;
  if (!customId.startsWith('don_')) return false;

  // Parse: don_{action}_{gameId}
  const withoutPrefix = customId.substring(4); // Remove 'don_'
  const separatorIndex = withoutPrefix.indexOf('_');
  if (separatorIndex === -1) return false;

  const action = withoutPrefix.substring(0, separatorIndex);
  const gameId = withoutPrefix.substring(separatorIndex + 1);

  const game = activeDoNGames.get(gameId);

  if (!game) {
    await interaction.reply({ content: 'Dit spel is verlopen!', flags: 64 });
    return true;
  }

  // Alleen de speler die het spel startte mag klikken
  if (interaction.user.id !== game.userId) {
    await interaction.reply({ content: 'Dit is niet jouw spel!', flags: 64 });
    return true;
  }

  // Reset inactiviteit timeout
  resetDoNTimeout(gameId);

  // Inzet kiezen (25 of 50)
  if (action === '25' || action === '50') {
    const betAmount = parseInt(action);
    const balance = casino.getUserBalance(game.userId);

    if (balance < betAmount) {
      await interaction.reply({ content: `Je hebt niet genoeg punten! Saldo: ${balance}`, flags: 64 });
      return true;
    }

    // Trek inzet af van saldo
    casino.subtractBalance(game.userId, betAmount);
    game.pot = betAmount;
    game.bet = betAmount;
    game.round = 1;

    await interaction.deferUpdate();
    await playDoNRound(interaction, game, gameId, client, config);
    return true;
  }

  // Verdubbelen
  if (action === 'double') {
    game.round += 1;

    await interaction.deferUpdate();
    await playDoNRound(interaction, game, gameId, client, config);
    return true;
  }

  // Stoppen en uitbetalen
  if (action === 'stop') {
    casino.addBalance(game.userId, game.username, game.pot, 'Double or Nothing');
    const newBalance = casino.getUserBalance(game.userId);
    cleanupDoNGame(gameId);

    await interaction.deferUpdate();

    const embed = new EmbedBuilder()
      .setTitle('Double or Nothing')
      .setDescription(`Uitbetaald na ${game.round} ${game.round === 1 ? 'ronde' : 'rondes'}.`)
      .setColor(0xF0B232)
      .addFields({ name: 'Uitbetaling', value: `${game.pot} punten`, inline: true })
      .setFooter({ text: `Nieuw saldo: ${newBalance} punten` });

    await interaction.editReply({ embeds: [embed], components: [] });

    // Log
    await sendLog(client, config.LOG_CHANNEL_ID, `Double or Nothing: ${game.username} casht uit voor ${game.pot} punten (${game.round} rondes, inzet: ${game.bet})`);
    return true;
  }

  return false;
}

/**
 * Handle bet button interactions
 */
async function handleBetButton(interaction, client, config) {
  const customId = interaction.customId;
  
  // Check of het een bet button is
  if (!customId.startsWith('bet_')) return false;
  
  const parts = customId.split('_');
  if (parts.length !== 3) return false;
  
  const betId = parseInt(parts[1]);
  const choice = parts[2]; // JA of NEE
  
  // Haal bet op
  const bet = casino.getBetWithEntries(betId);
  if (!bet) {
    await interaction.reply({ content: '❌ Deze weddenschap bestaat niet meer!', flags: 64 });
    return true;
  }
  
  if (bet.status !== 'open') {
    await interaction.reply({ content: '❌ Deze weddenschap is al gesloten!', flags: 64 });
    return true;
  }
  
  // Probeer bet te plaatsen
  const result = casino.placeBet(betId, interaction.user.id, interaction.user.username, choice);
  
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, flags: 64 });
    return true;
  }
  
  const newBalance = casino.getUserBalance(interaction.user.id);
  await interaction.reply({ 
    content: `✅ Je hebt **${casino.BET_AMOUNT} punten** ingezet op **${choice}**!\n💰 Nieuw saldo: ${newBalance} punten`, 
    flags: 64 
  });
  
  // Update de embed met nieuwe data
  try {
    const { embed } = casino.buildBetEmbed({ id: betId, question: bet.question });
    const buttons = casino.buildBetButtons(betId);
    await interaction.message.edit({ embeds: [embed], components: [buttons] });
  } catch (error) {
    console.error('Fout bij updaten bet embed:', error);
  }
  
  return true;
}

// =====================================================
// BLACKJACK - Embed Builders
// =====================================================

/**
 * Bouw de Blackjack game embed
 */
async function buildBlackjackEmbed(game, revealDealer = false, resultText = null, resultColor = null) {
  const isSplit = game.isSplit && game.hands;
  const dealerValue = revealDealer
    ? blackjack.calculateHandValue(game.dealerCards).value
    : blackjack.calculateHandValue([game.dealerCards[0]]).value;

  const dealerLabel = revealDealer ? `Dealer (${dealerValue})` : 'Dealer (?)';

  // Totale inzet berekenen
  const totalBet = getTotalBet(game);

  const separator = '━━━━━━━━━━━━━━━━━━━━';

  let description = '';
  if (resultText) {
    description = resultText;
  }

  const color = resultColor || 0x5865F2; // blurple default

  // Bij split: toon actieve hand indicator in description als er geen resultaat is
  if (isSplit && !resultText) {
    const handIdx = game.activeHandIndex + 1;
    const handValue = blackjack.calculateHandValue(game.hands[game.activeHandIndex].cards).value;
    description = `✂️ Split — Hand ${handIdx} is aan de beurt (${handValue})`;
  }

  // Render kaartafbeelding
  let files = [];
  try {
    const splitOptions = isSplit ? {
      hands: game.hands,
      activeHandIndex: game.activeHandIndex,
      finished: revealDealer
    } : null;

    const playerLabel = isSplit ? game.username : `${game.username} (${blackjack.calculateHandValue(game.playerCards).value})`;

    const imageBuffer = await renderBlackjackTable(
      game.dealerCards,
      isSplit ? [] : game.playerCards,
      !revealDealer,
      dealerLabel,
      playerLabel,
      splitOptions
    );
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'blackjack.png' });
    files = [attachment];
  } catch (err) {
    console.error('Fout bij renderen kaartafbeelding:', err);
    // Fallback naar tekst als rendering faalt
    const dealerDisplay = revealDealer
      ? `**Dealer** (${dealerValue})\n${blackjack.formatHand(game.dealerCards)}`
      : `**Dealer** (?)\n${blackjack.formatHand(game.dealerCards, true)}`;

    if (isSplit) {
      let handsDisplay = '';
      game.hands.forEach((hand, i) => {
        const hv = blackjack.calculateHandValue(hand.cards).value;
        const marker = (!revealDealer && i === game.activeHandIndex) ? '▶ ' : '';
        handsDisplay += `\n**${marker}Hand ${i + 1}** (${hv})\n${blackjack.formatHand(hand.cards)}`;
      });
      description = `${dealerDisplay}\n\n${separator}${handsDisplay}` + (resultText ? `\n\n${separator}\n\n${resultText}` : '');
    } else {
      const playerValue = blackjack.calculateHandValue(game.playerCards).value;
      const playerDisplay = `**${game.username}** (${playerValue})\n${blackjack.formatHand(game.playerCards)}`;
      description = `${dealerDisplay}\n\n${separator}\n\n${playerDisplay}` + (resultText ? `\n\n${separator}\n\n${resultText}` : '');
    }
  }

  const doubledText = game.doubled ? ' (Doubled)' : '';
  const splitText = isSplit ? ' (Split)' : '';
  const embed = new EmbedBuilder()
    .setTitle('🃏 Blackjack')
    .setColor(color)
    .setFooter({ text: `Inzet: ${totalBet} punten${doubledText}${splitText}` });

  if (description) {
    embed.setDescription(description);
  }

  if (files.length > 0) {
    embed.setImage('attachment://blackjack.png');
  }

  return { embed, files };
}

/**
 * Bouw de actie-buttons voor Blackjack (dynamisch op basis van game state)
 */
function buildBlackjackButtons(gameId, game) {
  const balance = casino.getUserBalance(game.userId);
  const activeCards = game.hands ? game.hands[game.activeHandIndex].cards : game.playerCards;
  const currentBet = game.hands ? game.hands[game.activeHandIndex].bet : game.bet;

  const buttons = [
    new ButtonBuilder()
      .setCustomId(`bj_hit_${gameId}`)
      .setLabel('Hit 🃏')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`bj_stand_${gameId}`)
      .setLabel('Stand ✋')
      .setStyle(ButtonStyle.Secondary)
  ];

  // Double: alleen bij precies 2 kaarten EN genoeg saldo
  if (blackjack.canDouble(activeCards) && balance >= currentBet) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`bj_double_${gameId}`)
        .setLabel('Double 💰')
        .setStyle(ButtonStyle.Success)
    );
  }

  // Split: alleen bij paar, eerste 2 kaarten, genoeg saldo, nog niet gesplit
  if (!game.isSplit && blackjack.canSplit(activeCards) && balance >= currentBet) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`bj_split_${gameId}`)
        .setLabel('Split ✂️')
        .setStyle(ButtonStyle.Danger)
    );
  }

  return new ActionRowBuilder().addComponents(buttons);
}

/**
 * Bouw de "Opnieuw Spelen" button row voor na afloop
 */
function buildBlackjackReplayButton(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bj_replay_${gameId}`)
      .setLabel('Opnieuw Spelen 🔄')
      .setStyle(ButtonStyle.Success)
  );
}

// =====================================================
// BLACKJACK - Button Handler
// =====================================================

async function handleBlackjackButton(interaction, client, config) {
  // Parse: bj_{action}_{...}
  const parts = interaction.customId.split('_');
  // parts[0] = 'bj', parts[1] = action, rest = context
  const action = parts[1];

  // ── Opnieuw Spelen → toon inzetkeuze ──
  if (action === 'replay') {
    // Check of user al een actief spel heeft
    for (const [, g] of activeBlackjackGames) {
      if (g.userId === interaction.user.id) {
        await interaction.reply({ content: 'Je hebt al een actief Blackjack spel!', flags: 64 });
        return;
      }
    }

    await interaction.deferUpdate();

    const balance = casino.getUserBalance(interaction.user.id);

    if (balance < 25) {
      await interaction.followUp({ content: '❌ Je hebt niet genoeg punten om te spelen! Je hebt minimaal 25 punten nodig.', flags: 64 });
      return;
    }

    // Maak een nieuw spel in betting fase
    const newGameId = generateBJGameId();

    activeBlackjackGames.set(newGameId, {
      userId: interaction.user.id,
      username: interaction.user.username,
      bet: 0,
      deck: null,
      playerCards: [],
      dealerCards: [],
      phase: 'betting',
      doubled: false,
      isSplit: false,
      hands: null,
      activeHandIndex: 0,
      gameId: newGameId,
      timeout: setTimeout(() => {
        activeBlackjackGames.delete(newGameId);
      }, 120000)
    });

    const embed = new EmbedBuilder()
      .setTitle('🃏 Blackjack')
      .setDescription('Kies je inzet:')
      .setColor(0x5865F2);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bj_25_${newGameId}`)
        .setLabel('25 punten')
        .setStyle(ButtonStyle.Success)
        .setDisabled(balance < 25),
      new ButtonBuilder()
        .setCustomId(`bj_50_${newGameId}`)
        .setLabel('50 punten')
        .setStyle(ButtonStyle.Success)
        .setDisabled(balance < 50),
      new ButtonBuilder()
        .setCustomId(`bj_100_${newGameId}`)
        .setLabel('100 punten')
        .setStyle(ButtonStyle.Success)
        .setDisabled(balance < 100),
      new ButtonBuilder()
        .setCustomId(`bj_200_${newGameId}`)
        .setLabel('200 punten')
        .setStyle(ButtonStyle.Success)
        .setDisabled(balance < 200)
    );

    await interaction.editReply({ embeds: [embed], files: [], components: [row] });
    return;
  }

  // ── Alle andere acties: game moet bestaan ──
  const gameId = parts.slice(2).join('_');
  const game = activeBlackjackGames.get(gameId);

  if (!game) {
    await interaction.reply({ content: '❌ Dit spel is verlopen!', flags: 64 });
    return;
  }

  if (interaction.user.id !== game.userId) {
    await interaction.reply({ content: '❌ Dit is niet jouw spel!', flags: 64 });
    return;
  }

  await interaction.deferUpdate();
  resetBJTimeout(gameId);

  // ── Inzet kiezen ──
  if (['25', '50', '100', '200'].includes(action) && game.phase === 'betting') {
    const balance = casino.getUserBalance(game.userId);
    const betAmount = parseInt(action);

    if (balance < betAmount) {
      await interaction.followUp({ content: '❌ Je hebt niet genoeg punten!', flags: 64 });
      return;
    }

    // Inzet afschrijven
    casino.subtractBalance(game.userId, betAmount);
    game.bet = betAmount;
    game.phase = 'playing';

    // Maak deck en deel kaarten
    game.deck = blackjack.createDeck();
    game.playerCards = [blackjack.dealCard(game.deck), blackjack.dealCard(game.deck)];
    game.dealerCards = [blackjack.dealCard(game.deck), blackjack.dealCard(game.deck)];

    // Check voor Blackjack
    const playerBJ = blackjack.isBlackjack(game.playerCards);
    const dealerBJ = blackjack.isBlackjack(game.dealerCards);

    if (playerBJ || dealerBJ) {
      // Direct resultaat
      const outcome = blackjack.determineOutcome(game.playerCards, game.dealerCards);
      const payout = blackjack.calculatePayout(betAmount, outcome);
      if (payout > 0) {
        casino.addBalance(game.userId, game.username, payout, `Blackjack ${outcome}`);
      }
      const newBalance = casino.getUserBalance(game.userId);

      const { text, color } = getOutcomeDisplay(outcome, payout, betAmount);
      const { embed, files } = await buildBlackjackEmbed(game, true, `${text}\n\n💰 Saldo: ${newBalance} punten`, color);

      if (outcome === 'lose') {
        embed.setThumbnail(KEEP_GAMBLING_IMG);
      }

      await interaction.editReply({ embeds: [embed], files, components: [buildBlackjackReplayButton(gameId)] });
      recordBlackjackResult(game.userId, game.username, betAmount, payout, outcome);
      cleanupBJGame(gameId);
      return;
    }

    // Toon initiële hand met buttons
    const { embed, files } = await buildBlackjackEmbed(game);
    const buttons = buildBlackjackButtons(gameId, game);
    await interaction.editReply({ embeds: [embed], files, components: [buttons] });
    return;
  }

  // ── Hit ──
  if (action === 'hit' && game.phase === 'playing') {
    if (game.isSplit && game.hands) {
      // Split mode: hit op actieve hand
      const hand = game.hands[game.activeHandIndex];
      hand.cards.push(blackjack.dealCard(game.deck));

      if (blackjack.isBusted(hand.cards)) {
        hand.status = 'bust';
        // Ga naar volgende hand of dealer
        return await advanceSplitHand(interaction, game, gameId);
      }

      if (blackjack.calculateHandValue(hand.cards).value === 21) {
        hand.status = 'stand';
        return await advanceSplitHand(interaction, game, gameId);
      }

      // Toon bijgewerkte hand
      const { embed, files } = await buildBlackjackEmbed(game);
      const buttons = buildBlackjackButtons(gameId, game);
      await interaction.editReply({ embeds: [embed], files, components: [buttons] });
      return;
    }

    // Normaal (niet-split) mode
    game.playerCards.push(blackjack.dealCard(game.deck));

    if (blackjack.isBusted(game.playerCards)) {
      // Bust - verloren
      const newBalance = casino.getUserBalance(game.userId);
      const { embed, files } = await buildBlackjackEmbed(game, true,
        `💥 **Bust!** Je bent over de 21!\nJe verliest **${game.bet} punten**.\n\n💰 Saldo: ${newBalance} punten`,
        0xED4245
      );
      embed.setThumbnail(KEEP_GAMBLING_IMG);
      await interaction.editReply({ embeds: [embed], files, components: [buildBlackjackReplayButton(gameId)] });
      recordBlackjackResult(game.userId, game.username, game.bet, 0, 'lose');
      cleanupBJGame(gameId);
      return;
    }

    // Check voor 21 - direct naar dealer turn (niet auto-win, fair play)
    if (blackjack.calculateHandValue(game.playerCards).value === 21) {
      return await resolveBJDealerTurn(interaction, game, gameId);
    }

    // Toon bijgewerkte hand
    const { embed, files } = await buildBlackjackEmbed(game);
    const buttons = buildBlackjackButtons(gameId, game);
    await interaction.editReply({ embeds: [embed], files, components: [buttons] });
    return;
  }

  // ── Stand ──
  if (action === 'stand' && game.phase === 'playing') {
    if (game.isSplit && game.hands) {
      game.hands[game.activeHandIndex].status = 'stand';
      return await advanceSplitHand(interaction, game, gameId);
    }
    return await resolveBJDealerTurn(interaction, game, gameId);
  }

  // ── Double Down ──
  if (action === 'double' && game.phase === 'playing') {
    if (game.isSplit && game.hands) {
      // Double op split-hand
      const hand = game.hands[game.activeHandIndex];
      if (!blackjack.canDouble(hand.cards)) {
        await interaction.followUp({ content: '❌ Je kunt niet meer double-downen!', flags: 64 });
        return;
      }
      const balance = casino.getUserBalance(game.userId);
      if (balance < hand.bet) {
        await interaction.followUp({ content: '❌ Je hebt niet genoeg punten om te double-downen!', flags: 64 });
        return;
      }
      casino.subtractBalance(game.userId, hand.bet);
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(blackjack.dealCard(game.deck));

      if (blackjack.isBusted(hand.cards)) {
        hand.status = 'bust';
      } else {
        hand.status = 'stand';
      }
      return await advanceSplitHand(interaction, game, gameId);
    }

    // Normaal (niet-split) double
    if (!blackjack.canDouble(game.playerCards)) {
      await interaction.followUp({ content: '❌ Je kunt niet meer double-downen!', flags: 64 });
      return;
    }
    const balance = casino.getUserBalance(game.userId);
    if (balance < game.bet) {
      await interaction.followUp({ content: '❌ Je hebt niet genoeg punten om te double-downen!', flags: 64 });
      return;
    }

    casino.subtractBalance(game.userId, game.bet);
    game.bet *= 2;
    game.doubled = true;
    game.playerCards.push(blackjack.dealCard(game.deck));

    if (blackjack.isBusted(game.playerCards)) {
      const newBalance = casino.getUserBalance(game.userId);
      const { embed, files } = await buildBlackjackEmbed(game, true,
        `💰 **Doubled & Bust!** Je bent over de 21!\nJe verliest **${game.bet} punten**.\n\n💰 Saldo: ${newBalance} punten`,
        0xED4245
      );
      embed.setThumbnail(KEEP_GAMBLING_IMG);
      await interaction.editReply({ embeds: [embed], files, components: [buildBlackjackReplayButton(gameId)] });
      recordBlackjackResult(game.userId, game.username, game.bet, 0, 'lose');
      cleanupBJGame(gameId);
      return;
    }

    // Auto-stand na double → dealer turn
    return await resolveBJDealerTurn(interaction, game, gameId);
  }

  // ── Split ──
  if (action === 'split' && game.phase === 'playing') {
    if (game.isSplit) {
      await interaction.followUp({ content: '❌ Je hebt al gesplit!', flags: 64 });
      return;
    }
    if (!blackjack.canSplit(game.playerCards)) {
      await interaction.followUp({ content: '❌ Je kunt deze hand niet splitsen!', flags: 64 });
      return;
    }
    const balance = casino.getUserBalance(game.userId);
    if (balance < game.bet) {
      await interaction.followUp({ content: '❌ Je hebt niet genoeg punten om te splitsen!', flags: 64 });
      return;
    }

    // Extra inzet afschrijven
    casino.subtractBalance(game.userId, game.bet);

    const card1 = game.playerCards[0];
    const card2 = game.playerCards[1];
    const isAces = card1.rank === 'A';

    // Maak 2 handen
    game.hands = [
      { cards: [card1, blackjack.dealCard(game.deck)], bet: game.bet, doubled: false, status: 'playing' },
      { cards: [card2, blackjack.dealCard(game.deck)], bet: game.bet, doubled: false, status: 'playing' }
    ];
    game.isSplit = true;
    game.activeHandIndex = 0;
    // Wis playerCards (niet meer in gebruik)
    game.playerCards = [];

    // Azen-regel: slechts 1 kaart per hand, auto-stand
    if (isAces) {
      game.hands[0].status = 'stand';
      game.hands[1].status = 'stand';
      return await resolveSplitDealerTurn(interaction, game, gameId);
    }

    // Check of hand 1 direct 21 heeft
    if (blackjack.calculateHandValue(game.hands[0].cards).value === 21) {
      game.hands[0].status = 'stand';
      return await advanceSplitHand(interaction, game, gameId);
    }

    // Toon hand 1
    const { embed, files } = await buildBlackjackEmbed(game);
    const buttons = buildBlackjackButtons(gameId, game);
    await interaction.editReply({ embeds: [embed], files, components: [buttons] });
    return;
  }
}

/**
 * Ga naar de volgende split-hand of start dealer turn
 */
async function advanceSplitHand(interaction, game, gameId) {
  // Probeer naar volgende hand te gaan
  if (game.activeHandIndex < game.hands.length - 1) {
    game.activeHandIndex++;
    const nextHand = game.hands[game.activeHandIndex];

    // Check of volgende hand direct 21 heeft
    if (blackjack.calculateHandValue(nextHand.cards).value === 21) {
      nextHand.status = 'stand';
      // Alle handen klaar → dealer turn
      return await resolveSplitDealerTurn(interaction, game, gameId);
    }

    // Toon volgende hand
    const { embed, files } = await buildBlackjackEmbed(game);
    const buttons = buildBlackjackButtons(gameId, game);
    await interaction.editReply({ embeds: [embed], files, components: [buttons] });
    return;
  }

  // Alle handen klaar → dealer turn
  return await resolveSplitDealerTurn(interaction, game, gameId);
}

/**
 * Dealer speelt en bepaal resultaat voor split-handen
 */
async function resolveSplitDealerTurn(interaction, game, gameId) {
  game.phase = 'dealer';

  // Check of alle handen bust zijn
  const allBust = game.hands.every(h => h.status === 'bust');
  if (!allBust) {
    blackjack.playDealer(game.deck, game.dealerCards);
  }

  let totalPayout = 0;
  let totalBet = 0;
  let anyWin = false;
  let anyLose = false;
  const resultLines = [];

  game.hands.forEach((hand, i) => {
    totalBet += hand.bet;
    const handLabel = `Hand ${i + 1}`;

    if (hand.status === 'bust') {
      resultLines.push(`${handLabel}: 💥 Bust — verlies **${hand.bet}** punten`);
      anyLose = true;
      return;
    }

    // Na split is A+10 geen blackjack, gewoon 21
    const outcome = determineSplitOutcome(hand.cards, game.dealerCards);
    const payout = blackjack.calculatePayout(hand.bet, outcome);
    totalPayout += payout;

    if (outcome === 'win') {
      resultLines.push(`${handLabel}: ✅ Gewonnen — +**${payout - hand.bet}** punten`);
      anyWin = true;
    } else if (outcome === 'push') {
      resultLines.push(`${handLabel}: 🤝 Gelijk — inzet terug`);
    } else {
      resultLines.push(`${handLabel}: ❌ Verloren — -**${hand.bet}** punten`);
      anyLose = true;
    }
  });

  if (totalPayout > 0) {
    casino.addBalance(game.userId, game.username, totalPayout, 'Blackjack split');
  }

  const newBalance = casino.getUserBalance(game.userId);
  const netResult = totalPayout - totalBet;
  const color = netResult > 0 ? 0x57F287 : netResult === 0 ? 0xF0B232 : 0xED4245;
  const netText = netResult > 0 ? `+${netResult}` : `${netResult}`;

  const resultText = `✂️ **Split Resultaat**\n${resultLines.join('\n')}\n\n📊 Netto: **${netText} punten**\n💰 Saldo: ${newBalance} punten`;
  const { embed, files } = await buildBlackjackEmbed(game, true, resultText, color);

  if (anyLose && !anyWin) {
    embed.setThumbnail(KEEP_GAMBLING_IMG);
  }

  await interaction.editReply({ embeds: [embed], files, components: [buildBlackjackReplayButton(gameId)] });

  // Registreer als 1 game; overall outcome
  const overallOutcome = netResult > 0 ? 'win' : netResult === 0 ? 'push' : 'lose';
  recordBlackjackResult(game.userId, game.username, totalBet, totalPayout, overallOutcome);
  cleanupBJGame(gameId);
}

/**
 * Bepaal outcome voor een split-hand (geen blackjack-bonus mogelijk)
 */
function determineSplitOutcome(playerCards, dealerCards) {
  const playerValue = blackjack.calculateHandValue(playerCards).value;
  const dealerValue = blackjack.calculateHandValue(dealerCards).value;

  if (playerValue > 21) return 'lose';
  if (dealerValue > 21) return 'win';
  if (playerValue > dealerValue) return 'win';
  if (playerValue < dealerValue) return 'lose';
  return 'push';
}

/**
 * Dealer speelt en bepaal resultaat (normaal / niet-split)
 */
async function resolveBJDealerTurn(interaction, game, gameId) {
  game.phase = 'dealer';

  // Dealer speelt
  blackjack.playDealer(game.deck, game.dealerCards);

  // Bepaal resultaat
  const outcome = blackjack.determineOutcome(game.playerCards, game.dealerCards);
  const payout = blackjack.calculatePayout(game.bet, outcome);

  if (payout > 0) {
    casino.addBalance(game.userId, game.username, payout, `Blackjack ${outcome}`);
  }

  const newBalance = casino.getUserBalance(game.userId);
  const doubledText = game.doubled ? ' (Doubled)' : '';
  const { text, color } = getOutcomeDisplay(outcome, payout, game.bet);

  const { embed, files } = await buildBlackjackEmbed(game, true, `${text}${doubledText}\n\n💰 Saldo: ${newBalance} punten`, color);

  if (outcome === 'lose') {
    embed.setThumbnail(KEEP_GAMBLING_IMG);
  }

  await interaction.editReply({ embeds: [embed], files, components: [buildBlackjackReplayButton(gameId)] });
  recordBlackjackResult(game.userId, game.username, game.bet, payout, outcome);
  cleanupBJGame(gameId);
}

/**
 * Geeft display tekst en kleur voor een uitkomst
 */
function getOutcomeDisplay(outcome, payout, bet) {
  switch (outcome) {
    case 'blackjack':
      return {
        text: `🎉 **BLACKJACK!** Je wint **${payout - bet} punten**!`,
        color: 0xFFD700
      };
    case 'win':
      return {
        text: `✅ **Gewonnen!** Je wint **${payout - bet} punten**!`,
        color: 0x57F287
      };
    case 'push':
      return {
        text: `🤝 **Gelijkspel!** Je krijgt je inzet van **${bet} punten** terug.`,
        color: 0xF0B232
      };
    case 'lose':
      return {
        text: `❌ **Verloren!** Je verliest **${bet} punten**.`,
        color: 0xED4245
      };
    default:
      return { text: '', color: 0x5865F2 };
  }
}

module.exports = {
  casinoCommands,
  handleCasinoCommands,
  handleBetButton,
  handleDoubleOrNothingButton,
  handleBlackjackButton,
  updateCasinoEmbed,
  sendLog
};
