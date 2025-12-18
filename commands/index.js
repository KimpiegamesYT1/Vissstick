const { hokCommands, handleHokCommands } = require('./hokCommands');
const { quizCommands, handleQuizCommands } = require('./quizCommands');
const { audioCommands, handleAudioCommands } = require('./audioCommands');

// Combineer alle commands
const allCommands = [
  ...hokCommands,
  ...quizCommands,
  ...audioCommands
];

// Handle alle commands
async function handleCommands(interaction, client, config, hokState) {
  // Try hok commands first
  if (await handleHokCommands(interaction, client, config, hokState)) {
    return;
  }

  // Try quiz commands
  if (await handleQuizCommands(interaction, client, config.QUIZ_CHANNEL_ID)) {
    return;
  }

  // Try audio commands
  if (await handleAudioCommands(interaction, client)) {
    return;
  }

  // Command not found
  console.log(`Onbekend command: ${interaction.commandName}`);
}

module.exports = {
  allCommands,
  handleCommands
};
