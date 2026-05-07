const { getDatabase } = require('../database');

function parseCountInput(content) {
  if (typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

function ensureState(db, channelId) {
  let state = db.prepare(`
    SELECT channel_id, current_number, last_user_id, last_message_id
    FROM counting_state
    WHERE channel_id = ?
  `).get(channelId);

  if (!state) {
    db.prepare(`
      INSERT INTO counting_state (channel_id, current_number)
      VALUES (?, 0)
    `).run(channelId);

    state = {
      channel_id: channelId,
      current_number: 0,
      last_user_id: null,
      last_message_id: null
    };
  }

  return state;
}

function resetState(db, channelId) {
  db.prepare(`
    UPDATE counting_state
    SET current_number = 0,
        last_user_id = NULL,
        last_message_id = NULL,
        last_updated = CURRENT_TIMESTAMP
    WHERE channel_id = ?
  `).run(channelId);
}

function updateState(db, channelId, number, userId, messageId) {
  db.prepare(`
    UPDATE counting_state
    SET current_number = ?,
        last_user_id = ?,
        last_message_id = ?,
        last_updated = CURRENT_TIMESTAMP
    WHERE channel_id = ?
  `).run(number, userId, messageId, channelId);
}

function buildResetMessage(result) {
  const expectedText = result.expected ? ` Verwacht: ${result.expected}.` : '';

  if (result.status === 'same-user') {
    return `Fout! Je mag niet twee keer achter elkaar tellen.${expectedText} We beginnen opnieuw bij 1.`;
  }

  if (result.status === 'invalid') {
    return `Fout! Alleen positieve hele getallen.${expectedText} We beginnen opnieuw bij 1.`;
  }

  return `Fout!${expectedText} We beginnen opnieuw bij 1.`;
}

function processCountingMessage({ channelId, userId, messageId, inputNumber }) {
  const db = getDatabase();

  const transaction = db.transaction(() => {
    const state = ensureState(db, channelId);
    const expected = state.current_number + 1;

    if (!inputNumber) {
      resetState(db, channelId);
      return { status: 'invalid', expected };
    }

    if (state.last_user_id && state.last_user_id === userId) {
      resetState(db, channelId);
      return { status: 'same-user', expected };
    }

    if (inputNumber !== expected) {
      resetState(db, channelId);
      return { status: 'wrong-number', expected, received: inputNumber };
    }

    updateState(db, channelId, inputNumber, userId, messageId);
    return { status: 'correct', number: inputNumber };
  });

  return transaction();
}

async function handleCountingMessage(message, channelId) {
  if (!channelId || message.channel.id !== channelId) return false;
  if (message.author.bot) return true;

  const inputNumber = parseCountInput(message.content);
  const result = processCountingMessage({
    channelId,
    userId: message.author.id,
    messageId: message.id,
    inputNumber
  });

  if (result.status === 'correct') {
    return true;
  }

  const resetMessage = buildResetMessage(result);
  await message.reply({
    content: resetMessage,
    allowedMentions: { repliedUser: false }
  }).catch((error) => {
    console.error('[TELLEN] Kon reset bericht niet sturen:', error);
  });

  return true;
}

module.exports = {
  handleCountingMessage
};
