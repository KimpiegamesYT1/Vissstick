/**
 * Quiz module - volledig omgebouwd naar SQLite database
 * Alle quiz functionaliteit met veilige database operaties
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getDatabase } = require('../database');

const EMOJI_MAP = {
  'A': '🇦',
  'B': '🇧', 
  'C': '🇨',
  'D': '🇩'
};

/**
 * Get current month key (YYYY-MM)
 */
function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Haal een random ongebruikte quiz vraag op
 */
function getRandomUnusedQuestion() {
  const db = getDatabase();
  
  // Tel totaal aantal vragen
  const totalCount = db.prepare('SELECT COUNT(*) as count FROM quiz_questions').get().count;
  
  // Haal alle ongebruikte vragen op
  const unusedQuestions = db.prepare(`
    SELECT * FROM quiz_questions 
    WHERE is_used = 0
  `).all();
  
  if (unusedQuestions.length === 0) {
    return { question: null, totalCount, availableCount: 0 };
  }
  
  // Selecteer random vraag
  const randomIndex = Math.floor(Math.random() * unusedQuestions.length);
  const question = unusedQuestions[randomIndex];
  
  return { 
    question, 
    totalCount, 
    availableCount: unusedQuestions.length 
  };
}

/**
 * Markeer een vraag als gebruikt
 */
function markQuestionAsUsed(questionId) {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    UPDATE quiz_questions 
    SET is_used = 1, used_date = datetime('now')
    WHERE id = ?
  `);
  
  stmt.run(questionId);
}

/**
 * Reset alle gebruikte vragen
 */
function resetUsedQuestions() {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    UPDATE quiz_questions 
    SET is_used = 0, used_date = NULL
  `);
  
  const result = stmt.run();
  return result.changes;
}

/**
 * Sla een actieve quiz op
 */
function saveActiveQuiz(channelId, messageId, questionId, isTestQuiz = false, timeoutMinutes = null) {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO active_quizzes 
    (channel_id, message_id, question_id, is_test_quiz, timeout_minutes)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stmt.run(channelId, messageId, questionId, isTestQuiz ? 1 : 0, timeoutMinutes);
}

/**
 * Haal actieve quiz op voor een kanaal
 */
function getActiveQuiz(channelId) {
  const db = getDatabase();
  
  const quiz = db.prepare(`
    SELECT 
      aq.*,
      qq.vraag,
      qq.optie_a,
      qq.optie_b,
      qq.optie_c,
      qq.optie_d,
      qq.correct_antwoord
    FROM active_quizzes aq
    JOIN quiz_questions qq ON aq.question_id = qq.id
    WHERE aq.channel_id = ?
  `).get(channelId);
  
  if (!quiz) return null;
  
  // Haal ook alle responses op
  const responses = db.prepare(`
    SELECT user_id, username, answer, submitted_at
    FROM quiz_responses
    WHERE channel_id = ?
  `).all(channelId);
  
  // Converteer naar object met user_id als key
  const responsesObj = {};
  responses.forEach(r => {
    responsesObj[r.user_id] = {
      answer: r.answer,
      username: r.username,
      submitted_at: r.submitted_at
    };
  });
  
  return {
    ...quiz,
    responses: responsesObj,
    opties: {
      A: quiz.optie_a,
      B: quiz.optie_b,
      C: quiz.optie_c,
      D: quiz.optie_d
    }
  };
}

/**
 * Sla een quiz response op
 */
function saveQuizResponse(channelId, userId, username, answer) {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO quiz_responses 
    (channel_id, user_id, username, answer)
    VALUES (?, ?, ?, ?)
  `);
  
  stmt.run(channelId, userId, username, answer);
}

/**
 * Verwijder een quiz response
 */
function deleteQuizResponse(channelId, userId) {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    DELETE FROM quiz_responses
    WHERE channel_id = ? AND user_id = ?
  `);
  
  stmt.run(channelId, userId);
}

/**
 * Tel aantal responses voor een quiz
 */
function countQuizResponses(channelId) {
  const db = getDatabase();
  
  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM quiz_responses
    WHERE channel_id = ?
  `).get(channelId);
  
  return result.count;
}

/**
 * Update scores na afloop van een quiz
 */
function updateScores(responses, correctAnswer) {
  const db = getDatabase();
  const monthKey = getCurrentMonthKey();
  
  const monthlyStmt = db.prepare(`
    INSERT INTO quiz_scores (user_id, username, month_key, correct_count, total_count)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(user_id, month_key) DO UPDATE SET
      correct_count = correct_count + ?,
      total_count = total_count + 1,
      username = excluded.username,
      last_updated = datetime('now')
  `);
  
  const allTimeStmt = db.prepare(`
    INSERT INTO quiz_scores (user_id, username, month_key, correct_count, total_count)
    VALUES (?, ?, 'all-time', ?, 1)
    ON CONFLICT(user_id, month_key) DO UPDATE SET
      correct_count = correct_count + ?,
      total_count = total_count + 1,
      username = excluded.username,
      last_updated = datetime('now')
  `);
  
  // Transaction voor atomiciteit
  const transaction = db.transaction((responses) => {
    Object.entries(responses).forEach(([userId, response]) => {
      const isCorrect = response.answer === correctAnswer ? 1 : 0;
      
      // Update monthly scores
      monthlyStmt.run(userId, response.username, monthKey, isCorrect, isCorrect);
      
      // Update all-time scores
      allTimeStmt.run(userId, response.username, isCorrect, isCorrect);
    });
  });
  
  transaction(responses);
}

/**
 * Haal quiz scores op voor een specifieke maand
 */
function getQuizScores(monthKey = null) {
  const db = getDatabase();
  
  const key = monthKey || getCurrentMonthKey();
  
  const scores = db.prepare(`
    SELECT user_id, username, correct_count, total_count
    FROM quiz_scores
    WHERE month_key = ?
    ORDER BY correct_count DESC, total_count ASC
  `).all(key);
  
  return scores;
}

/**
 * Verwijder een actieve quiz en alle responses
 */
function deleteActiveQuiz(channelId) {
  const db = getDatabase();
  
  // Responses worden automatisch verwijderd door CASCADE
  const stmt = db.prepare(`
    DELETE FROM active_quizzes
    WHERE channel_id = ?
  `);
  
  stmt.run(channelId);
}

/**
 * Start daily quiz
 */
async function startDailyQuiz(client, channelId, timeoutMinutes = null) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return console.error('Quiz kanaal niet gevonden!');

    const { question, totalCount, availableCount } = getRandomUnusedQuestion();
    
    if (totalCount === 0) {
      return console.error('Geen quiz vragen beschikbaar in database!');
    }
    
    // Check if all questions have been used
    if (!question) {
      const embed = new EmbedBuilder()
        .setTitle('📝 Dagelijkse Quiz')
        .setDescription('🎉 **Alle quiz vragen zijn gebruikt!**\n\nEr zijn geen nieuwe vragen meer beschikbaar. Een administrator kan de vragenlijst resetten met `/resetquiz`.')
        .setColor('#ffa500')
        .setFooter({ text: `Totaal aantal vragen: ${totalCount}` });

      await channel.send({ embeds: [embed] });
      return console.log('Alle quiz vragen zijn gebruikt!');
    }

    console.log(`Quiz selectie: ${availableCount} beschikbare vragen`);
    console.log(`Geselecteerde vraag ID: ${question.id} - "${question.vraag.substring(0, 50)}..."`);
    
    // Create embed with appropriate footer message
    const footerText = timeoutMinutes 
      ? `Test quiz eindigt na ${timeoutMinutes} minuten. ${availableCount} vragen over • 0 antwoorden`
      : `Antwoord wordt om 17:00 bekendgemaakt. ${availableCount} vragen over • 0 antwoorden`;

    const embed = new EmbedBuilder()
      .setTitle('📝 Dagelijkse Quiz!')
      .setDescription(question.vraag)
      .setColor('#0099ff')
      .setFooter({ text: footerText });

    // Create button components
    const opties = {
      A: question.optie_a,
      B: question.optie_b,
      C: question.optie_c,
      D: question.optie_d
    };

    const buttons = Object.keys(opties).map(letter => 
      new ButtonBuilder()
        .setCustomId(`quiz_${letter}`)
        .setLabel(opties[letter])
        .setEmoji(EMOJI_MAP[letter])
        .setStyle(ButtonStyle.Primary)
    );

    // Split buttons into rows (max 5 buttons per row)
    const actionRows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      const row = new ActionRowBuilder()
        .addComponents(buttons.slice(i, i + 5));
      actionRows.push(row);
    }

    const message = await channel.send({ 
      embeds: [embed], 
      components: actionRows 
    });
    console.log(`Quiz bericht verzonden met ID: ${message.id}`);

    // Save active quiz in database
    saveActiveQuiz(channelId, message.id, question.id, timeoutMinutes !== null, timeoutMinutes);
    console.log(`Quiz data opgeslagen in database voor kanaal ${channelId}`);

    // Set timeout for test quiz
    if (timeoutMinutes) {
      setTimeout(async () => {
        try {
          console.log(`Test quiz timeout na ${timeoutMinutes} minuten`);
          await endDailyQuiz(client, channelId);
          console.log('Quiz succesvol beëindigd via timeout');
        } catch (error) {
          console.error('Fout bij timeout beëindigen quiz:', error);
        }
      }, timeoutMinutes * 60 * 1000);
      
      console.log(`Test quiz gestart! Eindigt automatisch na ${timeoutMinutes} minuten.`);
    } else {
      console.log(`Dagelijkse quiz gestart! ${availableCount} vragen over.`);
    }
  } catch (error) {
    console.error('Fout bij starten quiz:', error);
  }
}

/**
 * Helper function to update quiz message
 */
async function updateQuizMessage(message, channelId) {
  try {
    const activeQuiz = getActiveQuiz(channelId);
    
    if (!activeQuiz) return;
    
    const { availableCount } = getRandomUnusedQuestion();
    const responseCount = Object.keys(activeQuiz.responses).length;
    
    // Different footer text for test quiz vs regular quiz
    const footerText = activeQuiz.is_test_quiz 
      ? `Test quiz eindigt na ${activeQuiz.timeout_minutes} minuten. ${availableCount} vragen over • ${responseCount} antwoorden`
      : `Antwoord wordt om 17:00 bekendgemaakt. ${availableCount} vragen over • ${responseCount} antwoorden`;
    
    const embed = new EmbedBuilder()
      .setTitle('📝 Dagelijkse Quiz!')
      .setDescription(activeQuiz.vraag)
      .setColor('#0099ff')
      .setFooter({ text: footerText });

    // Create updated buttons
    const buttons = Object.keys(activeQuiz.opties).map(letter => {
      return new ButtonBuilder()
        .setCustomId(`quiz_${letter}`)
        .setLabel(activeQuiz.opties[letter])
        .setEmoji(EMOJI_MAP[letter])
        .setStyle(ButtonStyle.Primary);
    });

    // Split buttons into rows
    const actionRows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      const row = new ActionRowBuilder()
        .addComponents(buttons.slice(i, i + 5));
      actionRows.push(row);
    }

    await message.edit({ 
      embeds: [embed], 
      components: actionRows 
    });
  } catch (err) {
    console.error('Fout bij updaten quiz bericht:', err);
  }
}

/**
 * Handle quiz button interactions
 */
async function handleQuizButton(interaction) {
  console.log(`handleQuizButton aangeroepen: customId=${interaction.customId}`);
  
  if (!interaction.customId.startsWith('quiz_')) {
    console.log('CustomId start niet met quiz_');
    return false;
  }

  const letter = interaction.customId.split('_')[1];
  const user = interaction.user;

  console.log(`Quiz button geklikt: ${user.username} -> ${letter}`);

  try {
    const activeQuiz = getActiveQuiz(interaction.channelId);
    
    if (!activeQuiz || activeQuiz.message_id !== interaction.message.id) {
      await interaction.reply({ 
        content: '❌ Deze quiz is niet meer actief!', 
        ephemeral: true 
      });
      return true;
    }

    // Check if user already has an answer
    const previousAnswer = activeQuiz.responses[user.id]?.answer;
    
    if (previousAnswer === letter) {
      // User clicked same button - remove their answer
      deleteQuizResponse(interaction.channelId, user.id);
      console.log(`Antwoord verwijderd: ${user.username}`);
      
      await interaction.reply({ 
        content: `❌ Antwoord **${letter}** verwijderd!`, 
        ephemeral: true 
      });
    } else {
      // Save the new answer
      saveQuizResponse(interaction.channelId, user.id, user.username, letter);
      console.log(`Antwoord opgeslagen: ${user.username} = ${letter}`);
      
      const optionText = activeQuiz.opties[letter];
      await interaction.reply({ 
        content: `✅ Antwoord **${letter}: ${optionText}** opgeslagen!`, 
        ephemeral: true 
      });
    }

    // Update the message footer with current response count
    setTimeout(async () => {
      try {
        await updateQuizMessage(interaction.message, interaction.channelId);
      } catch (err) {
        console.error('Kon quiz bericht niet updaten:', err);
      }
    }, 100);

    return true;
  } catch (error) {
    console.error('Fout bij verwerken quiz button:', error);
    await interaction.reply({ 
      content: '❌ Er is een fout opgetreden bij het verwerken van je antwoord!', 
      ephemeral: true 
    });
    return true;
  }
}

/**
 * End daily quiz (show results)
 */
async function endDailyQuiz(client, channelId) {
  try {
    console.log(`Starting endDailyQuiz for channel ${channelId}`);
    const activeQuiz = getActiveQuiz(channelId);
    
    if (!activeQuiz) {
      console.log('No active quiz found!');
      return;
    }

    console.log('Active quiz found, fetching channel...');
    const channel = await client.channels.fetch(channelId);

    console.log('Channel fetched, creating results embed...');
    
    // First disable all buttons on the original quiz message
    try {
      const quizChannel = await client.channels.fetch(channelId);
      const quizMessage = await quizChannel.messages.fetch(activeQuiz.message_id);
      
      // Create disabled buttons
      const disabledButtons = Object.keys(activeQuiz.opties).map(letter => 
        new ButtonBuilder()
          .setCustomId(`quiz_${letter}_disabled`)
          .setLabel(activeQuiz.opties[letter])
          .setEmoji(EMOJI_MAP[letter])
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );

      const disabledRows = [];
      for (let i = 0; i < disabledButtons.length; i += 5) {
        const row = new ActionRowBuilder()
          .addComponents(disabledButtons.slice(i, i + 5));
        disabledRows.push(row);
      }

      await quizMessage.edit({ components: disabledRows });
      console.log('Quiz buttons disabled');
    } catch (err) {
      console.error('Kon quiz buttons niet disablen:', err);
    }
    
    // Create results embed
    const correctAnswer = activeQuiz.correct_antwoord;
    const correctOption = activeQuiz.opties[correctAnswer];
    
    // Group responses by answer
    const responsesByAnswer = {};
    Object.values(activeQuiz.responses).forEach(response => {
      if (!responsesByAnswer[response.answer]) {
        responsesByAnswer[response.answer] = [];
      }
      responsesByAnswer[response.answer].push(response.username);
    });

    // Build description with layout
    let description = `**Vraag:** ${activeQuiz.vraag}\n\n`;
    description += `**Juiste antwoord:** ${correctAnswer} - ${correctOption}\n\n`;

    // Add answer options with participants
    Object.keys(activeQuiz.opties).forEach(letter => {
      const users = responsesByAnswer[letter] || [];
      const isCorrect = letter === correctAnswer;
      const letterDisplay = isCorrect ? `**${letter}**` : letter;
      description += `${letterDisplay}: ${users.join(', ') || 'Niemand'}\n`;
    });

    const embed = new EmbedBuilder()
      .setTitle('📊 Quiz Resultaten')
      .setDescription(description)
      .setColor('#00ff00');

    const totalResponses = Object.keys(activeQuiz.responses).length;
    embed.setFooter({ text: `Totaal aantal deelnemers: ${totalResponses}` });

    console.log('Sending results message...');
    await channel.send({ embeds: [embed] });

    console.log('Updating scores...');
    // Update scores for all participants
    updateScores(activeQuiz.responses, correctAnswer);

    console.log('Marking question as used...');
    // Mark the question as used
    markQuestionAsUsed(activeQuiz.question_id);

    console.log('Cleaning up quiz data...');
    // Clean up - responses worden automatisch verwijderd door CASCADE
    deleteActiveQuiz(channelId);

    console.log('Quiz beëindigd en resultaten getoond!');
  } catch (error) {
    console.error('Fout bij beëindigen quiz:', error);
  }
}

/**
 * Load active quizzes (voor bot startup)
 */
function loadActiveQuizzes() {
  const db = getDatabase();
  
  const quizzes = db.prepare(`
    SELECT channel_id, message_id, question_id, is_test_quiz, timeout_minutes
    FROM active_quizzes
  `).all();
  
  return quizzes;
}

module.exports = {
  startDailyQuiz,
  handleQuizButton,
  endDailyQuiz,
  resetUsedQuestions,
  getQuizScores,
  getCurrentMonthKey,
  loadActiveQuizzes,
  getActiveQuiz
};
