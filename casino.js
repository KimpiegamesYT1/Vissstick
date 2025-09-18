const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const casinoDataPath = path.join(__dirname, 'casino-data.json');

// Casino configuration
const CASINO_CONFIG = {
  FREE_TOKENS_AMOUNT: 10,
  FREE_TOKENS_INTERVAL: 3600000, // 1 hour in milliseconds
  MAX_TOKENS_DEFAULT: 100,
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
      tokens: 25, // Starting tokens
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
    .setDescription(`Welkom in het casino, <@${userId}>!`)
    .addFields(
      { name: `${EMOJIS.TOKENS} Tokens`, value: `${playerData.tokens}/${playerData.maxTokens}`, inline: true },
      { name: '⏰ Volgende gratis tokens', value: nextClaimTime, inline: true },
      { name: '🎮 Games gespeeld', value: playerData.gamesPlayed.toString(), inline: true },
      { name: '🏆 Totale winst', value: playerData.totalWins.toString(), inline: true },
      { name: '💔 Totaal verlies', value: playerData.totalLosses.toString(), inline: true },
      { name: '💰 Grootste winst', value: playerData.biggestWin.toString(), inline: true }
    )
    .setColor('#FFD700')
    .setFooter({ text: 'Kies een optie hieronder!' });

  const row1 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('casino_collect')
        .setLabel('Claim Tokens')
        .setEmoji(EMOJIS.COLLECT)
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canClaimTokens(playerData)),
      new ButtonBuilder()
        .setCustomId('casino_slots')
        .setLabel('Slots')
        .setEmoji(EMOJIS.SLOTS)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(playerData.tokens < CASINO_CONFIG.SLOT_COST),
      new ButtonBuilder()
        .setCustomId('casino_roulette')
        .setLabel('Roulette')
        .setEmoji(EMOJIS.ROULETTE)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(playerData.tokens < CASINO_CONFIG.ROULETTE_MIN_BET)
    );

  const row2 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('casino_blackjack')
        .setLabel('Blackjack')
        .setEmoji(EMOJIS.BLACKJACK)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(playerData.tokens < CASINO_CONFIG.BLACKJACK_MIN_BET),
      new ButtonBuilder()
        .setCustomId('casino_wheel')
        .setLabel('Daily Wheel')
        .setEmoji(EMOJIS.WHEEL)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!canDailyWheel),
      new ButtonBuilder()
        .setCustomId('casino_upgrades')
        .setLabel('Upgrades')
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
  
  // Slot symbols with different rarities
  const symbols = ['🍒', '🍊', '🍋', '🍇', '🔔', '⭐', '💎'];
  const weights = [30, 25, 20, 15, 7, 2, 1]; // Higher = more common
  
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
    const multipliers = [10, 15, 20, 30, 50, 100, 500]; // Based on rarity
    winnings = CASINO_CONFIG.SLOT_COST * multipliers[symbolIndex];
    winType = 'JACKPOT! Drie van hetzelfde!';
  } else if (result[0] === result[1] || result[1] === result[2] || result[0] === result[2]) {
    // Two of a kind
    winnings = CASINO_CONFIG.SLOT_COST * 2;
    winType = 'Twee van hetzelfde!';
  }
  
  if (winnings > 0) {
    playerData.tokens += winnings;
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
    .setTitle('🔴 Roulette')
    .setDescription('Plaats je inzet!')
    .addFields(
      { name: 'Je tokens', value: `${playerData.tokens}`, inline: true },
      { name: 'Min. inzet', value: `${CASINO_CONFIG.ROULETTE_MIN_BET}`, inline: true },
      { name: 'Uitbetalingen', value: 'Rood/Zwart: 2x\nSpecifiek getal: 36x', inline: false }
    )
    .setColor('#FF0000');
  
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
    playerData.tokens += winnings;
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
  
  // Wheel prizes with different probabilities
  const prizes = [
    { type: 'tokens', amount: 50, chance: 30, display: '50 Tokens' },
    { type: 'tokens', amount: 25, chance: 40, display: '25 Tokens' },
    { type: 'tokens', amount: 100, chance: 15, display: '100 Tokens' },
    { type: 'multiplier', amount: 2, chance: 8, display: '2x Token Boost (1u)' },
    { type: 'tokens', amount: 200, chance: 5, display: '200 Tokens' },
    { type: 'jackpot', amount: 500, chance: 2, display: 'JACKPOT! 500 Tokens' }
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
    playerData.tokens = Math.min(playerData.tokens + selectedPrize.amount, playerData.maxTokens);
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
    tokenMultiplier: [100, 250, 500, 1000],
    vaultSize: [150, 300, 600, 1200],
    autoCollector: 2000
  };
  
  const tokenMultLevel = playerData.upgrades.tokenMultiplier;
  const vaultLevel = playerData.upgrades.vaultSize;
  
  const embed = new EmbedBuilder()
    .setTitle('⬆️ Casino Upgrades')
    .setDescription(`Je tokens: ${playerData.tokens}`)
    .addFields(
      { 
        name: `${EMOJIS.TOKENS} Token Multiplier (Level ${tokenMultLevel})`, 
        value: tokenMultLevel >= 4 ? 'MAX LEVEL' : `Kost: ${upgradeCosts.tokenMultiplier[tokenMultLevel]} tokens\nEffect: +0.5x tokens per uur`, 
        inline: false 
      },
      { 
        name: `🏦 Vault Size (Level ${vaultLevel})`, 
        value: vaultLevel >= 4 ? 'MAX LEVEL' : `Kost: ${upgradeCosts.vaultSize[vaultLevel]} tokens\nEffect: +50 max tokens`, 
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
    tokenMultiplier: [100, 250, 500, 1000],
    vaultSize: [150, 300, 600, 1200],
    autoCollector: 2000
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
        playerData.tokenMultiplier = 1 + (playerData.upgrades.tokenMultiplier * 0.5);
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
        playerData.maxTokens = CASINO_CONFIG.MAX_TOKENS_DEFAULT + (playerData.upgrades.vaultSize * 50);
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
  EMOJIS
};