const quiz = require('../modules/quiz');

// Quiz slash commands - alleen non-admin commands blijven hier
const quizCommands = [
  // Admin commands zijn verplaatst naar /admin quiz
];

// Handle quiz commands
async function handleQuizCommands(interaction, client, QUIZ_CHANNEL_ID) {
  // Alle quiz commands zijn nu onder /admin quiz
  return false;
}

module.exports = {
  quizCommands,
  handleQuizCommands
};
