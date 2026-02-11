/**
 * Connect Four (4 op een rij) Game Logic Module
 * Pure game logic without Discord dependencies
 */

/**
 * Creates a new empty Connect Four board
 * Board is 6 rows (height) × 7 columns (width)
 * @returns {Array<Array<number>>} 2D array where 0 = empty, 1 = player 1, 2 = player 2
 */
function createBoard() {
  const rows = 6;
  const cols = 7;
  const board = [];
  
  for (let r = 0; r < rows; r++) {
    board.push(new Array(cols).fill(0));
  }
  
  return board;
}

/**
 * Attempts to drop a piece in the specified column
 * @param {Array<Array<number>>} board - The game board
 * @param {number} column - Column index (0-6)
 * @param {number} player - Player number (1 or 2)
 * @returns {Object} {success: boolean, board: Array, row: number|null}
 */
function dropPiece(board, column, player) {
  // Validate column
  if (column < 0 || column >= 7) {
    return { success: false, board, row: null };
  }
  
  // Find the lowest empty row in this column (gravity effect)
  let targetRow = -1;
  for (let row = 5; row >= 0; row--) {
    if (board[row][column] === 0) {
      targetRow = row;
      break;
    }
  }
  
  // Column is full
  if (targetRow === -1) {
    return { success: false, board, row: null };
  }
  
  // Place the piece
  const newBoard = board.map(row => [...row]); // Deep copy
  newBoard[targetRow][column] = player;
  
  return { success: true, board: newBoard, row: targetRow };
}

/**
 * Checks if there's a winner after placing a piece at the given position
 * @param {Array<Array<number>>} board - The game board
 * @param {number} lastRow - Row index of last placed piece
 * @param {number} lastCol - Column index of last placed piece
 * @returns {number|null} Winner player number (1 or 2) or null if no winner
 */
function checkWinner(board, lastRow, lastCol) {
  const player = board[lastRow][lastCol];
  if (player === 0) return null;
  
  // Check all four directions: horizontal, vertical, diagonal /, diagonal \
  const directions = [
    { dr: 0, dc: 1 },   // Horizontal
    { dr: 1, dc: 0 },   // Vertical
    { dr: 1, dc: 1 },   // Diagonal \
    { dr: 1, dc: -1 }   // Diagonal /
  ];
  
  for (const { dr, dc } of directions) {
    let count = 1; // Count the piece we just placed
    
    // Check in positive direction
    for (let i = 1; i < 4; i++) {
      const r = lastRow + (dr * i);
      const c = lastCol + (dc * i);
      
      if (r < 0 || r >= 6 || c < 0 || c >= 7 || board[r][c] !== player) {
        break;
      }
      count++;
    }
    
    // Check in negative direction
    for (let i = 1; i < 4; i++) {
      const r = lastRow - (dr * i);
      const c = lastCol - (dc * i);
      
      if (r < 0 || r >= 6 || c < 0 || c >= 7 || board[r][c] !== player) {
        break;
      }
      count++;
    }
    
    // Found 4 or more in a row
    if (count >= 4) {
      return player;
    }
  }
  
  return null;
}

/**
 * Checks if the board is completely full (draw condition)
 * @param {Array<Array<number>>} board - The game board
 * @returns {boolean} True if board is full
 */
function isBoardFull(board) {
  // Check top row - if any column has an empty space at the top, board isn't full
  for (let col = 0; col < 7; col++) {
    if (board[0][col] === 0) {
      return false;
    }
  }
  return true;
}

/**
 * Checks if a specific column is full
 * @param {Array<Array<number>>} board - The game board
 * @param {number} column - Column index (0-6)
 * @returns {boolean} True if column is full
 */
function isColumnFull(board, column) {
  if (column < 0 || column >= 7) return true;
  return board[0][column] !== 0;
}

/**
 * Renders the board as a string with emojis
 * @param {Array<Array<number>>} board - The game board
 * @returns {string} Visual representation of the board
 */
function renderBoard(board) {
  const emojis = {
    0: '⚪', // Empty
    1: '🔴', // Player 1
    2: '🟢'  // Player 2
  };
  
  let output = '';
  
  // Render board from top to bottom
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      output += emojis[board[row][col]];
    }
    output += '\n';
  }
  
  // Add column numbers below
  output += '1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣';
  
  return output;
}

module.exports = {
  createBoard,
  dropPiece,
  checkWinner,
  isBoardFull,
  isColumnFull,
  renderBoard
};
