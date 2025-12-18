// installeer eerst met: npm install discord.js node-fetch better-sqlite3
const { Client, GatewayIntentBits, ActivityType, EmbedBuilder } = require("discord.js");
const config = require('./config.json');
const cron = require('node-cron');
const { initDatabase } = require('./database');
const quiz = require('./modules/quiz.js');
const hok = require('./modules/hok.js');
const { allCommands, handleCommands } = require('./commands');
const { handleChatResponse } = require('./modules/chatResponses.js');

// Config wordt nu geïmporteerd uit config.json
const { TOKEN, CHANNEL_ID, QUIZ_CHANNEL_ID, SCOREBOARD_CHANNEL_ID, API_URL, ROLE_ID } = config;

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
      percentage: data.total_count > 0 ? ((data.correct_count / data.total_count) * 100).toFixed(1) : 0
    }));

    // Create embed
    const embed = new EmbedBuilder()
      .setTitle('🏆 Maandelijks Quiz Scoreboard')
      .setColor('#FFD700')
      .setTimestamp();

    // Get month name
    const date = new Date(monthKey + '-01');
    const monthName = date.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
    embed.setDescription(`**Resultaten voor ${monthName}**\n\n`);

    // Add top 10 (or all if less)
    let description = '';
    const topScores = sortedScores.slice(0, 10);
    topScores.forEach((score, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      description += `${medal} **${score.username}**: ${score.correct}/${score.total} correct (${score.percentage}%)\n`;
    });

    embed.setDescription(`**Resultaten voor ${monthName}**\n\n${description}`);
    embed.setFooter({ text: `Totaal ${sortedScores.length} deelnemers deze maand` });

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

// Message handler voor chat responses
client.on('messageCreate', async (message) => {
  await handleChatResponse(message);
});

// Replace the messageCreate handler with slash commands
client.on('interactionCreate', async (interaction) => {
  // Handle button interactions (for quiz)
  if (interaction.isButton()) {
    quiz.handleQuizButton(interaction);
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
    console.log('Starting daily quiz...');
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
