const { hokCommands, handleHokCommands } = require('./hokCommands');
const { quizCommands, handleQuizCommands } = require('./quizCommands');
const { audioCommands, handleAudioCommands } = require('./audioCommands');
const { casinoCommands, handleCasinoCommands } = require('./casinoCommands');
const { connectFourCommands, handleConnectFourCommands } = require('./connectFourCommands');

// Combineer alle commands
const allCommands = [
  ...hokCommands,
  ...quizCommands,
  ...audioCommands,
  ...casinoCommands,
  ...connectFourCommands
];

// Handle alle commands
async function handleCommands(interaction, client, config, hokState) {
  // Handle autocomplete first (only audio commands have autocomplete)
  if (interaction.isAutocomplete()) {
    if (await handleAudioCommands(interaction, client)) {
      return;
    }
    return;
  }

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

  // Try casino commands
  if (await handleCasinoCommands(interaction, client, config)) {
    return;
  }

  // Try connect four commands
  if (await handleConnectFourCommands(interaction, client, config)) {
    return;
  }

  // Command not found
  console.log(`Onbekend command: ${interaction.commandName}`);
}

module.exports = {
  allCommands,
  handleCommands
};
