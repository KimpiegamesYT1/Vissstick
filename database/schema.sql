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

-- Indexes voor betere performance
CREATE INDEX IF NOT EXISTS idx_quiz_questions_used ON quiz_questions(is_used);
CREATE INDEX IF NOT EXISTS idx_quiz_scores_month ON quiz_scores(month_key);
CREATE INDEX IF NOT EXISTS idx_quiz_scores_user ON quiz_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_channel ON quiz_responses(channel_id);
CREATE INDEX IF NOT EXISTS idx_hok_status_date ON hok_status_log(date_key);
CREATE INDEX IF NOT EXISTS idx_hok_status_logged ON hok_status_log(logged_at);

-- Initialiseer hok state met standaard waarden
INSERT OR IGNORE INTO hok_state (id, is_open) VALUES (1, 0);
