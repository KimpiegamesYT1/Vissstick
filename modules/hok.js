/**
 * Hok module - volledig omgebouwd naar SQLite database
 * Alle hok monitoring functionaliteit met veilige database operaties
 */

const { ActivityType } = require("discord.js");
const { getDatabase } = require('../database');

// Check interval configuratie (in milliseconden)
const CHECK_INTERVALS = {
  OPEN: 5 * 60 * 1000,      // 5 minuten als hok open is
  CLOSED: 1 * 60 * 1000,    // 1 minuut als hok dicht is
  NIGHT: 15 * 60 * 1000     // 15 minuten tussen 22:00 en 05:00
};

/**
 * Get current date key (YYYY-MM-DD)
 */
function getCurrentDateKey() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get weekday from date string
 */
function getWeekDay(dateStr) {
  return new Date(dateStr).getDay();
}


/**
 * Sla een hok status log op
 */
function logHokStatus(dateKey, time, isOpening) {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    INSERT INTO hok_status_log (date_key, time_logged, is_opening)
    VALUES (?, ?, ?)
  `);
  
  stmt.run(dateKey, time, isOpening ? 1 : 0);
}

/**
 * Cleanup oude hok logs (ouder dan MAX_DAYS)
 * OPTIONEEL - standaard bewaren we data voor altijd
 */
function cleanOldHokLogs(maxDays = null) {
  if (!maxDays) {
    console.log('ℹ️  Hok logs worden voor altijd bewaard (geen cleanup)');
    return;
  }
  
  const db = getDatabase();
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxDays);
  const cutoffDateKey = cutoffDate.toISOString().split('T')[0];
  
  const stmt = db.prepare(`
    DELETE FROM hok_status_log
    WHERE date_key < ?
  `);
  
  const result = stmt.run(cutoffDateKey);
  
  if (result.changes > 0) {
    console.log(`🧹 ${result.changes} oude hok logs verwijderd (ouder dan ${maxDays} dagen)`);
  }
}

/**
 * Haal hok status logs op voor een specifieke datum
 */
function getHokLogsForDate(dateKey) {
  const db = getDatabase();
  
  const logs = db.prepare(`
    SELECT time_logged, is_opening, logged_at
    FROM hok_status_log
    WHERE date_key = ?
    ORDER BY time_logged ASC
  `).all(dateKey);
  
  // Groepeer in opening en closing times
  const openTimes = [];
  const closeTimes = [];
  
  logs.forEach(log => {
    if (log.is_opening) {
      openTimes.push(log.time_logged);
    } else {
      closeTimes.push(log.time_logged);
    }
  });
  
  return { openTimes, closeTimes };
}

/**
 * Haal alle hok geschiedenis op
 * Standaard 180 dagen (6 maanden) voor betere statistieken
 */
function getAllHokHistory(limitDays = 180) {
  const db = getDatabase();
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - limitDays);
  const cutoffDateKey = cutoffDate.toISOString().split('T')[0];
  
  const dates = db.prepare(`
    SELECT DISTINCT date_key
    FROM hok_status_log
    WHERE date_key >= ?
    ORDER BY date_key DESC
  `).all(cutoffDateKey);
  
  const history = {};
  
  dates.forEach(({ date_key }) => {
    history[date_key] = getHokLogsForDate(date_key);
  });
  
  return history;
}

/**
 * Voorspel openings/sluitingstijd op basis van historische data (laatste 6 maanden)
 * Gebruikt weighted average: recente data weegt zwaarder mee
 * - Laatste maand: 100% gewicht
 * - Ouder dan 1 maand: lineair afnemend van 100% naar 20%
 */
function predictOpeningTime(isOpen) {
  const db = getDatabase();
  
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
  
  // Haal tijden op van laatste 6 maanden
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const cutoffDateKey = sixMonthsAgo.toISOString().split('T')[0];
  
  const logs = db.prepare(`
    SELECT time_logged, date_key
    FROM hok_status_log
    WHERE is_opening = ?
    AND date_key >= ?
    ORDER BY logged_at DESC
  `).all(isOpen ? 0 : 1, cutoffDateKey); // 0 = closing, 1 = opening
  
  // Filter op weekdag en bereken gewichten
  const now = new Date();
  const relevantTimes = [];
  
  logs.forEach(log => {
    const logWeekday = getWeekDay(log.date_key);
    if (logWeekday === targetDay) {
      // Bereken leeftijd van de data in dagen
      const logDate = new Date(log.date_key);
      const ageInDays = Math.floor((now - logDate) / (1000 * 60 * 60 * 24));
      
      // Bereken gewicht
      let weight;
      if (ageInDays <= 30) {
        // Laatste maand: 100% gewicht
        weight = 1.0;
      } else {
        // Ouder dan 1 maand: lineair afnemen van 100% naar 20% over 5 maanden
        // 30 dagen = 100%, 180 dagen = 20%
        const daysOverOneMonth = ageInDays - 30;
        const maxDaysForDecay = 150; // 180 - 30 = 150 dagen
        weight = 1.0 - (daysOverOneMonth / maxDaysForDecay) * 0.8; // Afname van 80% (van 100% naar 20%)
        weight = Math.max(0.2, weight); // Minimaal 20%
      }
      
      relevantTimes.push({
        time: log.time_logged,
        weight: weight
      });
    }
  });
  
  if (relevantTimes.length === 0) return null;
  
  // Bereken weighted average
  let totalWeightedMinutes = 0;
  let totalWeight = 0;
  
  relevantTimes.forEach(item => {
    const [hours, minutes] = item.time.split(':').map(Number);
    const timeInMinutes = hours * 60 + minutes;
    
    totalWeightedMinutes += timeInMinutes * item.weight;
    totalWeight += item.weight;
  });
  
  const avgMinutes = Math.round(totalWeightedMinutes / totalWeight);
  const hours = Math.floor(avgMinutes / 60);
  const minutes = avgMinutes % 60;
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Update hok state in database
 */
function updateHokState(isOpen, lastMessageId = null) {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    UPDATE hok_state
    SET is_open = ?, last_message_id = ?, last_updated = datetime('now')
    WHERE id = 1
  `);
  
  stmt.run(isOpen ? 1 : 0, lastMessageId);
}

/**
 * Haal huidige hok state op
 */
function getHokState() {
  const db = getDatabase();
  
  const state = db.prepare(`
    SELECT is_open, last_message_id, last_updated
    FROM hok_state
    WHERE id = 1
  `).get();
  
  if (!state) {
    // Initialiseer als niet bestaat
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO hok_state (id, is_open)
      VALUES (1, 0)
    `);
    stmt.run();
    
    return { is_open: 0, last_message_id: null, last_updated: null };
  }
  
  return state;
}

/**
 * Functie om te bepalen of het nacht is (22:00 - 05:00)
 */
function isNightTime() {
  const hour = new Date().getHours();
  return hour >= 22 || hour < 5;
}

/**
 * Functie om het juiste check interval te bepalen
 */
function getCheckInterval(isOpen) {
  if (isNightTime()) {
    return CHECK_INTERVALS.NIGHT;
  }
  return isOpen ? CHECK_INTERVALS.OPEN : CHECK_INTERVALS.CLOSED;
}

/**
 * Check API functie
 */
async function checkStatus(client, config, state) {
  const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
  
  try {
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
      updateHokState(isOpen);
      console.log("Initiële status opgehaald:", isOpen ? "open" : "dicht");
      updateCheckInterval(isOpen, state);
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
      
      // Log de status change in database
      logHokStatus(dateKey, currentTime, isOpen);

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
      const predictedTime = predictOpeningTime(isOpen);
      const predictionMsg = predictedTime ? ` (${isOpen ? 'Sluit' : 'Opent'} meestal rond ${predictedTime})` : '';

      // Bepaal of we moeten pingen
      const currentDay = new Date().getDay();
      const isWeekend = currentDay === 0 || currentDay === 6; // 0 = zondag, 6 = zaterdag
      const shouldPing = isOpen && !isWeekend; // Alleen pingen bij opening en niet in weekend
      
      const hokMention = shouldPing ? `<@&${config.ROLE_ID}>` : 'hok';

      // Nieuw bericht sturen
      const message = await channel.send(
        isOpen 
          ? `✅ Het ${hokMention} is nu **open**!${predictionMsg}` 
          : `❌ Het ${hokMention} is nu **dicht**!${predictionMsg}`
      );
      
      // Reactie toevoegen
      await message.react('🔔');
      state.lastMessage = message;
      
      // Update state in database
      updateHokState(isOpen, message.id);

      console.log("Status gewijzigd:", isOpen ? "open" : "dicht");
    }
  } catch (err) {
    console.error("Fout bij ophalen API:", err);
  }
}

/**
 * Functie om het check interval te updaten
 */
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

/**
 * Start hok monitoring
 */
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

// Legacy functions voor backward compatibility
function loadHokData() {
  return {
    openingTimes: getAllHokHistory(56),
    MAX_DAYS: 56
  };
}

function saveHokData(data) {
  // Deprecated - data wordt nu automatisch opgeslagen in database
  console.warn('saveHokData is deprecated - data wordt automatisch opgeslagen');
}

function cleanOldData(hokData) {
  // Deprecated - gebruik cleanOldHokLogs
  console.warn('cleanOldData is deprecated - gebruik cleanOldHokLogs');
  cleanOldHokLogs(56);
}

module.exports = {
  getCurrentDateKey,
  getWeekDay,
  logHokStatus,
  cleanOldHokLogs,
  getHokLogsForDate,
  getAllHokHistory,
  predictOpeningTime,
  updateHokState,
  getHokState,
  checkStatus,
  startHokMonitoring,
  loadHokData,
  saveHokData,
  cleanOldData
};
