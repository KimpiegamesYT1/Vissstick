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
 * Get current Amsterdam hour (0-23)
 */
function getAmsterdamHour() {
  return parseInt(new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false }));
}

/**
 * Get current date key (YYYY-MM-DD) in Amsterdam timezone
 */
function getCurrentDateKey() {
  const now = new Date();
  const year = now.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', year: 'numeric' });
  const month = now.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', month: '2-digit' });
  const day = now.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', day: '2-digit' });
  return `${year}-${month}-${day}`;
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
 * Haal gefilterde hok geschiedenis op
 * Filtert sessies korter dan 30 minuten eruit
 * Geeft per dag: eerste geldige opening en laatste geldige sluiting
 */
function getFilteredHokHistory(limitDays = 180) {
  const db = getDatabase();
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - limitDays);
  const cutoffDateKey = cutoffDate.toISOString().split('T')[0];
  
  // Haal ALLE logs op om sessieduur te kunnen berekenen
  const logs = db.prepare(`
    SELECT date_key, time_logged, is_opening
    FROM hok_status_log
    WHERE date_key >= ?
    ORDER BY date_key DESC, time_logged ASC
  `).all(cutoffDateKey);
  
  const history = {};
  let currentDay = null;
  let dayLogs = [];
  
  const processDayLogs = (dateKey, logs) => {
    let openTime = null;
    let openTimeStr = null;
    let firstValidOpen = null;
    let lastValidClose = null;
    
    for (const log of logs) {
      const [h, m] = log.time_logged.split(':').map(Number);
      const minutes = h * 60 + m;
      
      if (log.is_opening) {
        openTime = minutes;
        openTimeStr = log.time_logged;
      } else {
        // Closing
        if (openTime !== null) {
          const duration = minutes - openTime;
          if (duration >= 30) {
            // Geldige sessie gevonden (>= 30 min)
            if (firstValidOpen === null) firstValidOpen = openTimeStr;
            lastValidClose = log.time_logged;
          }
          openTime = null;
          openTimeStr = null;
        }
      }
    }
    
    // Alleen toevoegen als we geldige data hebben
    if (firstValidOpen !== null || lastValidClose !== null) {
      history[dateKey] = {
        openTimes: firstValidOpen ? [firstValidOpen] : [],
        closeTimes: lastValidClose ? [lastValidClose] : []
      };
    }
  };
  
  // Group logs by day
  logs.forEach(log => {
    if (log.date_key !== currentDay) {
      if (currentDay) processDayLogs(currentDay, dayLogs);
      currentDay = log.date_key;
      dayLogs = [];
    }
    dayLogs.push(log);
  });
  if (currentDay) processDayLogs(currentDay, dayLogs);
  
  return history;
}

/**
 * Bereken gewogen mediaan voor een lijst van tijden met gewichten
 */
function calculateWeightedMedian(timesWithWeights) {
  if (timesWithWeights.length === 0) return null;
  if (timesWithWeights.length === 1) return timesWithWeights[0].minutes;
  
  // Sorteer op tijd
  timesWithWeights.sort((a, b) => a.minutes - b.minutes);
  
  const totalWeight = timesWithWeights.reduce((sum, item) => sum + item.weight, 0);
  const halfWeight = totalWeight / 2;
  
  let cumulativeWeight = 0;
  
  for (let i = 0; i < timesWithWeights.length; i++) {
    cumulativeWeight += timesWithWeights[i].weight;
    
    if (cumulativeWeight >= halfWeight) {
      if (cumulativeWeight === halfWeight && i + 1 < timesWithWeights.length) {
        return Math.round((timesWithWeights[i].minutes + timesWithWeights[i + 1].minutes) / 2);
      }
      return timesWithWeights[i].minutes;
    }
  }
  
  return timesWithWeights[0].minutes;
}

/**
 * Bereken gewogen statistieken voor een specifieke weekdag
 * Gebruikt dezelfde logica als predictOpeningTime
 * @param {number} targetWeekday - Weekdag (0=zondag, 1=maandag, etc)
 * @param {number} limitDays - Hoeveel dagen terug (standaard 120)
 * @returns {object} - { medianOpen, medianClose, sampleCount }
 */
function getWeightedStatisticsForWeekday(targetWeekday, limitDays = 120) {
  const db = getDatabase();
  
  // Haal tijden op van laatste X maanden
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - limitDays);
  const cutoffDateKey = cutoffDate.toISOString().split('T')[0];
  
  // Haal ALLE logs op om sessieduur te kunnen berekenen
  const logs = db.prepare(`
    SELECT date_key, time_logged, is_opening
    FROM hok_status_log
    WHERE date_key >= ?
    ORDER BY date_key DESC, time_logged ASC
  `).all(cutoffDateKey);
  
  // Verwerk logs om geldige sessies (>= 30 min) te vinden
  const validTimesPerDay = {}; // date_key -> { open: minutes, close: minutes }
  
  let currentDay = null;
  let dayLogs = [];

  const processDayLogs = (dateKey, logs) => {
    let openTime = null;
    let firstValidOpen = null;
    let lastValidClose = null;

    for (const log of logs) {
      const [h, m] = log.time_logged.split(':').map(Number);
      const minutes = h * 60 + m;

      if (log.is_opening) {
        openTime = minutes;
      } else {
        // Closing
        if (openTime !== null) {
          const duration = minutes - openTime;
          if (duration >= 30) {
            // Geldige sessie gevonden
            if (firstValidOpen === null) firstValidOpen = openTime;
            lastValidClose = minutes;
          }
          openTime = null;
        }
      }
    }
    
    if (firstValidOpen !== null && lastValidClose !== null) {
      validTimesPerDay[dateKey] = {
        open: firstValidOpen,
        close: lastValidClose
      };
    }
  };

  // Group logs by day
  logs.forEach(log => {
    if (log.date_key !== currentDay) {
      if (currentDay) processDayLogs(currentDay, dayLogs);
      currentDay = log.date_key;
      dayLogs = [];
    }
    dayLogs.push(log);
  });
  if (currentDay) processDayLogs(currentDay, dayLogs);
  
  // Filter op weekdag en bereken gewichten
  const now = new Date();
  const openTimesWithWeights = [];
  const closeTimesWithWeights = [];
  
  Object.entries(validTimesPerDay).forEach(([dateKey, times]) => {
    const logWeekday = getWeekDay(dateKey);
    if (logWeekday === targetWeekday) {
      // Bereken hoeveel maanden geleden
      const logDate = new Date(dateKey);
      const monthsAgo = (now.getFullYear() - logDate.getFullYear()) * 12 + (now.getMonth() - logDate.getMonth());
      
      // Bepaal gewicht
      let weight;
      if (monthsAgo === 0) weight = 1.0;
      else if (monthsAgo === 1) weight = 0.7;
      else if (monthsAgo === 2) weight = 0.5;
      else weight = 0.2;
      
      openTimesWithWeights.push({ minutes: times.open, weight });
      closeTimesWithWeights.push({ minutes: times.close, weight });
    }
  });
  
  return {
    medianOpen: calculateWeightedMedian(openTimesWithWeights),
    medianClose: calculateWeightedMedian(closeTimesWithWeights),
    sampleCount: openTimesWithWeights.length
  };
}

/**
 * Voorspel openings/sluitingstijd op basis van historische data (laatste 4 maanden)
 * Filtert korte sessies (< 30 min) eruit voor betere accuratesse
 * Gebruikt eerste geldige opening en laatste geldige sluiting van elke dag
 * NU REFACTORED: Gebruikt gedeelde getWeightedStatisticsForWeekday functie
 */
function predictOpeningTime(isOpen) {
  let targetDay;
  let daysFromNow = 0;
  
  if (isOpen) {
    // Als hok open is, voorspel sluittijd voor vandaag
    targetDay = new Date().getDay();
  } else {
    // Als hok dicht is: overdag → voorspel voor vandaag, avond/nacht → voorspel voor morgen
    const currentHour = getAmsterdamHour();
    if (currentHour >= 5 && currentHour < 17) {
      // Overdag: het hok kan vandaag nog openen
      targetDay = new Date().getDay();
    } else {
      // Avond/nacht: voorspel voor morgen
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      targetDay = tomorrow.getDay();
      daysFromNow = 1;
    }
  }
  
  // Gebruik gedeelde functie voor consistente berekening
  const statistics = getWeightedStatisticsForWeekday(targetDay, 120);
  
  if (statistics.sampleCount === 0) return null;
  
  // Kies tijd: als isOpen=true voorspellen we sluiting (close), anders opening (open)
  const medianMinutes = isOpen ? statistics.medianClose : statistics.medianOpen;
  
  if (medianMinutes === null) return null;
  
  const hours = Math.floor(medianMinutes / 60);
  const minutes = medianMinutes % 60;
  
  return {
    time: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
    daysFromNow
  };
}

/**
 * Update hok state in database
 */
function updateHokState(isOpen, lastMessageId = null, updateTimestamp = true) {
  const db = getDatabase();
  
  const stmt = updateTimestamp
    ? db.prepare(`
      UPDATE hok_state
      SET is_open = ?, last_message_id = ?, last_updated = datetime('now')
      WHERE id = 1
    `)
    : db.prepare(`
      UPDATE hok_state
      SET is_open = ?, last_message_id = ?
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
 * Functie om te bepalen of het nacht is (22:00 - 05:00) in Amsterdam timezone
 */
function isNightTime() {
  const hour = getAmsterdamHour();
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
 * Verwerk een nieuwe hok status: bot activity, kanaalnaam, bericht en database.
 * Wordt gebruikt door zowel de Discord-bron als de (legacy) API polling.
 */
async function applyHokStatus(isOpen, client, config, state, options = {}) {
  const at = options.at instanceof Date ? options.at : new Date();

  const channel = await client.channels.fetch(config.CHANNEL_ID).catch(() => null);
  if (!channel) return console.error("Kanaal niet gevonden!");

  // Update bot status
  client.user.setActivity(
    isOpen ? 'Hok is open 📗' : 'Hok is dicht 📕',
    { type: ActivityType.Watching }
  );

  // Bij eerste keer alleen status opslaan (zonder last_updated te overschrijven)
  if (!state.isInitialized) {
    state.lastStatus = isOpen;
    state.isInitialized = true;
    updateHokState(isOpen, null, false);
    console.log("Initiële status opgehaald:", isOpen ? "open" : "dicht");
    if (state.mode === 'api') updateCheckInterval(isOpen, state);
    return;
  }

  if (state.mode === 'api') {
    // Check of interval moet worden aangepast (door tijd of status)
    const currentInterval = getCheckInterval(isOpen);
    const activeInterval = state.checkInterval ? currentInterval : null;

    // Update interval als status veranderd is of als we van/naar nacht periode gaan
    if (state.lastStatus !== isOpen || activeInterval !== currentInterval) {
      updateCheckInterval(isOpen, state);
    }
  }

  // Alleen iets doen als status is veranderd
  if (state.lastStatus === isOpen) return;

  state.lastStatus = isOpen;

  const currentTime = at.toLocaleTimeString('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Log de status change in database
  logHokStatus(getCurrentDateKey(), currentTime, isOpen);

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

  // Nieuw bericht sturen via gedeelde functie
  const statusContent = buildStatusMessage(isOpen, config.ROLE_ID);
  const message = await channel.send(statusContent);

  // Reactie toevoegen
  await message.react('🔔');
  state.lastMessage = message;

  // Update state in database
  updateHokState(isOpen, message.id);

  console.log("Status gewijzigd:", isOpen ? "open" : "dicht");
}

/**
 * Alle tekst uit een bericht halen (content + embeds), zodat we zowel
 * gewone berichten als embed-berichten kunnen lezen.
 */
function extractMessageText(message) {
  const parts = [message.content || ''];

  for (const embed of message.embeds || []) {
    parts.push(embed.title || '', embed.description || '', embed.author?.name || '', embed.footer?.text || '');
    for (const field of embed.fields || []) {
      parts.push(field.name || '', field.value || '');
    }
  }

  return parts.join('\n');
}

// Kanaal (in onze eigen server, via "kanaal volgen" gekoppeld aan het
// mededelingen-kanaal van Syntaxis) waarin de hok status-updates verschijnen.
// Hardcoded omdat dit ID vast is; overschrijfbaar via config.HOK_SOURCE_CHANNEL_ID.
const DEFAULT_HOK_SOURCE_CHANNEL_ID = '1544249073455075359';

function getSourceChannelId(config) {
  return config.HOK_SOURCE_CHANNEL_ID || DEFAULT_HOK_SOURCE_CHANNEL_ID;
}

const HOK_CLOSED_PATTERNS = [/gesloten/i, /\bdicht\b/i, /\bclosed\b/i, /🔴/, /:red_circle:/i, /❌/, /📕/];
const HOK_OPEN_PATTERNS = [/geopend/i, /\bopen\b/i, /🟢/, /:green_circle:/i, /✅/, /📗/];

/**
 * Bepaal de hok status uit een statusbericht.
 * Geeft true (open), false (dicht) of null (geen bruikbaar statusbericht).
 */
function parseHokStatusFromMessage(message) {
  const text = extractMessageText(message);
  if (!text.trim()) return null;

  const isClosed = HOK_CLOSED_PATTERNS.some((pattern) => pattern.test(text));
  const isOpen = HOK_OPEN_PATTERNS.some((pattern) => pattern.test(text));

  // Zowel open als dicht (of geen van beide) is niet te vertrouwen
  if (isClosed === isOpen) return null;

  return isOpen;
}

/**
 * Check of een bericht uit het geconfigureerde bron-kanaal komt en van een
 * vertrouwde afzender is (optioneel via HOK_SOURCE_AUTHOR_IDS).
 */
function isTrustedSourceMessage(message, config) {
  if (message.channel?.id !== getSourceChannelId(config)) return false;

  const allowedAuthors = config.HOK_SOURCE_AUTHOR_IDS;
  if (Array.isArray(allowedAuthors) && allowedAuthors.length > 0) {
    return allowedAuthors.includes(message.author?.id) || allowedAuthors.includes(message.webhookId);
  }

  return true;
}

/**
 * Verwerk een live binnenkomend bericht uit het bron-kanaal
 */
async function handleHokSourceMessage(message, client, config, state) {
  if (!state || state.mode !== 'discord') return;
  if (!isTrustedSourceMessage(message, config)) return;

  const isOpen = parseHokStatusFromMessage(message);
  if (isOpen === null) return;

  state.lastSourceMessageId = message.id;
  await applyHokStatus(isOpen, client, config, state, { at: message.createdAt });
}

/**
 * Lees het laatste statusbericht uit het bron-kanaal.
 * Wordt gebruikt bij het opstarten en periodiek, zodat gemiste berichten
 * (herstart, downtime, gateway hiccup) alsnog worden opgepikt.
 */
async function syncFromSourceChannel(client, config, state) {
  try {
    const sourceChannelId = getSourceChannelId(config);
    const channel = await client.channels.fetch(sourceChannelId).catch(() => null);
    if (!channel || typeof channel.messages?.fetch !== 'function') {
      console.error('Hok bron-kanaal niet gevonden of niet leesbaar:', sourceChannelId);
      return;
    }

    const messages = await channel.messages.fetch({ limit: 50 });
    const latest = [...messages.values()]
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
      .find((message) => isTrustedSourceMessage(message, config) && parseHokStatusFromMessage(message) !== null);

    if (!latest) {
      console.warn('Geen bruikbaar hok statusbericht gevonden in bron-kanaal');
      return;
    }

    if (state.lastSourceMessageId === latest.id) return;

    state.lastSourceMessageId = latest.id;
    await applyHokStatus(parseHokStatusFromMessage(latest), client, config, state, { at: latest.createdAt });
  } catch (err) {
    console.error('Fout bij synchroniseren met hok bron-kanaal:', err);
  }
}

/**
 * Check API functie (legacy - alleen als er geen HOK_SOURCE_CHANNEL_ID is)
 */
async function checkStatus(client, config, state) {
  const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

  try {
    const res = await fetch(config.API_URL);
    const data = await res.json();

    if (!data || !data.payload) return;

    await applyHokStatus(data.payload.open === 1, client, config, state);
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
 * Converteer een voorspelde tijd (bijv. "09:15") naar een Unix timestamp voor vandaag in Amsterdam
 * Als de voorspelde tijd al voorbij is, geeft null terug (geen "over -3 uur" tonen)
 */
function getPredictedUnixTimestamp(timeStr, daysFromNow = 0) {
  try {
    const [hours, minutes] = timeStr.split(':').map(Number);
    
    // Maak een Date object voor vandaag in Amsterdam timezone
    const now = new Date();
    const amsterdamNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
    
    // Voeg dagen toe als we voor morgen voorspellen
    if (daysFromNow > 0) {
      amsterdamNow.setDate(amsterdamNow.getDate() + daysFromNow);
    }
    
    // Zet de voorspelde uren/minuten
    amsterdamNow.setHours(hours, minutes, 0, 0);
    
    // Bereken het verschil tussen Amsterdam en UTC om correct terug te converteren
    const utcOffset = now.getTime() - new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' })).getTime();
    const predictedUtc = amsterdamNow.getTime() + utcOffset;
    
    // Alleen tonen als de voorspelde tijd in de toekomst ligt
    if (predictedUtc <= Date.now()) return null;
    
    return Math.floor(predictedUtc / 1000);
  } catch {
    return null;
  }
}

function buildStatusMessage(isOpen, roleId) {
  // Voorspel volgende tijd
  const prediction = predictOpeningTime(isOpen);
  let predictionMsg = '';
  if (prediction) {
    const { time, daysFromNow } = prediction;
    // Bereken Unix timestamp voor de voorspelde tijd (Amsterdam timezone)
    const relativeTimestamp = getPredictedUnixTimestamp(time, daysFromNow);
    const relativeStr = relativeTimestamp ? `, <t:${relativeTimestamp}:R>` : '';
    const dayLabel = daysFromNow > 0 ? ' morgen' : '';
    predictionMsg = ` (${isOpen ? 'Sluit' : 'Opent'}${dayLabel} meestal rond ${time}${relativeStr})`;
  }

  // Bepaal of we moeten pingen (niet in weekend, niet bij sluiting)
  const currentDay = new Date().getDay();
  const isWeekend = currentDay === 0 || currentDay === 6;
  const shouldPing = isOpen && !isWeekend;
  const hokMention = shouldPing ? `<@&${roleId}>` : 'hok';

  return isOpen
    ? `✅ Het ${hokMention} is nu **open**!${predictionMsg}`
    : `❌ Het ${hokMention} is nu **dicht**!${predictionMsg}`;
}

function startHokMonitoring(client, config) {
  const state = {
    client,
    config,
    lastStatus: null,
    lastMessage: null,
    isInitialized: false,
    checkInterval: null,
    mode: config.HOK_USE_API === true ? 'api' : 'discord',
    lastSourceMessageId: null,
    syncInterval: null
  };

  if (state.mode === 'discord') {
    const resyncMinutes = Number(config.HOK_SOURCE_RESYNC_MINUTES) > 0
      ? Number(config.HOK_SOURCE_RESYNC_MINUTES)
      : 1;

    console.log(`Hok status wordt gelezen uit Discord kanaal ${getSourceChannelId(config)} (resync elke ${resyncMinutes} min)`);

    // Eerste sync: huidige status uit de geschiedenis van het bron-kanaal
    syncFromSourceChannel(client, config, state);

    // Vangnet voor gemiste berichten tijdens downtime
    state.syncInterval = setInterval(() => {
      syncFromSourceChannel(client, config, state);
    }, resyncMinutes * 60 * 1000);
  } else {
    console.log('Hok status wordt opgehaald via de API (HOK_USE_API = true)');
    checkStatus(client, config, state);
  }

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
  getFilteredHokHistory,
  predictOpeningTime,
  getWeightedStatisticsForWeekday,
  calculateWeightedMedian,
  updateHokState,
  getHokState,
  buildStatusMessage,
  checkStatus,
  applyHokStatus,
  parseHokStatusFromMessage,
  isTrustedSourceMessage,
  handleHokSourceMessage,
  syncFromSourceChannel,
  startHokMonitoring,
  loadHokData,
  saveHokData,
  cleanOldData
};
