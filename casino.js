const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const casinoDataPath = path.join(__dirname, 'casino-data.json');

// Blackjack game state storage
const blackjackGames = new Map();

// Card values and suits for blackjack
const BLACKJACK_CARDS = {
  suits: ['♠️', '♥️', '♦️', '♣️'],
  ranks: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'],
  values: { 'A': 11, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 10, 'Q': 10, 'K': 10 }
};

// Create a new deck
function createDeck() {
  const deck = [];
  for (const suit of BLACKJACK_CARDS.suits) {
    for (const rank of BLACKJACK_CARDS.ranks) {
      deck.push({ suit, rank, value: BLACKJACK_CARDS.values[rank] });
    }
  }
  return shuffleDeck(deck);
}

// Shuffle deck
function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Calculate hand value (handling Aces)
function calculateHandValue(hand) {
  let value = 0;
  let aces = 0;
  
  for (const card of hand) {
    if (card.rank === 'A') {
      aces++;
      value += 11;
    } else {
      value += card.value;
    }
  }
  
  // Convert Aces from 11 to 1 if needed
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  
  return value;
}

// Format hand for display with better visibility
function formatHand(hand, hideFirst = false) {
  if (hideFirst && hand.length > 0) {
    const hiddenCard = '🂠';
    const visibleCards = hand.slice(1).map(card => `${card.rank}${card.suit}`);
    return `${hiddenCard} ${visibleCards.join(' ')}`;
  }
  return hand.map(card => `${card.rank}${card.suit}`).join(' ');
}

// Get hand description for clarity
function getHandDescription(hand, value) {
  const cardCount = hand.length;
  let description = '';
  
  if (value === 21 && cardCount === 2) {
    description = ' **🎉 BLACKJACK!**';
  } else if (value > 21) {
    description = ' **💥 BUST!**';
  } else if (value === 21) {
    description = ' **🎯 Perfect 21!**';
  }
  
  return description;
}

// Create blackjack bet selection menu
function createBlackjackMenu(playerData) {
  const embed = new EmbedBuilder()
    .setTitle('🃏 Blackjack Tafel')
    .setDescription('**Welkom bij Blackjack!**\n\nHet doel is om zo dicht mogelijk bij 21 te komen zonder eroverheen te gaan.\n\n📋 **Spelregels:**\n• Kaarten 2-10 = face value\n• J, Q, K = 10 punten\n• Aas = 11 of 1 (automatisch)\n• Dealer stopt bij 17\n• Blackjack (21 met 2 kaarten) = 2.5x uitbetaling')
    .addFields(
      { name: '💰 Je tokens', value: `${playerData.tokens}`, inline: true },
      { name: '💵 Min. inzet', value: `${CASINO_CONFIG.BLACKJACK_MIN_BET} tokens`, inline: true },
      { name: '🎯 Kies je inzet', value: 'Selecteer hieronder hoeveel je wilt inzetten!', inline: false }
    )
    .setColor('#2F3136')
    .setFooter({ text: 'Veel succes aan de blackjack tafel! 🍀' });

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('blackjack_bet_2')
        .setLabel('Inzet: 2 tokens')
        .setEmoji('🪙')
        .setStyle(ButtonStyle.Success)
        .setDisabled(playerData.tokens < 2),
      new ButtonBuilder()
        .setCustomId('blackjack_bet_5')
        .setLabel('Inzet: 5 tokens')
        .setEmoji('🪙')
        .setStyle(ButtonStyle.Success)
        .setDisabled(playerData.tokens < 5),
      new ButtonBuilder()
        .setCustomId('blackjack_bet_10')
        .setLabel('Inzet: 10 tokens')
        .setEmoji('🪙')
        .setStyle(ButtonStyle.Success)
        .setDisabled(playerData.tokens < 10),
      new ButtonBuilder()
        .setCustomId('casino_menu')
        .setLabel('Terug')
        .setEmoji(EMOJIS.BACK)
        .setStyle(ButtonStyle.Secondary)
    );

  return { embeds: [embed], components: [row] };
}
async function startBlackjack(userId, betAmount) {
  const playerData = await getPlayerData(userId);
  
  if (playerData.tokens < betAmount) {
    return { error: `❌ Niet genoeg tokens! Je hebt ${playerData.tokens} tokens, maar je probeert ${betAmount} tokens in te zetten.` };
  }
  
  if (betAmount < CASINO_CONFIG.BLACKJACK_MIN_BET) {
    return { error: `❌ Minimum inzet is ${CASINO_CONFIG.BLACKJACK_MIN_BET} tokens!` };
  }
  
  playerData.tokens -= betAmount;
  playerData.gamesPlayed++;
  
  const deck = createDeck();
  const playerHand = [deck.pop(), deck.pop()];
  const dealerHand = [deck.pop(), deck.pop()];
  
  const gameState = {
    deck,
    playerHand,
    dealerHand,
    betAmount,
    gameOver: false,
    playerValue: calculateHandValue(playerHand),
    dealerValue: calculateHandValue([dealerHand[0]]) // Only show first card
  };
  
  blackjackGames.set(userId, gameState);
  
  // Check for natural blackjack
  if (gameState.playerValue === 21) {
    return await finishBlackjack(userId, 'blackjack');
  }
  
  await updatePlayerData(userId, playerData);
  
  const embed = new EmbedBuilder()
    .setTitle('🃏 Blackjack Tafel')
    .setDescription('**Welkom bij Blackjack!**\nKom zo dicht mogelijk bij 21 zonder eroverheen te gaan!')
    .addFields(
      { name: '🎯 Jouw hand', value: `${formatHand(playerHand)} = **${gameState.playerValue}**`, inline: false },
      { name: '🏦 Dealer hand', value: `${formatHand(dealerHand, true)} = **${calculateHandValue([dealerHand[0]])}** + ?`, inline: false },
      { name: '💰 Inzet', value: `${betAmount} tokens`, inline: true },
      { name: '🪙 Resterende tokens', value: `${playerData.tokens}`, inline: true }
    )
    .setColor('#2F3136')
    .setFooter({ text: 'Hit = nieuwe kaart, Stand = stoppen met huidige hand' });
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('blackjack_hit')
        .setLabel('Hit')
        .setEmoji('👆')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('blackjack_stand')
        .setLabel('Stand')
        .setEmoji('✋')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('casino_menu')
        .setLabel('Opgeven')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
    );
  
  return { embeds: [embed], components: [row] };
}

// Handle blackjack hit
async function blackjackHit(userId) {
  const gameState = blackjackGames.get(userId);
  if (!gameState || gameState.gameOver) {
    return { error: 'Geen actieve blackjack game!' };
  }
  
  const newCard = gameState.deck.pop();
  gameState.playerHand.push(newCard);
  gameState.playerValue = calculateHandValue(gameState.playerHand);
  
  if (gameState.playerValue > 21) {
    return await finishBlackjack(userId, 'bust');
  }
  
  if (gameState.playerValue === 21) {
    return await finishBlackjack(userId, 'stand');
  }
  
  const playerData = await getPlayerData(userId);
  
  const embed = new EmbedBuilder()
    .setTitle('🃏 Blackjack - Hit!')
    .setDescription(`Je trok: **${newCard.rank}${newCard.suit}**`)
    .addFields(
      { name: '🎯 Jouw hand', value: `${formatHand(gameState.playerHand)} = **${gameState.playerValue}**`, inline: false },
      { name: '🏦 Dealer hand', value: `${formatHand(gameState.dealerHand, true)} = **${calculateHandValue([gameState.dealerHand[0]])}** + ?`, inline: false },
      { name: '💰 Inzet', value: `${gameState.betAmount} tokens`, inline: true },
      { name: '🪙 Resterende tokens', value: `${playerData.tokens}`, inline: true }
    )
    .setColor('#2F3136')
    .setFooter({ text: 'Nog een kaart of stoppen?' });
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('blackjack_hit')
        .setLabel('Hit')
        .setEmoji('👆')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('blackjack_stand')
        .setLabel('Stand')
        .setEmoji('✋')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('casino_menu')
        .setLabel('Opgeven')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
    );
  
  return { embeds: [embed], components: [row] };
}

// Handle blackjack stand
async function blackjackStand(userId) {
  const gameState = blackjackGames.get(userId);
  if (!gameState || gameState.gameOver) {
    return { error: 'Geen actieve blackjack game!' };
  }
  
  return await finishBlackjack(userId, 'stand');
}

// Finish blackjack game
async function finishBlackjack(userId, action) {
  const gameState = blackjackGames.get(userId);
  if (!gameState) {
    return { error: 'Geen actieve blackjack game!' };
  }
  
  gameState.gameOver = true;
  
  // Dealer plays (if player didn't bust)
  if (action !== 'bust') {
    while (calculateHandValue(gameState.dealerHand) < 17) {
      gameState.dealerHand.push(gameState.deck.pop());
    }
  }
  
  const finalPlayerValue = calculateHandValue(gameState.playerHand);
  const finalDealerValue = calculateHandValue(gameState.dealerHand);
  
  let result = '';
  let winnings = 0;
  let resultColor = '#FF0000';
  
  if (action === 'bust') {
    result = '💥 **BUST!** Je ging over 21!';
    resultColor = '#FF0000';
  } else if (action === 'blackjack') {
    result = '🎉 **BLACKJACK!** Perfect 21!';
    winnings = Math.floor(gameState.betAmount * 2.5); // 3:2 payout
    resultColor = '#FFD700';
  } else if (finalDealerValue > 21) {
    result = '🎉 **JE WINT!** Dealer ging bust!';
    winnings = gameState.betAmount * 2;
    resultColor = '#00FF00';
  } else if (finalPlayerValue > finalDealerValue) {
    result = '🎉 **JE WINT!** Hogere hand dan dealer!';
    winnings = gameState.betAmount * 2;
    resultColor = '#00FF00';
  } else if (finalPlayerValue === finalDealerValue) {
    result = '🤝 **GELIJKSPEL!** Inzet teruggekregen!';
    winnings = gameState.betAmount;
    resultColor = '#FFFF00';
  } else {
    result = '😞 **VERLOREN!** Dealer had betere hand!';
    resultColor = '#FF0000';
  }
  
  const playerData = await getPlayerData(userId);
  
  if (winnings > 0) {
    const tokenResult = addTokensWithLimit(playerData, winnings);
    if (winnings > gameState.betAmount) { // Only count as win if more than bet back
      playerData.totalWins += winnings - gameState.betAmount;
      if (winnings - gameState.betAmount > playerData.biggestWin) {
        playerData.biggestWin = winnings - gameState.betAmount;
      }
    }
  } else {
    playerData.totalLosses += gameState.betAmount;
  }
  
  await updatePlayerData(userId, playerData);
  blackjackGames.delete(userId);
  
  const embed = new EmbedBuilder()
    .setTitle('🃏 Blackjack Resultaat')
    .setDescription(result)
    .addFields(
      { name: '🎯 Jouw hand', value: `${formatHand(gameState.playerHand)} = **${finalPlayerValue}**`, inline: false },
      { name: '🏦 Dealer hand', value: `${formatHand(gameState.dealerHand)} = **${finalDealerValue}**`, inline: false },
      { name: '💰 Inzet', value: `${gameState.betAmount} tokens`, inline: true },
      { name: '🎁 Winst', value: `${winnings} tokens`, inline: true },
      { name: '🪙 Nieuwe saldo', value: `${playerData.tokens} tokens`, inline: true }
    )
    .setColor(resultColor);
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('blackjack_bet_2')
        .setLabel('Nieuwe ronde (2 tokens)')
        .setEmoji('🎮')
        .setStyle(ButtonStyle.Success)
        .setDisabled(playerData.tokens < 2),
      new ButtonBuilder()
        .setCustomId('blackjack_bet_5')
        .setLabel('Nieuwe ronde (5 tokens)')
        .setEmoji('🎮')
        .setStyle(ButtonStyle.Success)
        .setDisabled(playerData.tokens < 5),
      new ButtonBuilder()
        .setCustomId('blackjack_bet_10')
        .setLabel('Nieuwe ronde (10 tokens)')
        .setEmoji('🎮')
        .setStyle(ButtonStyle.Success)
        .setDisabled(playerData.tokens < 10),
      new ButtonBuilder()
        .setCustomId('casino_menu')
        .setLabel('Terug naar menu')
        .setEmoji(EMOJIS.BACK)
        .setStyle(ButtonStyle.Secondary)
    );
  
  return { embeds: [embed], components: [row] };
}

// Casino configuration
const CASINO_CONFIG = {
  FREE_TOKENS_AMOUNT: 25, // Meer gratis tokens per uur
  FREE_TOKENS_INTERVAL: 3600000, // 1 hour in milliseconds
  MAX_TOKENS_DEFAULT: 200, // Veel hoger startlimiet
  SLOT_COST: 5,
  ROULETTE_MIN_BET: 1,
  BLACKJACK_MIN_BET: 2,
  DAILY_WHEEL_COOLDOWN: 86400000, // 24 hours
};

// Emoji constants
const EMOJIS = {
  TOKENS: '🪙',
  SLOTS: '🎰',
  ROULETTE: '🔴',
  BLACKJACK: '🃏',
  WHEEL: '🎡',
  UPGRADE: '⬆️',
  COLLECT: '💰',
  BACK: '◀️',
  PLAY: '▶️',
  SPIN: '🔄',
  BET: '💵',
  HIT: '👆',
  STAND: '✋',
  JACKPOT: '💎',
  WIN: '🎉'
};

// Helper function to add tokens with vault limit check
function addTokensWithLimit(playerData, tokensToAdd) {
  const oldTokens = playerData.tokens;
  const newTokens = Math.min(playerData.tokens + tokensToAdd, playerData.maxTokens);
  const actualTokensAdded = newTokens - oldTokens;
  const tokensLost = tokensToAdd - actualTokensAdded;
  
  playerData.tokens = newTokens;
  
  return {
    tokensAdded: actualTokensAdded,
    tokensLost: tokensLost,
    maxReached: newTokens >= playerData.maxTokens
  };
}

// Load casino data
async function loadCasinoData() {
  try {
    const data = await fs.readFile(casinoDataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { players: {} };
  }
}

// Save casino data
async function saveCasinoData(data) {
  await fs.writeFile(casinoDataPath, JSON.stringify(data, null, 2));
}

// Get or create player data
async function getPlayerData(userId) {
  const casinoData = await loadCasinoData();
  
  if (!casinoData.players[userId]) {
    casinoData.players[userId] = {
      tokens: 100, // Veel meer starting tokens
      lastTokenClaim: 0,
      maxTokens: CASINO_CONFIG.MAX_TOKENS_DEFAULT,
      tokenMultiplier: 1,
      autoCollector: false,
      lastDailyWheel: 0,
      totalWins: 0,
      totalLosses: 0,
      biggestWin: 0,
      gamesPlayed: 0,
      upgrades: {
        tokenMultiplier: 0,
        vaultSize: 0,
        autoCollector: false
      }
    };
    await saveCasinoData(casinoData);
  } else {
    // Upgrade bestaande spelers naar nieuwe economie
    const player = casinoData.players[userId];
    let updated = false;
    
    // Geef bestaande spelers meer tokens als ze vastzitten
    if (player.tokens < 75 && player.maxTokens < 200) {
      player.tokens = Math.max(player.tokens, 100);
      updated = true;
    }
    
    // Update max tokens naar nieuwe standaard
    if (player.maxTokens < CASINO_CONFIG.MAX_TOKENS_DEFAULT) {
      player.maxTokens = CASINO_CONFIG.MAX_TOKENS_DEFAULT + (player.upgrades.vaultSize * 100);
      updated = true;
    }
    
    // Fix token multiplier naar nieuwe berekening
    if (player.upgrades && player.upgrades.tokenMultiplier > 0) {
      player.tokenMultiplier = 1 + (player.upgrades.tokenMultiplier * 0.75);
      updated = true;
    }
    
    if (updated) {
      await saveCasinoData(casinoData);
    }
  }
  
  return casinoData.players[userId];
}

// Update player data
async function updatePlayerData(userId, playerData) {
  const casinoData = await loadCasinoData();
  casinoData.players[userId] = playerData;
  await saveCasinoData(casinoData);
}

// Check if player can claim free tokens
function canClaimTokens(playerData) {
  return Date.now() - playerData.lastTokenClaim >= CASINO_CONFIG.FREE_TOKENS_INTERVAL;
}

// Claim free tokens
async function claimTokens(userId) {
  const playerData = await getPlayerData(userId);
  
  if (!canClaimTokens(playerData)) {
    const timeLeft = CASINO_CONFIG.FREE_TOKENS_INTERVAL - (Date.now() - playerData.lastTokenClaim);
    const minutes = Math.ceil(timeLeft / (1000 * 60));
    return { success: false, message: `Je moet nog ${minutes} minuten wachten!` };
  }
  
  const tokensToAdd = CASINO_CONFIG.FREE_TOKENS_AMOUNT * playerData.tokenMultiplier;
  const newTokens = Math.min(playerData.tokens + tokensToAdd, playerData.maxTokens);
  const actualTokensAdded = newTokens - playerData.tokens;
  
  playerData.tokens = newTokens;
  playerData.lastTokenClaim = Date.now();
  
  await updatePlayerData(userId, playerData);
  
  return { 
    success: true, 
    tokensAdded: actualTokensAdded,
    totalTokens: newTokens,
    maxReached: newTokens >= playerData.maxTokens 
  };
}

// Main casino menu
function createCasinoMenu(playerData, userId) {
  const nextClaimTime = canClaimTokens(playerData) ? 'Nu beschikbaar!' : 
    `${Math.ceil((CASINO_CONFIG.FREE_TOKENS_INTERVAL - (Date.now() - playerData.lastTokenClaim)) / (1000 * 60))} min`;
  
  const canDailyWheel = Date.now() - playerData.lastDailyWheel >= CASINO_CONFIG.DAILY_WHEEL_COOLDOWN;
  
  const embed = new EmbedBuilder()
    .setTitle('🎰 Lucky Hour Casino')
    .setDescription(`Welkom in het casino, <@${userId}>!\n\n**🎮 Beschikbare Spellen:**\n• **Slots** (${CASINO_CONFIG.SLOT_COST} tokens) - Match 3 symbolen voor winst!\n• **Roulette** (min. ${CASINO_CONFIG.ROULETTE_MIN_BET} token) - Gok op rood, zwart of lucky number!\n• **Blackjack** (min. ${CASINO_CONFIG.BLACKJACK_MIN_BET} tokens) - Kom zo dicht mogelijk bij 21!\n• **Daily Wheel** (gratis, 1x per dag) - Spin het gelukswiel!\n\n💡 **Tip:** Upgrade je kluis en token multiplier voor meer winst!`)
    .addFields(
      { name: `${EMOJIS.TOKENS} Tokens`, value: `${playerData.tokens}/${playerData.maxTokens}`, inline: true },
      { name: '⏰ Gratis tokens', value: nextClaimTime, inline: true },
      { name: '💰 Token multiplier', value: `${playerData.tokenMultiplier}x`, inline: true },
      { name: '� Games gespeeld', value: playerData.gamesPlayed.toString(), inline: true },
      { name: '🏆 Totale winst', value: `${playerData.totalWins} tokens`, inline: true },
      { name: '� Grootste winst', value: `${playerData.biggestWin} tokens`, inline: true }
    )
    .setColor('#FFD700')
    .setFooter({ text: 'Veel geluk en speel verantwoord! 🍀' });

  const row1 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('casino_collect')
        .setLabel(`Claim ${CASINO_CONFIG.FREE_TOKENS_AMOUNT * playerData.tokenMultiplier} Tokens`)
        .setEmoji(EMOJIS.COLLECT)
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canClaimTokens(playerData)),
      new ButtonBuilder()
        .setCustomId('casino_slots')
        .setLabel(`Slots (${CASINO_CONFIG.SLOT_COST} tokens)`)
        .setEmoji(EMOJIS.SLOTS)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(playerData.tokens < CASINO_CONFIG.SLOT_COST),
      new ButtonBuilder()
        .setCustomId('casino_roulette')
        .setLabel(`Roulette (${CASINO_CONFIG.ROULETTE_MIN_BET}+ tokens)`)
        .setEmoji(EMOJIS.ROULETTE)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(playerData.tokens < CASINO_CONFIG.ROULETTE_MIN_BET)
    );

  const row2 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('casino_blackjack')
        .setLabel(`Blackjack (${CASINO_CONFIG.BLACKJACK_MIN_BET}+ tokens)`)
        .setEmoji(EMOJIS.BLACKJACK)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(playerData.tokens < CASINO_CONFIG.BLACKJACK_MIN_BET),
      new ButtonBuilder()
        .setCustomId('casino_wheel')
        .setLabel(canDailyWheel ? 'Daily Wheel (Gratis!)' : 'Daily Wheel (24u wachten)')
        .setEmoji(EMOJIS.WHEEL)
        .setStyle(canDailyWheel ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!canDailyWheel),
      new ButtonBuilder()
        .setCustomId('casino_upgrades')
        .setLabel('Shop & Upgrades')
        .setEmoji(EMOJIS.UPGRADE)
        .setStyle(ButtonStyle.Secondary)
    );

  return { embeds: [embed], components: [row1, row2] };
}

// Slot machine game
async function playSlots(userId) {
  const playerData = await getPlayerData(userId);
  
  if (playerData.tokens < CASINO_CONFIG.SLOT_COST) {
    return { error: 'Niet genoeg tokens!' };
  }
  
  playerData.tokens -= CASINO_CONFIG.SLOT_COST;
  playerData.gamesPlayed++;
  
  // Slot symbols with different rarities (betere kansen)
  const symbols = ['🍒', '🍊', '🍋', '🍇', '🔔', '⭐', '💎'];
  const weights = [25, 20, 18, 15, 10, 7, 5]; // Betere verdeling, meer kans op wins
  
  function getRandomSymbol() {
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    
    for (let i = 0; i < symbols.length; i++) {
      random -= weights[i];
      if (random <= 0) return symbols[i];
    }
    return symbols[0];
  }
  
  const result = [getRandomSymbol(), getRandomSymbol(), getRandomSymbol()];
  let winnings = 0;
  let winType = '';
  
  // Check for wins
  if (result[0] === result[1] && result[1] === result[2]) {
    // Three of a kind
    const symbolIndex = symbols.indexOf(result[0]);
    const multipliers = [15, 20, 25, 40, 75, 150, 750]; // Hogere uitbetalingen
    winnings = CASINO_CONFIG.SLOT_COST * multipliers[symbolIndex];
    winType = 'JACKPOT! Drie van hetzelfde!';
  } else if (result[0] === result[1] || result[1] === result[2] || result[0] === result[2]) {
    // Two of a kind
    winnings = CASINO_CONFIG.SLOT_COST * 3; // Betere uitbetaling voor two of a kind
    winType = 'Twee van hetzelfde!';
  }
  
  if (winnings > 0) {
    const tokenResult = addTokensWithLimit(playerData, winnings);
    playerData.totalWins += winnings;
    if (winnings > playerData.biggestWin) {
      playerData.biggestWin = winnings;
    }
  } else {
    playerData.totalLosses += CASINO_CONFIG.SLOT_COST;
  }
  
  await updatePlayerData(userId, playerData);
  
  const embed = new EmbedBuilder()
    .setTitle('🎰 Slot Machine')
    .setDescription(`**${result.join(' | ')}**\n\n${winType || 'Helaas, geen winst!'}`)
    .addFields(
      { name: 'Inzet', value: `${CASINO_CONFIG.SLOT_COST} tokens`, inline: true },
      { name: 'Winst', value: `${winnings} tokens`, inline: true },
      { name: 'Saldo', value: `${playerData.tokens} tokens`, inline: true }
    )
    .setColor(winnings > 0 ? '#00FF00' : '#FF0000');
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('casino_slots')
        .setLabel('Opnieuw spelen')
        .setEmoji(EMOJIS.SPIN)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(playerData.tokens < CASINO_CONFIG.SLOT_COST),
      new ButtonBuilder()
        .setCustomId('casino_menu')
        .setLabel('Terug naar menu')
        .setEmoji(EMOJIS.BACK)
        .setStyle(ButtonStyle.Secondary)
    );
  
  return { embeds: [embed], components: [row] };
}

// Roulette game
function createRouletteMenu(playerData) {
  const embed = new EmbedBuilder()
    .setTitle('🔴 Roulette Tafel')
    .setDescription('**Welkom bij de roulette tafel!**\n\nKies je inzet en waag je kans!\n\n🔴 **Rood** = nummers 1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36\n⚫ **Zwart** = alle andere nummers (behalve 0)\n🟢 **0** = huis wint\n🍀 **Lucky Number 7** = 36x uitbetaling!')
    .addFields(
      { name: '💰 Je tokens', value: `${playerData.tokens}`, inline: true },
      { name: '💵 Min. inzet', value: `${CASINO_CONFIG.ROULETTE_MIN_BET} token`, inline: true },
      { name: '💎 Uitbetalingen', value: 'Rood/Zwart: **2x**\nLucky Number 7: **36x**', inline: true }
    )
    .setColor('#FF0000')
    .setFooter({ text: 'Plaats je inzet en laat het wiel draaien! 🎲' });
  
  const row1 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('roulette_red_1')
        .setLabel('Rood (1 token)')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(playerData.tokens < 1),
      new ButtonBuilder()
        .setCustomId('roulette_black_1')
        .setLabel('Zwart (1 token)')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(playerData.tokens < 1),
      new ButtonBuilder()
        .setCustomId('roulette_red_5')
        .setLabel('Rood (5 tokens)')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(playerData.tokens < 5)
    );
  
  const row2 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('roulette_black_5')
        .setLabel('Zwart (5 tokens)')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(playerData.tokens < 5),
      new ButtonBuilder()
        .setCustomId('roulette_lucky_10')
        .setLabel('Lucky Number (10 tokens)')
        .setStyle(ButtonStyle.Success)
        .setDisabled(playerData.tokens < 10),
      new ButtonBuilder()
        .setCustomId('casino_menu')
        .setLabel('Terug')
        .setEmoji(EMOJIS.BACK)
        .setStyle(ButtonStyle.Secondary)
    );
  
  return { embeds: [embed], components: [row1, row2] };
}

// Play roulette
async function playRoulette(userId, betType, betAmount) {
  const playerData = await getPlayerData(userId);
  
  if (playerData.tokens < betAmount) {
    return { error: 'Niet genoeg tokens!' };
  }
  
  playerData.tokens -= betAmount;
  playerData.gamesPlayed++;
  
  const spinResult = Math.floor(Math.random() * 37); // 0-36
  const isRed = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(spinResult);
  const isBlack = spinResult !== 0 && !isRed;
  
  let won = false;
  let winnings = 0;
  
  if (betType === 'red' && isRed) {
    won = true;
    winnings = betAmount * 2;
  } else if (betType === 'black' && isBlack) {
    won = true;
    winnings = betAmount * 2;
  } else if (betType === 'lucky' && spinResult === 7) { // Lucky number 7
    won = true;
    winnings = betAmount * 36;
  }
  
  if (won) {
    const tokenResult = addTokensWithLimit(playerData, winnings);
    playerData.totalWins += winnings;
    if (winnings > playerData.biggestWin) {
      playerData.biggestWin = winnings;
    }
  } else {
    playerData.totalLosses += betAmount;
  }
  
  await updatePlayerData(userId, playerData);
  
  const resultColor = spinResult === 0 ? '🟢' : (isRed ? '🔴' : '⚫');
  
  const embed = new EmbedBuilder()
    .setTitle('🔴 Roulette Resultaat')
    .setDescription(`De bal viel op: **${resultColor} ${spinResult}**\n\n${won ? `${EMOJIS.WIN} Je hebt gewonnen!` : 'Helaas, verloren!'}`)
    .addFields(
      { name: 'Inzet', value: `${betAmount} tokens op ${betType}`, inline: true },
      { name: 'Winst', value: `${winnings} tokens`, inline: true },
      { name: 'Saldo', value: `${playerData.tokens} tokens`, inline: true }
    )
    .setColor(won ? '#00FF00' : '#FF0000');
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('casino_roulette')
        .setLabel('Opnieuw spelen')
        .setEmoji(EMOJIS.SPIN)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(playerData.tokens < CASINO_CONFIG.ROULETTE_MIN_BET),
      new ButtonBuilder()
        .setCustomId('casino_menu')
        .setLabel('Terug naar menu')
        .setEmoji(EMOJIS.BACK)
        .setStyle(ButtonStyle.Secondary)
    );
  
  return { embeds: [embed], components: [row] };
}

// Daily wheel
async function spinDailyWheel(userId) {
  const playerData = await getPlayerData(userId);
  
  const timeSinceLastSpin = Date.now() - playerData.lastDailyWheel;
  if (timeSinceLastSpin < CASINO_CONFIG.DAILY_WHEEL_COOLDOWN) {
    const hoursLeft = Math.ceil((CASINO_CONFIG.DAILY_WHEEL_COOLDOWN - timeSinceLastSpin) / (1000 * 60 * 60));
    return { error: `Je moet nog ${hoursLeft} uur wachten!` };
  }
  
  playerData.lastDailyWheel = Date.now();
  
  // Wheel prizes with different probabilities (betere prijzen)
  const prizes = [
    { type: 'tokens', amount: 75, chance: 30, display: '75 Tokens' },
    { type: 'tokens', amount: 50, chance: 25, display: '50 Tokens' },
    { type: 'tokens', amount: 125, chance: 20, display: '125 Tokens' },
    { type: 'multiplier', amount: 2, chance: 10, display: '2x Token Boost (1u)' },
    { type: 'tokens', amount: 200, chance: 10, display: '200 Tokens' },
    { type: 'jackpot', amount: 500, chance: 5, display: 'JACKPOT! 500 Tokens' }
  ];
  
  let random = Math.random() * 100;
  let selectedPrize = prizes[0];
  
  for (const prize of prizes) {
    if (random <= prize.chance) {
      selectedPrize = prize;
      break;
    }
    random -= prize.chance;
  }
  
  if (selectedPrize.type === 'tokens' || selectedPrize.type === 'jackpot') {
    const tokenResult = addTokensWithLimit(playerData, selectedPrize.amount);
  }
  
  await updatePlayerData(userId, playerData);
  
  const embed = new EmbedBuilder()
    .setTitle('🎡 Daily Wheel')
    .setDescription(`${EMOJIS.SPIN} Het wiel draait...\n\n🎉 **Je hebt gewonnen: ${selectedPrize.display}!**`)
    .addFields(
      { name: 'Huidige tokens', value: `${playerData.tokens}`, inline: true },
      { name: 'Volgende spin', value: '24 uur', inline: true }
    )
    .setColor('#FFD700');
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('casino_menu')
        .setLabel('Terug naar menu')
        .setEmoji(EMOJIS.BACK)
        .setStyle(ButtonStyle.Secondary)
    );
  
  return { embeds: [embed], components: [row] };
}

// Upgrades menu
function createUpgradesMenu(playerData) {
  const upgradeCosts = {
    tokenMultiplier: [75, 150, 350, 750], // Betaalbaar met vault
    vaultSize: [100, 200, 450, 900], // Eerste upgrade is betaalbaar!
    autoCollector: 500 // Veel lager, meer bereikbaar
  };
  
  const tokenMultLevel = playerData.upgrades.tokenMultiplier;
  const vaultLevel = playerData.upgrades.vaultSize;
  
  const embed = new EmbedBuilder()
    .setTitle('⬆️ Casino Upgrades')
    .setDescription(`Je tokens: ${playerData.tokens}`)
    .addFields(
      { 
        name: `${EMOJIS.TOKENS} Token Multiplier (Level ${tokenMultLevel})`, 
        value: tokenMultLevel >= 4 ? 'MAX LEVEL' : `Kost: ${upgradeCosts.tokenMultiplier[tokenMultLevel]} tokens\nEffect: +0.75x tokens per uur`, 
        inline: false 
      },
      { 
        name: `🏦 Vault Size (Level ${vaultLevel})`, 
        value: vaultLevel >= 4 ? 'MAX LEVEL' : `Kost: ${upgradeCosts.vaultSize[vaultLevel]} tokens\nEffect: +100 max tokens`, 
        inline: false 
      },
      { 
        name: '🤖 Auto Collector', 
        value: playerData.upgrades.autoCollector ? 'UNLOCKED' : `Kost: ${upgradeCosts.autoCollector} tokens\nEffect: Automatisch tokens verzamelen`, 
        inline: false 
      }
    )
    .setColor('#9932CC');
  
  const row1 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('upgrade_multiplier')
        .setLabel('Token Multiplier')
        .setEmoji('🔢')
        .setStyle(ButtonStyle.Success)
        .setDisabled(tokenMultLevel >= 4 || playerData.tokens < upgradeCosts.tokenMultiplier[tokenMultLevel]),
      new ButtonBuilder()
        .setCustomId('upgrade_vault')
        .setLabel('Vault Size')
        .setEmoji('🏦')
        .setStyle(ButtonStyle.Success)
        .setDisabled(vaultLevel >= 4 || playerData.tokens < upgradeCosts.vaultSize[vaultLevel])
    );
  
  const row2 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('upgrade_auto')
        .setLabel('Auto Collector')
        .setEmoji('🤖')
        .setStyle(ButtonStyle.Success)
        .setDisabled(playerData.upgrades.autoCollector || playerData.tokens < upgradeCosts.autoCollector),
      new ButtonBuilder()
        .setCustomId('casino_menu')
        .setLabel('Terug')
        .setEmoji(EMOJIS.BACK)
        .setStyle(ButtonStyle.Secondary)
    );
  
  return { embeds: [embed], components: [row1, row2] };
}

// Handle upgrade purchase
async function purchaseUpgrade(userId, upgradeType) {
  const playerData = await getPlayerData(userId);
  const upgradeCosts = {
    tokenMultiplier: [75, 150, 350, 750], // Betaalbaar met vault
    vaultSize: [100, 200, 450, 900], // Eerste upgrade is betaalbaar!
    autoCollector: 500 // Veel lager, meer bereikbaar
  };
  
  let cost, success = false, message = '';
  
  if (upgradeType === 'multiplier') {
    const level = playerData.upgrades.tokenMultiplier;
    if (level >= 4) {
      message = 'Maximaal level bereikt!';
    } else {
      cost = upgradeCosts.tokenMultiplier[level];
      if (playerData.tokens >= cost) {
        playerData.tokens -= cost;
        playerData.upgrades.tokenMultiplier++;
        playerData.tokenMultiplier = 1 + (playerData.upgrades.tokenMultiplier * 0.75); // Betere multiplier bonus
        success = true;
        message = `Token Multiplier geüpgraded naar level ${playerData.upgrades.tokenMultiplier}!`;
      } else {
        message = 'Niet genoeg tokens!';
      }
    }
  } else if (upgradeType === 'vault') {
    const level = playerData.upgrades.vaultSize;
    if (level >= 4) {
      message = 'Maximaal level bereikt!';
    } else {
      cost = upgradeCosts.vaultSize[level];
      if (playerData.tokens >= cost) {
        playerData.tokens -= cost;
        playerData.upgrades.vaultSize++;
        playerData.maxTokens = CASINO_CONFIG.MAX_TOKENS_DEFAULT + (playerData.upgrades.vaultSize * 100); // Meer capaciteit per upgrade
        success = true;
        message = `Vault Size geüpgraded naar level ${playerData.upgrades.vaultSize}!`;
      } else {
        message = 'Niet genoeg tokens!';
      }
    }
  } else if (upgradeType === 'auto') {
    if (playerData.upgrades.autoCollector) {
      message = 'Al aangekocht!';
    } else {
      cost = upgradeCosts.autoCollector;
      if (playerData.tokens >= cost) {
        playerData.tokens -= cost;
        playerData.upgrades.autoCollector = true;
        success = true;
        message = 'Auto Collector aangekocht!';
      } else {
        message = 'Niet genoeg tokens!';
      }
    }
  }
  
  if (success) {
    await updatePlayerData(userId, playerData);
  }
  
  return { success, message, playerData };
}

module.exports = {
  createCasinoMenu,
  getPlayerData,
  claimTokens,
  playSlots,
  createRouletteMenu,
  playRoulette,
  spinDailyWheel,
  createUpgradesMenu,
  purchaseUpgrade,
  createBlackjackMenu,
  startBlackjack,
  blackjackHit,
  blackjackStand,
  finishBlackjack,
  EMOJIS
};