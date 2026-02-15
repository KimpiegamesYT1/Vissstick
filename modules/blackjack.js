/**
 * Blackjack module - Pure spellogica (geen Discord-afhankelijkheid)
 */

const { randomInt } = require('crypto');

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/**
 * Maak een geschud deck van 52 kaarten
 */
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  // Fisher-Yates shuffle (cryptografisch veilig)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Trek een kaart van het deck
 */
function dealCard(deck) {
  if (deck.length === 0) {
    throw new Error('Deck is leeg - geen kaarten meer beschikbaar');
  }
  return deck.pop();
}

/**
 * Numerieke waarde van een kaart (Aas = 11, plaatjes = 10)
 */
function cardValue(card) {
  if (card.rank === 'A') return 11;
  if (['K', 'Q', 'J'].includes(card.rank)) return 10;
  return parseInt(card.rank);
}

/**
 * Bereken handwaarde met soft/hard Aas logica
 * @returns {{ value: number, soft: boolean }}
 */
function calculateHandValue(cards) {
  let value = 0;
  let aces = 0;

  for (const card of cards) {
    value += cardValue(card);
    if (card.rank === 'A') aces++;
  }

  // Verlaag Azen van 11 naar 1 als we boven 21 zitten
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }

  return { value, soft: aces > 0 };
}

/**
 * Formatteer een kaart als tekst: "A♠"
 */
function formatCard(card) {
  return `${card.rank}${card.suit}`;
}

/**
 * Formatteer een hele hand als tekst
 * @param {boolean} hideSecond - Verberg de tweede kaart (voor dealer)
 */
function formatHand(cards, hideSecond = false) {
  if (hideSecond && cards.length >= 2) {
    return `${formatCard(cards[0])}  🂠`;
  }
  return cards.map(formatCard).join('  ');
}

/**
 * Check of een hand Blackjack is (precies 2 kaarten, waarde 21)
 */
function isBlackjack(cards) {
  return cards.length === 2 && calculateHandValue(cards).value === 21;
}

/**
 * Check of een hand bust is (waarde > 21)
 */
function isBusted(cards) {
  return calculateHandValue(cards).value > 21;
}

/**
 * Check of de speler kan double-downen (precies 2 kaarten)
 */
function canDouble(cards) {
  if (cards.length !== 2) return false;
  const { value } = calculateHandValue(cards);
  return value === 9 || value === 10 || value === 11;
}

/**
 * Check of de speler kan splitsen (precies 2 kaarten met dezelfde rang)
 */
function canSplit(cards) {
  return cards.length === 2 && cards[0].rank === cards[1].rank;
}

/**
 * Check of de dealer nog moet trekken (< 17)
 */
function shouldDealerHit(cards) {
  return calculateHandValue(cards).value < 17;
}

/**
 * Speel de dealer uit: trek kaarten tot >= 17
 * @returns {Card[]} De dealer kaarten na het spelen
 */
function playDealer(deck, dealerCards) {
  while (shouldDealerHit(dealerCards)) {
    dealerCards.push(dealCard(deck));
  }
  return dealerCards;
}

/**
 * Bepaal het resultaat van de hand
 * @returns {'blackjack' | 'win' | 'push' | 'lose'}
 */
function determineOutcome(playerCards, dealerCards) {
  const playerBJ = isBlackjack(playerCards);
  const dealerBJ = isBlackjack(dealerCards);

  // Beide Blackjack = push
  if (playerBJ && dealerBJ) return 'push';
  // Alleen speler Blackjack
  if (playerBJ) return 'blackjack';
  // Alleen dealer Blackjack
  if (dealerBJ) return 'lose';

  const playerValue = calculateHandValue(playerCards).value;
  const dealerValue = calculateHandValue(dealerCards).value;

  // Speler bust
  if (playerValue > 21) return 'lose';
  // Dealer bust
  if (dealerValue > 21) return 'win';
  // Vergelijk waarden
  if (playerValue > dealerValue) return 'win';
  if (playerValue < dealerValue) return 'lose';
  return 'push';
}

/**
 * Bereken uitbetaling op basis van resultaat
 * @param {number} bet - Originele inzet
 * @param {string} outcome - 'blackjack' | 'win' | 'push' | 'lose'
 * @returns {number} Bedrag dat terug naar speler gaat (0 bij verlies)
 */
function calculatePayout(bet, outcome) {
  switch (outcome) {
    case 'blackjack': return bet + Math.floor(bet * 1.5);  // inzet + 1.5x winst (house uses floor)
    case 'win': return bet * 2;                       // 1x winst (inzet + 1x terug)
    case 'push': return bet;                          // Inzet terug
    case 'lose': return 0;                            // Niets
    default: return 0;
  }
}

module.exports = {
  createDeck,
  dealCard,
  calculateHandValue,
  formatCard,
  formatHand,
  isBlackjack,
  isBusted,
  canDouble,
  canSplit,
  shouldDealerHit,
  playDealer,
  determineOutcome,
  calculatePayout
};
