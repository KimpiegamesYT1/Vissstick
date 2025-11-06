// installeer eerst met: npm install discord.js node-fetch
const { Client, GatewayIntentBits, ActivityType, EmbedBuilder } = require("discord.js");
const config = require('./config.json');
const cron = require('node-cron');
const quiz = require('./modules/quiz.js');
const hok = require('./modules/hok.js');
const { allCommands, handleCommands } = require('./commands');

// Config wordt nu geïmporteerd uit config.json
const { TOKEN, CHANNEL_ID, QUIZ_CHANNEL_ID, API_URL, ROLE_ID } = config;

// Load active quizzes on bot startup
async function loadActiveQuizzes() {
  try {
    const quizData = await quiz.loadQuizData();
    
    for (const [channelId, quizInfo] of Object.entries(quizData.activeQuizzes)) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
          const message = await channel.messages.fetch(quizInfo.messageId);
          if (message) {
            activeQuizMessages.set(quizInfo.messageId, message);
            console.log(`Herladen actieve quiz in kanaal ${channelId}`);
            
            // Reset timeout for test quizzes if they have one
            if (quizInfo.isTestQuiz && quizInfo.timeoutMinutes) {
              // Calculate remaining time (simplified - assumes quiz was started recently)
              setTimeout(async () => {
                try {
                  console.log(`Test quiz timeout na herstart`);
                  await quiz.endDailyQuiz(client, channelId);
                } catch (error) {
                  console.error('Fout bij timeout na herstart:', error);
                }
              }, quizInfo.timeoutMinutes * 60 * 1000);
            }
          }
        }
      } catch (error) {
        console.error(`Kon quiz bericht niet herladen voor kanaal ${channelId}:`, error);
        // Clean up invalid quiz reference
        delete quizData.activeQuizzes[channelId];
      }
    }
    
    // Save cleaned up quiz data
    await quiz.saveQuizData(quizData);
    console.log(`${Object.keys(quizData.activeQuizzes).length} actieve quizzes herladen`);
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

    const scores = await quiz.loadQuizScores();
    const monthKey = quiz.getCurrentMonthKey();
    const monthlyScores = scores.monthly[monthKey];

    if (!monthlyScores || Object.keys(monthlyScores).length === 0) {
      await channel.send('📊 Er zijn nog geen quiz scores voor deze maand!');
      return;
    }

    // Convert to array and sort by correct answers (then by total)
    const sortedScores = Object.entries(monthlyScores)
      .map(([userId, data]) => ({
        userId,
        username: data.username,
        correct: data.correct,
        total: data.total,
        percentage: data.total > 0 ? ((data.correct / data.total) * 100).toFixed(1) : 0
      }))
      .sort((a, b) => {
        if (b.correct !== a.correct) return b.correct - a.correct;
        return b.total - a.total;
      });

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

    await channel.send({ embeds: [embed] });
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
  console.log(`Bot ingelogd als ${client.user.tag}`);
  
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
  cron.schedule('0 18 L * *', async () => {
    console.log('Showing monthly scoreboard...');
    await showMonthlyScoreboard(client, QUIZ_CHANNEL_ID);
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
