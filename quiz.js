const { EmbedBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const quizDataPath = path.join(__dirname, 'quiz-data.json');
const quizListPath = path.join(__dirname, 'quizlijst.json');
const usedQuestionsPath = path.join(__dirname, 'used-questions.json');

const EMOJI_MAP = {
  'A': '🇦',
  'B': '🇧', 
  'C': '🇨',
  'D': '🇩'
};

// Load used questions
async function loadUsedQuestions() {
  try {
    const data = await fs.readFile(usedQuestionsPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Save used questions
async function saveUsedQuestions(usedQuestions) {
  await fs.writeFile(usedQuestionsPath, JSON.stringify(usedQuestions, null, 2));
}

// Reset used questions (for admin command)
async function resetUsedQuestions() {
  await saveUsedQuestions([]);
}

// Load quiz data (active quizzes)
async function loadQuizData() {
  try {
    const data = await fs.readFile(quizDataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { activeQuizzes: {} };
  }
}

// Save quiz data
async function saveQuizData(data) {
  await fs.writeFile(quizDataPath, JSON.stringify(data, null, 2));
}

// Load quiz questions (excluding used ones)
async function loadQuizList() {
  try {
    const allQuestions = JSON.parse(await fs.readFile(quizListPath, 'utf8'));
    const usedQuestions = await loadUsedQuestions();
    
    // Filter out used questions by comparing the full question object
    const availableQuestions = allQuestions.filter(question => {
      return !usedQuestions.some(used => 
        used.vraag === question.vraag && 
        JSON.stringify(used.opties) === JSON.stringify(question.opties)
      );
    });
    
    return { all: allQuestions, available: availableQuestions };
  } catch (error) {
    console.error('Fout bij laden quizlijst:', error);
    return { all: [], available: [] };
  }
}

// Start daily quiz
async function startDailyQuiz(client, channelId, timeoutMinutes = null) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return console.error('Quiz kanaal niet gevonden!');

    const { all: allQuestions, available: availableQuestions } = await loadQuizList();
    
    if (allQuestions.length === 0) return console.error('Geen quiz vragen beschikbaar!');
    
    // Check if all questions have been used
    if (availableQuestions.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('📝 Dagelijkse Quiz')
        .setDescription('🎉 **Alle quiz vragen zijn gebruikt!**\n\nEr zijn geen nieuwe vragen meer beschikbaar. Een administrator kan de vragenlijst resetten met `/resetquiz`.')
        .setColor('#ffa500')
        .setFooter({ text: `Totaal aantal vragen: ${allQuestions.length}` });

      await channel.send({ embeds: [embed] });
      return console.log('Alle quiz vragen zijn gebruikt!');
    }

    // Select random quiz from available questions
    const randomQuiz = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
    
    // Create embed with appropriate footer message
    const footerText = timeoutMinutes 
      ? `Test quiz eindigt na ${timeoutMinutes} minuten. ${availableQuestions.length} vragen over`
      : `Antwoord wordt om 11:00 bekendgemaakt. ${availableQuestions.length} vragen over`;

    const embed = new EmbedBuilder()
      .setTitle('📝 Dagelijkse Quiz!')
      .setDescription(randomQuiz.vraag)
      .addFields(
        Object.entries(randomQuiz.opties).map(([letter, option]) => ({
          name: `${EMOJI_MAP[letter]} ${letter}`,
          value: option,
          inline: true
        }))
      )
      .setColor('#0099ff')
      .setFooter({ text: footerText });

    const message = await channel.send({ embeds: [embed] });

    // Add reactions
    for (const letter of Object.keys(randomQuiz.opties)) {
      await message.react(EMOJI_MAP[letter]);
    }

    // Save active quiz (don't mark as used yet)
    const quizData = await loadQuizData();
    quizData.activeQuizzes[channelId] = {
      messageId: message.id,
      quiz: randomQuiz,
      responses: {},
      isTestQuiz: timeoutMinutes !== null
    };
    await saveQuizData(quizData);

    // Set timeout for test quiz
    if (timeoutMinutes) {
      setTimeout(async () => {
        console.log(`Test quiz timeout na ${timeoutMinutes} minuten`);
        await endDailyQuiz(client, channelId);
      }, timeoutMinutes * 60 * 1000);
      
      console.log(`Test quiz gestart! Eindigt automatisch na ${timeoutMinutes} minuten.`);
    } else {
      console.log(`Dagelijkse quiz gestart! ${availableQuestions.length} vragen over.`);
    }
  } catch (error) {
    console.error('Fout bij starten quiz:', error);
  }
}

// Handle quiz reactions
async function handleQuizReaction(reaction, user, added) {
  if (user.bot) return;

  const quizData = await loadQuizData();
  const activeQuiz = quizData.activeQuizzes[reaction.message.channelId];
  
  if (!activeQuiz || activeQuiz.messageId !== reaction.message.id) return;

  const emojiLetter = Object.keys(EMOJI_MAP).find(key => EMOJI_MAP[key] === reaction.emoji.name);
  if (!emojiLetter) return;

  if (added) {
    // User added reaction - remove their reaction immediately and save their answer
    try {
      await reaction.users.remove(user.id);
    } catch (err) {
      console.error('Kon reactie niet verwijderen:', err);
    }
    
    activeQuiz.responses[user.id] = {
      answer: emojiLetter,
      username: user.username
    };
  } else {
    // User removed reaction (this shouldn't happen often since we remove reactions immediately)
    delete activeQuiz.responses[user.id];
  }

  await saveQuizData(quizData);

  // Update the original message footer with current response count
  try {
    const { all: allQuestions, available: availableQuestions } = await loadQuizList();
    const totalResponses = Object.keys(activeQuiz.responses).length;
    
    // Different footer text for test quiz vs regular quiz
    const footerText = activeQuiz.isTestQuiz 
      ? `Test quiz eindigt na 5 minuten. ${availableQuestions.length} vragen over | ${totalResponses} antwoorden`
      : `Antwoord wordt om 11:00 bekendgemaakt. ${availableQuestions.length} vragen over | ${totalResponses} antwoorden`;
    
    const embed = new EmbedBuilder()
      .setTitle('📝 Dagelijkse Quiz!')
      .setDescription(activeQuiz.quiz.vraag)
      .addFields(
        Object.entries(activeQuiz.quiz.opties).map(([letter, option]) => ({
          name: `${EMOJI_MAP[letter]} ${letter}`,
          value: option,
          inline: true
        }))
      )
      .setColor('#0099ff')
      .setFooter({ text: footerText });

    await reaction.message.edit({ embeds: [embed] });
  } catch (err) {
    console.error('Kon bericht niet updaten:', err);
  }
}

// End daily quiz (show results)
async function endDailyQuiz(client, channelId) {
  try {
    const quizData = await loadQuizData();
    const activeQuiz = quizData.activeQuizzes[channelId];
    
    if (!activeQuiz) return;

    const channel = await client.channels.fetch(channelId);

    // Create results embed
    const correctAnswer = activeQuiz.quiz.antwoord;
    const correctOption = activeQuiz.quiz.opties[correctAnswer];
    
    // Group responses by answer
    const responsesByAnswer = {};
    Object.values(activeQuiz.responses).forEach(response => {
      if (!responsesByAnswer[response.answer]) {
        responsesByAnswer[response.answer] = [];
      }
      responsesByAnswer[response.answer].push(response.username);
    });

    // Build description with new layout
    let description = `**Vraag:** ${activeQuiz.quiz.vraag}\n\n`;
    description += `**Juiste antwoord:** ${correctAnswer} - ${correctOption}\n\n`;

    // Add answer options with participants
    Object.keys(activeQuiz.quiz.opties).forEach(letter => {
      const users = responsesByAnswer[letter] || [];
      const isCorrect = letter === correctAnswer;
      const letterDisplay = isCorrect ? `**"${letter}"**` : `"${letter}"`;
      description += `${letterDisplay}: ${users.join(', ') || 'Niemand'}\n`;
    });

    const embed = new EmbedBuilder()
      .setTitle('📊 Quiz Resultaten')
      .setDescription(description)
      .setColor('#00ff00');

    const totalResponses = Object.keys(activeQuiz.responses).length;
    embed.setFooter({ text: `Totaal aantal deelnemers: ${totalResponses}` });

    // Send new message with results (don't update the original)
    await channel.send({ embeds: [embed] });

    // Now mark the question as used
    const usedQuestions = await loadUsedQuestions();
    usedQuestions.push(activeQuiz.quiz);
    await saveUsedQuestions(usedQuestions);

    // Clean up
    delete quizData.activeQuizzes[channelId];
    await saveQuizData(quizData);

    console.log('Quiz beëindigd en resultaten getoond!');
  } catch (error) {
    console.error('Fout bij beëindigen quiz:', error);
  }
}

module.exports = {
  startDailyQuiz,
  handleQuizReaction,
  endDailyQuiz,
  resetUsedQuestions
};
