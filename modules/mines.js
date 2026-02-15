const crypto = require('crypto');

const TOTAL_TILES = 20;

function shuffleArrayCrypto(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateMines(total = TOTAL_TILES, mines = 3) {
  const indices = Array.from({ length: total }, (_, i) => i);
  shuffleArrayCrypto(indices);
  return new Set(indices.slice(0, mines));
}

/**
 * Calculate multiplier after a successful safe pick using per-pick factor:
 * factor = (remainingTiles / remainingSafeTiles) * HOUSE_EDGE
 * multiplier *= factor
 */
function calculateNextMultiplier(currentMultiplier, openedSafeCountBeforePick, total = TOTAL_TILES, mines = 3, houseEdge = 0.97) {
  const opened = openedSafeCountBeforePick; // number safe already opened before this pick
  const remainingTiles = total - opened; // includes the tile we're about to open
  const remainingSafe = total - mines - opened;
  if (remainingSafe <= 0) return currentMultiplier; // shouldn't happen
  const factor = (remainingTiles / remainingSafe) * houseEdge;
  const next = currentMultiplier * factor;
  return Math.round(next * 100) / 100; // 2 decimals
}

function calculatePayout(bet, multiplier, payoutCapMultiplier = 3) {
  const raw = Math.floor(bet * multiplier);
  const cap = Math.floor(bet * payoutCapMultiplier);
  return Math.min(raw, cap);
}

module.exports = {
  TOTAL_TILES,
  generateMines,
  calculateNextMultiplier,
  calculatePayout
};
