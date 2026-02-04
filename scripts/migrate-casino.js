/**
 * Casino Migratie Script
 * Voegt de nieuwe casino tabellen toe aan bestaande database
 * Run met: node scripts/migrate-casino.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'bot.db');

console.log('🎰 Casino Migratie Script');
console.log('========================\n');

try {
  const db = new Database(DB_PATH);
  
  console.log('📊 Controleren bestaande tabellen...');
  
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const tableNames = tables.map(t => t.name);
  
  console.log(`   Gevonden tabellen: ${tableNames.join(', ')}\n`);
  
  // Users tabel
  if (!tableNames.includes('users')) {
    console.log('✅ Aanmaken: users tabel');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        balance INTEGER DEFAULT 0,
        total_earned INTEGER DEFAULT 0,
        total_spent INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_users_balance ON users(balance DESC);
    `);
  } else {
    console.log('⏭️  Bestaat al: users tabel');
  }
  
  // Bets tabel
  if (!tableNames.includes('bets')) {
    console.log('✅ Aanmaken: bets tabel');
    db.exec(`
      CREATE TABLE IF NOT EXISTS bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question TEXT NOT NULL,
        status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed', 'resolved', 'expired')),
        outcome TEXT CHECK(outcome IN ('JA', 'NEE', NULL)),
        total_pool INTEGER DEFAULT 0,
        month_key TEXT NOT NULL,
        message_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        created_by TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);
      CREATE INDEX IF NOT EXISTS idx_bets_month ON bets(month_key);
    `);
  } else {
    console.log('⏭️  Bestaat al: bets tabel');
  }
  
  // Bet entries tabel
  if (!tableNames.includes('bet_entries')) {
    console.log('✅ Aanmaken: bet_entries tabel');
    db.exec(`
      CREATE TABLE IF NOT EXISTS bet_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bet_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        choice TEXT NOT NULL CHECK(choice IN ('JA', 'NEE')),
        amount INTEGER NOT NULL DEFAULT 400,
        payout INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (bet_id) REFERENCES bets(id) ON DELETE CASCADE,
        UNIQUE(bet_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_bet_entries_bet ON bet_entries(bet_id);
      CREATE INDEX IF NOT EXISTS idx_bet_entries_user ON bet_entries(user_id);
    `);
  } else {
    console.log('⏭️  Bestaat al: bet_entries tabel');
  }
  
  // Shop inventory tabel
  if (!tableNames.includes('shop_inventory')) {
    console.log('✅ Aanmaken: shop_inventory tabel');
    db.exec(`
      CREATE TABLE IF NOT EXISTS shop_inventory (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        month_key TEXT NOT NULL,
        haribo_stock INTEGER DEFAULT 4,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT OR IGNORE INTO shop_inventory (id, month_key, haribo_stock) 
      VALUES (1, strftime('%Y-%m', 'now'), 4);
    `);
  } else {
    console.log('⏭️  Bestaat al: shop_inventory tabel');
  }
  
  // Shop purchases tabel
  if (!tableNames.includes('shop_purchases')) {
    console.log('✅ Aanmaken: shop_purchases tabel');
    db.exec(`
      CREATE TABLE IF NOT EXISTS shop_purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        item TEXT NOT NULL,
        price INTEGER NOT NULL,
        month_key TEXT NOT NULL,
        purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_shop_purchases_user ON shop_purchases(user_id);
      CREATE INDEX IF NOT EXISTS idx_shop_purchases_month ON shop_purchases(month_key);
    `);
  } else {
    console.log('⏭️  Bestaat al: shop_purchases tabel');
  }
  
  // Monthly reset log tabel
  if (!tableNames.includes('monthly_reset_log')) {
    console.log('✅ Aanmaken: monthly_reset_log tabel');
    db.exec(`
      CREATE TABLE IF NOT EXISTS monthly_reset_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month_key TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        final_balance INTEGER NOT NULL,
        position INTEGER,
        bonus_received INTEGER DEFAULT 0,
        reset_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } else {
    console.log('⏭️  Bestaat al: monthly_reset_log tabel');
  }
  
  db.close();
  
  console.log('\n🎉 Migratie voltooid!');
  console.log('\n📝 Vergeet niet om je config.json te updaten met:');
  console.log('   "CASINO_CHANNEL_ID": "1468608557279612998"');
  console.log('   "LOG_CHANNEL_ID": "1415603152400547862"');
  
} catch (error) {
  console.error('❌ Fout bij migratie:', error);
  process.exit(1);
}
