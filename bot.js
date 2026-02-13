// installeer eerst met: npm install discord.js node-fetch better-sqlite3
const { Client, GatewayIntentBits, ActivityType, EmbedBuilder } = require("discord.js");
const config = require('./config.json');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { initDatabase } = require('./database');
const quiz = require('./modules/quiz.js');
const hok = require('./modules/hok.js');
const casino = require('./modules/casino.js');
const { allCommands, handleCommands } = require('./commands');
const { handleChatResponse } = require('./modules/chatResponses.js');
const { updateCasinoEmbed, sendLog, handleBetButton, handleDoubleOrNothingButton, handleBlackjackButton, handleApprovalButton } = require('./commands/casinoCommands.js');
const { handleConnectFourButton } = require('./commands/connectFourCommands.js');
const { handleHangmanButton } = require('./commands/hangmanCommands.js');

// Config wordt nu geïmporteerd uit config.json
const { TOKEN, CHANNEL_ID, QUIZ_CHANNEL_ID, SCOREBOARD_CHANNEL_ID, API_URL, ROLE_ID, CASINO_CHANNEL_ID, LOG_CHANNEL_ID, CHATBOT_CHANNEL_ID, GROQ_API_KEY } = config;

function ensureLogDirectory() {
  const logDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

function getDailyLogFilePath() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const logDir = ensureLogDirectory();
  return path.join(logDir, `bot-${date}.log`);
}

function setupFileLogging() {
  const originalLog = console.log.bind(console);
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  const writeLine = (level, args) => {
    const timestamp = new Date().toISOString();
    const message = args
      .map((value) => {
        if (value instanceof Error) return value.stack || value.message;
        if (typeof value === 'object') {
          try {
            return JSON.stringify(value);
          } catch (err) {
            return String(value);
          }
        }
        return String(value);
      })
      .join(' ');

    const line = `[${timestamp}] [${level}] ${message}\n`;
    try {
      fs.appendFileSync(getDailyLogFilePath(), line, 'utf8');
    } catch (err) {
      originalError('Kon niet schrijven naar logbestand:', err);
    }
  };

  console.log = (...args) => {
    writeLine('INFO', args);
    originalLog(...args);
  };

  console.warn = (...args) => {
    writeLine('WARN', args);
    originalWarn(...args);
  };

  console.error = (...args) => {
    writeLine('ERROR', args);
    originalError(...args);
  };
}

setupFileLogging();

// Load active quizzes on bot startup
async function loadActiveQuizzes() {
  try {
    const activeQuizzes = quiz.loadActiveQuizzes();
    
    if (activeQuizzes.length === 0) {
      console.log('Geen actieve quizzes bij opstarten');
      return;
    }
    
    console.log(`${activeQuizzes.length} actieve quiz(zes) gevonden in database`);
    
    for (const quizInfo of activeQuizzes) {
      try {
        const channel = await client.channels.fetch(quizInfo.channel_id);
        if (channel) {
          const message = await channel.messages.fetch(quizInfo.message_id);
          if (message) {
            activeQuizMessages.set(quizInfo.message_id, message);
            console.log(`✓ Herladen actieve quiz in kanaal ${quizInfo.channel_id}`);
          }
        }
      } catch (error) {
        console.error(`Kon quiz niet herladen voor kanaal ${quizInfo.channel_id}:`, error);
        // Quiz wordt automatisch uit database gehaald bij volgende cleanup
      }
    }
  } catch (error) {
    console.error('Fout bij laden actieve quizzes:', error);
  }
}

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Global error handler
client.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

let activeQuizMessages = new Map(); // Store active quiz message references
let hokState = null; // State voor hok monitoring
const chatbotChannelQueues = new Map(); // Voorkom overlappende chatbot requests per kanaal

function enqueueChatbotTask(channelId, task) {
  const currentQueue = chatbotChannelQueues.get(channelId) || Promise.resolve();

  const nextTask = currentQueue
    .catch(() => {})
    .then(task);

  chatbotChannelQueues.set(channelId, nextTask);

  nextTask.finally(() => {
    if (chatbotChannelQueues.get(channelId) === nextTask) {
      chatbotChannelQueues.delete(channelId);
    }
  });

  return nextTask;
}

// Show monthly scoreboard
async function showMonthlyScoreboard(client, channelId) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      console.error('Quiz channel niet gevonden');
      return;
    }

    const scores = quiz.getQuizScores();
    const monthKey = quiz.getCurrentMonthKey();

    if (!scores || scores.length === 0) {
      await channel.send('📊 Er zijn nog geen quiz scores voor deze maand!');
      return;
    }

    // Scores zijn al gesorteerd uit database
    const sortedScores = scores.map(data => ({
      userId: data.user_id,
      username: data.username,
      correct: data.correct_count,
      total: data.total_count,
      percentage: data.total_count > 0 ? ((data.correct_count / data.total_count) * 100).toFixed(1) : 0,
      pointsEarned: data.correct_count * casino.QUIZ_REWARD
    }));

    // Calculate totals
    const totalPointsEarned = sortedScores.reduce((sum, s) => sum + s.pointsEarned, 0);
    const totalCorrect = sortedScores.reduce((sum, s) => sum + s.correct, 0);

    // Create embed
    const embed = new EmbedBuilder()
      .setTitle('🏆 Maandelijks Quiz Scoreboard')
      .setColor('#FFD700')
      .setTimestamp();

    // Get month name
    const date = new Date(monthKey + '-01');
    const monthName = date.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });

    // Add top 10 (or all if less)
    let description = `**Resultaten voor ${monthName}**\n\n`;
    const topScores = sortedScores.slice(0, 10);
    topScores.forEach((score, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      description += `${medal} **${score.username}**: ${score.correct}/${score.total} correct (${score.percentage}%) • 💰 ${score.pointsEarned} punten\n`;
    });
    
    // Add top 3 bonus info
    description += `\n📢 **De top 3 ontvangt een startbonus volgende maand:**\n`;
    description += `🥇 ${casino.START_BONUSES[1]} punten | 🥈 ${casino.START_BONUSES[2]} punten | 🥉 ${casino.START_BONUSES[3]} punten`;

    embed.setDescription(description);
    embed.setFooter({ text: `${sortedScores.length} deelnemers • ${totalCorrect} goede antwoorden • ${totalPointsEarned} punten uitgedeeld` });

    // Send @everyone first, then the embed (so the mention works properly)
    await channel.send({ content: '@everyone 🏆 De maandelijkse quiz resultaten zijn binnen!', embeds: [embed] });
    console.log('Maandelijks scoreboard verstuurd!');
  } catch (error) {
    console.error('Fout bij tonen maandelijks scoreboard:', error);
  }
}

// Reactie handler (alleen voor hok notificaties)
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  
  // Only handle bell reactions for hok notifications
  if (hokState && reaction.message.id === hokState.lastMessage?.id && reaction.emoji.name === '🔔') {
    try {
      const guild = reaction.message.guild;
      const member = await guild.members.fetch(user.id);
      const role = await guild.roles.fetch(ROLE_ID);
      
      if (role) {
        // Toggle role
        if (member.roles.cache.has(ROLE_ID)) {
          await member.roles.remove(role);
          await reaction.message.channel.send(`<@${user.id}> ontvangt niet langer notificaties!`).then(msg => {
            setTimeout(() => msg.delete(), 5000);
          });
        } else {
          await member.roles.add(role);
          await reaction.message.channel.send(`<@${user.id}> ontvangt nu notificaties!`).then(msg => {
            setTimeout(() => msg.delete(), 5000);
          });
        }
        // Remove user's reaction
        await reaction.users.remove(user.id);
      }
    } catch (err) {
      console.error("Fout bij toevoegen rol:", err);
    }
  }
});

// Reaction removal handler (niet meer nodig voor quiz)
client.on('messageReactionRemove', async (reaction, user) => {
  // Quiz reactions zijn nu buttons - dit is alleen voor toekomstige functionaliteit
});

// Message handler voor chat responses and chatbot
client.on('messageCreate', async (message) => {
  // Handle chatbot first if in chatbot channel
  if (CHATBOT_CHANNEL_ID && GROQ_API_KEY && message.channel.id === CHATBOT_CHANNEL_ID) {
    // Ignore bot messages
    if (message.author.bot) {
      return;
    }

    await enqueueChatbotTask(message.channel.id, async () => {
      const cleanedMessage = (message.content || '').trim();
      if (!cleanedMessage) {
        return;
      }

      // Import chatbot module
      const { generateResponse } = require('./modules/chatbot');
      let typingInterval = null;

      try {
        // Send typing indicator (lasts ~10 seconds)
        await message.channel.sendTyping();

        // Keep typing indicator alive during processing
        typingInterval = setInterval(() => {
          message.channel.sendTyping().catch(() => clearInterval(typingInterval));
        }, 8000);

        // Generate AI response
        const aiResult = await generateResponse(
          message.channel.id,
          cleanedMessage,
          message.author.id,
          message.author.username,
          GROQ_API_KEY
        );

        const reply = typeof aiResult === 'string' ? aiResult : aiResult.message;
        const conversationId = typeof aiResult === 'string' ? 'onbekend' : aiResult.conversationId;
        const startedNewConversation = typeof aiResult === 'string' ? false : aiResult.startedNewConversation;

        if (startedNewConversation) {
          const newChatEmbed = new EmbedBuilder()
            .setDescription(`Nieuwe chat gestart • Chat ID: ${conversationId}`)
            .setColor('#5865F2')
            .setTimestamp();

          await message.channel.send({ embeds: [newChatEmbed] }).catch(err =>
            console.error('[CHATBOT] Kon nieuwe-chat embed niet versturen:', err)
          );
        }

        // Send response as embed
        const embed = new EmbedBuilder()
          .setDescription(reply)
          .setColor('#0099ff')
          .setFooter({ 
            text: `Chat ID: ${conversationId} • Gevraagd door ${message.author.username}`,
            iconURL: message.author.displayAvatarURL() 
          })
          .setTimestamp();

        await message.reply({ embeds: [embed] }).catch(async (replyError) => {
          console.error('[CHATBOT] Kon embed reply niet versturen, fallback naar plain text:', replyError);
          await message.reply(reply);
        });

      } catch (error) {
        console.error('[CHATBOT]', error);

        // Send error embed to channel
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Chatbot Error')
          .setDescription(
            error.message || 'Er ging iets mis met de AI. Probeer het later opnieuw.'
          )
          .setColor('#FF0000')
          .setTimestamp();

        await message.reply({ embeds: [errorEmbed] }).catch(err => 
          console.error('[CHATBOT] Kon error embed niet versturen:', err)
        );
      } finally {
        if (typingInterval) {
          clearInterval(typingInterval);
        }
      }
    });

    return; // Don't process chat responses if in chatbot channel
  }

  // Handle regular chat responses
  await handleChatResponse(message);
});

// Replace the messageCreate handler with slash commands
client.on('interactionCreate', async (interaction) => {
  // Handle button interactions
  if (interaction.isButton()) {
    // Try approval buttons first
    if (interaction.customId.startsWith('approval_')) {
      await handleApprovalButton(interaction, client, config);
      return;
    }
    // Try bet buttons
    if (interaction.customId.startsWith('bet_')) {
      await handleBetButton(interaction, client, config);
      return;
    }
    // Try Double or Nothing buttons
    if (interaction.customId.startsWith('don_')) {
      await handleDoubleOrNothingButton(interaction, client, config);
      return;
    }
    // Try Blackjack buttons
    if (interaction.customId.startsWith('bj_')) {
      await handleBlackjackButton(interaction, client, config);
      return;
    }
    // Try Connect Four buttons
    if (interaction.customId.startsWith('c4_')) {
      await handleConnectFourButton(interaction, client, config);
      return;
    }
    // Try Hangman buttons
    if (interaction.customId.startsWith('hm_')) {
      await handleHangmanButton(interaction, client, config);
      return;
    }
    // Then quiz buttons
    quiz.handleQuizButton(interaction);
    return;
  }

  // Handle autocomplete interactions
  if (interaction.isAutocomplete()) {
    handleCommands(interaction, client, config, hokState);
    return;
  }

  // Handle slash commands
  if (!interaction.isChatInputCommand()) return;

  handleCommands(interaction, client, config, hokState);
});

// Start de bot
client.once("clientReady", async () => {
  console.log(`🤖 Bot ingelogd als ${client.user.tag}`);
  
  // Initialiseer database
  try {
    initDatabase();
    console.log('✅ Database geïnitialiseerd');
  } catch (error) {
    console.error('❌ Database initialisatie mislukt:', error);
    process.exit(1);
  }

  // Valideer chatbot configuratie
  if (CHATBOT_CHANNEL_ID && GROQ_API_KEY) {
    console.log('✅ Chatbot configuratie gevonden');
  } else if (CHATBOT_CHANNEL_ID || GROQ_API_KEY) {
    console.warn('⚠️ Chatbot configuratie incompleet - chatbot uitgeschakeld');
    console.warn('   Voeg zowel CHATBOT_CHANNEL_ID als GROQ_API_KEY toe aan config.json');
  }

  // Importeer nieuwe quiz vragen uit quiz-import.json (en maak bestand daarna weer leeg)
  try {
    const result = quiz.importQuestionsFromJson();
    if (result.inserted > 0 || result.skipped > 0 || result.invalid > 0) {
      console.log(
        `📝 Quiz import: ${result.inserted} toegevoegd, ${result.skipped} overgeslagen, ${result.invalid} ongeldig (quiz-import.json is geleegd)`
      );
    }
  } catch (error) {
    console.error('❌ Fout bij importeren quiz vragen uit quiz-import.json:', error);
  }
  
  // Set initial bot status
  client.user.setActivity('Hok status laden...', { type: ActivityType.Watching });

  // Schedule daily quiz at 7:00
  cron.schedule('0 7 * * *', () => {
      console.log('Daily quiz cron triggered.');
      console.log(`Daily quiz channel: ${QUIZ_CHANNEL_ID}`);
    // Check if there's already an active quiz (e.g., test quiz)
    const activeQuiz = quiz.getActiveQuiz(QUIZ_CHANNEL_ID);
    if (activeQuiz) {
      const quizType = activeQuiz.is_test_quiz ? 'test quiz' : 'dagelijkse quiz';
        console.log(`Active quiz detected: ${quizType}. Skipping daily quiz start.`);
        console.log(`Active quiz message_id=${activeQuiz.message_id}, question_id=${activeQuiz.question_id}`);
      return;
    }
      console.log('No active quiz found. Starting daily quiz now.');
    quiz.startDailyQuiz(client, QUIZ_CHANNEL_ID);
  }, {
    timezone: "Europe/Amsterdam"
  });

  // Schedule quiz results at 17:00
  cron.schedule('0 17 * * *', () => {
    console.log('Ending daily quiz...');
    quiz.endDailyQuiz(client, QUIZ_CHANNEL_ID);
  }, {
    timezone: "Europe/Amsterdam"
  });

  // Schedule monthly scoreboard on last day of month at 18:00
  // Check daily at 18:00 if it's the last day of the month
  cron.schedule('0 18 28-31 * *', async () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Check if tomorrow is the first day of next month (meaning today is last day)
    if (tomorrow.getDate() === 1) {
      console.log('Showing monthly scoreboard...');
      await showMonthlyScoreboard(client, SCOREBOARD_CHANNEL_ID);
      
      // Expire all open bets (geef inzetten terug)
      console.log('Expiring open bets...');
      const expiredBets = casino.expireOpenBets();
      if (expiredBets.length > 0) {
        await sendLog(client, LOG_CHANNEL_ID, `🔄 ${expiredBets.length} weddenschap(pen) automatisch verlopen aan einde van de maand. Inzetten zijn terugbetaald.`);
        
        // Stuur melding naar casino kanaal
        try {
          const casinoChannel = await client.channels.fetch(CASINO_CHANNEL_ID);
          if (casinoChannel) {
            const expiredEmbed = new EmbedBuilder()
              .setTitle('⏰ Weddenschappen Verlopen')
              .setColor('#FFA500')
              .setDescription(`${expiredBets.length} weddenschap(pen) zijn automatisch verlopen omdat de maand voorbij is.\n\nAlle inzetten zijn terugbetaald.`)
              .setTimestamp();
            await casinoChannel.send({ embeds: [expiredEmbed] });
          }
        } catch (error) {
          console.error('Fout bij sturen expired bets melding:', error);
        }
      }
      
      // Update casino embed
      await updateCasinoEmbed(client, CASINO_CHANNEL_ID);
    }
  }, {
    timezone: "Europe/Amsterdam"
  });

  // Schedule monthly reset on the 1st of each month at 00:01
  // Dit gebeurt NA het scoreboard van de vorige dag (18:00) en VOOR de eerste quiz (07:00)
  cron.schedule('1 0 1 * *', async () => {
    console.log('Performing monthly balance reset...');
    
    try {
      const result = casino.performMonthlyReset();
      
      if (result.success && result.topUsers.length > 0) {
        // Stuur melding naar log kanaal
        let logMessage = `🔄 **Maandelijkse Reset Uitgevoerd**\n`;
        logMessage += `📊 ${result.totalUsersReset} users gereset\n\n`;
        logMessage += `🏆 **Top 3 met startbonus:**\n`;
        
        result.topUsers.forEach(user => {
          const medal = user.position === 1 ? '🥇' : user.position === 2 ? '🥈' : '🥉';
          logMessage += `${medal} ${user.username}: ${user.final_balance} punten → ${user.bonus} bonus\n`;
        });
        
        await sendLog(client, LOG_CHANNEL_ID, logMessage);
        
        // Stuur ook melding naar scoreboard kanaal
        try {
          const scoreboardChannel = await client.channels.fetch(SCOREBOARD_CHANNEL_ID);
          if (scoreboardChannel) {
            const resetEmbed = new EmbedBuilder()
              .setTitle('🎊 Nieuwe Maand - Balances Gereset!')
              .setColor('#00FF00')
              .setDescription(`Alle balances zijn gereset naar 0.\n\nDe top 3 van vorige maand heeft een startbonus ontvangen!`)
              .addFields(
                result.topUsers.map(user => ({
                  name: `${user.position === 1 ? '🥇' : user.position === 2 ? '🥈' : '🥉'} ${user.username}`,
                  value: `Had ${user.final_balance} punten → Start met ${user.bonus} bonus`,
                  inline: true
                }))
              )
              .setTimestamp();
            
            await scoreboardChannel.send({ embeds: [resetEmbed] });
          }
        } catch (error) {
          console.error('Fout bij sturen reset melding:', error);
        }
      }
      
      console.log('Monthly reset completed!');
    } catch (error) {
      console.error('Fout bij maandelijkse reset:', error);
    }
  }, {
    timezone: "Europe/Amsterdam"
  });

  // Register slash commands
  try {
    console.log('Registreer slash commands...');
    await client.application.commands.set(allCommands);
    console.log('Slash commands geregistreerd!');
  } catch (error) {
    console.error('Fout bij registreren commands:', error);
  }

  // Start hok monitoring
  hokState = hok.startHokMonitoring(client, config);
  
  // Load active quizzes after startup
  await loadActiveQuizzes();
});

client.login(TOKEN);
