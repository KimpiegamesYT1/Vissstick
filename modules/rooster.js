/**
 * Rooster monitor
 *
 * Haalt de Saxion-agenda (iCal feed) op en vergelijkt de events binnen de
 * komende 2 weken met een snapshot in de database. Bij toegevoegde, vervallen
 * of gewijzigde events stuurt de bot een embed naar het log-kanaal.
 *
 * Alleen wijzigingen in de toekomst tellen; verleden events worden genegeerd.
 * Bij de allereerste run wordt de snapshot stil opgebouwd (geen melding).
 *
 * Let op: de feed genereert bij elke request nieuwe UID's, dus events worden
 * geïdentificeerd via een afgeleide sleutel (vak + datum), niet via UID.
 */

const { EmbedBuilder } = require('discord.js');
const { getDatabase } = require('../database');

// Standaard feed (webcal:// omgezet naar https://). Overschrijfbaar via config.
const DEFAULT_FEED_URL =
  'https://saxion.myx.nl/api/InternetCalendar/feed/e152f2a2-a050-43c2-ac3a-cc0b2ad4301d/c9995f3b-0852-4543-9432-f2ba75f55893';

// Doel-kanaal voor roostermeldingen (zelfde als het log-kanaal).
const DEFAULT_LOG_CHANNEL_ID = '1415603152400547862';

// Hoe ver vooruit we melden.
const WINDOW_DAYS = 14;

// Hoe ver vooruit we events onthouden. Ruimer dan WINDOW_DAYS zodat een event
// dat "de 2 weken in schuift" niet als nieuw wordt gemeld.
const SNAPSHOT_DAYS = 60;

// Maximaal aantal wijzigingen dat we in één embed tonen.
const MAX_FIELDS = 20;

// Pauze-melding: een gat tussen twee lessen op dezelfde dag telt als pauze
// wanneer het minstens PAUSE_MIN_MINUTES en hoogstens ROOSTER_MAX_PAUSE_MINUTES
// (default hieronder) duurt. De melding gaat PAUSE_LEAD_MINUTES vooraf.
const PAUSE_MIN_MINUTES = 5;
const DEFAULT_PAUSE_MAX_MINUTES = 90;
const DEFAULT_PAUSE_LEAD_MINUTES = 5;

function getPauseMaxMinutes(config) {
  const v = Number(config.ROOSTER_MAX_PAUSE_MINUTES);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_PAUSE_MAX_MINUTES;
}

function getPauseLeadMinutes(config) {
  const v = Number(config.ROOSTER_PAUSE_LEAD_MINUTES);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_PAUSE_LEAD_MINUTES;
}

function getFeedUrl(config) {
  const raw = config.ROOSTER_FEED_URL || DEFAULT_FEED_URL;
  return raw.replace(/^webcal:\/\//i, 'https://');
}

function getLogChannelId(config) {
  return config.ROOSTER_LOG_CHANNEL_ID || config.LOG_CHANNEL_ID || DEFAULT_LOG_CHANNEL_ID;
}

/**
 * Unescape iCal tekst (\, \; \\ \n).
 */
function unescapeText(value) {
  return String(value || '')
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/**
 * Vouw iCal continuation-lines (regels die met spatie/tab beginnen) samen.
 */
function unfoldLines(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

/**
 * Normaliseer een iCal datum/tijd naar een vergelijkbare stamp YYYYMMDDTHHMMSS
 * in Europe/Amsterdam wall-clock tijd.
 */
function normalizeStamp(rawValue) {
  const value = String(rawValue || '').trim();

  const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly) {
    return `${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}T000000`;
  }

  const utc = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (utc) {
    const [, y, mo, d, h, mi, s] = utc.map(Number);
    return amsterdamStampFromDate(new Date(Date.UTC(y, mo - 1, d, h, mi, s)));
  }

  const local = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (local) {
    return `${local[1]}${local[2]}${local[3]}T${local[4]}${local[5]}${local[6]}`;
  }

  return null;
}

/**
 * Formatteer een Date naar Amsterdam wall-clock stamp YYYYMMDDTHHMMSS.
 */
function amsterdamStampFromDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value.padStart(2, '0');
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}${get('month')}${get('day')}T${hour}${get('minute')}${get('second')}`;
}

function amsterdamNowStamp() {
  return amsterdamStampFromDate(new Date());
}

/**
 * Datum (YYYYMMDD) van vandaag + n dagen in Amsterdam.
 */
function amsterdamDateStampPlusDays(days) {
  const shifted = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return amsterdamStampFromDate(shifted).slice(0, 8);
}

/**
 * Toon een stamp als "DD-MM-YYYY HH:MM".
 */
function formatStamp(stamp) {
  if (!stamp || stamp.length < 15) return stamp || '?';
  return `${stamp.slice(6, 8)}-${stamp.slice(4, 6)}-${stamp.slice(0, 4)} ${stamp.slice(9, 11)}:${stamp.slice(11, 13)}`;
}

/**
 * Toon alleen de tijd van een stamp ("HH:MM").
 */
function formatTime(stamp) {
  if (!stamp || stamp.length < 13) return '?';
  return `${stamp.slice(9, 11)}:${stamp.slice(11, 13)}`;
}

/**
 * Zet een stamp (YYYYMMDDTHHMMSS, Amsterdam wall-clock) om naar een Date.
 * Alleen bedoeld voor verschillen binnen dezelfde dag.
 */
function stampToDate(stamp) {
  return new Date(Date.UTC(
    Number(stamp.slice(0, 4)),
    Number(stamp.slice(4, 6)) - 1,
    Number(stamp.slice(6, 8)),
    Number(stamp.slice(9, 11)),
    Number(stamp.slice(11, 13)),
    Number(stamp.slice(13, 15)) || 0
  ));
}

/**
 * Verschil in minuten tussen twee stamps (b - a).
 */
function stampDiffMinutes(a, b) {
  return (stampToDate(b).getTime() - stampToDate(a).getTime()) / 60000;
}

/**
 * Toon een event-periode compact (zelfde dag => alleen eind-tijd).
 */
function formatRange(startStamp, endStamp) {
  const start = formatStamp(startStamp);
  if (!endStamp || endStamp.length < 15) return start;
  if (endStamp.slice(0, 8) === startStamp.slice(0, 8)) {
    return `${start}–${endStamp.slice(9, 11)}:${endStamp.slice(11, 13)}`;
  }
  return `${start} → ${formatStamp(endStamp)}`;
}

/**
 * Haal de "basisnaam" van een event: de SUMMARY zonder een eventueel
 * toegevoegde ", <locatie>" aan het eind.
 */
function baseSummary(summary, location) {
  let base = String(summary || '').trim();
  const loc = String(location || '').trim();
  if (loc) {
    const suffix = new RegExp(`\\s*,\\s*${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    base = base.replace(suffix, '').trim();
  }
  return base;
}

/**
 * Korte lestitel: basisnaam zonder code-prefix (alles vóór de eerste ": ").
 */
function lessonTitle(summary, location) {
  const base = baseSummary(summary, location);
  const idx = base.indexOf(': ');
  return idx !== -1 ? base.slice(idx + 2).trim() || base : base;
}

/**
 * Stabiele identiteit van een event: basisnaam + startdatum. Overleeft het
 * regenereren van UID's en laat tijd-/locatiewijzigingen als "gewijzigd" zien.
 */
function eventKey(event) {
  return `${baseSummary(event.summary, event.location).toLowerCase()}|${event.startStamp.slice(0, 8)}`;
}

/**
 * Ken elk event een unieke sleutel toe; los botsingen (zelfde vak, zelfde dag)
 * op met een volgnummer op basis van starttijd.
 */
function assignKeys(events) {
  const grouped = new Map();
  for (const event of events) {
    const key = eventKey(event);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(event);
  }

  const result = [];
  for (const [key, group] of grouped) {
    group.sort((a, b) => (a.startStamp + (a.endStamp || '')).localeCompare(b.startStamp + (b.endStamp || '')));
    group.forEach((event, index) => {
      result.push({ ...event, key: group.length > 1 ? `${key}#${index + 1}` : key });
    });
  }
  return result;
}

/**
 * Parse een iCal string naar een lijst events.
 */
function parseIcs(text) {
  const lines = unfoldLines(text).split('\n');
  const events = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (current && current.summary && current.startRaw) {
        const startStamp = normalizeStamp(current.startRaw);
        if (startStamp) {
          events.push({
            summary: unescapeText(current.summary) || '(geen titel)',
            location: unescapeText(current.location),
            startStamp,
            endStamp: current.endRaw ? normalizeStamp(current.endRaw) : null
          });
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const sep = trimmed.indexOf(':');
    if (sep === -1) continue;
    const key = trimmed.slice(0, sep).split(';')[0].toUpperCase();
    const val = trimmed.slice(sep + 1);

    if (key === 'SUMMARY') current.summary = val;
    else if (key === 'LOCATION') current.location = val;
    else if (key === 'DTSTART') current.startRaw = val.trim();
    else if (key === 'DTEND') current.endRaw = val.trim();
  }

  return events;
}

/**
 * Haal de agenda-feed op.
 */
async function fetchCalendar(config) {
  const res = await fetch(getFeedUrl(config), {
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': 'VissstickBot/1.0 (rooster monitor)' }
  });
  if (!res.ok) {
    throw new Error(`Feed gaf status ${res.status}`);
  }
  return res.text();
}

/**
 * Toekomstige events die we onthouden (tot SNAPSHOT_DAYS vooruit).
 */
function filterToSnapshotRange(events) {
  const nowStamp = amsterdamNowStamp();
  const endDate = amsterdamDateStampPlusDays(SNAPSHOT_DAYS);
  return events.filter(
    (event) => event.startStamp >= nowStamp && event.startStamp.slice(0, 8) <= endDate
  );
}

/**
 * Valt de startdatum binnen het meld-venster (max WINDOW_DAYS vooruit)?
 */
function isInNotifyWindow(startStamp) {
  return startStamp.slice(0, 8) <= amsterdamDateStampPlusDays(WINDOW_DAYS);
}

function getSnapshot() {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT event_key, summary, location, start_stamp, end_stamp FROM rooster_events')
    .all();
  const map = new Map();
  for (const row of rows) {
    map.set(row.event_key, {
      key: row.event_key,
      summary: row.summary,
      location: row.location || '',
      startStamp: row.start_stamp,
      endStamp: row.end_stamp || null
    });
  }
  return map;
}

function saveSnapshot(events) {
  const db = getDatabase();
  const replace = db.transaction((list) => {
    db.prepare('DELETE FROM rooster_events').run();
    const insert = db.prepare(`
      INSERT INTO rooster_events (event_key, summary, location, start_stamp, end_stamp)
      VALUES (@key, @summary, @location, @startStamp, @endStamp)
    `);
    for (const event of list) {
      insert.run({
        key: event.key,
        summary: event.summary,
        location: event.location || '',
        startStamp: event.startStamp,
        endStamp: event.endStamp || null
      });
    }
    db.prepare("UPDATE rooster_meta SET initialized = 1, last_checked = datetime('now') WHERE id = 1").run();
  });
  replace(events);
}

function isInitialized() {
  const db = getDatabase();
  const row = db.prepare('SELECT initialized FROM rooster_meta WHERE id = 1').get();
  return Boolean(row && row.initialized);
}

/**
 * Vergelijk de vorige snapshot met de huidige window-events.
 */
function diffEvents(previous, current) {
  const nowStamp = amsterdamNowStamp();
  const currentMap = new Map(current.map((event) => [event.key, event]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const event of current) {
    const before = previous.get(event.key);
    if (!before) {
      added.push(event);
      continue;
    }

    const fields = [];
    if (before.summary !== event.summary) {
      fields.push({ label: 'Naam', before: before.summary, after: event.summary });
    }
    if (before.startStamp !== event.startStamp || (before.endStamp || '') !== (event.endStamp || '')) {
      fields.push({
        label: 'Tijd',
        before: formatRange(before.startStamp, before.endStamp),
        after: formatRange(event.startStamp, event.endStamp)
      });
    }
    if ((before.location || '') !== (event.location || '')) {
      fields.push({
        label: 'Locatie',
        before: before.location || '(geen)',
        after: event.location || '(geen)'
      });
    }
    if (fields.length > 0) changed.push({ event, fields });
  }

  for (const [key, before] of previous) {
    if (currentMap.has(key)) continue;
    if (before.startStamp >= nowStamp) removed.push(before);
  }

  // Alleen melden over events binnen het meld-venster (max WINDOW_DAYS).
  return {
    added: added.filter((event) => isInNotifyWindow(event.startStamp)),
    removed: removed.filter((event) => isInNotifyWindow(event.startStamp)),
    changed: changed.filter((item) => isInNotifyWindow(item.event.startStamp))
  };
}

function totalCount(diff) {
  return diff.added.length + diff.removed.length + diff.changed.length;
}

function hasChanges(diff) {
  return totalCount(diff) > 0;
}

function locationSuffix(location) {
  return location ? ` · ${location}` : '';
}

function truncate(value, max) {
  const str = String(value || '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

/**
 * Bouw de embed met alle wijzigingen.
 */
function buildChangeEmbed(diff) {
  const embed = new EmbedBuilder()
    .setTitle(`📅 Roosterwijziging${totalCount(diff) === 1 ? '' : 'en'}`)
    .setColor(0xffa500)
    .setTimestamp();

  const summaryParts = [];
  if (diff.added.length) summaryParts.push(`${diff.added.length} nieuw`);
  if (diff.changed.length) summaryParts.push(`${diff.changed.length} gewijzigd`);
  if (diff.removed.length) summaryParts.push(`${diff.removed.length} vervallen`);
  embed.setDescription(`Wijzigingen in de komende ${WINDOW_DAYS} dagen: ${summaryParts.join(' · ')}`);

  const fields = [];

  for (const event of diff.added) {
    fields.push({
      name: `➕ Nieuw: ${truncate(event.summary, 240)}`,
      value: truncate(`${formatRange(event.startStamp, event.endStamp)}${locationSuffix(event.location)}`, 1024)
    });
  }

  for (const item of diff.changed) {
    const lines = item.fields.map(
      (f) => `**${f.label}:** ${truncate(f.before, 300)} → ${truncate(f.after, 300)}`
    );
    fields.push({
      name: `✏️ Gewijzigd: ${truncate(item.event.summary, 240)}`,
      value: truncate(lines.join('\n'), 1024)
    });
  }

  for (const event of diff.removed) {
    fields.push({
      name: `➖ Vervallen: ${truncate(event.summary, 240)}`,
      value: truncate(`was: ${formatRange(event.startStamp, event.endStamp)}${locationSuffix(event.location)}`, 1024)
    });
  }

  if (fields.length > MAX_FIELDS) {
    const shown = fields.slice(0, MAX_FIELDS);
    shown.push({ name: '…', value: `en nog ${fields.length - MAX_FIELDS} andere wijziging(en)` });
    embed.addFields(shown);
  } else {
    embed.addFields(fields);
  }

  return embed;
}

/**
 * Hoofd-check: haal feed op, vergelijk, stuur melding, sla nieuwe snapshot op.
 */
async function checkRoosterChanges(client, config) {
  let text;
  try {
    text = await fetchCalendar(config);
  } catch (err) {
    console.error('[rooster] Kon de agenda-feed niet ophalen:', err.message);
    return;
  }

  let snapshotEvents;
  try {
    snapshotEvents = assignKeys(filterToSnapshotRange(parseIcs(text)));
  } catch (err) {
    console.error('[rooster] Kon de agenda-feed niet verwerken:', err);
    return;
  }

  cleanupOldPauseReminders();

  const firstRun = !isInitialized();
  const diff = diffEvents(getSnapshot(), snapshotEvents);

  if (firstRun) {
    saveSnapshot(snapshotEvents);
    console.log(`[rooster] Eerste snapshot opgebouwd (${snapshotEvents.length} events) - geen melding`);
    return;
  }

  if (!hasChanges(diff)) {
    saveSnapshot(snapshotEvents);
    return;
  }

  try {
    const channel = await client.channels.fetch(getLogChannelId(config));
    if (!channel) {
      console.error('[rooster] Log-kanaal niet gevonden:', getLogChannelId(config));
      return;
    }
    await channel.send({ embeds: [buildChangeEmbed(diff)] });
  } catch (err) {
    console.error('[rooster] Kon roostermelding niet sturen:', err);
    return; // snapshot niet opslaan zodat we het de volgende keer opnieuw proberen
  }

  saveSnapshot(snapshotEvents);
  console.log(
    `[rooster] Melding gestuurd: ${diff.added.length} nieuw, ${diff.changed.length} gewijzigd, ${diff.removed.length} vervallen`
  );
}

// =====================================================
// PAUZE-MELDINGEN
// =====================================================

/**
 * Haal de lessen van een dag op uit de snapshot: events met een locatie en een
 * echte starttijd (geen hele-dag events zoals vakanties).
 */
function getLessonsForDay(dateStamp) {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT event_key, summary, location, start_stamp, end_stamp
       FROM rooster_events
       WHERE substr(start_stamp, 1, 8) = ?
         AND location IS NOT NULL AND location != ''
         AND substr(start_stamp, 10, 6) != '000000'
         AND end_stamp IS NOT NULL AND end_stamp != ''
       ORDER BY start_stamp ASC`
    )
    .all(dateStamp);
}

/**
 * Zoek voor een les de les die er direct aan voorafgaat (hoogste eindtijd die
 * niet later ligt dan de start van deze les).
 */
function findPrecedingLesson(lessons, target) {
  let best = null;
  for (const lesson of lessons) {
    if (lesson.event_key === target.event_key) continue;
    if (lesson.end_stamp <= target.start_stamp) {
      if (!best || lesson.end_stamp > best.end_stamp) best = lesson;
    }
  }
  return best;
}

/**
 * Bouw de embed voor een pauze-melding.
 */
function buildPauseReminderEmbed(before, next, gapMinutes, minutesLeft) {
  const title = lessonTitle(next.summary, next.location);
  return new EmbedBuilder()
    .setTitle('⏰ Pauze bijna voorbij')
    .setColor(0x5865f2)
    .setDescription(
      `**${title}** begint om **${formatTime(next.start_stamp)}** ` +
        `(over ${Math.max(1, Math.round(minutesLeft))} min) in **${next.location}**.`
    )
    .addFields(
      { name: 'Pauze', value: `${Math.round(gapMinutes)} min — na ${lessonTitle(before.summary, before.location)} (tot ${formatTime(before.end_stamp)})` }
    )
    .setTimestamp();
}

function cleanupOldPauseReminders() {
  try {
    getDatabase()
      .prepare("DELETE FROM rooster_pause_reminders WHERE notified_at < datetime('now', '-2 days')")
      .run();
  } catch (err) {
    console.error('[rooster] Kon oude pauze-meldingen niet opruimen:', err);
  }
}

/**
 * Controleer of er nu een pauze bijna voorbij is en stuur eenmalig een melding
 * PAUSE_LEAD_MINUTES voordat de volgende les begint. Draait elke minuut en
 * gebruikt alleen de snapshot in de database (geen feed-request).
 */
async function checkPauseReminders(client, config) {
  const db = getDatabase();
  const nowStamp = amsterdamNowStamp();
  const today = nowStamp.slice(0, 8);

  const lessons = getLessonsForDay(today);
  if (lessons.length < 2) return;

  const maxPause = getPauseMaxMinutes(config);
  const lead = getPauseLeadMinutes(config);

  for (const next of lessons) {
    const minutesLeft = stampDiffMinutes(nowStamp, next.start_stamp);
    if (minutesLeft <= 0 || minutesLeft > lead) continue;

    const before = findPrecedingLesson(lessons, next);
    if (!before) continue;

    const gap = stampDiffMinutes(before.end_stamp, next.start_stamp);
    if (gap < PAUSE_MIN_MINUTES || gap > maxPause) continue;

    const reminderKey = `${today}|${next.event_key}`;
    if (db.prepare('SELECT 1 FROM rooster_pause_reminders WHERE reminder_key = ?').get(reminderKey)) {
      continue;
    }

    try {
      const channel = await client.channels.fetch(getLogChannelId(config));
      if (!channel) {
        console.error('[rooster] Log-kanaal niet gevonden voor pauze-melding');
        continue;
      }
      await channel.send({ embeds: [buildPauseReminderEmbed(before, next, gap, minutesLeft)] });
    } catch (err) {
      console.error('[rooster] Kon pauze-melding niet sturen:', err);
      continue; // niet markeren -> volgende minuut opnieuw proberen
    }

    db.prepare(
      "INSERT OR IGNORE INTO rooster_pause_reminders (reminder_key, notified_at) VALUES (?, datetime('now'))"
    ).run(reminderKey);
    console.log(`[rooster] Pauze-melding: ${lessonTitle(next.summary, next.location)} begint om ${formatTime(next.start_stamp)} (pauze ${Math.round(gap)} min)`);
  }
}

/**
 * Start de rooster monitoring: doe direct een eerste check (seed of diff).
 */
async function startRoosterMonitoring(client, config) {
  await checkRoosterChanges(client, config);
}

module.exports = {
  WINDOW_DAYS,
  getFeedUrl,
  getLogChannelId,
  parseIcs,
  normalizeStamp,
  baseSummary,
  eventKey,
  assignKeys,
  filterToSnapshotRange,
  diffEvents,
  buildChangeEmbed,
  checkRoosterChanges,
  getLessonsForDay,
  findPrecedingLesson,
  buildPauseReminderEmbed,
  checkPauseReminders,
  startRoosterMonitoring
};
