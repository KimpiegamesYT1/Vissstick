const quiz = require('../modules/quiz');

// Quiz slash commands
const quizCommands = [
  {
    name: 'testquiz',
    description: 'Start een test quiz (alleen voor administrators)',
    options: [
      {
        name: 'tijd',
        description: 'Aantal minuten voordat de quiz eindigt (1-600, standaard: 1)',
        type: 4, // INTEGER type
        required: false,
        min_value: 1,
        max_value: 600
      }
    ]
  },
  {
    name: 'resetquiz',
    description: 'Reset de gebruikte quiz vragen (alleen voor administrators)'
  }
];

// Handle quiz commands
async function handleQuizCommands(interaction, client, QUIZ_CHANNEL_ID) {
  const { commandName } = interaction;

  if (commandName === 'testquiz') {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: '❌ Je hebt geen administrator rechten!', flags: 64 });
      return true;
    }

    // Defer the reply immediately to prevent timeout
    await interaction.deferReply({ flags: 64 });

    try {
      const tijd = interaction.options.getInteger('tijd') || 1;
      
      const result = await quiz.startDailyQuiz(client, QUIZ_CHANNEL_ID, tijd);
      const usedMinutes = result && typeof result.timeoutMinutesUsed !== 'undefined' && result.timeoutMinutesUsed !== null ? result.timeoutMinutesUsed : tijd;
      
      await interaction.editReply({ 
        content: `✅ Test quiz gestart! De quiz eindigt automatisch na ${usedMinutes} ${usedMinutes === 1 ? 'minuut' : 'minuten'}.` 
      });
    } catch (error) {
      console.error('Fout bij starten test quiz:', error);
      await interaction.editReply({ 
        content: '❌ Er is een fout opgetreden bij het starten van de test quiz.' 
      });
    }
    return true;
  }

  if (commandName === 'resetquiz') {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: '❌ Je hebt geen administrator rechten!', flags: 64 });
      return true;
    }

    // Defer the reply immediately to prevent timeout
    await interaction.deferReply({ flags: 64 });

    try {
      await quiz.resetUsedQuestions();
      await interaction.editReply({ content: '✅ Quiz vragen zijn gereset! Alle vragen kunnen weer gebruikt worden.' });
    } catch (error) {
      console.error('Fout bij resetten quiz vragen:', error);
      await interaction.editReply({ content: '❌ Er is een fout opgetreden bij het resetten van de quiz vragen.' });
    }
    return true;
  }

  return false;
}

module.exports = {
  quizCommands,
  handleQuizCommands
};
