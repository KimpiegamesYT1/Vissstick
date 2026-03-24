/**
 * Daily math challenge module.
 * 1x per dag een rekensom in chat; eerste juiste antwoord wint punten.
 */

const { EmbedBuilder } = require('discord.js');
const { getDatabase } = require('../database');

const DEFAULT_REWARD_POINTS = 200;
const VALID_OPERATORS = ['+', '-', '*', '/'];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function getAmsterdamParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const byType = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') {
      byType[part.type] = part.value;
    }
  });

  const hourRaw = Number(byType.hour);
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: hourRaw === 24 ? 0 : hourRaw,
    minute: Number(byType.minute),
    second: Number(byType.second)
  };
}

function getDateKeyFromParts(parts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function getDateKeyAmsterdam(date = new Date()) {
  return getDateKeyFromParts(getAmsterdamParts(date));
}

function getCurrentMonthKey() {
  const parts = getAmsterdamParts();
  return `${parts.year}-${pad2(parts.month)}`;
}

function getCurrentTimeAmsterdam() {
  const parts = getAmsterdamParts();
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateExpression() {
  const operator = VALID_OPERATORS[randomInt(0, VALID_OPERATORS.length - 1)];

  if (operator === '+') {
    const a = randomInt(3, 90);
    const b = randomInt(3, 90);
    return {
      questionText: `${a} + ${b}`,
      answer: String(a + b)
    };
  }

  if (operator === '-') {
    const a = randomInt(20, 120);
    const b = randomInt(1, a - 1);
    return {
      questionText: `${a} - ${b}`,
      answer: String(a - b)
    };
  }

  if (operator === '*') {
    const a = randomInt(2, 15);
    const b = randomInt(2, 15);
    return {
      questionText: `${a} * ${b}`,
      answer: String(a * b)
    };
  }

  // Division only generates integer outcomes.
  const divisor = randomInt(2, 12);
  const quotient = randomInt(2, 15);
  const dividend = divisor * quotient;
  return {
    questionText: `${dividend} / ${divisor}`,
    answer: String(quotient)
  };
}

function normalizeAnswer(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().replace(',', '.');
  if (!trimmed) return null;

  // Only accept plain integer/decimal input, no formulas.
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;

  // Normalize 4.0 and 4 to the same string.
  return Number.isInteger(value) ? String(value) : String(value);
}

function getChallengeByDate(dateKey) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM daily_math_challenges WHERE challenge_date = ?').get(dateKey) || null;
}

function getActiveChallenge(channelId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT *
    FROM daily_math_challenges
    WHERE channel_id = ? AND status = 'active'
    ORDER BY id DESC
    LIMIT 1
  `).get(channelId) || null;
}

function createPendingChallenge({ dateKey, channelId, rewardPoints = DEFAULT_REWARD_POINTS, scheduledFor }) {
  const db = getDatabase();
  const existing = getChallengeByDate(dateKey);
  if (existing) return existing;

  const expression = generateExpression();
  db.prepare(`
    INSERT INTO daily_math_challenges
    (challenge_date, channel_id, question_text, correct_answer, reward_points, status, scheduled_for)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(dateKey, channelId, expression.questionText, expression.answer, rewardPoints, scheduledFor);

  return getChallengeByDate(dateKey);
}

function markChallengeSkipped(dateKey) {
  const db = getDatabase();
  db.prepare(`
    UPDATE daily_math_challenges
    SET status = 'skipped', ended_at = datetime('now')
    WHERE challenge_date = ? AND status = 'pending'
  `).run(dateKey);
}

function activateChallenge(dateKey, messageId) {
  const db = getDatabase();
  db.prepare(`
    UPDATE daily_math_challenges
    SET status = 'active', message_id = ?, started_at = datetime('now')
    WHERE challenge_date = ? AND status = 'pending'
  `).run(messageId, dateKey);

  return getChallengeByDate(dateKey);
}

function expireChallenge(dateKey) {
  const db = getDatabase();
  db.prepare(`
    UPDATE daily_math_challenges
    SET status = 'expired', ended_at = datetime('now')
    WHERE challenge_date = ? AND status IN ('pending', 'active')
  `).run(dateKey);

  return getChallengeByDate(dateKey);
}

function expireActiveChallenge(channelId) {
  const db = getDatabase();
  const active = getActiveChallenge(channelId);
  if (!active) return null;

  db.prepare(`
    UPDATE daily_math_challenges
    SET status = 'expired', ended_at = datetime('now')
    WHERE id = ? AND status = 'active'
  `).run(active.id);

  return getChallengeByDate(active.challenge_date);
}

function submitAnswer({ challengeId, userId, username, submittedAnswer }) {
  const db = getDatabase();

  const transaction = db.transaction(() => {
    const challenge = db.prepare('SELECT * FROM daily_math_challenges WHERE id = ?').get(challengeId);
    if (!challenge || challenge.status !== 'active') {
      return { success: false, reason: 'not-active', challenge };
    }

    const normalized = normalizeAnswer(submittedAnswer);
    if (normalized === null) {
      return { success: false, reason: 'invalid-input', challenge };
    }

    const isCorrect = normalized === challenge.correct_answer;
    if (!isCorrect) {
      return { success: false, reason: 'wrong-answer', challenge };
    }

    const result = db.prepare(`
      UPDATE daily_math_challenges
      SET status = 'won',
          ended_at = datetime('now'),
          winner_user_id = ?,
          winner_username = ?
      WHERE id = ? AND status = 'active'
    `).run(userId, username, challengeId);

    if (result.changes === 0) {
      return { success: false, reason: 'already-resolved', challenge };
    }

    const updated = db.prepare('SELECT * FROM daily_math_challenges WHERE id = ?').get(challengeId);
    return { success: true, reason: 'winner', challenge: updated };
  });

  return transaction();
}

function buildChallengeEmbed(questionText, rewardPoints = DEFAULT_REWARD_POINTS) {
  return new EmbedBuilder()
    .setTitle('Rekensom Reactietest')
    .setColor('#00A86B')
    .setDescription(`**Som:** ${questionText}\n\nTyp het juiste antwoord hieronder in de chat.\nEerste juiste antwoord wint **${rewardPoints}** punten.`)
    .setFooter({ text: 'Toegestane operators: +, -, *, /' })
    .setTimestamp();
}

function buildWinnerEmbed({ username, correctAnswer, rewardPoints }) {
  return new EmbedBuilder()
    .setTitle('Rekensom Gehaald')
    .setColor('#2E8B57')
    .setDescription(`**${username}** was het snelst en wint **${rewardPoints}** punten.\nJuiste antwoord: **${correctAnswer}**`)
    .setTimestamp();
}

function buildExpiredEmbed(correctAnswer) {
  return new EmbedBuilder()
    .setTitle('Rekensom Gesloten')
    .setColor('#FF8C00')
    .setDescription(`Niemand had op tijd het juiste antwoord.\nJuiste antwoord: **${correctAnswer}**`)
    .setTimestamp();
}

module.exports = {
  DEFAULT_REWARD_POINTS,
  getDateKeyAmsterdam,
  getCurrentTimeAmsterdam,
  getCurrentMonthKey,
  normalizeAnswer,
  getChallengeByDate,
  getActiveChallenge,
  createPendingChallenge,
  markChallengeSkipped,
  activateChallenge,
  expireChallenge,
  expireActiveChallenge,
  submitAnswer,
  buildChallengeEmbed,
  buildWinnerEmbed,
  buildExpiredEmbed
};
