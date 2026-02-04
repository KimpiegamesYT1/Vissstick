-- Vissstick Discord Bot Database Schema
-- SQLite database voor veilige en schaalbare data opslag

-- Quiz vragen (master lijst)
CREATE TABLE IF NOT EXISTS quiz_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vraag TEXT NOT NULL,
    optie_a TEXT NOT NULL,
    optie_b TEXT NOT NULL,
    optie_c TEXT NOT NULL,
    optie_d TEXT NOT NULL,
    correct_antwoord TEXT NOT NULL CHECK(correct_antwoord IN ('A','B','C','D')),
    is_used BOOLEAN DEFAULT 0,
    used_date DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Actieve quizzes
CREATE TABLE IF NOT EXISTS active_quizzes (
    channel_id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    question_id INTEGER NOT NULL,
    is_test_quiz BOOLEAN DEFAULT 0,
    timeout_minutes INTEGER,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (question_id) REFERENCES quiz_questions(id)
);

-- Quiz antwoorden (responses)
CREATE TABLE IF NOT EXISTS quiz_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    answer TEXT NOT NULL CHECK(answer IN ('A','B','C','D')),
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (channel_id) REFERENCES active_quizzes(channel_id) ON DELETE CASCADE,
    UNIQUE(channel_id, user_id)
);

-- Quiz scores (maandelijks en all-time)
CREATE TABLE IF NOT EXISTS quiz_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    month_key TEXT NOT NULL, -- Format: YYYY-MM (of 'all-time')
    correct_count INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, month_key)
);

-- Hok status history
CREATE TABLE IF NOT EXISTS hok_status_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_key TEXT NOT NULL, -- Format: YYYY-MM-DD
    time_logged TEXT NOT NULL, -- Format: HH:MM
    is_opening BOOLEAN NOT NULL, -- TRUE = opening, FALSE = closing
    logged_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Hok state (huidige status)
CREATE TABLE IF NOT EXISTS hok_state (
    id INTEGER PRIMARY KEY CHECK(id = 1), -- Altijd maar 1 rij
    is_open BOOLEAN NOT NULL,
    last_message_id TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Notificatie subscriptions (voor bell emoji)
CREATE TABLE IF NOT EXISTS hok_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- =====================================================
-- ECONOMIE & CASINO SYSTEEM
-- =====================================================

-- Users tabel voor economie (balance tracking)
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    balance INTEGER DEFAULT 0,
    total_earned INTEGER DEFAULT 0,
    total_spent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Bets tabel (actieve en afgesloten weddenschappen)
CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed', 'resolved', 'expired')),
    outcome TEXT CHECK(outcome IN ('JA', 'NEE', NULL)),
    total_pool INTEGER DEFAULT 0,
    month_key TEXT NOT NULL, -- Format: YYYY-MM
    message_id TEXT, -- Discord message ID voor embed updates
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    created_by TEXT NOT NULL
);

-- Bet entries (individuele inzetten)
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

-- Shop voorraad per maand
CREATE TABLE IF NOT EXISTS shop_inventory (
    id INTEGER PRIMARY KEY CHECK(id = 1), -- Altijd maar 1 rij
    month_key TEXT NOT NULL, -- Format: YYYY-MM
    haribo_stock INTEGER DEFAULT 4,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Aankoop geschiedenis
CREATE TABLE IF NOT EXISTS shop_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    item TEXT NOT NULL,
    price INTEGER NOT NULL,
    month_key TEXT NOT NULL,
    purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Maandelijkse reset log (voor top 3 bonussen)
CREATE TABLE IF NOT EXISTS monthly_reset_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month_key TEXT NOT NULL, -- De maand die gereset werd
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    final_balance INTEGER NOT NULL,
    position INTEGER, -- 1, 2, 3 voor top 3
    bonus_received INTEGER DEFAULT 0,
    reset_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- INDEXES
-- =====================================================

-- Quiz indexes
CREATE INDEX IF NOT EXISTS idx_quiz_questions_used ON quiz_questions(is_used);
CREATE INDEX IF NOT EXISTS idx_quiz_scores_month ON quiz_scores(month_key);
CREATE INDEX IF NOT EXISTS idx_quiz_scores_user ON quiz_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_channel ON quiz_responses(channel_id);

-- Hok indexes
CREATE INDEX IF NOT EXISTS idx_hok_status_date ON hok_status_log(date_key);
CREATE INDEX IF NOT EXISTS idx_hok_status_logged ON hok_status_log(logged_at);

-- Economie & Casino indexes
CREATE INDEX IF NOT EXISTS idx_users_balance ON users(balance DESC);
CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);
CREATE INDEX IF NOT EXISTS idx_bets_month ON bets(month_key);
CREATE INDEX IF NOT EXISTS idx_bet_entries_bet ON bet_entries(bet_id);
CREATE INDEX IF NOT EXISTS idx_bet_entries_user ON bet_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_purchases_user ON shop_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_purchases_month ON shop_purchases(month_key);

-- =====================================================
-- INITIAL DATA
-- =====================================================

-- Initialiseer hok state met standaard waarden
INSERT OR IGNORE INTO hok_state (id, is_open) VALUES (1, 0);

-- Initialiseer shop inventory
INSERT OR IGNORE INTO shop_inventory (id, month_key, haribo_stock) 
VALUES (1, strftime('%Y-%m', 'now'), 4);
