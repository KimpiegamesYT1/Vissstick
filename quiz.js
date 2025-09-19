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
    const randomIndex = Math.floor(Math.random() * availableQuestions.length);
    const randomQuiz = availableQuestions[randomIndex];
    
    console.log(`Quiz selectie: ${randomIndex + 1}/${availableQuestions.length} beschikbare vragen`);
    console.log(`Geselecteerde vraag: "${randomQuiz.vraag.substring(0, 50)}..."`);
    
    // Create embed with appropriate footer message
    const footerText = timeoutMinutes 
      ? `Test quiz eindigt na ${timeoutMinutes} minuten. ${availableQuestions.length} vragen over • 0 antwoorden`
      : `Antwoord wordt om 11:00 bekendgemaakt. ${availableQuestions.length} vragen over • 0 antwoorden`;

    const embed = new EmbedBuilder()
      .setTitle('📝 Dagelijkse Quiz!')
      .setDescription(randomQuiz.vraag)
      .addFields(
        Object.entries(randomQuiz.opties).map(([letter, option]) => ({
          name: `${EMOJI_MAP[letter]} ${letter}`,
          value: option,
          inline: false // Alle antwoorden onder elkaar
        }))
      )
      .setColor('#0099ff')
      .setFooter({ text: footerText });

    const message = await channel.send({ embeds: [embed] });
    console.log(`Quiz bericht verzonden met ID: ${message.id}`);

    // Add reactions
    for (const letter of Object.keys(randomQuiz.opties)) {
      await message.react(EMOJI_MAP[letter]);
      console.log(`Reactie toegevoegd: ${letter} (${EMOJI_MAP[letter]})`);
    }

    // Save active quiz (don't mark as used yet)
    const quizData = await loadQuizData();
    quizData.activeQuizzes[channelId] = {
      messageId: message.id,
      quiz: randomQuiz,
      responses: {},
      isTestQuiz: timeoutMinutes !== null,
      timeoutMinutes: timeoutMinutes
    };
    
    try {
      await saveQuizData(quizData);
      console.log(`Quiz data opgeslagen voor kanaal ${channelId}`);
    } catch (error) {
      console.error('Fout bij opslaan quiz data:', error);
      throw error;
    }

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
      console.log(`Dagelijkse quiz gestart! ${availableQuestions.length} vragen over.`);
    }
  } catch (error) {
    console.error('Fout bij starten quiz:', error);
  }
}

// Handle quiz reactions
async function handleQuizReaction(reaction, user, added) {
  if (user.bot) return;

  try {
    const quizData = await loadQuizData();
    const activeQuiz = quizData.activeQuizzes[reaction.message.channelId];
    
    if (!activeQuiz || activeQuiz.messageId !== reaction.message.id) return;

    const emojiLetter = Object.keys(EMOJI_MAP).find(key => EMOJI_MAP[key] === reaction.emoji.name);
    if (!emojiLetter) return;

    console.log(`Quiz reactie ontvangen: ${user.username} -> ${emojiLetter} (${added ? 'toegevoegd' : 'verwijderd'})`);

    if (added) {
      // Check if user already has an answer
      const previousAnswer = activeQuiz.responses[user.id]?.answer;
      
      // Save the new answer FIRST before removing reactions
      activeQuiz.responses[user.id] = {
        answer: emojiLetter,
        username: user.username
      };
      
      // Save immediately to prevent data loss
      await saveQuizData(quizData);
      console.log(`Antwoord opgeslagen: ${user.username} = ${emojiLetter}`);
      
      // Then remove reactions (with delay to ensure save completed)
      setTimeout(async () => {
        try {
          await reaction.users.remove(user.id);
          
          // If user had a different answer before, remove that reaction too
          if (previousAnswer && previousAnswer !== emojiLetter) {
            const previousEmoji = EMOJI_MAP[previousAnswer];
            const previousReaction = reaction.message.reactions.cache.find(r => r.emoji.name === previousEmoji);
            if (previousReaction) {
              await previousReaction.users.remove(user.id);
            }
          }
        } catch (err) {
          console.error('Kon reactie niet verwijderen:', err);
        }
      }, 100); // 100ms delay
      
    } else {
      // User removed reaction - remove their stored answer
      delete activeQuiz.responses[user.id];
      await saveQuizData(quizData);
      console.log(`Antwoord verwijderd: ${user.username}`);
    }
  } catch (error) {
    console.error('Fout bij verwerken quiz reactie:', error);
    return;
  }

  // Update the original message footer with current response count
  setTimeout(async () => {
    try {
      const updatedQuizData = await loadQuizData();
      const updatedActiveQuiz = updatedQuizData.activeQuizzes[reaction.message.channelId];
      
      if (!updatedActiveQuiz) return;
      
      const { all: allQuestions, available: availableQuestions } = await loadQuizList();
      const responseCount = Object.keys(updatedActiveQuiz.responses).length;
      
      // Different footer text for test quiz vs regular quiz
      const footerText = updatedActiveQuiz.isTestQuiz 
        ? `Test quiz eindigt na ${updatedActiveQuiz.timeoutMinutes} minuten. ${availableQuestions.length} vragen over • ${responseCount} antwoorden`
        : `Antwoord wordt om 11:00 bekendgemaakt. ${availableQuestions.length} vragen over • ${responseCount} antwoorden`;
      
      const embed = new EmbedBuilder()
        .setTitle('📝 Dagelijkse Quiz!')
        .setDescription(updatedActiveQuiz.quiz.vraag)
        .addFields(
          Object.entries(updatedActiveQuiz.quiz.opties).map(([letter, option]) => ({
            name: `${EMOJI_MAP[letter]} ${letter}`,
            value: option,
            inline: false // Alle antwoorden onder elkaar
          }))
        )
        .setColor('#0099ff')
        .setFooter({ text: footerText });

      await reaction.message.edit({ embeds: [embed] });
    } catch (err) {
      console.error('Kon bericht niet updaten:', err);
    }
  }, 200); // Wait a bit longer to ensure data is saved
}

// End daily quiz (show results)
async function endDailyQuiz(client, channelId) {
  try {
    console.log(`Starting endDailyQuiz for channel ${channelId}`);
    const quizData = await loadQuizData();
    const activeQuiz = quizData.activeQuizzes[channelId];
    
    if (!activeQuiz) {
      console.log('No active quiz found!');
      return;
    }

    console.log('Active quiz found, fetching channel...');
    const channel = await client.channels.fetch(channelId);

    console.log('Channel fetched, creating results embed...');
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
    // Send new message with results (don't update the original)
    await channel.send({ embeds: [embed] });

    console.log('Marking question as used...');
    // Now mark the question as used
    const usedQuestions = await loadUsedQuestions();
    usedQuestions.push(activeQuiz.quiz);
    await saveUsedQuestions(usedQuestions);

    console.log('Cleaning up quiz data...');
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
  resetUsedQuestions,
  loadQuizData,
  saveQuizData
};
