/**
 * Casino Commands - Slash commands voor het casino systeem
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const casino = require('../modules/casino');
const quiz = require('../modules/quiz');

// =====================================================
// DOUBLE OR NOTHING - Game State
// =====================================================
const activeDoNGames = new Map();
const DON_WIN_CHANCE = 0.50;
const DON_MAX_ROUNDS = 5;

function generateDoNGameId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
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

  // /balance
  if (commandName === 'balance') {
    const targetUser = interaction.options.getUser('user');
    
    // If a user is specified, check if the requester is an admin
    if (targetUser && !interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: '❌ Je hebt geen rechten om het saldo van anderen te bekijken!', flags: 64 });
      return true;
    }
    
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
    if (!interaction.member.permissions.has('Administrator')) {
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
      
      await interaction.editReply({ embeds: [embed] });
      
      // Stuur ook naar casino kanaal
      try {
        const casinoChannel = await client.channels.fetch(casinoChannelId);
        if (casinoChannel) {
          await casinoChannel.send({ embeds: [embed] });
        }
      } catch (error) {
        console.error('Fout bij sturen naar casino kanaal:', error);
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

  return false;
}

// =====================================================
// DOUBLE OR NOTHING - Round Logic
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

module.exports = {
  casinoCommands,
  handleCasinoCommands,
  handleBetButton,
  handleDoubleOrNothingButton,
  updateCasinoEmbed,
  sendLog
};
