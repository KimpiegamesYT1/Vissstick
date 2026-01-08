/**
 * Hok Dashboard - Backend Server
 * Voorziet parameters configuratie en data visualisatie
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database connectie naar de bot database
const DB_PATH = path.join(__dirname, '..', 'bot.db');
let db;

try {
  db = new Database(DB_PATH, { readonly: false });
  db.pragma('journal_mode = WAL');
  console.log('✅ Database connectie succesvol!');
} catch (error) {
  console.error('❌ Database connectie mislukt:', error);
  process.exit(1);
}

// Maak parameters tabel als die niet bestaat
db.exec(`
  CREATE TABLE IF NOT EXISTS hok_parameters (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    check_interval_open INTEGER DEFAULT 300000,
    check_interval_closed INTEGER DEFAULT 60000,
    check_interval_night INTEGER DEFAULT 900000,
    night_start_hour INTEGER DEFAULT 22,
    night_end_hour INTEGER DEFAULT 5,
    history_limit_days INTEGER DEFAULT 180,
    min_session_duration INTEGER DEFAULT 30,
    prediction_lookback_months INTEGER DEFAULT 4,
    weight_current_month REAL DEFAULT 1.0,
    weight_1_month_ago REAL DEFAULT 0.7,
    weight_2_months_ago REAL DEFAULT 0.5,
    weight_3plus_months_ago REAL DEFAULT 0.2,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Initialiseer parameters met default waarden
const initStmt = db.prepare(`
  INSERT OR IGNORE INTO hok_parameters (id) VALUES (1)
`);
initStmt.run();

// API Endpoints

// GET - Haal parameters op
app.get('/api/parameters', (req, res) => {
  try {
    const params = db.prepare('SELECT * FROM hok_parameters WHERE id = 1').get();
    res.json(params);
  } catch (error) {
    console.error('Fout bij ophalen parameters:', error);
    res.status(500).json({ error: 'Fout bij ophalen parameters' });
  }
});

// PUT - Update parameters
app.put('/api/parameters', (req, res) => {
  try {
    const {
      check_interval_open,
      check_interval_closed,
      check_interval_night,
      night_start_hour,
      night_end_hour,
      history_limit_days,
      min_session_duration,
      prediction_lookback_months,
      weight_current_month,
      weight_1_month_ago,
      weight_2_months_ago,
      weight_3plus_months_ago
    } = req.body;

    const stmt = db.prepare(`
      UPDATE hok_parameters SET
        check_interval_open = ?,
        check_interval_closed = ?,
        check_interval_night = ?,
        night_start_hour = ?,
        night_end_hour = ?,
        history_limit_days = ?,
        min_session_duration = ?,
        prediction_lookback_months = ?,
        weight_current_month = ?,
        weight_1_month_ago = ?,
        weight_2_months_ago = ?,
        weight_3plus_months_ago = ?,
        updated_at = datetime('now')
      WHERE id = 1
    `);

    stmt.run(
      check_interval_open,
      check_interval_closed,
      check_interval_night,
      night_start_hour,
      night_end_hour,
      history_limit_days,
      min_session_duration,
      prediction_lookback_months,
      weight_current_month,
      weight_1_month_ago,
      weight_2_months_ago,
      weight_3plus_months_ago
    );

    res.json({ success: true, message: 'Parameters bijgewerkt!' });
  } catch (error) {
    console.error('Fout bij updaten parameters:', error);
    res.status(500).json({ error: 'Fout bij updaten parameters' });
  }
});

// GET - Haal alle hok logs op
app.get('/api/logs', (req, res) => {
  try {
    const { days } = req.query;
    const limitDays = days ? parseInt(days) : 30;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - limitDays);
    const cutoffDateKey = cutoffDate.toISOString().split('T')[0];

    const logs = db.prepare(`
      SELECT date_key, time_logged, is_opening, logged_at
      FROM hok_status_log
      WHERE date_key >= ?
      ORDER BY date_key ASC, time_logged ASC
    `).all(cutoffDateKey);

    res.json(logs);
  } catch (error) {
    console.error('Fout bij ophalen logs:', error);
    res.status(500).json({ error: 'Fout bij ophalen logs' });
  }
});

// GET - Haal gefilterde logs op (alleen geldige sessies >= min duration)
app.get('/api/logs/filtered', (req, res) => {
  try {
    const { days, minDuration } = req.query;
    const limitDays = days ? parseInt(days) : 30;
    const minSessionDuration = minDuration ? parseInt(minDuration) : 30;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - limitDays);
    const cutoffDateKey = cutoffDate.toISOString().split('T')[0];

    const logs = db.prepare(`
      SELECT date_key, time_logged, is_opening
      FROM hok_status_log
      WHERE date_key >= ?
      ORDER BY date_key ASC, time_logged ASC
    `).all(cutoffDateKey);

    // Verwerk logs om geldige sessies te filteren
    const filteredData = {};
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
          if (openTime !== null) {
            const duration = minutes - openTime;
            if (duration >= minSessionDuration) {
              if (firstValidOpen === null) firstValidOpen = openTime;
              lastValidClose = minutes;
            }
            openTime = null;
          }
        }
      }

      if (firstValidOpen !== null || lastValidClose !== null) {
        filteredData[dateKey] = {
          openTime: firstValidOpen,
          closeTime: lastValidClose,
          weekday: new Date(dateKey).getDay()
        };
      }
    };

    logs.forEach(log => {
      if (log.date_key !== currentDay) {
        if (currentDay) processDayLogs(currentDay, dayLogs);
        currentDay = log.date_key;
        dayLogs = [];
      }
      dayLogs.push(log);
    });
    if (currentDay) processDayLogs(currentDay, dayLogs);

    res.json(filteredData);
  } catch (error) {
    console.error('Fout bij ophalen gefilterde logs:', error);
    res.status(500).json({ error: 'Fout bij ophalen gefilterde logs' });
  }
});

// GET - Bereken voorspellingen per weekdag
app.get('/api/predictions', (req, res) => {
  try {
    const params = db.prepare('SELECT * FROM hok_parameters WHERE id = 1').get();
    
    const lookbackMonths = params.prediction_lookback_months;
    const minSessionDuration = params.min_session_duration;
    
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - lookbackMonths);
    const cutoffDateKey = cutoffDate.toISOString().split('T')[0];

    const logs = db.prepare(`
      SELECT date_key, time_logged, is_opening
      FROM hok_status_log
      WHERE date_key >= ?
      ORDER BY date_key DESC, time_logged ASC
    `).all(cutoffDateKey);

    // Verwerk logs per dag
    const validTimesPerDay = {};
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
          if (openTime !== null) {
            const duration = minutes - openTime;
            if (duration >= minSessionDuration) {
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

    logs.forEach(log => {
      if (log.date_key !== currentDay) {
        if (currentDay) processDayLogs(currentDay, dayLogs);
        currentDay = log.date_key;
        dayLogs = [];
      }
      dayLogs.push(log);
    });
    if (currentDay) processDayLogs(currentDay, dayLogs);

    // Bereken voorspellingen per weekdag
    const predictions = {};
    const now = new Date();

    for (let targetDay = 0; targetDay < 7; targetDay++) {
      const openTimes = [];
      const closeTimes = [];

      Object.entries(validTimesPerDay).forEach(([dateKey, times]) => {
        const logWeekday = new Date(dateKey).getDay();
        if (logWeekday === targetDay) {
          const logDate = new Date(dateKey);
          const monthsAgo = (now.getFullYear() - logDate.getFullYear()) * 12 + (now.getMonth() - logDate.getMonth());

          let weight;
          if (monthsAgo === 0) weight = params.weight_current_month;
          else if (monthsAgo === 1) weight = params.weight_1_month_ago;
          else if (monthsAgo === 2) weight = params.weight_2_months_ago;
          else weight = params.weight_3plus_months_ago;

          openTimes.push({ minutes: times.open, weight });
          closeTimes.push({ minutes: times.close, weight });
        }
      });

      const calculateWeightedMedian = (times) => {
        if (times.length === 0) return null;
        
        times.sort((a, b) => a.minutes - b.minutes);
        const totalWeight = times.reduce((sum, item) => sum + item.weight, 0);
        const halfWeight = totalWeight / 2;
        
        let cumulativeWeight = 0;
        let medianMinutes = times[0].minutes;
        
        for (let i = 0; i < times.length; i++) {
          cumulativeWeight += times[i].weight;
          if (cumulativeWeight >= halfWeight) {
            if (i > 0 && cumulativeWeight - times[i].weight < halfWeight) {
              medianMinutes = (times[i - 1].minutes + times[i].minutes) / 2;
            } else {
              medianMinutes = times[i].minutes;
            }
            break;
          }
        }
        
        return medianMinutes;
      };

      const openMedian = calculateWeightedMedian(openTimes);
      const closeMedian = calculateWeightedMedian(closeTimes);

      predictions[targetDay] = {
        openTime: openMedian,
        closeTime: closeMedian,
        dataPoints: openTimes.length
      };
    }

    res.json(predictions);
  } catch (error) {
    console.error('Fout bij berekenen voorspellingen:', error);
    res.status(500).json({ error: 'Fout bij berekenen voorspellingen' });
  }
});

// POST - Voeg nieuwe log toe (voor testen)
app.post('/api/logs', (req, res) => {
  try {
    const { date_key, time_logged, is_opening } = req.body;

    const stmt = db.prepare(`
      INSERT INTO hok_status_log (date_key, time_logged, is_opening)
      VALUES (?, ?, ?)
    `);

    stmt.run(date_key, time_logged, is_opening ? 1 : 0);
    res.json({ success: true, message: 'Log toegevoegd!' });
  } catch (error) {
    console.error('Fout bij toevoegen log:', error);
    res.status(500).json({ error: 'Fout bij toevoegen log' });
  }
});

// DELETE - Verwijder log
app.delete('/api/logs/:id', (req, res) => {
  try {
    const { id } = req.params;
    const stmt = db.prepare('DELETE FROM hok_status_log WHERE id = ?');
    stmt.run(id);
    res.json({ success: true, message: 'Log verwijderd!' });
  } catch (error) {
    console.error('Fout bij verwijderen log:', error);
    res.status(500).json({ error: 'Fout bij verwijderen log' });
  }
});

// GET - Statistieken
app.get('/api/stats', (req, res) => {
  try {
    const totalLogs = db.prepare('SELECT COUNT(*) as count FROM hok_status_log').get();
    const dateRange = db.prepare(`
      SELECT 
        MIN(date_key) as first_date,
        MAX(date_key) as last_date
      FROM hok_status_log
    `).get();

    res.json({
      totalLogs: totalLogs.count,
      firstDate: dateRange.first_date,
      lastDate: dateRange.last_date
    });
  } catch (error) {
    console.error('Fout bij ophalen statistieken:', error);
    res.status(500).json({ error: 'Fout bij ophalen statistieken' });
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  console.log('\n👋 Database connectie gesloten');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Hok Dashboard draait op http://localhost:${PORT}`);
});
