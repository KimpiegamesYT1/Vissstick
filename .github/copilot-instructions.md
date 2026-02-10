# Vissstick Discord Bot - AI Coding Guidelines

## Architecture Overview

This is a **Discord.js v14** bot with **SQLite database** (better-sqlite3) for "Het HOK van Syntaxis". Four main systems:

1. **Hok Monitoring** - Polls external API for open/closed status, adapts check intervals (5min open / 1min closed / 15min night)
2. **Daily Quiz** - Scheduled at 07:00, answers revealed at 17:00, awards 150 casino points per correct answer
3. **Casino System** - Prediction market with 400pt fixed bets (JA/NEE), 10% tax, Double-or-Nothing mini-game
4. **Audio Player** - Voice channel MP3 playback using @discordjs/voice

## Critical Patterns

### Database Access Pattern
**ALWAYS** use the singleton pattern from [`database/index.js`](database/index.js):
```javascript
const { getDatabase } = require('../database');
const db = getDatabase();
```
Never create new Database instances. All queries use synchronous better-sqlite3 API (`.run()`, `.get()`, `.all()`).

### Module Structure
- [`bot.js`](bot.js) - Main entry point with cron jobs, event handlers, command registration
- [`modules/`](modules/) - Business logic (casino, quiz, hok, chatResponses)
- [`commands/`](commands/) - Slash command definitions and handlers (index.js combines all)
- [`database/`](database/) - Schema and database utilities

**Handler Pattern**: Each command module exports `{commands: [], handleCommands()}`. The [`commands/index.js`](commands/index.js) aggregates all and tries handlers sequentially until one returns `true`.

### Active State Management
Quiz and bet interactions use **ephemeral state**:
- Quizzes: `active_quizzes` table tracks message_id → question mapping
- Double-or-Nothing: `activeDoNGames` Map in memory with 2min timeout
- Bets: Status in `bets` table, buttons remain on messages until resolved

**CRITICAL**: Check for existing active quiz before starting a new one (`quiz.getActiveQuiz(channelId)`). This prevents daily quiz from starting if test quiz is running.

### Cron Schedule (Europe/Amsterdam timezone)
```javascript
'0 7 * * *'   → Daily quiz start
'0 17 * * *'  → Daily quiz end & reveal answers
'0 18 28-31 * *' → Monthly scoreboard (last day check)
'1 0 1 * *'   → Monthly reset (top 3 get bonuses: 2000/1000/500 pts)
```

**Known Issue**: If bot is offline when quiz should end (17:00), the quiz stays "active" in DB and blocks next day's 07:00 quiz. No auto-recovery implemented yet.

### Config System
All IDs in [`config.json`](config.json) (not committed, see [`config.example.json`](config.example.json)):
- `CHANNEL_ID` - Hok status channel
- `QUIZ_CHANNEL_ID` - Daily quiz
- `CASINO_CHANNEL_ID` - Casino status embed + bet announcements
- `LOG_CHANNEL_ID` - Admin action logs
- `SCOREBOARD_CHANNEL_ID` - Monthly scoreboard

### Casino Economics
```javascript
BET_AMOUNT = 400       // Fixed per bet
TAX_RATE = 0.10        // 10% of winnings
MAX_PAYOUT = 1200      // 3x bet cap
HARIBO_PRICE = 5000    // Shop item
QUIZ_REWARD = 150      // Per correct answer
```

**Payout Logic**: Winners split losing pot proportionally, minus 10% tax. See [`casino.resolveBet()`](modules/casino.js) for complex distribution algorithm.

### Quiz Import System
Place questions in root `quiz-import.json` (array format):
```json
[{"vraag": "...", "opties": {"A": "...", "B": "...", "C": "...", "D": "..."}, "antwoord": "B"}]
```
On bot startup, `quiz.importQuestionsFromJson()` ingests and empties the file automatically.

## Development Workflow

**Start bot**: `npm start` (or `./startscript` on server - handles backups + git pull)

**Database inspection**: 
```bash
sqlite3 bot.db ".schema"  # View structure
sqlite3 bot.db "SELECT * FROM active_quizzes"  # Check stuck quizzes
```

**Testing quiz without waiting**:
```
/admin quiz test tijd:1  # 1-minute test quiz
```

**Reset commands** (`/admin quiz reset`):
- `database` - Wipe all questions (irreversible!)
- `used` - Reset `is_used=0` to reuse questions

## Common Pitfalls

1. **Quiz Stuck**: Active quiz in DB blocks new quiz. No command to force-end exists—manually DELETE from `active_quizzes` table.

2. **Button Interactions**: All buttons must check `interaction.user.id` matches game owner. Double-or-Nothing uses `don_{action}_{gameId}` format.

3. **Balance Transactions**: Use `casino.addBalance()` / `casino.subtractBalance()` for atomicity. Always pass `(userId, username, amount, reason)`.

4. **Embed Updates**: Casino status embed is searched and edited in-place. If message not found, posts new embed. See `updateCasinoEmbed()` in [`casinoCommands.js`](commands/casinoCommands.js).

5. **Admin Permissions**: Check `interaction.member.permissions.has('Administrator')` before admin operations. Regular `/balance <user>` also requires admin.

## Key Files Reference

- [`database/schema.sql`](database/schema.sql) - Complete table definitions
- [`modules/casino.js`](modules/casino.js) - All economy logic (740 lines)
- [`modules/quiz.js`](modules/quiz.js) - Quiz lifecycle (845 lines)
- [`modules/hok.js`](modules/hok.js) - Polling logic with dynamic intervals
- [`commands/casinoCommands.js`](commands/casinoCommands.js) - Casino slash commands + button handlers

## Testing Edge Cases

- Bet resolution when only one side has bets (no losers to pay winners)
- Quiz timeout during active quiz (should refund points but doesn't currently)
- Multiple users clicking Double-or-Nothing buttons (enforces single-user ownership)
- Monthly reset on months with 28/29/30/31 days (cron checks if tomorrow.getDate() === 1)
