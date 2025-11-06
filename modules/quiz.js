const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const quizDataPath = path.join(__dirname, '..', 'quiz-data.json');
const quizListPath = path.join(__dirname, '..', 'quizlijst.json');
const usedQuestionsPath = path.join(__dirname, '..', 'used-questions.json');
const quizScoresPath = path.join(__dirname, '..', 'quiz-scores.json');

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

// Load quiz scores
async function loadQuizScores() {
  try {
    const data = await fs.readFile(quizScoresPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { monthly: {}, allTime: {} };
  }
}

// Save quiz scores
async function saveQuizScores(scores) {
  await fs.writeFile(quizScoresPath, JSON.stringify(scores, null, 2));
}

// Get current month key (YYYY-MM)
function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Update scores after quiz ends
async function updateScores(responses, correctAnswer) {
  const scores = await loadQuizScores();
  const monthKey = getCurrentMonthKey();
  
  // Initialize month if needed
  if (!scores.monthly[monthKey]) {
    scores.monthly[monthKey] = {};
  }
  
  // Update scores for each user
  Object.entries(responses).forEach(([userId, response]) => {
    const isCorrect = response.answer === correctAnswer;
    
    // Update monthly scores
    if (!scores.monthly[monthKey][userId]) {
      scores.monthly[monthKey][userId] = {
        username: response.username,
        correct: 0,
        total: 0
      };
    }
    scores.monthly[monthKey][userId].total += 1;
    if (isCorrect) {
      scores.monthly[monthKey][userId].correct += 1;
    }
    
    // Update all-time scores
    if (!scores.allTime[userId]) {
      scores.allTime[userId] = {
        username: response.username,
        correct: 0,
        total: 0
      };
    }
    scores.allTime[userId].total += 1;
    if (isCorrect) {
      scores.allTime[userId].correct += 1;
    }
  });
  
  await saveQuizScores(scores);
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
      : `Antwoord wordt om 17:00 bekendgemaakt. ${availableQuestions.length} vragen over • 0 antwoorden`;

    const embed = new EmbedBuilder()
      .setTitle('📝 Dagelijkse Quiz!')
      .setDescription(randomQuiz.vraag)
      .setColor('#0099ff')
      .setFooter({ text: footerText });

    // Create button components
    const buttons = Object.keys(randomQuiz.opties).map(letter => 
      new ButtonBuilder()
        .setCustomId(`quiz_${letter}`)
        .setLabel(randomQuiz.opties[letter])
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

    // No need to add reactions anymore - buttons handle this

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

// Helper function to update quiz message
async function updateQuizMessage(message, channelId) {
  try {
    const updatedQuizData = await loadQuizData();
    const updatedActiveQuiz = updatedQuizData.activeQuizzes[channelId];
    
    if (!updatedActiveQuiz) return;
    
    const { all: allQuestions, available: availableQuestions } = await loadQuizList();
    const responseCount = Object.keys(updatedActiveQuiz.responses).length;
    
    // Different footer text for test quiz vs regular quiz
    const footerText = updatedActiveQuiz.isTestQuiz 
      ? `Test quiz eindigt na ${updatedActiveQuiz.timeoutMinutes} minuten. ${availableQuestions.length} vragen over • ${responseCount} antwoorden`
      : `Antwoord wordt om 17:00 bekendgemaakt. ${availableQuestions.length} vragen over • ${responseCount} antwoorden`;
    
    const embed = new EmbedBuilder()
      .setTitle('📝 Dagelijkse Quiz!')
      .setDescription(updatedActiveQuiz.quiz.vraag)
      .setColor('#0099ff')
      .setFooter({ text: footerText });

    // Create updated buttons - keep simple without counters or color changes
    const buttons = Object.keys(updatedActiveQuiz.quiz.opties).map(letter => {
      return new ButtonBuilder()
        .setCustomId(`quiz_${letter}`)
        .setLabel(updatedActiveQuiz.quiz.opties[letter])
        .setEmoji(EMOJI_MAP[letter])
        .setStyle(ButtonStyle.Primary); // Always keep primary blue color
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

// Handle quiz button interactions
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
    const quizData = await loadQuizData();
    const activeQuiz = quizData.activeQuizzes[interaction.channelId];
    
    if (!activeQuiz || activeQuiz.messageId !== interaction.message.id) {
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
      delete activeQuiz.responses[user.id];
      await saveQuizData(quizData);
      console.log(`Antwoord verwijderd: ${user.username}`);
      
      await interaction.reply({ 
        content: `❌ Antwoord **${letter}** verwijderd!`, 
        ephemeral: true 
      });
    } else {
      // Save the new answer
      activeQuiz.responses[user.id] = {
        answer: letter,
        username: user.username
      };
      
      await saveQuizData(quizData);
      console.log(`Antwoord opgeslagen: ${user.username} = ${letter}`);
      
      const optionText = activeQuiz.quiz.opties[letter];
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
    
    // First disable all buttons on the original quiz message
    try {
      const quizChannel = await client.channels.fetch(channelId);
      const quizMessage = await quizChannel.messages.fetch(activeQuiz.messageId);
      
      // Create disabled buttons
      const disabledButtons = Object.keys(activeQuiz.quiz.opties).map(letter => 
        new ButtonBuilder()
          .setCustomId(`quiz_${letter}_disabled`)
          .setLabel(activeQuiz.quiz.opties[letter])
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

    console.log('Updating scores...');
    // Update scores for all participants
    await updateScores(activeQuiz.responses, correctAnswer);

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
  handleQuizButton,
  endDailyQuiz,
  resetUsedQuestions,
  loadQuizData,
  saveQuizData,
  loadQuizScores,
  getCurrentMonthKey
};
