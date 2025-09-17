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
async function startDailyQuiz(client, channelId) {
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
    
    // Create embed
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
      .setFooter({ 
        text: `Reageer met de juiste emoji! Antwoord wordt om 15:00 bekendgemaakt. (${availableQuestions.length}/${allQuestions.length} vragen over)` 
      });

    const message = await channel.send({ embeds: [embed] });

    // Add reactions
    for (const letter of Object.keys(randomQuiz.opties)) {
      await message.react(EMOJI_MAP[letter]);
    }

    // Mark question as used
    const usedQuestions = await loadUsedQuestions();
    usedQuestions.push(randomQuiz);
    await saveUsedQuestions(usedQuestions);

    // Save active quiz
    const quizData = await loadQuizData();
    quizData.activeQuizzes[channelId] = {
      messageId: message.id,
      quiz: randomQuiz,
      responses: {}
    };
    await saveQuizData(quizData);

    console.log(`Dagelijkse quiz gestart! ${availableQuestions.length - 1} vragen over.`);
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
    // User added reaction
    activeQuiz.responses[user.id] = {
      answer: emojiLetter,
      username: user.username
    };
  } else {
    // User removed reaction
    delete activeQuiz.responses[user.id];
  }

  await saveQuizData(quizData);
}

// End daily quiz (show results)
async function endDailyQuiz(client, channelId) {
  try {
    const quizData = await loadQuizData();
    const activeQuiz = quizData.activeQuizzes[channelId];
    
    if (!activeQuiz) return;

    const channel = await client.channels.fetch(channelId);
    const message = await channel.messages.fetch(activeQuiz.messageId);

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

    const embed = new EmbedBuilder()
      .setTitle('📊 Quiz Resultaten')
      .setDescription(`**Vraag:** ${activeQuiz.quiz.vraag}\n\n**Juiste antwoord:** ${EMOJI_MAP[correctAnswer]} ${correctAnswer} - ${correctOption}`)
      .setColor('#00ff00');

    // Add response fields
    Object.entries(responsesByAnswer).forEach(([letter, users]) => {
      const isCorrect = letter === correctAnswer;
      embed.addFields({
        name: `${EMOJI_MAP[letter]} ${letter} ${isCorrect ? '✅' : '❌'}`,
        value: users.join(', ') || 'Niemand',
        inline: true
      });
    });

    const totalResponses = Object.keys(activeQuiz.responses).length;
    embed.setFooter({ text: `Totaal aantal deelnemers: ${totalResponses}` });

    // Update message and remove reactions
    await message.edit({ embeds: [embed] });
    await message.reactions.removeAll();

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
