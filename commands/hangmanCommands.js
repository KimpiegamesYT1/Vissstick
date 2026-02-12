/**
 * Hangman Discord Commands
 * Handles slash commands and button interactions for hangman game
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const hangman = require('../modules/hangman');
const casino = require('../modules/casino');

// =====================================================
// STATE MANAGEMENT
// =====================================================

// Active games map (key: userId, value: game state)
const activeHangmanGames = new Map();

// Bet amounts available for selection
const BET_AMOUNTS = [50, 100, 200];

// Game timeout durations (in milliseconds)
const BET_SELECTION_TIMEOUT = 60000; // 60 seconds
const GAMEPLAY_TIMEOUT = 120000; // 120 seconds (2 minutes)

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Generate unique game ID
 * @returns {string} Unique game identifier
 */
function generateGameId() {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Build hangman game embed
 * @param {Object} game - Game state object
 * @returns {EmbedBuilder} Discord embed for game display
 */
function buildHangmanEmbed(game) {
  const embed = new EmbedBuilder()
    .setColor(game.phase === 'bet_selection' ? '#FFA500' : '#00FF00')
    .setTitle('🎲 Galgje')
    .setTimestamp();
  
  if (game.phase === 'bet_selection') {
    embed.setDescription(
      `**${game.player.username}** wil galgje spelen!\n\n` +
      `Kies je inzet om te beginnen:\n` +
      `💰 **50 punten** - Win 100 punten\n` +
      `💰 **100 punten** - Win 200 punten\n` +
      `💰 **200 punten** - Win 400 punten\n\n` +
      `Je hebt 6 foute pogingen voordat je verliest!`
    );
  } else {
    // Playing phase
    const wordDisplay = hangman.getWordDisplay(game.word, game.guessedLetters);
    const wrongLetters = hangman.getWrongLetters(game.word, game.guessedLetters);
    const hangmanArt = hangman.getHangmanStage(game.wrongGuesses);
    
    embed.setDescription(
      `**Speler:** ${game.player.username}\n` +
      `**Inzet:** ${game.betAmount} punten\n\n` +
      `\`\`\`${hangmanArt}\`\`\`\n` +
      `**Woord:** \`${wordDisplay}\`\n\n` +
      `**Foute letters:** ${wrongLetters.length > 0 ? wrongLetters.join(', ') : 'Nog geen'}\n` +
      `**Pogingen over:** ${game.maxWrong - game.wrongGuesses}`
    );
  }
  
  return embed;
}

/**
 * Build game over embed
 * @param {Object} game - Game state object
 * @param {boolean} won - Whether player won
 * @returns {EmbedBuilder} Discord embed for game over
 */
function buildGameOverEmbed(game, won) {
  const wordDisplay = hangman.getWordDisplay(game.word, game.guessedLetters);
  const hangmanArt = hangman.getHangmanStage(game.wrongGuesses);
  
  const embed = new EmbedBuilder()
    .setTimestamp();
  
  if (won) {
    const winAmount = game.betAmount * 2;
    embed
      .setColor('#00FF00')
      .setTitle('🎉 Gewonnen!')
      .setDescription(
        `**${game.player.username}** heeft het woord geraden!\n\n` +
        `\`\`\`${hangmanArt}\`\`\`\n` +
        `**Woord:** \`${wordDisplay}\`\n\n` +
        `💰 **+${winAmount} punten** (+${game.betAmount} winst)`
      );
  } else {
    embed
      .setColor('#FF0000')
      .setTitle('💀 Verloren!')
      .setDescription(
        `**${game.player.username}** is opgehangen!\n\n` +
        `\`\`\`${hangmanArt}\`\`\`\n` +
        `**Het woord was:** \`${game.word}\`\n\n` +
        `💸 **-${game.betAmount} punten**`
      );
  }
  
  return embed;
}

/**
 * Build bet selection buttons
 * @param {string} userId - Discord user ID
 * @param {string} gameId - Game identifier
 * @returns {ActionRowBuilder[]} Array of action rows with bet buttons
 */
function buildBetButtons(userId, gameId) {
  const userBalance = casino.getUserBalance(userId);
  
  const buttons = BET_AMOUNTS.map(amount => {
    const canAfford = userBalance >= amount;
    return new ButtonBuilder()
      .setCustomId(`hm_bet_${gameId}_${amount}`)
      .setLabel(`${amount} punten`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canAfford);
  });
  
  const cancelButton = new ButtonBuilder()
    .setCustomId(`hm_cancel_${gameId}`)
    .setLabel('Annuleren')
    .setStyle(ButtonStyle.Danger);
  
  return [new ActionRowBuilder().addComponents(...buttons, cancelButton)];
}

/**
 * Build letter selection buttons
 * @param {Set<string>} guessedLetters - Already guessed letters
 * @param {string} gameId - Game identifier
 * @returns {ActionRowBuilder[]} Array of action rows with letter buttons
 */
function buildLetterButtons(guessedLetters, gameId) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const rows = [];
  
  // Split alphabet into rows (5-6 letters each)
  const rowSizes = [5, 5, 5, 5, 6]; // A-E, F-J, K-O, P-T, U-Z
  let startIndex = 0;
  
  for (const size of rowSizes) {
    const rowLetters = alphabet.slice(startIndex, startIndex + size);
    const buttons = [...rowLetters].map(letter => {
      const isGuessed = guessedLetters.has(letter);
      return new ButtonBuilder()
        .setCustomId(`hm_letter_${gameId}_${letter}`)
        .setLabel(letter)
        .setStyle(isGuessed ? ButtonStyle.Secondary : ButtonStyle.Primary)
        .setDisabled(isGuessed);
    });
    
    rows.push(new ActionRowBuilder().addComponents(...buttons));
    startIndex += size;
  }
  
  return rows;
}

/**
 * Cleanup hangman game (refund if in progress, clear timeout, remove from map)
 * @param {string} gameId - Game identifier
 */
function cleanupHangmanGame(gameId) {
  const game = activeHangmanGames.get(gameId);
  if (!game) return;
  
  // Clear timeout
  if (game.timeout) {
    clearTimeout(game.timeout);
  }
  
  // Refund bet if game was in progress
  if (game.phase === 'playing' && game.betAmount) {
    casino.addBalance(
      game.player.id,
      game.player.username,
      game.betAmount,
      'Galgje timeout refund'
    );
  }
  
  // Remove from active games
  activeHangmanGames.delete(gameId);
  console.log(`[Hangman] Game ${gameId} cleaned up`);
}

/**
 * Reset game timeout
 * @param {string} gameId - Game identifier
 * @param {number} duration - Timeout duration in milliseconds
 * @param {Object} interaction - Discord interaction object
 */
function resetHangmanTimeout(gameId, duration, interaction) {
  const game = activeHangmanGames.get(gameId);
  if (!game) return;
  
  // Clear existing timeout
  if (game.timeout) {
    clearTimeout(game.timeout);
  }
  
  // Set new timeout
  game.timeout = setTimeout(async () => {
    try {
      const timeoutEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('⏱️ Time-out!')
        .setDescription(
          `Het galgje spel van **${game.player.username}** is verlopen door inactiviteit.\n\n` +
          (game.betAmount ? `💰 **${game.betAmount} punten** zijn teruggestort.` : '')
        )
        .setTimestamp();
      
      await interaction.message.edit({
        embeds: [timeoutEmbed],
        components: []
      });
    } catch (error) {
      console.error('[Hangman] Error updating timeout message:', error);
    }
    
    cleanupHangmanGame(gameId);
  }, duration);
}

// =====================================================
// COMMAND HANDLERS
// =====================================================

/**
 * Handle /galgje command
 * @param {Object} interaction - Discord command interaction
 * @param {Object} client - Discord client
 * @param {Object} config - Bot configuration
 * @returns {boolean} True if command was handled
 */
async function handleHangmanCommands(interaction, client, config) {
  if (!interaction.isCommand()) return false;
  if (interaction.commandName !== 'galgje') return false;
  
  const userId = interaction.user.id;
  const username = interaction.user.username;
  
  // Check if user already has an active game
  const existingGame = [...activeHangmanGames.values()].find(g => g.player.id === userId);
  if (existingGame) {
    await interaction.reply({
      content: '❌ Je hebt al een actief galgje spel! Maak dat eerst af.',
      ephemeral: true
    });
    return true;
  }
  
  // Create new game
  const gameId = generateGameId();
  const game = {
    gameId,
    player: { id: userId, username },
    phase: 'bet_selection',
    betAmount: null,
    word: null,
    guessedLetters: new Set(),
    wrongGuesses: 0,
    maxWrong: hangman.MAX_WRONG_GUESSES,
    timeout: null
  };
  
  activeHangmanGames.set(gameId, game);
  console.log(`[Hangman] Game ${gameId} created for ${username}`);
  
  // Send bet selection message
  const embed = buildHangmanEmbed(game);
  const buttons = buildBetButtons(userId, gameId);
  
  await interaction.reply({
    embeds: [embed],
    components: buttons
  });
  
  // Set timeout for bet selection
  resetHangmanTimeout(gameId, BET_SELECTION_TIMEOUT, interaction);
  
  return true;
}

/**
 * Handle hangman button interactions
 * @param {Object} interaction - Discord button interaction
 * @param {Object} client - Discord client
 * @param {Object} config - Bot configuration
 * @returns {boolean} True if interaction was handled
 */
async function handleHangmanButton(interaction, client, config) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith('hm_')) return false;
  
  const [, action, gameId, param] = interaction.customId.split('_');
  const game = activeHangmanGames.get(gameId);
  
  if (!game) {
    await interaction.reply({
      content: '❌ Dit spel bestaat niet meer.',
      ephemeral: true
    });
    return true;
  }
  
  // Verify user is the game owner
  if (interaction.user.id !== game.player.id) {
    await interaction.reply({
      content: '❌ Dit is niet jouw spel!',
      ephemeral: true
    });
    return true;
  }
  
  // Handle cancel button
  if (action === 'cancel') {
    cleanupHangmanGame(gameId);
    
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor('#FF6B6B')
          .setTitle('❌ Geannuleerd')
          .setDescription(`**${game.player.username}** heeft het galgje spel geannuleerd.`)
          .setTimestamp()
      ],
      components: []
    });
    
    return true;
  }
  
  // Handle bet selection
  if (action === 'bet') {
    const betAmount = parseInt(param);
    const userBalance = casino.getUserBalance(game.player.id);
    
    // Validate balance
    if (userBalance < betAmount) {
      await interaction.reply({
        content: `❌ Je hebt niet genoeg punten! Je hebt **${userBalance}** punten, maar je hebt **${betAmount}** nodig.`,
        ephemeral: true
      });
      return true;
    }
    
    // Deduct bet amount
    casino.subtractBalance(game.player.id, betAmount);
    console.log(`[Hangman] ${game.player.username} bet ${betAmount} points`);
    
    // Initialize game
    game.phase = 'playing';
    game.betAmount = betAmount;
    game.word = hangman.getRandomWord();
    game.guessedLetters = new Set();
    game.wrongGuesses = 0;
    
    console.log(`[Hangman] Word for game ${gameId}: ${game.word}`);
    
    // Update message with game board
    const embed = buildHangmanEmbed(game);
    const buttons = buildLetterButtons(game.guessedLetters, gameId);
    
    await interaction.update({
      embeds: [embed],
      components: buttons
    });
    
    // Reset timeout for gameplay
    resetHangmanTimeout(gameId, GAMEPLAY_TIMEOUT, interaction);
    
    return true;
  }
  
  // Handle letter guess
  if (action === 'letter') {
    const letter = param;
    
    // Process the guess
    const result = hangman.processGuess(game, letter);
    
    if (result.alreadyGuessed) {
      await interaction.reply({
        content: `❌ Je hebt de letter **${letter}** al geraden!`,
        ephemeral: true
      });
      return true;
    }
    
    // Check if game is over
    if (result.gameOver) {
      clearTimeout(game.timeout);
      
      // Handle payout
      if (result.won) {
        const winAmount = game.betAmount * 2;
        casino.addBalance(
          game.player.id,
          game.player.username,
          winAmount,
          `Galgje gewonnen (${game.word})`
        );
        console.log(`[Hangman] ${game.player.username} won ${winAmount} points`);
      } else {
        console.log(`[Hangman] ${game.player.username} lost ${game.betAmount} points`);
      }
      
      // Show game over message
      const gameOverEmbed = buildGameOverEmbed(game, result.won);
      await interaction.update({
        embeds: [gameOverEmbed],
        components: []
      });
      
      // Cleanup game
      activeHangmanGames.delete(gameId);
      console.log(`[Hangman] Game ${gameId} finished - ${result.won ? 'won' : 'lost'}`);
    } else {
      // Game continues - update board
      const embed = buildHangmanEmbed(game);
      const buttons = buildLetterButtons(game.guessedLetters, gameId);
      
      await interaction.update({
        embeds: [embed],
        components: buttons
      });
      
      // Reset timeout
      resetHangmanTimeout(gameId, GAMEPLAY_TIMEOUT, interaction);
    }
    
    return true;
  }
  
  return false;
}

// =====================================================
// SLASH COMMAND DEFINITION
// =====================================================

const hangmanCommands = [
  {
    name: 'galgje',
    description: 'Speel galgje en raad het Nederlandse woord!',
    options: []
  }
];

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  hangmanCommands,
  handleHangmanCommands,
  handleHangmanButton
};
