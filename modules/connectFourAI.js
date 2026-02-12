/**
 * Connect Four AI Module
 * Minimax algorithm with alpha-beta pruning for optimal gameplay
 */

const c4 = require('./connectFour');

// =====================================================
// CONSTANTS
// =====================================================

const DIFFICULTY_LEVELS = {
  easy: { name: 'Makkelijk', depth: 2, useRandom: true },
  normal: { name: 'Normaal', depth: 4, useRandom: false },
  hard: { name: 'Moeilijk', depth: 6, useRandom: false },
  impossible: { name: 'Onmogelijk', depth: 9, useRandom: false }
};

const WIN_SCORE = 1000000;
const LOSE_SCORE = -1000000;

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Get all valid (non-full) columns
 * @param {Array<Array<number>>} board - The game board
 * @returns {number[]} Array of valid column indices
 */
function getValidColumns(board) {
  const validCols = [];
  for (let col = 0; col < 7; col++) {
    if (!c4.isColumnFull(board, col)) {
      validCols.push(col);
    }
  }
  return validCols;
}

/**
 * Simulate dropping a piece and get the resulting row
 * @param {Array<Array<number>>} board - The game board
 * @param {number} column - Column to drop in
 * @returns {number} Row index where piece lands, or -1 if column is full
 */
function getDropRow(board, column) {
  for (let row = 5; row >= 0; row--) {
    if (board[row][column] === 0) {
      return row;
    }
  }
  return -1;
}

/**
 * Count consecutive pieces in a window
 * Used for position evaluation
 * @param {number[]} window - Array of 4 consecutive cells
 * @param {number} player - Player to count for
 * @returns {number} Score for this window
 */
function evaluateWindow(window, player) {
  const opponent = player === 1 ? 2 : 1;
  let score = 0;
  
  const playerCount = window.filter(cell => cell === player).length;
  const opponentCount = window.filter(cell => cell === opponent).length;
  const emptyCount = window.filter(cell => cell === 0).length;
  
  // Scoring system
  if (playerCount === 4) {
    score += 100; // Four in a row
  } else if (playerCount === 3 && emptyCount === 1) {
    score += 10; // Three in a row with one empty (strong threat)
  } else if (playerCount === 2 && emptyCount === 2) {
    score += 5; // Two in a row with two empty (potential)
  }
  
  // Penalize opponent threats
  if (opponentCount === 3 && emptyCount === 1) {
    score -= 80; // Block opponent's three in a row (critical!)
  } else if (opponentCount === 2 && emptyCount === 2) {
    score -= 4; // Block opponent's two in a row
  }
  
  return score;
}

/**
 * Evaluate the entire board position
 * Higher score = better for the AI player
 * @param {Array<Array<number>>} board - The game board
 * @param {number} aiPlayer - AI player number (1 or 2)
 * @returns {number} Board evaluation score
 */
function evaluateBoard(board, aiPlayer) {
  let score = 0;
  
  // Center column preference (strategic advantage)
  const centerCol = 3;
  const centerCount = board.filter(row => row[centerCol] === aiPlayer).length;
  score += centerCount * 6;
  
  // Check all horizontal windows
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 4; col++) {
      const window = [board[row][col], board[row][col+1], board[row][col+2], board[row][col+3]];
      score += evaluateWindow(window, aiPlayer);
    }
  }
  
  // Check all vertical windows
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 7; col++) {
      const window = [board[row][col], board[row+1][col], board[row+2][col], board[row+3][col]];
      score += evaluateWindow(window, aiPlayer);
    }
  }
  
  // Check all diagonal windows (/)
  for (let row = 3; row < 6; row++) {
    for (let col = 0; col < 4; col++) {
      const window = [board[row][col], board[row-1][col+1], board[row-2][col+2], board[row-3][col+3]];
      score += evaluateWindow(window, aiPlayer);
    }
  }
  
  // Check all diagonal windows (\)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const window = [board[row][col], board[row+1][col+1], board[row+2][col+2], board[row+3][col+3]];
      score += evaluateWindow(window, aiPlayer);
    }
  }
  
  return score;
}

/**
 * Check if the game is in a terminal state (win/loss/draw)
 * @param {Array<Array<number>>} board - The game board
 * @returns {boolean} True if game is over
 */
function isTerminalNode(board) {
  // Check if board is full
  if (c4.isBoardFull(board)) {
    return true;
  }
  
  // Check if there's a winner (need to check last moves)
  // This is a simplified check - in practice, we track the last move
  return false;
}

/**
 * Minimax algorithm with alpha-beta pruning
 * @param {Array<Array<number>>} board - Current board state
 * @param {number} depth - Remaining search depth
 * @param {number} alpha - Alpha value for pruning
 * @param {number} beta - Beta value for pruning
 * @param {boolean} maximizingPlayer - True if maximizing, false if minimizing
 * @param {number} aiPlayer - AI player number (1 or 2)
 * @returns {number} Best score for this position
 */
function minimax(board, depth, alpha, beta, maximizingPlayer, aiPlayer) {
  const validCols = getValidColumns(board);
  const opponent = aiPlayer === 1 ? 2 : 1;
  
  // Check terminal conditions
  if (depth === 0 || validCols.length === 0) {
    return evaluateBoard(board, aiPlayer);
  }
  
  if (maximizingPlayer) {
    let maxScore = -Infinity;
    
    for (const col of validCols) {
      const row = getDropRow(board, col);
      if (row === -1) continue;
      
      // Make move
      const tempBoard = board.map(r => [...r]);
      tempBoard[row][col] = aiPlayer;
      
      // Check for immediate win
      const winner = c4.checkWinner(tempBoard, row, col);
      if (winner === aiPlayer) {
        return WIN_SCORE;
      }
      
      // Recurse
      const score = minimax(tempBoard, depth - 1, alpha, beta, false, aiPlayer);
      maxScore = Math.max(maxScore, score);
      alpha = Math.max(alpha, score);
      
      // Alpha-beta pruning
      if (beta <= alpha) {
        break;
      }
    }
    
    return maxScore;
  } else {
    let minScore = Infinity;
    
    for (const col of validCols) {
      const row = getDropRow(board, col);
      if (row === -1) continue;
      
      // Make move
      const tempBoard = board.map(r => [...r]);
      tempBoard[row][col] = opponent;
      
      // Check for immediate loss
      const winner = c4.checkWinner(tempBoard, row, col);
      if (winner === opponent) {
        return LOSE_SCORE;
      }
      
      // Recurse
      const score = minimax(tempBoard, depth - 1, alpha, beta, true, aiPlayer);
      minScore = Math.min(minScore, score);
      beta = Math.min(beta, score);
      
      // Alpha-beta pruning
      if (beta <= alpha) {
        break;
      }
    }
    
    return minScore;
  }
}

/**
 * Get a random valid move (for easy difficulty)
 * @param {Array<Array<number>>} board - Current game board
 * @returns {number} Random valid column (0-6)
 */
function getRandomMove(board) {
  const validCols = getValidColumns(board);
  return validCols[Math.floor(Math.random() * validCols.length)];
}

/**
 * Get the best move for the AI player
 * Main entry point for AI decision making
 * @param {Array<Array<number>>} board - Current game board
 * @param {number} aiPlayer - AI player number (1 or 2)
 * @param {string} difficulty - Difficulty level: 'easy', 'normal', or 'hard'
 * @param {Function} progressCallback - Optional callback (current, total) for progress updates
 * @returns {number} Best column to play (0-6)
 */
function getAIMove(board, aiPlayer, difficulty = 'normal', progressCallback = null) {
  const validCols = getValidColumns(board);
  
  if (validCols.length === 0) {
    // Should never happen, but safety check
    return 3; // Return center column
  }
  
  if (validCols.length === 1) {
    // Only one option
    return validCols[0];
  }
  
  const difficultyConfig = DIFFICULTY_LEVELS[difficulty] || DIFFICULTY_LEVELS.normal;
  console.log(`[C4 AI] Difficulty: ${difficultyConfig.name}, Depth: ${difficultyConfig.depth}`);
  
  // Easy mode: 60% random, 40% smart (block wins)
  if (difficulty === 'easy' && Math.random() < 0.6) {
    const col = getRandomMove(board);
    console.log(`[C4 AI] Easy mode - Random move: column ${col + 1}`);
    return col;
  }
  
  // First move optimization: play center
  const moveCount = board.flat().filter(cell => cell !== 0).length;
  if (moveCount === 0) {
    return 3; // Center column
  }
  
  console.log('[C4 AI] Calculating best move...');
  const startTime = Date.now();
  
  let bestScore = -Infinity;
  let bestCol = validCols[0];
  const opponent = aiPlayer === 1 ? 2 : 1;
  
  // Check for immediate winning move
  for (const col of validCols) {
    const row = getDropRow(board, col);
    if (row === -1) continue;
    
    const tempBoard = board.map(r => [...r]);
    tempBoard[row][col] = aiPlayer;
    
    if (c4.checkWinner(tempBoard, row, col) === aiPlayer) {
      console.log(`[C4 AI] Found winning move: column ${col + 1} (${Date.now() - startTime}ms)`);
      return col;
    }
  }
  
  // Check for blocking opponent's winning move
  for (const col of validCols) {
    const row = getDropRow(board, col);
    if (row === -1) continue;
    
    const tempBoard = board.map(r => [...r]);
    tempBoard[row][col] = opponent;
    
    if (c4.checkWinner(tempBoard, row, col) === opponent) {
      console.log(`[C4 AI] Blocking opponent's winning move: column ${col + 1} (${Date.now() - startTime}ms)`);
      return col;
    }
  }
  
  // Evaluate each possible move with minimax
  let columnIndex = 0;
  for (const col of validCols) {
    const row = getDropRow(board, col);
    if (row === -1) continue;
    
    // Simulate move
    const tempBoard = board.map(r => [...r]);
    tempBoard[row][col] = aiPlayer;
    
    // Run minimax with difficulty-based depth
    const score = minimax(tempBoard, difficultyConfig.depth - 1, -Infinity, Infinity, false, aiPlayer);
    
    console.log(`[C4 AI] Column ${col + 1}: score ${score}`);
    
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
    
    columnIndex++;
    
    // Report progress AFTER evaluation (so user sees actual progress)
    if (progressCallback) {
      progressCallback(columnIndex, validCols.length);
    }
  }
  
  const elapsed = Date.now() - startTime;
  console.log(`[C4 AI] Best move: column ${bestCol + 1} (score: ${bestScore}, time: ${elapsed}ms, depth: ${difficultyConfig.depth})`);
  
  return bestCol;
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  getAIMove,
  getValidColumns,
  evaluateBoard,
  DIFFICULTY_LEVELS
};
