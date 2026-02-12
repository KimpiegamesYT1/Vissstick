/**
 * Migration script om chatbot tables toe te voegen
 * Run met: node migrate-chatbot.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'bot.db');

console.log('🔧 Starting chatbot tables migration...');

try {
    const db = new Database(DB_PATH);
    
    // Check of tables al bestaan
    const existingTables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name LIKE 'chatbot%'
    `).all();
    
    if (existingTables.length > 0) {
        console.log('⚠️  Chatbot tables bestaan al:');
        existingTables.forEach(t => console.log(`   - ${t.name}`));
        console.log('✅ Migration niet nodig!');
        db.close();
        process.exit(0);
    }
    
    console.log('📊 Creating chatbot_conversations table...');
    db.exec(`
        CREATE TABLE IF NOT EXISTS chatbot_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_message_at INTEGER NOT NULL,
            total_tokens INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived'))
        );
    `);
    
    console.log('📊 Creating chatbot_messages table...');
    db.exec(`
        CREATE TABLE IF NOT EXISTS chatbot_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            user_id TEXT,
            username TEXT,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
            content TEXT NOT NULL,
            tokens INTEGER DEFAULT 0,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES chatbot_conversations(id) ON DELETE CASCADE
        );
    `);
    
    console.log('📊 Creating indexes...');
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chatbot_conversations_status 
        ON chatbot_conversations(status, last_message_at);
    `);
    
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chatbot_messages_conversation 
        ON chatbot_messages(conversation_id, timestamp);
    `);
    
    // Verify tables are created
    const newTables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name LIKE 'chatbot%'
    `).all();
    
    console.log('✅ Migration completed successfully!');
    console.log('📋 Created tables:');
    newTables.forEach(t => console.log(`   - ${t.name}`));
    
    db.close();
    console.log('🎉 Chatbot module is ready to use!');
    
} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
}
