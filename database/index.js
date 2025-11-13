/**
 * Database module voor Vissstick Discord Bot
 * Centralized database management met SQLite
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'bot.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;

/**
 * Initialiseer database en schema
 */
function initDatabase() {
  try {
    // Maak database connectie
    db = new Database(DB_PATH);
    
    // Optimalisaties voor betere performance en veiligheid
    db.pragma('journal_mode = WAL'); // Write-Ahead Logging voor betere concurrency
    db.pragma('foreign_keys = ON'); // Enforce foreign key constraints
    db.pragma('synchronous = NORMAL'); // Balans tussen veiligheid en snelheid
    
    // Check of database nieuw is
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    
    if (tables.length === 0) {
      console.log('📊 Database wordt geïnitialiseerd...');
      const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
      db.exec(schema);
      console.log('✅ Database schema succesvol aangemaakt!');
    } else {
      console.log('✅ Database connectie succesvol!');
    }
    
    return db;
  } catch (error) {
    console.error('❌ Fout bij initialiseren database:', error);
    throw error;
  }
}

/**
 * Get database instance (singleton pattern)
 */
function getDatabase() {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * Sluit database connectie netjes af
 */
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('Database connectie gesloten');
  }
}

/**
 * Database backup maken
 */
function backupDatabase(backupPath) {
  if (!db) {
    throw new Error('Database niet geïnitialiseerd');
  }
  
  const backup = db.backup(backupPath);
  
  return new Promise((resolve, reject) => {
    backup.step(-1); // Backup hele database in één stap
    backup.finish();
    
    if (backup.failed) {
      reject(new Error('Backup mislukt'));
    } else {
      console.log(`✅ Database backup gemaakt: ${backupPath}`);
      resolve();
    }
  });
}

/**
 * Vacuum database (cleanup en optimalisatie)
 */
function vacuumDatabase() {
  if (!db) {
    throw new Error('Database niet geïnitialiseerd');
  }
  
  db.exec('VACUUM');
  console.log('✅ Database geoptimaliseerd (VACUUM)');
}

// Graceful shutdown handlers
process.on('exit', () => {
  closeDatabase();
});

process.on('SIGINT', () => {
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDatabase();
  process.exit(0);
});

module.exports = {
  initDatabase,
  getDatabase,
  closeDatabase,
  backupDatabase,
  vacuumDatabase
};
