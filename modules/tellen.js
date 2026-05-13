const { EmbedBuilder } = require('discord.js');
const { getDatabase } = require('../database');

let schemaEnsured = false;

function parseCountInput(content) {
  if (typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

function ensureCountingSchema(db) {
  if (schemaEnsured) return;

  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'counting_state'
  `).get();

  if (!tableExists) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS counting_state (
        channel_id TEXT PRIMARY KEY,
        current_number INTEGER NOT NULL DEFAULT 0,
        fail_count INTEGER NOT NULL DEFAULT 0,
        highest_number INTEGER NOT NULL DEFAULT 0,
        last_user_id TEXT,
        last_message_id TEXT,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    schemaEnsured = true;
    return;
  }

  const columns = db.prepare('PRAGMA table_info(counting_state)').all();
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('fail_count')) {
    db.prepare('ALTER TABLE counting_state ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0').run();
  }

  if (!columnNames.has('highest_number')) {
    db.prepare('ALTER TABLE counting_state ADD COLUMN highest_number INTEGER NOT NULL DEFAULT 0').run();
  }

  schemaEnsured = true;
}

function ensureState(db, channelId) {
  ensureCountingSchema(db);
  let state = db.prepare(`
    SELECT channel_id, current_number, fail_count, highest_number, last_user_id, last_message_id
    FROM counting_state
    WHERE channel_id = ?
  `).get(channelId);

  if (!state) {
    db.prepare(`
      INSERT INTO counting_state (channel_id, current_number, fail_count, highest_number)
      VALUES (?, 0, 0, 0)
    `).run(channelId);

    state = {
      channel_id: channelId,
      current_number: 0,
      fail_count: 0,
      highest_number: 0,
      last_user_id: null,
      last_message_id: null
    };
  }

  return state;
}

function recordFailure(db, channelId) {
  db.prepare(`
    UPDATE counting_state
    SET current_number = 0,
        fail_count = fail_count + 1,
        last_user_id = NULL,
        last_message_id = NULL,
        last_updated = CURRENT_TIMESTAMP
    WHERE channel_id = ?
  `).run(channelId);
}

function updateState(db, channelId, number, userId, messageId, highestNumber) {
  db.prepare(`
    UPDATE counting_state
    SET current_number = ?,
        highest_number = ?,
        last_user_id = ?,
        last_message_id = ?,
        last_updated = CURRENT_TIMESTAMP
    WHERE channel_id = ?
  `).run(number, highestNumber, userId, messageId, channelId);
}

function buildResetEmbed(result, rawInput, userId) {
  const embed = new EmbedBuilder()
    .setTitle('Tellen reset')
    .setColor('#E74C3C')
    .setFooter({ text: 'Stuur 1 om opnieuw te starten.' })
    .setTimestamp();

  let description = 'Er ging iets mis met het tellen.';

  if (result.status === 'same-user') {
    description = 'Je mag niet twee keer achter elkaar tellen. Laat iemand anders de volgende beurt doen.';
  } else if (result.status === 'invalid') {
    description = 'Alleen positieve hele getallen tellen mee.';
  } else if (result.status === 'wrong-number') {
    description = 'Dit nummer klopt niet in de reeks.';
  }

  embed.setDescription(`${description}\nWe starten opnieuw bij 1.`);

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

  fields.unshift({ name: 'Fout door', value: `<@${userId}>`, inline: true });
  fields.push({ name: 'Bereikt getal', value: String(result.reachedNumber), inline: true });
  fields.push({ name: 'Aantal fails', value: String(result.failCount), inline: true });
  fields.push({ name: 'Record (hoogste ooit)', value: String(result.highestNumber), inline: true });

  embed.addFields(fields);

  return embed;
}

function processCountingMessage({ channelId, userId, messageId, inputNumber }) {
  const db = getDatabase();

  const transaction = db.transaction(() => {
    const state = ensureState(db, channelId);
    const expected = state.current_number + 1;
    const reachedNumber = state.current_number;
    const highestNumber = Number(state.highest_number || 0);
    const failCount = Number(state.fail_count || 0);

    if (state.current_number === 0 && inputNumber !== 1) {
      return { status: 'awaiting-start' };
    }

    if (!inputNumber) {
      recordFailure(db, channelId);
      return {
        status: 'invalid',
        expected,
        reachedNumber,
        highestNumber,
        failCount: failCount + 1
      };
    }

    if (state.last_user_id && state.last_user_id === userId) {
      recordFailure(db, channelId);
      return {
        status: 'same-user',
        expected,
        reachedNumber,
        highestNumber,
        failCount: failCount + 1
      };
    }

    if (inputNumber !== expected) {
      recordFailure(db, channelId);
      return {
        status: 'wrong-number',
        expected,
        received: inputNumber,
        reachedNumber,
        highestNumber,
        failCount: failCount + 1
      };
    }

    const newHighest = Math.max(highestNumber, inputNumber);
    updateState(db, channelId, inputNumber, userId, messageId, newHighest);
    return { status: 'correct', number: inputNumber, highestNumber: newHighest };
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
    await message.react('✅').catch((error) => {
      console.error('[TELLEN] Kon checkmark reactie niet plaatsen:', error);
    });
    return true;
  }

  if (result.status === 'awaiting-start') {
    await message.react('⏰').catch((error) => {
      console.error('[TELLEN] Kon klokje reactie niet plaatsen:', error);
    });
    return true;
  }

  const resetEmbed = buildResetEmbed(result, message.content, message.author.id);
  await message.reply({
    embeds: [resetEmbed],
    allowedMentions: { repliedUser: false, users: [] }
  }).catch((error) => {
    console.error('[TELLEN] Kon reset bericht niet sturen:', error);
  });

  return true;
}

module.exports = {
  handleCountingMessage
};
