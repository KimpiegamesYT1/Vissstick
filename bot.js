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

// Check interval configuratie (in milliseconden)
const CHECK_INTERVALS = {
  OPEN: 5 * 60 * 1000,      // 5 minuten als hok open is
  CLOSED: 1 * 60 * 1000,    // 1 minuut als hok dicht is
  NIGHT: 15 * 60 * 1000     // 15 minuten tussen 22:00 en 05:00
};

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
let checkInterval = null; // Store current interval ID

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
      updateCheckInterval(isOpen); // Set interval based on initial status
      return;
    }

    // Check of interval moet worden aangepast (door tijd of status)
    const currentInterval = getCheckInterval(isOpen);
    const activeInterval = checkInterval ? currentInterval : null;
    
    // Update interval als status veranderd is of als we van/naar nacht periode gaan
    if (lastStatus !== isOpen || activeInterval !== currentInterval) {
      updateCheckInterval(isOpen);
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

// Functie om te bepalen of het nacht is (22:00 - 05:00)
function isNightTime() {
  const hour = new Date().getHours();
  return hour >= 22 || hour < 5;
}

// Functie om het juiste check interval te bepalen
function getCheckInterval(isOpen) {
  if (isNightTime()) {
    return CHECK_INTERVALS.NIGHT;
  }
  return isOpen ? CHECK_INTERVALS.OPEN : CHECK_INTERVALS.CLOSED;
}

// Functie om het check interval te updaten
function updateCheckInterval(isOpen) {
  const newInterval = getCheckInterval(isOpen);
  
  // Als het interval veranderd is, reset het
  if (checkInterval) {
    clearInterval(checkInterval);
  }
  
  checkInterval = setInterval(checkStatus, newInterval);
  
  const intervalMinutes = newInterval / (60 * 1000);
  console.log(`Check interval ingesteld op ${intervalMinutes} ${intervalMinutes === 1 ? 'minuut' : 'minuten'} (${isNightTime() ? 'nacht' : isOpen ? 'open' : 'dicht'})`);
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
    
    if (Object.keys(hokData.openingTimes).length === 0) {
      await interaction.reply('📊 Nog geen data beschikbaar');
      return;
    }

    // Sorteer op datum (nieuwste eerst)
    const sortedEntries = Object.entries(hokData.openingTimes)
      .sort((a, b) => new Date(b[0]) - new Date(a[0]));

    // Functie om dag van de week te krijgen
    const getDayName = (dateStr) => {
      const days = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
      return days[new Date(dateStr).getDay()];
    };

    // Functie om totale open tijd te berekenen
    const calculateOpenDuration = (openTimes, closeTimes) => {
      if (openTimes.length === 0 || closeTimes.length === 0) return null;
      
      const parseTime = (time) => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
      };

      const firstOpen = parseTime(openTimes[0]);
      const lastClose = parseTime(closeTimes[closeTimes.length - 1]);
      const totalMinutes = lastClose - firstOpen;
      
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      
      return `${hours}u ${minutes}m`;
    };

    // Maak een mooie output per dag
    const stats = sortedEntries.map(([date, times]) => {
      const dayName = getDayName(date);
      const formattedDate = new Date(date).toLocaleDateString('nl-NL', { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
      });
      
      let output = `**${dayName} ${formattedDate}**\n`;
      
      // Toon openingstijden
      if (times.openTimes.length > 0) {
        if (times.openTimes.length === 1) {
          output += `📗 Geopend om **${times.openTimes[0]}**\n`;
        } else {
          output += `📗 Geopend: ${times.openTimes.join(', ')}\n`;
        }
      } else {
        output += `📗 Niet geopend\n`;
      }
      
      // Toon sluitingstijden
      if (times.closeTimes.length > 0) {
        if (times.closeTimes.length === 1) {
          output += `📕 Gesloten om **${times.closeTimes[0]}**\n`;
        } else {
          output += `📕 Gesloten: ${times.closeTimes.join(', ')}\n`;
        }
      } else {
        output += `📕 Nog niet gesloten\n`;
      }
      
      // Bereken en toon totale open tijd
      const duration = calculateOpenDuration(times.openTimes, times.closeTimes);
      if (duration) {
        output += `⏱️ Totaal open: **${duration}**`;
      }
      
      return output;
    }).join('\n\n');

    // Splits in meerdere berichten als het te lang is (Discord limiet is 2000 karakters)
    const maxLength = 1900;
    if (stats.length > maxLength) {
      const messages = [];
      const entries = stats.split('\n\n');
      let currentMessage = '📊 **Hok Geschiedenis**\n\n';
      
      for (const entry of entries) {
        if ((currentMessage + entry + '\n\n').length > maxLength) {
          messages.push(currentMessage);
          currentMessage = entry + '\n\n';
        } else {
          currentMessage += entry + '\n\n';
        }
      }
      if (currentMessage.trim()) {
        messages.push(currentMessage);
      }
      
      // Stuur eerste bericht als reply
      await interaction.reply(messages[0]);
      
      // Stuur rest als follow-ups
      for (let i = 1; i < messages.length; i++) {
        await interaction.followUp(messages[i]);
      }
    } else {
      await interaction.reply(`📊 **Hok Geschiedenis**\n\n${stats}`);
    }
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

  // Schedule quiz results at 17:00
  cron.schedule('0 17 * * *', () => {
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
  // Interval wordt nu dynamisch ingesteld in checkStatus() na eerste check
  
  // Load active quizzes after startup
  await loadActiveQuizzes();
});

client.login(TOKEN);
