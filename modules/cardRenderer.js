/**
 * Card Renderer - Genereert hand-afbeeldingen voor Blackjack
 * Combineert individuele kaart-PNG's tot een enkele handafbeelding
 */

const sharp = require('sharp');
const path = require('path');

const CARDS_DIR = path.join(__dirname, '..', 'audio', 'Cards');

// Kaartafmetingen (geschaald)
const CARD_WIDTH = 100;
const CARD_HEIGHT = 145;
const CARD_SPACING = 10;
const HAND_PADDING = 15;
const SECTION_GAP = 30;
const LABEL_HEIGHT = 30;

// Kleuren
const BG_COLOR = { r: 43, g: 45, b: 49, alpha: 1 }; // Discord dark theme
const CARD_BACK_COLOR = { r: 59, g: 99, b: 184, alpha: 1 };

/**
 * Map een kaartobject naar een bestandsnaam
 */
function cardToFilename(card) {
  const rankMap = {
    'A': 'ace', '2': '2', '3': '3', '4': '4', '5': '5',
    '6': '6', '7': '7', '8': '8', '9': '9', '10': '10',
    'J': 'jack', 'Q': 'queen', 'K': 'king'
  };
  const suitMap = {
    '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs'
  };

  const rank = rankMap[card.rank];
  const suit = suitMap[card.suit];
  return `${rank}_of_${suit}.png`;
}

/**
 * Maak een kaart-achterkant afbeelding (voor verborgen dealer kaart)
 */
async function createCardBack() {
  // Blauwe kaartrug met randje
  const svg = `
    <svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}">
      <rect x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="8" ry="8" fill="#1a1a2e"/>
      <rect x="4" y="4" width="${CARD_WIDTH - 8}" height="${CARD_HEIGHT - 8}" rx="6" ry="6" fill="#3b63b8"/>
      <rect x="10" y="10" width="${CARD_WIDTH - 20}" height="${CARD_HEIGHT - 20}" rx="4" ry="4" fill="none" stroke="#5b83d8" stroke-width="2"/>
      <text x="${CARD_WIDTH / 2}" y="${CARD_HEIGHT / 2 + 5}" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#5b83d8" text-anchor="middle">?</text>
    </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Laad en resize een kaart-PNG
 */
async function loadCardImage(card) {
  const filename = cardToFilename(card);
  const filepath = path.join(CARDS_DIR, filename);

  return sharp(filepath)
    .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'fill' })
    .png()
    .toBuffer();
}

/**
 * Maak een tekst-label als SVG buffer
 */
async function createLabel(text, width) {
  const escapedText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `
    <svg width="${width}" height="${LABEL_HEIGHT}">
      <text x="0" y="22" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${escapedText}</text>
    </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Render een rij kaarten naast elkaar
 * @returns {Buffer} PNG buffer van de kaartrij
 */
async function renderCardRow(cards, hideSecond = false) {
  const cardCount = cards.length;
  const rowWidth = cardCount * CARD_WIDTH + (cardCount - 1) * CARD_SPACING;

  const composites = [];

  for (let i = 0; i < cards.length; i++) {
    let cardBuffer;
    if (hideSecond && i === 1) {
      cardBuffer = await createCardBack();
    } else {
      cardBuffer = await loadCardImage(cards[i]);
    }

    composites.push({
      input: cardBuffer,
      left: i * (CARD_WIDTH + CARD_SPACING),
      top: 0
    });
  }

  return sharp({
    create: {
      width: rowWidth,
      height: CARD_HEIGHT,
      channels: 4,
      background: BG_COLOR
    }
  })
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * Render de volledige Blackjack tafel (dealer + speler handen)
 * @param {Card[]} dealerCards - Dealer kaarten
 * @param {Card[]} playerCards - Speler kaarten (of lege array bij split)
 * @param {boolean} hideDealer - Verberg de tweede dealer kaart
 * @param {string} dealerLabel - Label voor dealer hand
 * @param {string} playerLabel - Label voor speler hand
 * @param {Object} [splitOptions] - Extra opties voor split-rendering
 * @param {Array} [splitOptions.hands] - Array van {cards, bet, status}
 * @param {number} [splitOptions.activeHandIndex] - Welke hand actief is
 * @param {boolean} [splitOptions.finished] - Of het spel afgelopen is
 * @returns {Buffer} PNG buffer van de volledige tafel
 */
async function renderBlackjackTable(dealerCards, playerCards, hideDealer = true, dealerLabel = 'Dealer', playerLabel = 'Jij', splitOptions = null) {
  const isSplit = splitOptions && splitOptions.hands && splitOptions.hands.length > 0;

  if (!isSplit) {
    // Normale render (1 speler hand)
    return renderNormalTable(dealerCards, playerCards, hideDealer, dealerLabel, playerLabel);
  }

  // Split render (meerdere speler handen)
  return renderSplitTable(dealerCards, hideDealer, dealerLabel, playerLabel, splitOptions);
}

/**
 * Render normale (niet-split) Blackjack tafel
 */
async function renderNormalTable(dealerCards, playerCards, hideDealer, dealerLabel, playerLabel) {
  const maxCards = Math.max(dealerCards.length, playerCards.length);
  const tableWidth = Math.max(
    maxCards * CARD_WIDTH + (maxCards - 1) * CARD_SPACING,
    200 // minimum breedte
  ) + HAND_PADDING * 2;

  const tableHeight = LABEL_HEIGHT + CARD_HEIGHT + SECTION_GAP + LABEL_HEIGHT + CARD_HEIGHT + HAND_PADDING * 2;

  // Render de kaartrijen
  const dealerRow = await renderCardRow(dealerCards, hideDealer);
  const playerRow = await renderCardRow(playerCards);

  // Render labels
  const bj = require('./blackjack');
  const dealerValue = bj.calculateHandValue(dealerCards).value;
  const playerValue = bj.calculateHandValue(playerCards).value;
  const dLabelText = hideDealer ? `${dealerLabel} (?)` : `${dealerLabel} (${dealerValue})`;
  const pLabelText = `${playerLabel} (${playerValue})`;
  const dLabel = await createLabel(dLabelText, tableWidth);
  const pLabel = await createLabel(pLabelText, tableWidth);

  const composites = [
    // Dealer label
    { input: dLabel, left: HAND_PADDING, top: HAND_PADDING },
    // Dealer kaarten
    { input: dealerRow, left: HAND_PADDING, top: HAND_PADDING + LABEL_HEIGHT },
    // Speler label
    { input: pLabel, left: HAND_PADDING, top: HAND_PADDING + LABEL_HEIGHT + CARD_HEIGHT + SECTION_GAP },
    // Speler kaarten
    { input: playerRow, left: HAND_PADDING, top: HAND_PADDING + LABEL_HEIGHT + CARD_HEIGHT + SECTION_GAP + LABEL_HEIGHT }
  ];

  return sharp({
    create: {
      width: tableWidth,
      height: tableHeight,
      channels: 4,
      background: BG_COLOR
    }
  })
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * Render split Blackjack tafel (dealer + 2 speler handen)
 */
async function renderSplitTable(dealerCards, hideDealer, dealerLabel, playerLabel, splitOptions) {
  const { hands, activeHandIndex, finished } = splitOptions;
  const handCount = hands.length;

  // Bereken maximale kaarten over alle handen
  let maxCards = dealerCards.length;
  for (const hand of hands) {
    maxCards = Math.max(maxCards, hand.cards.length);
  }

  const tableWidth = Math.max(
    maxCards * CARD_WIDTH + (maxCards - 1) * CARD_SPACING,
    200
  ) + HAND_PADDING * 2;

  // Hoogte: dealer + N handen (elk met label + kaarten + gap)
  const sectionHeight = LABEL_HEIGHT + CARD_HEIGHT;
  const tableHeight = HAND_PADDING * 2 + sectionHeight + (handCount * (SECTION_GAP + sectionHeight));

  const composites = [];
  let yOffset = HAND_PADDING;

  // Dealer
  const dLabelText = hideDealer ? `${dealerLabel} (?)` : `${dealerLabel} (${require('./blackjack').calculateHandValue(dealerCards).value})`;
  const dLabel = await createLabel(dLabelText, tableWidth);
  const dealerRow = await renderCardRow(dealerCards, hideDealer);
  composites.push({ input: dLabel, left: HAND_PADDING, top: yOffset });
  yOffset += LABEL_HEIGHT;
  composites.push({ input: dealerRow, left: HAND_PADDING, top: yOffset });
  yOffset += CARD_HEIGHT;

  // Speler handen
  for (let i = 0; i < handCount; i++) {
    yOffset += SECTION_GAP;
    const hand = hands[i];
    const handValue = require('./blackjack').calculateHandValue(hand.cards).value;
    const isActive = !finished && i === activeHandIndex;
    const marker = isActive ? '▶ ' : '';
    const statusText = hand.status === 'bust' ? ' 💥' : hand.status === 'stand' ? ' ✋' : '';
    const handLabel = `${marker}Hand ${i + 1} (${handValue})${statusText} — ${hand.bet} pt`;

    const hLabel = await createLabel(handLabel, tableWidth);
    const handRow = await renderCardRow(hand.cards);
    composites.push({ input: hLabel, left: HAND_PADDING, top: yOffset });
    yOffset += LABEL_HEIGHT;
    composites.push({ input: handRow, left: HAND_PADDING, top: yOffset });
    yOffset += CARD_HEIGHT;
  }

  return sharp({
    create: {
      width: tableWidth,
      height: tableHeight,
      channels: 4,
      background: BG_COLOR
    }
  })
    .composite(composites)
    .png()
    .toBuffer();
}

module.exports = {
  renderBlackjackTable,
  cardToFilename
};
