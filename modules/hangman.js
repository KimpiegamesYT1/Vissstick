/**
 * Hangman Game Module
 * Pure game logic for word guessing game with Dutch words
 */

// =====================================================
// CONSTANTS
// =====================================================

/**
 * Dutch word list for hangman game
 * ~100 common Dutch words (5-10 letters)
 */
const DUTCH_WORDS = [
  'APPEL', 'BOEK', 'COMPUTER', 'DELTA', 'ENERGIE',
  'FIETS', 'GITAAR', 'HOND', 'IJZER', 'JAZZ',
  'KAAS', 'LAMP', 'MAAN', 'NACHT', 'OGEN',
  'PIANO', 'QUEUE', 'REGEN', 'STORM', 'TAFEL',
  'FLORIS', 'VADER', 'WATER', 'STIJN', 'YOGA',
  'ZEBRA', 'AARDE', 'BAKKER', 'CIRCUS', 'DROOM',
  'EILAND', 'FABRIEK', 'GELUID', 'HAVEN', 'INDIA',
  'JURK', 'KAMER', 'LERAAR', 'MARKT', 'NIEUW',
  'ORKEST', 'PAPIER', 'RADIO', 'SCHOOL', 'THEATER',
  'UURWERK', 'VERHAAL', 'WINKEL', 'ZOMER', 'BANAAN',
  'CHOCOLA', 'DIAMANT', 'EEKHOORN', 'FAMILIE', 'GOUDEN',
  'HOOFD', 'IJSJE', 'KOFFIE', 'LENTE', 'MELK',
  'NUMMER', 'OKTOBER', 'PENNEN', 'RAPPORT', 'SLEUTEL',
  'TREIN', 'VAKANTIE', 'WERELD', 'ZAAG', 'BLOEM',
  'CIJFER', 'DANSEN', 'ECOLOGIE', 'FRUIT', 'GROEN',
  'HERFST', 'IDEE', 'JANUARI', 'KRANT', 'LOPEN',
  'MOEDER', 'NATUUR', 'OEFENING', 'PLASTIC', 'ROBOT',
  'SCHRIJVEN', 'TEKEN', 'VRAGEN', 'WINTER', 'ZINGEN',
  'ARTIKEL', 'BEDRIJF', 'CULTUUR', 'DOKTER', 'ENGAGEMENT',
  'FIETSEN', 'GEMEENTE', 'HORIZON', 'INTERNET', 'JURKEN'
];

/**
 * ASCII art stages for hangman (7 stages: 0 = empty, 6 = complete)
 */
const HANGMAN_STAGES = [
  // Stage 0: Empty gallows
  `
   ┌─────┐
   │     
   │     
   │     
   │     
   │     
  ─┴─────`,
  
  // Stage 1: Head
  `
   ┌─────┐
   │     │
   │     O
   │     
   │     
   │     
  ─┴─────`,
  
  // Stage 2: Body
  `
   ┌─────┐
   │     │
   │     O
   │     │
   │     
   │     
  ─┴─────`,
  
  // Stage 3: Left arm
  `
   ┌─────┐
   │     │
   │     O
   │    ─│
   │     
   │     
  ─┴─────`,
  
  // Stage 4: Right arm
  `
   ┌─────┐
   │     │
   │     O
   │    ─│─
   │     
   │     
  ─┴─────`,
  
  // Stage 5: Left leg
  `
   ┌─────┐
   │     │
   │     O
   │    ─│─
   │    ─
   │     
  ─┴─────`,
  
  // Stage 6: Right leg (game over)
  `
   ┌─────┐
   │     │
   │     O
   │    ─│─
   │    ─ ─
   │     
  ─┴─────`
];

const MAX_WRONG_GUESSES = 6;

// =====================================================
// GAME LOGIC FUNCTIONS
// =====================================================

/**
 * Get a random word from the word list
 * @returns {string} Random Dutch word in uppercase
 */
function getRandomWord() {
  return DUTCH_WORDS[Math.floor(Math.random() * DUTCH_WORDS.length)];
}

/**
 * Create a new hangman game state
 * @param {string} [word] - Optional word to use (default: random)
 * @returns {Object} New game state object
 */
function createGame(word = null) {
  return {
    word: word ? word.toUpperCase() : getRandomWord(),
    guessedLetters: new Set(),
    wrongGuesses: 0,
    maxWrong: MAX_WRONG_GUESSES
  };
}

/**
 * Process a letter guess
 * @param {Object} gameState - Current game state
 * @param {string} letter - Letter to guess (will be uppercased)
 * @returns {Object} Result object with game status
 */
function processGuess(gameState, letter) {
  const upperLetter = letter.toUpperCase();
  
  // Check if already guessed
  if (gameState.guessedLetters.has(upperLetter)) {
    return {
      correct: false,
      alreadyGuessed: true,
      gameOver: false,
      won: false
    };
  }
  
  // Add to guessed letters
  gameState.guessedLetters.add(upperLetter);
  
  // Check if letter is in word
  const correct = gameState.word.includes(upperLetter);
  
  if (!correct) {
    gameState.wrongGuesses++;
  }
  
  // Check for game over
  const gameOver = gameState.wrongGuesses >= gameState.maxWrong || isWordComplete(gameState.word, gameState.guessedLetters);
  const won = gameOver && isWordComplete(gameState.word, gameState.guessedLetters);
  
  return {
    correct,
    alreadyGuessed: false,
    gameOver,
    won
  };
}

/**
 * Check if the word has been completely guessed
 * @param {string} word - The target word
 * @param {Set<string>} guessedLetters - Set of guessed letters
 * @returns {boolean} True if word is complete
 */
function isWordComplete(word, guessedLetters) {
  return [...word].every(letter => guessedLetters.has(letter));
}

/**
 * Get word display with guessed letters revealed
 * @param {string} word - The target word
 * @param {Set<string>} guessedLetters - Set of guessed letters
 * @returns {string} Display string like "H_LL_"
 */
function getWordDisplay(word, guessedLetters) {
  return [...word].map(letter => guessedLetters.has(letter) ? letter : '_').join(' ');
}

/**
 * Get list of available (unguessed) letters
 * @param {Set<string>} guessedLetters - Set of already guessed letters
 * @returns {string[]} Array of available letters
 */
function getAvailableLetters(guessedLetters) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return [...alphabet].filter(letter => !guessedLetters.has(letter));
}

/**
 * Get letters that were guessed incorrectly
 * @param {string} word - The target word
 * @param {Set<string>} guessedLetters - Set of guessed letters
 * @returns {string[]} Array of wrong letters
 */
function getWrongLetters(word, guessedLetters) {
  return [...guessedLetters].filter(letter => !word.includes(letter));
}

/**
 * Get the current hangman ASCII art stage
 * @param {number} wrongGuesses - Number of wrong guesses
 * @returns {string} ASCII art for current stage
 */
function getHangmanStage(wrongGuesses) {
  const stage = Math.min(wrongGuesses, HANGMAN_STAGES.length - 1);
  return HANGMAN_STAGES[stage];
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  DUTCH_WORDS,
  HANGMAN_STAGES,
  MAX_WRONG_GUESSES,
  getRandomWord,
  createGame,
  processGuess,
  isWordComplete,
  getWordDisplay,
  getAvailableLetters,
  getWrongLetters,
  getHangmanStage
};
