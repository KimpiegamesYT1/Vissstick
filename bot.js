// installeer eerst met: npm install discord.js node-fetch
const { Client, GatewayIntentBits, ActivityType } = require("discord.js");
// Import fetch for Node.js 18+
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const config = require('./config.json');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const quiz = require('./quiz.js');

// Config wordt nu geïmporteerd uit config.json
const { TOKEN, CHANNEL_ID, QUIZ_CHANNEL_ID, API_URL, ROLE_ID } = config;
const dataPath = path.join(__dirname, 'data.json');

// Load data from file
async function loadHokData() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist, return default structure
    return {
      openingTimes: {},
      MAX_DAYS: 56
    };
  }
}

// Save data to file
async function saveHokData(data) {
  await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
}

// Data structure voor openingstijden
const hokData = {
  openingTimes: {},
  MAX_DAYS: 56 // 8 weken aan data
};

function getCurrentDateKey() {
  return new Date().toISOString().split('T')[0];
}

function getWeekDay(dateStr) {
  return new Date(dateStr).getDay();
}

async function cleanOldData(hokData) {
  const dates = Object.keys(hokData.openingTimes).sort();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - hokData.MAX_DAYS);
  
  let modified = false;
  dates.forEach(date => {
    if (new Date(date) < cutoffDate) {
      delete hokData.openingTimes[date];
      modified = true;
    }
  });
  
  if (modified) {
    await saveHokData(hokData);
  }
}

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

function predictOpeningTime(isOpen, hokData) {
  let targetDay;
  
  if (isOpen) {
    // Als hok open is, voorspel sluittijd voor vandaag
    targetDay = new Date().getDay();
  } else {
    // Als hok dicht is, voorspel openingstijd voor morgen
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    targetDay = tomorrow.getDay();
  }
  
  let relevantTimes = [];
  
  // Verzamel alle tijden voor de doeldag
  Object.entries(hokData.openingTimes).forEach(([date, data]) => {
    if (getWeekDay(date) === targetDay) {
      if (isOpen) {
        // Voor sluittijd, pak de laatste tijd van de dag
        if (data.closeTimes.length > 0) {
          relevantTimes.push(data.closeTimes[data.closeTimes.length - 1]);
        }
      } else {
        // Voor openingstijd, pak de eerste tijd van de dag
        if (data.openTimes.length > 0) {
          relevantTimes.push(data.openTimes[0]);
        }
      }
    }
  });
  
  if (relevantTimes.length === 0) return null;
  
  // Bereken gemiddelde tijd
  const timeInMinutes = relevantTimes.map(time => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  });
  
  const avgMinutes = Math.round(timeInMinutes.reduce((a, b) => a + b) / timeInMinutes.length);
  const hours = Math.floor(avgMinutes / 60);
  const minutes = avgMinutes % 60;
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
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

let lastStatus = null;
let lastMessage = null;
let isInitialized = false;
let activeQuizMessages = new Map(); // Store active quiz message references

// Check API functie
async function checkStatus() {
  try {
    const hokData = await loadHokData();
    const res = await fetch(API_URL);
    const data = await res.json();

    if (!data || !data.payload) return;

    const isOpen = data.payload.open === 1;
    const channel = await client.channels.fetch(CHANNEL_ID);
    const currentTime = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    const dateKey = getCurrentDateKey();

    if (!channel) return console.error("Kanaal niet gevonden!");

    // Update bot status
    client.user.setActivity(
      isOpen ? 'Hok is open 📗' : 'Hok is dicht 📕',
      { type: ActivityType.Watching }
    );

    // Bij eerste keer alleen status opslaan
    if (!isInitialized) {
      lastStatus = isOpen;
      isInitialized = true;
      console.log("Initiële status opgehaald:", isOpen ? "open" : "dicht");
      return;
    }

    // Alleen iets doen als status is veranderd
    if (lastStatus !== isOpen) {
      lastStatus = isOpen;
      
      // Update opening/closing times
      if (!hokData.openingTimes[dateKey]) {
        hokData.openingTimes[dateKey] = { openTimes: [], closeTimes: [] };
      }
      
      if (isOpen) {
        hokData.openingTimes[dateKey].openTimes.push(currentTime);
      } else {
        hokData.openingTimes[dateKey].closeTimes.push(currentTime);
      }
      
      await saveHokData(hokData);
      await cleanOldData(hokData);

      // Verwijder vorig bericht als het bestaat
      if (lastMessage) {
        try {
          await lastMessage.delete();
        } catch (err) {
          console.error("Kon vorig bericht niet verwijderen:", err);
        }
      }

      // Naam aanpassen
      await channel.setName(isOpen ? "📗-hok-is-open" : "📕-hok-is-dicht");

      // Voorspel volgende tijd
      const predictedTime = predictOpeningTime(isOpen, hokData);
      const predictionMsg = predictedTime ? ` (${isOpen ? 'Sluit' : 'Opent'} meestal rond ${predictedTime})` : '';

      // Nieuw bericht sturen
      const message = await channel.send(
        isOpen 
          ? `✅ Het <@&${ROLE_ID}> is nu **open**!${predictionMsg}` 
          : `❌ Het <@&${ROLE_ID}> is nu **dicht**!${predictionMsg}`
      );
      
      // Reactie toevoegen
      await message.react('🔔');
      lastMessage = message;

      console.log("Status gewijzigd:", isOpen ? "open" : "dicht");
    }
  } catch (err) {
    console.error("Fout bij ophalen API:", err);
  }
}

// Reactie handler (alleen voor hok notificaties)
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  
  // Only handle bell reactions for hok notifications
  if (reaction.message.id === lastMessage?.id && reaction.emoji.name === '🔔') {
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
    console.log(`Button interaction ontvangen: ${interaction.customId} van ${interaction.user.username}`);
    const handled = await quiz.handleQuizButton(interaction);
    if (handled) {
      console.log('Quiz button succesvol afgehandeld');
      return;
    }
    
    // Handle other buttons here if needed in the future
    console.log('Button interaction niet afgehandeld door quiz module');
    return;
  }

  // Handle slash commands
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'hokhistorie') {
    const hokData = await loadHokData();
    const stats = Object.entries(hokData.openingTimes)
      .sort()
      .map(([date, times]) => {
        return `**${date}**:\n` +
               `📗 Open: ${times.openTimes.join(', ') || 'geen'}\n` +
               `📕 Dicht: ${times.closeTimes.join(', ') || 'geen'}`;
      })
      .join('\n\n');
    
    await interaction.reply(stats || 'Nog geen data beschikbaar');
  }

  if (commandName === 'hokstatus') {
    try {
      const res = await fetch(API_URL);
      const data = await res.json();
      
      if (!data || !data.payload) {
        await interaction.reply('❌ Kon status niet ophalen');
        return;
      }

      const isOpen = data.payload.open === 1;
      const hokData = await loadHokData();
      const predictedTime = predictOpeningTime(isOpen, hokData);
      const predictionMsg = predictedTime ? ` (${isOpen ? 'Sluit' : 'Opent'} meestal rond ${predictedTime})` : '';
      
      await interaction.reply(
        isOpen 
          ? `✅ Het hok is momenteel **open**!${predictionMsg}` 
          : `❌ Het hok is momenteel **dicht**!${predictionMsg}`
      );
    } catch (err) {
      console.error("Fout bij ophalen status:", err);
      await interaction.reply('❌ Fout bij ophalen van de status');
    }
  }

  if (commandName === 'hokupdate') {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: '❌ Je hebt geen administrator rechten!', flags: 64 });
      return;
    }

    // Defer the reply immediately to prevent timeout
    await interaction.deferReply({ ephemeral: true });

    try {
      const res = await fetch(API_URL);
      const data = await res.json();
      
      if (!data || !data.payload) {
        await interaction.editReply({ content: '❌ Kon status niet ophalen' });
        return;
      }

      const isOpen = data.payload.open === 1;
      const channel = await client.channels.fetch(CHANNEL_ID);
      const hokData = await loadHokData();
      
      // Update bot status
      client.user.setActivity(
        isOpen ? 'Hok is open 📗' : 'Hok is dicht 📕',
        { type: ActivityType.Watching }
      );
      
      // Update channel name
      await channel.setName(isOpen ? "📗-hok-is-open" : "📕-hok-is-dicht");
      
      // Remove old message if exists
      if (lastMessage) {
        try {
          await lastMessage.delete();
        } catch (err) {
          console.error("Kon vorig bericht niet verwijderen:", err);
        }
      }

      // Send new message
      const predictedTime = predictOpeningTime(isOpen, hokData);
      const predictionMsg = predictedTime ? ` (${isOpen ? 'Sluit' : 'Opent'} meestal rond ${predictedTime})` : '';

      const message = await channel.send(
        isOpen 
          ? `✅ Het <@&${ROLE_ID}> is nu **open**!${predictionMsg}` 
          : `❌ Het <@&${ROLE_ID}> is nu **dicht**!${predictionMsg}`
      );
      
      await message.react('🔔');
      lastMessage = message;
      lastStatus = isOpen;

      await interaction.editReply({ content: '✅ Hok status succesvol geüpdatet!' });
    } catch (err) {
      console.error("Fout bij updaten status:", err);
      await interaction.editReply({ content: '❌ Fout bij updaten van de status' });
    }
  }

  if (commandName === 'testquiz') {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: '❌ Je hebt geen administrator rechten!', flags: 64 });
      return;
    }

    const timeoutMinutes = interaction.options.getInteger('tijd') || 1; // Default 1 minuut
    
    if (timeoutMinutes < 1 || timeoutMinutes > 60) {
      await interaction.reply({ content: '❌ Tijd moet tussen 1 en 60 minuten zijn!', flags: 64 });
      return;
    }

    // Defer the reply immediately to prevent timeout
    await interaction.deferReply({ ephemeral: true });

    try {
      await quiz.startDailyQuiz(client, QUIZ_CHANNEL_ID, timeoutMinutes);
      await interaction.editReply({ content: `✅ Test quiz gestart! Resultaten worden automatisch getoond na ${timeoutMinutes} minuut${timeoutMinutes === 1 ? '' : 'en'}.` });
    } catch (error) {
      console.error('Fout bij starten test quiz:', error);
      await interaction.editReply({ content: '❌ Er is een fout opgetreden bij het starten van de test quiz.' });
    }
  }

  if (commandName === 'resetquiz') {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: '❌ Je hebt geen administrator rechten!', flags: 64 });
      return;
    }

    // Defer the reply immediately to prevent timeout
    await interaction.deferReply({ ephemeral: true });

    try {
      await quiz.resetUsedQuestions();
      await interaction.editReply({ content: '✅ Quiz vragen zijn gereset! Alle vragen kunnen weer gebruikt worden.' });
    } catch (error) {
      console.error('Fout bij resetten quiz vragen:', error);
      await interaction.editReply({ content: '❌ Er is een fout opgetreden bij het resetten van de quiz vragen.' });
    }
  }
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

  // Schedule quiz results at 11:00
  cron.schedule('0 11 * * *', () => {
    console.log('Ending daily quiz...');
    quiz.endDailyQuiz(client, QUIZ_CHANNEL_ID);
  }, {
    timezone: "Europe/Amsterdam"
  });

  // Register slash commands
  const commands = [
    {
      name: 'hokhistorie',
      description: 'Toont de openingstijden geschiedenis van het hok'
    },
    {
      name: 'hokstatus',
      description: 'Toont de huidige status van het hok'
    },
    {
      name: 'hokupdate',
      description: 'Update het hok status bericht (alleen voor administrators)'
    },
    {
      name: 'testquiz',
      description: 'Start een test quiz (alleen voor administrators)',
      options: [
        {
          name: 'tijd',
          description: 'Aantal minuten voordat de quiz eindigt (1-60, standaard: 1)',
          type: 4, // INTEGER type
          required: false,
          min_value: 1,
          max_value: 60
        }
      ]
    },
    {
      name: 'resetquiz',
      description: 'Reset de gebruikte quiz vragen (alleen voor administrators)'
    }
  ];

  try {
    console.log('Registreer slash commands...');
    await client.application.commands.set(commands);
    console.log('Slash commands geregistreerd!');
  } catch (error) {
    console.error('Fout bij registreren commands:', error);
  }

  checkStatus();
  setInterval(checkStatus, 60 * 1000); // elke minuut checken
  
  // Load active quizzes after startup
  await loadActiveQuizzes();
});

client.login(TOKEN);
