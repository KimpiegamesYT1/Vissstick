const { ActivityType } = require("discord.js");
const fs = require('fs').promises;
const path = require('path');

const dataPath = path.join(__dirname, '..', 'data.json');

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

// Check API functie
async function checkStatus(client, config, state) {
  const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
  
  try {
    const hokData = await loadHokData();
    const res = await fetch(config.API_URL);
    const data = await res.json();

    if (!data || !data.payload) return;

    const isOpen = data.payload.open === 1;
    const channel = await client.channels.fetch(config.CHANNEL_ID);
    const currentTime = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    const dateKey = getCurrentDateKey();

    if (!channel) return console.error("Kanaal niet gevonden!");

    // Update bot status
    client.user.setActivity(
      isOpen ? 'Hok is open 📗' : 'Hok is dicht 📕',
      { type: ActivityType.Watching }
    );

    // Bij eerste keer alleen status opslaan
    if (!state.isInitialized) {
      state.lastStatus = isOpen;
      state.isInitialized = true;
      console.log("Initiële status opgehaald:", isOpen ? "open" : "dicht");
      updateCheckInterval(isOpen, state); // Set interval based on initial status
      return;
    }

    // Check of interval moet worden aangepast (door tijd of status)
    const currentInterval = getCheckInterval(isOpen);
    const activeInterval = state.checkInterval ? currentInterval : null;
    
    // Update interval als status veranderd is of als we van/naar nacht periode gaan
    if (state.lastStatus !== isOpen || activeInterval !== currentInterval) {
      updateCheckInterval(isOpen, state);
    }

    // Alleen iets doen als status is veranderd
    if (state.lastStatus !== isOpen) {
      state.lastStatus = isOpen;
      
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
      if (state.lastMessage) {
        try {
          await state.lastMessage.delete();
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
          ? `✅ Het <@&${config.ROLE_ID}> is nu **open**!${predictionMsg}` 
          : `❌ Het <@&${config.ROLE_ID}> is nu **dicht**!${predictionMsg}`
      );
      
      // Reactie toevoegen
      await message.react('🔔');
      state.lastMessage = message;

      console.log("Status gewijzigd:", isOpen ? "open" : "dicht");
    }
  } catch (err) {
    console.error("Fout bij ophalen API:", err);
  }
}

// Functie om het check interval te updaten
function updateCheckInterval(isOpen, state) {
  const newInterval = getCheckInterval(isOpen);
  
  // Als het interval veranderd is, reset het
  if (state.checkInterval) {
    clearInterval(state.checkInterval);
  }
  
  state.checkInterval = setInterval(() => {
    checkStatus(state.client, state.config, state);
  }, newInterval);
  
  const intervalMinutes = newInterval / (60 * 1000);
  console.log(`Check interval ingesteld op ${intervalMinutes} ${intervalMinutes === 1 ? 'minuut' : 'minuten'} (${isNightTime() ? 'nacht' : isOpen ? 'open' : 'dicht'})`);
}

// Start hok monitoring
function startHokMonitoring(client, config) {
  const state = {
    client,
    config,
    lastStatus: null,
    lastMessage: null,
    isInitialized: false,
    checkInterval: null
  };
  
  // Eerste check
  checkStatus(client, config, state);
  
  return state;
}

module.exports = {
  loadHokData,
  saveHokData,
  getCurrentDateKey,
  getWeekDay,
  cleanOldData,
  predictOpeningTime,
  checkStatus,
  startHokMonitoring
};
