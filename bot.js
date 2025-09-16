// installeer eerst met: npm install discord.js node-fetch
const { Client, GatewayIntentBits, ActivityType } = require("discord.js");
// Import fetch for Node.js 18+
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const config = require('./config.json');
const fs = require('fs').promises;
const path = require('path');

// Config wordt nu geïmporteerd uit config.json
const { TOKEN, CHANNEL_ID, API_URL, ROLE_ID } = config;
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

async function predictOpeningTime(isOpen, hokData) {
  const currentDay = new Date().getDay();
  let relevantTimes = [];
  
  // Verzamel alle tijden voor dezelfde weekdag
  Object.entries(hokData.openingTimes).forEach(([date, data]) => {
    if (getWeekDay(date) === currentDay) {
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

let lastStatus = null;
let lastMessage = null;
let isInitialized = false;

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

// Reactie handler
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  
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

// Replace the messageCreate handler with slash commands
client.on('interactionCreate', async (interaction) => {
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
      await interaction.reply({ content: '❌ Je hebt geen administrator rechten!', ephemeral: true });
      return;
    }

    try {
      const res = await fetch(API_URL);
      const data = await res.json();
      
      if (!data || !data.payload) {
        await interaction.reply({ content: '❌ Kon status niet ophalen', ephemeral: true });
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

      await interaction.reply({ content: '✅ Hok status succesvol geüpdatet!', ephemeral: true });
    } catch (err) {
      console.error("Fout bij updaten status:", err);
      await interaction.reply({ content: '❌ Fout bij updaten van de status', ephemeral: true });
    }
  }
});

// Start de bot
client.once("clientReady", async () => {
  console.log(`Bot ingelogd als ${client.user.tag}`);
  
  // Set initial bot status
  client.user.setActivity('Hok status laden...', { type: ActivityType.Watching });
  
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
});

client.login(TOKEN);
