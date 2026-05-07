const { EmbedBuilder } = require('discord.js');
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

function buildResetEmbed(result, rawInput) {
  const embed = new EmbedBuilder()
    .setTitle('Tellen reset')
    .setColor('#E74C3C')
    .setFooter({ text: 'We starten opnieuw bij 1.' })
    .setTimestamp();

  let description = 'Er ging iets mis met het tellen.';

  if (result.status === 'same-user') {
    description = 'Je mag niet twee keer achter elkaar tellen. Laat iemand anders de volgende beurt doen.';
  } else if (result.status === 'invalid') {
    description = 'Alleen positieve hele getallen tellen mee.';
  } else if (result.status === 'wrong-number') {
    description = 'Dit nummer klopt niet in de reeks.';
  }

  embed.setDescription(description);

  const fields = [];
  if (result.expected) {
    fields.push({ name: 'Verwacht', value: String(result.expected), inline: true });
  }

  if (result.status === 'wrong-number' && result.received != null) {
    fields.push({ name: 'Jouw invoer', value: String(result.received), inline: true });
  } else if (result.status === 'invalid' && rawInput) {
    const trimmedInput = String(rawInput).trim();
    if (trimmedInput) {
      fields.push({ name: 'Jouw invoer', value: trimmedInput.slice(0, 200), inline: false });
    }
  }

  if (fields.length > 0) {
    embed.addFields(fields);
  }

  return embed;
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

  const resetEmbed = buildResetEmbed(result, message.content);
  await message.reply({
    embeds: [resetEmbed],
    allowedMentions: { repliedUser: false }
  }).catch((error) => {
    console.error('[TELLEN] Kon reset bericht niet sturen:', error);
  });

  return true;
}

module.exports = {
  handleCountingMessage
};
