/**
 * Connect Four Commands - 4 op een rij game met betting
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const casino = require('../modules/casino');
const c4 = require('../modules/connectFour');
const c4AI = require('../modules/connectFourAI');

// =====================================================
// CONNECT FOUR - Game State
// =====================================================
const activeC4Games = new Map();
const ALLOWED_BETS = [100, 200, 400];

function generateC4GameId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

// =====================================================
// TIMEOUT MANAGEMENT
// =====================================================

/**
 * Cleanup game and clear timeout
 */
function cleanupC4Game(gameId) {
  const game = activeC4Games.get(gameId);
  if (game) {
    if (game.timeout) {
      clearTimeout(game.timeout);
    }
    activeC4Games.delete(gameId);
  }
}

/**
 * Reset timeout for game (extends time on each interaction)
 */
function resetC4Timeout(gameId, duration = 120000) {
  const game = activeC4Games.get(gameId);
  if (!game) return;
  
  if (game.timeout) {
    clearTimeout(game.timeout);
  }
  
  game.timeout = setTimeout(() => {
    const g = activeC4Games.get(gameId);
    if (!g) return;
    
    // Refund both players if game was in progress
    if (g.phase === 'playing' && g.betAmount) {
      // Only refund in PvP mode (AI games are free)
      if (g.mode !== 'ai') {
        casino.addBalance(g.player1.id, g.player1.username, g.betAmount, '4 op een rij timeout');
        casino.addBalance(g.player2.id, g.player2.username, g.betAmount, '4 op een rij timeout');
      }
    }
    
    activeC4Games.delete(gameId);
  }, duration);
}

// =====================================================
// EMBED BUILDERS
// =====================================================

/**
 * Build initial challenge embed with bet selection
 */
function buildC4ChallengeEmbed(challenger, opponent, isAI = false) {
  if (isAI) {
    return new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('🤖 4 op een rij tegen BOT')
      .setDescription(`${challenger.username} speelt 4 op een rij tegen de **BOT**!\n\n🎮 **${challenger.username}**, kies een moeilijkheidsgraad:\n_Dit spel is gratis - geen punten nodig!_`)
      .setFooter({ text: 'Kies een level om te starten' })
      .setTimestamp();
  }
  
  return new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle('🎮 4 op een rij Uitdaging!')
    .setDescription(`${challenger.username} daagt ${opponent.username} uit voor een potje 4 op een rij!\n\n**${challenger.username}**, kies hoeveel je wilt gokken:`)
    .setFooter({ text: 'Klik op een bedrag om de uitdaging te sturen' })
    .setTimestamp();
}

/**
 * Build waiting for acceptance embed
 */
function buildC4WaitingEmbed(game) {
  return new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle('🎮 4 op een rij Uitdaging!')
    .setDescription(`${game.player1.username} daagt ${game.player2.username} uit!\n\n💰 **Inzet:** ${game.betAmount} punten per speler\n\n**${game.player2.username}**, accepteer de uitdaging binnen 60 seconden!`)
    .setFooter({ text: 'De uitdaging vervalt na 60 seconden' })
    .setTimestamp();
}

/**
 * Build game board embed
 */
function buildC4GameEmbed(game, message = null, aiThinking = false, aiProgress = null) {
  const boardStr = c4.renderBoard(game.board);
  const currentPlayerName = game.currentPlayer === 1 ? game.player1.username : game.player2.username;
  const currentPlayerEmoji = game.currentPlayer === 1 ? '🔴' : '🟢';
  
  let description;
  if (aiThinking) {
    if (aiProgress !== null) {
      const progressBar = '█'.repeat(Math.floor(aiProgress / 5)) + '░'.repeat(20 - Math.floor(aiProgress / 5));
      description = `${boardStr}\n\n🤖 **BOT denkt na...**\n\`${progressBar}\` ${aiProgress}%`;
    } else {
      description = `${boardStr}\n\n🤖 **BOT denkt na...**`;
    }
  } else if (game.mode === 'ai' && game.currentPlayer === game.aiPlayer) {
    description = `${boardStr}\n\n${currentPlayerEmoji} **BOT** is aan de beurt!`;
  } else {
    description = `${boardStr}\n\n${currentPlayerEmoji} **${currentPlayerName}** is aan de beurt!`;
  }
  
  const embed = new EmbedBuilder()
    .setColor(game.mode === 'ai' ? '#00FF00' : '#4169E1')
    .setTitle(game.mode === 'ai' ? '🤖 4 op een rij - VS BOT' : '🎮 4 op een rij')
    .setDescription(description)
    .setFooter({ text: 'Klik op een kolom nummer om je schijf te laten vallen' })
    .setTimestamp();
  
  // Add fields based on mode
  if (game.mode === 'ai') {
    const difficultyName = c4AI.DIFFICULTY_LEVELS[game.difficulty]?.name || 'Normaal';
    embed.addFields(
      { name: `🔴 ${game.player1.username}`, value: `Speler (Mens)`, inline: true },
      { name: `🟢 BOT`, value: `${difficultyName}`, inline: true }
    );
  } else {
    embed.addFields(
      { name: `🔴 ${game.player1.username}`, value: `Inzet: ${game.betAmount} punten`, inline: true },
      { name: `🟢 ${game.player2.username}`, value: `Inzet: ${game.betAmount} punten`, inline: true }
    );
  }
  
  if (message) {
    embed.setDescription(`${boardStr}\n\n${message}`);
  }
  
  return embed;
}

/**
 * Build game over embed
 */
function buildC4GameOverEmbed(game, result) {
  const boardStr = c4.renderBoard(game.board);
  let description = `${boardStr}\n\n`;
  let color = '#95A5A6';
  
  if (result.type === 'win') {
    const winner = result.winner === 1 ? game.player1 : game.player2;
    const winnerEmoji = result.winner === 1 ? '🔴' : '🟢';
    
    if (game.mode === 'ai') {
      if (result.winner === 1) {
        // Human won
        description += `${winnerEmoji} **${winner.username}** heeft gewonnen!\n\n🎉 Gefeliciteerd! Je hebt de BOT verslagen!`;
        color = '#FFD700';
      } else {
        // AI won
        const difficultyName = c4AI.DIFFICULTY_LEVELS[game.difficulty]?.name || 'Normaal';
        description += `${winnerEmoji} **BOT** heeft gewonnen!\n\n🤖 De ${difficultyName} BOT was te sterk. Probeer het opnieuw!`;
        color = '#FF4444';
      }
    } else {
      const winAmount = game.betAmount * 2;
      description += `${winnerEmoji} **${winner.username}** heeft gewonnen!\n\n🏆 **Prijs:** ${winAmount} punten`;
      color = '#FFD700';
    }
  } else if (result.type === 'draw') {
    if (game.mode === 'ai') {
      description += `🤝 **Gelijkspel!**\n\nHet bord is vol! Niemand heeft gewonnen.`;
    } else {
      description += `🤝 **Gelijkspel!**\n\nHet bord is vol! Beide spelers krijgen hun inzet terug.`;
    }
    color = '#95A5A6';
  }
  
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(game.mode === 'ai' ? '🤖 4 op een rij - Game Over' : '🎮 4 op een rij - Game Over')
    .setDescription(description)
    .setTimestamp();
}

// =====================================================
// BUTTON BUILDERS
// =====================================================

/**
 * Build bet amount selection buttons  
 */
function buildC4BetButtons(gameId, isAI = false) {
  const row = new ActionRowBuilder();
  
  if (isAI) {
    // Difficulty selection for AI mode
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`c4_diff_${gameId}_easy`)
        .setLabel('Makkelijk')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`c4_diff_${gameId}_normal`)
        .setLabel('Normaal')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`c4_diff_${gameId}_hard`)
        .setLabel('Moeilijk')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`c4_diff_${gameId}_impossible`)
        .setLabel('Onmogelijk')
        .setStyle(ButtonStyle.Secondary)
    );
  } else {
    // Bet selection for PvP mode
    for (const amount of ALLOWED_BETS) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`c4_bet_${gameId}_${amount}`)
          .setLabel(`${amount} punten`)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('💰')
      );
    }
  }
  
  return row;
}

/**
 * Build accept challenge button (includes decline option)
 */
function buildC4AcceptButton(gameId) {
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`c4_accept_${gameId}`)
      .setLabel('Accepteer uitdaging!')
      .setStyle(ButtonStyle.Success)
  );
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`c4_decline_${gameId}`)
      .setLabel('Weiger uitdaging')
      .setStyle(ButtonStyle.Danger)
  );
  return row;
} 

/**
 * Build column selection buttons for gameplay
 * Returns array of ActionRows (split into 5 + 2 due to Discord's 5-button limit)
 */
function buildC4ColumnButtons(gameId, board) {
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
  
  // First row: columns 0-4 (5 buttons - Discord's max per row)
  const row1 = new ActionRowBuilder();
  for (let col = 0; col < 5; col++) {
    const isDisabled = c4.isColumnFull(board, col);
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`c4_col${col}_${gameId}`)
        .setEmoji(emojis[col])
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(isDisabled)
    );
  }
  
  // Second row: columns 5-6 (2 buttons)
  const row2 = new ActionRowBuilder();
  for (let col = 5; col < 7; col++) {
    const isDisabled = c4.isColumnFull(board, col);
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`c4_col${col}_${gameId}`)
        .setEmoji(emojis[col])
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(isDisabled)
    );
  }
  
  return [row1, row2];
}

// =====================================================
// COMMAND DEFINITIONS
// =====================================================

const connectFourCommands = [
  {
    name: '4opeenrij',
    description: 'Daag iemand uit voor een potje 4 op een rij met een inzet',
    options: [
      {
        name: 'tegenstander',
        description: 'De speler die je wilt uitdagen',
        type: 6, // USER type
        required: true
      }
    ]
  }
];

// =====================================================
// COMMAND HANDLER
// =====================================================

async function handleConnectFourCommands(interaction, client, config) {
  const { commandName } = interaction;
  
  // /4opeenrij <tegenstander>
  if (commandName === '4opeenrij') {
    const challenger = interaction.user;
    const opponent = interaction.options.getUser('tegenstander');
    
    // Validation checks
    if (opponent.id === challenger.id) {
      await interaction.reply({ content: '❌ Je kunt jezelf niet uitdagen!', flags: 64 });
      return true;
    }
    
    // Check if opponent is the bot (AI mode)
    const isAI = opponent.id === client.user.id;
    
    // Block other bots (but allow our own bot for AI mode)
    if (opponent.bot && !isAI) {
      await interaction.reply({ content: '❌ Je kunt deze bot niet uitdagen!', flags: 64 });
      return true;
    }
    
    // Check if either player is already in an active game
    for (const [gameId, game] of activeC4Games.entries()) {
      if (game.player1.id === challenger.id || game.player2?.id === challenger.id) {
        await interaction.reply({ content: '❌ Je bent al bezig met een spel! Maak dat eerst af.', flags: 64 });
        return true;
      }
      // Don't check for AI - bot can handle multiple games
      if (!isAI && (game.player2?.id === opponent.id || game.player1.id === opponent.id)) {
        await interaction.reply({ content: `❌ ${opponent.username} is al bezig met een spel!`, flags: 64 });
        return true;
      }
    }
    
    // Create game
    const gameId = generateC4GameId();
    const game = {
      gameId,
      player1: {
        id: challenger.id,
        username: challenger.username
      },
      player2: {
        id: opponent.id,
        username: isAI ? 'BOT' : opponent.username
      },
      board: null,
      currentPlayer: null,
      betAmount: null,
      difficulty: null, // AI difficulty: 'easy', 'normal', or 'hard'
      phase: isAI ? 'difficulty_selection' : 'bet_selection', // AI: difficulty first, PvP: bet first
      mode: isAI ? 'ai' : 'pvp', // Track game mode
      aiPlayer: isAI ? 2 : null, // AI is always player 2
      timeout: null
    };
    
    activeC4Games.set(gameId, game);
    resetC4Timeout(gameId, 60000); // 60 seconds for bet selection
    
    // Send challenge embed with bet buttons
    const embed = buildC4ChallengeEmbed(game.player1, game.player2, isAI);
    const buttons = buildC4BetButtons(gameId, isAI);
    
    await interaction.reply({
      content: isAI ? '' : `<@${opponent.id}>`,
      embeds: [embed],
      components: [buttons]
    });
    
    return true;
  }
  
  return false;
}

// =====================================================
// BUTTON HANDLER
// =====================================================

async function handleConnectFourButton(interaction, client, config) {
  const customId = interaction.customId;
  
  // Handle difficulty selection for AI games
  if (customId.startsWith('c4_diff_')) {
    // Format: c4_diff_{gameId}_{difficulty}
    const parts = customId.split('_');
    const gameId = parts[2];
    const difficulty = parts[3]; // 'easy', 'normal', or 'hard'
    
    const game = activeC4Games.get(gameId);
    if (!game) {
      await interaction.reply({ content: '❌ Deze uitdaging is verlopen!', flags: 64 });
      return true;
    }
    
    // Only challenger can select difficulty
    if (interaction.user.id !== game.player1.id) {
      await interaction.reply({ content: '❌ Alleen de uitdager kan de moeilijkheid kiezen!', flags: 64 });
      return true;
    }
    
    // Validate difficulty
    if (!c4AI.DIFFICULTY_LEVELS[difficulty]) {
      await interaction.reply({ content: '❌ Ongeldige moeilijkheidsgraad!', flags: 64 });
      return true;
    }
    
    // Set difficulty and start game immediately (AI games are free)
    game.difficulty = difficulty;
    game.board = c4.createBoard();
    game.currentPlayer = 1; // Player 1 (human) starts
    game.phase = 'playing';
    
    const difficultyName = c4AI.DIFFICULTY_LEVELS[difficulty].name;
    
    // Update message with game board
    const embed = buildC4GameEmbed(game);
    const buttons = buildC4ColumnButtons(gameId, game.board);
    
    await interaction.update({
      content: `🤖 **${game.player1.username}** speelt tegen de BOT op **${difficultyName}** niveau!`,
      embeds: [embed],
      components: buttons.length > 0 ? buttons : []
    });
    
    resetC4Timeout(gameId, 120000); // 120 seconds per turn
    return true;
  }
  
  // Parse button type and gameId
  if (customId.startsWith('c4_bet_')) {
    // Format: c4_bet_{gameId}_{amount}
    const parts = customId.split('_');
    const gameId = parts[2];
    const betAmount = parseInt(parts[3]);
    
    const game = activeC4Games.get(gameId);
    if (!game) {
      await interaction.reply({ content: '❌ Deze uitdaging is verlopen!', flags: 64 });
      return true;
    }
    
    // Only challenger can select bet amount
    if (interaction.user.id !== game.player1.id) {
      await interaction.reply({ content: '❌ Alleen de uitdager kan het bedrag kiezen!', flags: 64 });
      return true;
    }
    
    // Check if challenger has enough balance
    const challengerBalance = casino.getUserBalance(game.player1.id);
    if (challengerBalance < betAmount) {
      await interaction.reply({ content: `❌ Je hebt niet genoeg punten! Je hebt ${challengerBalance} punten.`, flags: 64 });
      cleanupC4Game(gameId);
      return true;
    }
    
    // Update game with bet amount
    game.betAmount = betAmount;
    
    // PvP mode: proceed to waiting_accept phase
    game.phase = 'waiting_accept';
    
    // Update message with accept button
    const embed = buildC4WaitingEmbed(game);
    const buttons = buildC4AcceptButton(gameId);
    
    await interaction.update({
      embeds: [embed],
      components: [buttons]
    });
    
    resetC4Timeout(gameId, 60000); // 60 seconds to accept
    
    return true;
  }
  
  if (customId.startsWith('c4_accept_')) {
    // Format: c4_accept_{gameId}
    const gameId = customId.split('_')[2];
    
    const game = activeC4Games.get(gameId);
    if (!game) {
      await interaction.reply({ content: '❌ Deze uitdaging is verlopen!', flags: 64 });
      return true;
    }
    
    // Only opponent can accept
    if (interaction.user.id !== game.player2.id) {
      await interaction.reply({ content: '❌ Alleen de uitgedaagde speler kan accepteren!', flags: 64 });
      return true;
    }
    
    // Check if both players have enough balance
    const challengerBalance = casino.getUserBalance(game.player1.id);
    const opponentBalance = casino.getUserBalance(game.player2.id);
    
    if (challengerBalance < game.betAmount) {
      await interaction.update({
        content: `❌ ${game.player1.username} heeft niet meer genoeg punten!`,
        embeds: [],
        components: []
      });
      cleanupC4Game(gameId);
      return true;
    }
    
    if (opponentBalance < game.betAmount) {
      await interaction.reply({ 
        content: `❌ Je hebt niet genoeg punten! Je hebt ${opponentBalance} punten, maar je hebt ${game.betAmount} punten nodig.`, 
        flags: 64 
      });
      return true;
    }
    
    // Deduct bet from both players
    casino.subtractBalance(game.player1.id, game.betAmount);
    casino.subtractBalance(game.player2.id, game.betAmount);
    
    // Initialize game
    game.board = c4.createBoard();
    game.currentPlayer = 1; // Player 1 (challenger) starts
    game.phase = 'playing';
    
    // Update message with game board
    const embed = buildC4GameEmbed(game);
    const buttons = buildC4ColumnButtons(gameId, game.board);
    
    await interaction.update({
      embeds: [embed],
      components: buttons.length > 0 ? buttons : []
    });
    
    resetC4Timeout(gameId, 120000); // 120 seconds per turn
    
    return true;
  }
  
  if (customId.startsWith('c4_decline_')) {
    // Format: c4_decline_{gameId}
    const gameId = customId.split('_')[2];
    
    const game = activeC4Games.get(gameId);
    if (!game) {
      await interaction.reply({ content: '❌ Deze uitdaging is verlopen!', flags: 64 });
      return true;
    }
    
    // Only opponent can decline
    if (interaction.user.id !== game.player2.id) {
      await interaction.reply({ content: '❌ Alleen de uitgedaagde speler kan de uitdaging weigeren!', flags: 64 });
      return true;
    }
    
    // Update message to indicate decline and remove components
    await interaction.update({
      content: `❌ ${interaction.user.username} heeft de uitdaging geweigerd.`,
      embeds: [],
      components: []
    });
    
    cleanupC4Game(gameId);
    return true;
  }
  
  if (customId.startsWith('c4_col')) {
    // Format: c4_col{0-6}_{gameId}
    const match = customId.match(/^c4_col(\d)_(.+)$/);
    if (!match) return false;
    
    const column = parseInt(match[1]);
    const gameId = match[2];
    
    const game = activeC4Games.get(gameId);
    if (!game) {
      await interaction.reply({ content: '❌ Dit spel is verlopen!', flags: 64 });
      return true;
    }
    
    if (game.phase !== 'playing') {
      await interaction.reply({ content: '❌ Dit spel is niet actief!', flags: 64 });
      return true;
    }
    
    // Check if it's this player's turn
    const currentPlayerId = game.currentPlayer === 1 ? game.player1.id : game.player2.id;
    
    // In AI mode, only human player can click buttons
    if (game.mode === 'ai') {
      if (interaction.user.id !== game.player1.id) {
        await interaction.reply({ content: '❌ Alleen de menselijke speler kan klikken!', flags: 64 });
        return true;
      }
      // In AI mode, it should always be the human's turn when buttons are clickable
      if (game.currentPlayer !== 1) {
        await interaction.reply({ content: '❌ Het is niet jouw beurt! De BOT is aan de beurt.', flags: 64 });
        return true;
      }
    } else {
      // PvP mode: check if it's this player's turn
      if (interaction.user.id !== currentPlayerId) {
        const currentPlayerName = game.currentPlayer === 1 ? game.player1.username : game.player2.username;
        await interaction.reply({ 
          content: `❌ Het is niet jouw beurt! ${currentPlayerName} is aan de beurt.`, 
          flags: 64 
        });
        return true;
      }
    }
    
    // Drop piece
    const result = c4.dropPiece(game.board, column, game.currentPlayer);
    
    if (!result.success) {
      await interaction.reply({ content: '❌ Deze kolom is vol!', flags: 64 });
      return true;
    }
    
    // Update board
    game.board = result.board;
    
    // Check for winner
    const winner = c4.checkWinner(game.board, result.row, column);
    
    if (winner) {
      // We have a winner!
      const winnerPlayer = winner === 1 ? game.player1 : game.player2;
      
      // Award winnings (only in PvP mode, AI games are free)
      if (game.mode !== 'ai') {
        const winAmount = game.betAmount * 2;
        casino.addBalance(winnerPlayer.id, winnerPlayer.username, winAmount, `Gewonnen 4 op een rij tegen ${winner === 1 ? game.player2.username : game.player1.username}`);
      }
      
      // Update message with game over
      const embed = buildC4GameOverEmbed(game, { type: 'win', winner });
      await interaction.update({
        embeds: [embed],
        components: [] // Remove buttons
      });
      
      cleanupC4Game(gameId);
      return true;
    }
    
    // Check for draw
    if (c4.isBoardFull(game.board)) {
      // Refund player(s) - only in PvP mode (AI games are free)
      if (game.mode !== 'ai') {
        casino.addBalance(game.player1.id, game.player1.username, game.betAmount, '4 op een rij gelijkspel');
        casino.addBalance(game.player2.id, game.player2.username, game.betAmount, '4 op een rij gelijkspel');
      }
      
      // Update message with game over
      const embed = buildC4GameOverEmbed(game, { type: 'draw' });
      await interaction.update({
        embeds: [embed],
        components: [] // Remove buttons
      });
      
      cleanupC4Game(gameId);
      return true;
    }
    
    // Switch to next player
    game.currentPlayer = game.currentPlayer === 1 ? 2 : 1;
    
    // If AI mode and it's now AI's turn, make AI move
    if (game.mode === 'ai' && game.currentPlayer === game.aiPlayer) {
      const showProgress = game.difficulty === 'hard' || game.difficulty === 'impossible';
      
      // Update board to show AI is thinking
      const thinkingEmbed = buildC4GameEmbed(game, null, true, showProgress ? 0 : null);
      const buttons = buildC4ColumnButtons(gameId, game.board);
      
      await interaction.update({
        embeds: [thinkingEmbed],
        components: buttons.length > 0 ? buttons : []
      });
      
      // Add delay for better UX (AI "thinking")
      setTimeout(async () => {
        const currentGame = activeC4Games.get(gameId);
        if (!currentGame || currentGame.phase !== 'playing') return;
        
        try {
          // Progress callback for hard/impossible difficulty  
          let lastUpdate = 0;
          let progressCallback = null;
          if (showProgress) {
            progressCallback = async (current, total) => {
              const now = Date.now();
              // Throttle updates to max once per 500ms to avoid rate limits
              if (now - lastUpdate < 500) return;
              lastUpdate = now;
              
              const percentage = Math.round((current / total) * 100);
              const progressEmbed = buildC4GameEmbed(currentGame, null, true, percentage);
              const progressButtons = buildC4ColumnButtons(gameId, currentGame.board);
              try {
                await interaction.editReply({
                  embeds: [progressEmbed],
                  components: progressButtons.length > 0 ? progressButtons : []
                });
              } catch (err) {
                // Ignore rate limit errors during progress updates
                if (err.code !== 50035 && err.code !== 10062) {
                  console.error('[C4 AI] Progress update error:', err);
                }
              }
            };
          }
          
          // Get AI move with difficulty and progress callback
          const aiColumn = c4AI.getAIMove(currentGame.board, currentGame.aiPlayer, currentGame.difficulty, progressCallback);
          const aiResult = c4.dropPiece(currentGame.board, aiColumn, currentGame.aiPlayer);
          
          if (!aiResult.success) {
            console.error('[C4 AI] AI made invalid move!');
            // Fallback: human wins (no money in AI games)
            const errorEmbed = new EmbedBuilder()
              .setColor('#FF0000')
              .setTitle('❌ AI Fout')
              .setDescription('De AI maakte een ongeldige zet. Je wint!');
            await interaction.editReply({ embeds: [errorEmbed], components: [] });
            cleanupC4Game(gameId);
            return;
          }
          
          // Update board
          currentGame.board = aiResult.board;
          
          // Check for AI winner
          const aiWinner = c4.checkWinner(currentGame.board, aiResult.row, aiColumn);
          
          if (aiWinner) {
            // AI won (no money in AI games)
            const embed = buildC4GameOverEmbed(currentGame, { type: 'win', winner: currentGame.aiPlayer });
            await interaction.editReply({
              embeds: [embed],
              components: []
            });
            cleanupC4Game(gameId);
            return;
          }
          
          // Check for draw after AI move
          if (c4.isBoardFull(currentGame.board)) {
            // Draw (no money in AI games)
            const embed = buildC4GameOverEmbed(currentGame, { type: 'draw' });
            await interaction.editReply({
              embeds: [embed],
              components: []
            });
            cleanupC4Game(gameId);
            return;
          }
          
          // Switch back to human player
          currentGame.currentPlayer = 1;
          
          // Update board with AI's move
          const embed = buildC4GameEmbed(currentGame);
          const newButtons = buildC4ColumnButtons(gameId, currentGame.board);
          
          await interaction.editReply({
            embeds: [embed],
            components: newButtons.length > 0 ? newButtons : []
          });
          
          resetC4Timeout(gameId, 120000);
        } catch (error) {
          console.error('[C4 AI] Error during AI turn:', error);
          // Cleanup on error
          cleanupC4Game(gameId);
        }
      }, 1500); // 1.5 second delay for AI "thinking"
      
      return true;
    }
    
    // PvP mode: Update message with new board state
    const embed = buildC4GameEmbed(game);
    const buttons = buildC4ColumnButtons(gameId, game.board);
    
    await interaction.update({
      embeds: [embed],
      components: buttons.length > 0 ? buttons : []
    });
    
    resetC4Timeout(gameId, 120000); // Reset timeout for next turn
    
    return true;
  }
  
  return false;
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  connectFourCommands,
  handleConnectFourCommands,
  handleConnectFourButton
};
