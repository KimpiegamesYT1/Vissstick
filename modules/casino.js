/**
 * Casino module - Prediction Market systeem
 * Bevat alle economie en betting logica
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getDatabase } = require('../database');

// Constanten
const BET_AMOUNT = 400;
const TAX_RATE = 0.10; // 10% belasting
const MAX_PAYOUT = 1200; // 3x inzet
const HARIBO_PRICE = 5000;
const HARIBO_STOCK_PER_MONTH = 4;
const QUIZ_REWARD = 150; // Punten per goed quiz antwoord

// Startbonussen voor top 3
const START_BONUSES = {
  1: 2000,
  2: 1000,
  3: 500
};

/**
 * Get huidige maand key (YYYY-MM)
 */
function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// =====================================================
// USER BALANCE FUNCTIES
// =====================================================

/**
 * Haal user op of maak nieuwe aan
 */
function getOrCreateUser(userId, username) {
  const db = getDatabase();
  
  let user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  
  if (!user) {
    db.prepare(`
      INSERT INTO users (user_id, username, balance)
      VALUES (?, ?, 0)
    `).run(userId, username);
    
    user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  } else if (user.username !== username) {
    // Update username als die veranderd is
    db.prepare('UPDATE users SET username = ? WHERE user_id = ?').run(username, userId);
    user.username = username;
  }
  
  return user;
}

/**
 * Haal user balance op
 */
function getUserBalance(userId) {
  const db = getDatabase();
  const user = db.prepare('SELECT balance FROM users WHERE user_id = ?').get(userId);
  return user ? user.balance : 0;
}

/**
 * Voeg punten toe aan user balance
 */
function addBalance(userId, username, amount, reason = null) {
  const db = getDatabase();
  
  getOrCreateUser(userId, username);
  
  db.prepare(`
    UPDATE users 
    SET balance = balance + ?, 
        total_earned = total_earned + ?,
        last_updated = datetime('now')
    WHERE user_id = ?
  `).run(amount, amount, userId);
  
  return getUserBalance(userId);
}

/**
 * Trek punten af van user balance
 */
function subtractBalance(userId, amount) {
  const db = getDatabase();
  
  db.prepare(`
    UPDATE users 
    SET balance = balance - ?, 
        total_spent = total_spent + ?,
        last_updated = datetime('now')
    WHERE user_id = ?
  `).run(amount, amount, userId);
  
  return getUserBalance(userId);
}

/**
 * Haal top users op gesorteerd op balance
 */
function getTopUsers(limit = 10) {
  const db = getDatabase();
  
  return db.prepare(`
    SELECT user_id, username, balance, total_earned, total_spent
    FROM users
    WHERE balance > 0
    ORDER BY balance DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Haal alle users op met balance > 0
 */
function getAllUsersWithBalance() {
  const db = getDatabase();
  
  return db.prepare(`
    SELECT user_id, username, balance
    FROM users
    WHERE balance > 0
    ORDER BY balance DESC
  `).all();
}

/**
 * Haal positie van user in leaderboard
 */
function getUserPosition(userId) {
  const db = getDatabase();
  
  const result = db.prepare(`
    SELECT COUNT(*) + 1 as position
    FROM users
    WHERE balance > (SELECT COALESCE(balance, 0) FROM users WHERE user_id = ?)
  `).get(userId);
  
  return result ? result.position : 0;
}

// =====================================================
// BET FUNCTIES
// =====================================================

/**
 * Maak een nieuwe bet aan
 */
function createBet(question, createdBy) {
  const db = getDatabase();
  const monthKey = getCurrentMonthKey();
  
  const result = db.prepare(`
    INSERT INTO bets (question, status, month_key, created_by)
    VALUES (?, 'open', ?, ?)
  `).run(question, monthKey, createdBy);
  
  return result.lastInsertRowid;
}

/**
 * Update bet message ID (voor embed updates)
 */
function updateBetMessageId(betId, messageId) {
  const db = getDatabase();
  
  db.prepare(`
    UPDATE bets SET message_id = ? WHERE id = ?
  `).run(messageId, betId);
}

/**
 * Haal alle open bets op
 */
function getOpenBets() {
  const db = getDatabase();
  
  return db.prepare(`
    SELECT * FROM bets 
    WHERE status = 'open'
    ORDER BY created_at DESC
  `).all();
}

/**
 * Haal specifieke bet op met alle entries
 */
function getBetWithEntries(betId) {
  const db = getDatabase();
  
  const bet = db.prepare('SELECT * FROM bets WHERE id = ?').get(betId);
  
  if (!bet) return null;
  
  const entries = db.prepare(`
    SELECT * FROM bet_entries WHERE bet_id = ?
  `).all(betId);
  
  const jaVotes = entries.filter(e => e.choice === 'JA');
  const neeVotes = entries.filter(e => e.choice === 'NEE');
  
  return {
    ...bet,
    entries,
    jaVotes,
    neeVotes,
    totalPool: entries.length * BET_AMOUNT
  };
}

/**
 * Plaats een bet entry
 */
function placeBet(betId, userId, username, choice) {
  const db = getDatabase();
  
  // Check of user al gestemd heeft
  const existing = db.prepare(`
    SELECT * FROM bet_entries WHERE bet_id = ? AND user_id = ?
  `).get(betId, userId);
  
  if (existing) {
    return { success: false, error: 'Je hebt al gestemd op deze weddenschap!' };
  }
  
  // Check balance
  const balance = getUserBalance(userId);
  if (balance < BET_AMOUNT) {
    return { success: false, error: `Je hebt niet genoeg punten! Je hebt ${balance} punten, maar je hebt ${BET_AMOUNT} nodig.` };
  }
  
  // Trek inzet af
  subtractBalance(userId, BET_AMOUNT);
  
  // Plaats bet entry
  db.prepare(`
    INSERT INTO bet_entries (bet_id, user_id, username, choice, amount)
    VALUES (?, ?, ?, ?, ?)
  `).run(betId, userId, username, choice, BET_AMOUNT);
  
  // Update total pool
  db.prepare(`
    UPDATE bets SET total_pool = total_pool + ? WHERE id = ?
  `).run(BET_AMOUNT, betId);
  
  return { success: true };
}

/**
 * Resolve een bet en betaal uit
 */
function resolveBet(betId, outcome) {
  const db = getDatabase();
  
  const bet = getBetWithEntries(betId);
  if (!bet) return { success: false, error: 'Weddenschap niet gevonden!' };
  if (bet.status !== 'open') return { success: false, error: 'Deze weddenschap is al afgesloten!' };
  
  const winners = bet.entries.filter(e => e.choice === outcome);
  const losers = bet.entries.filter(e => e.choice !== outcome);
  
  // Bereken uitbetaling
  const totalPool = bet.totalPool;
  const poolAfterTax = Math.floor(totalPool * (1 - TAX_RATE));
  
  let payoutPerWinner = 0;
  let actualPayout = 0;
  let excessBurned = 0;
  
  if (winners.length > 0) {
    payoutPerWinner = Math.floor(poolAfterTax / winners.length);
    actualPayout = Math.min(payoutPerWinner, MAX_PAYOUT);
    excessBurned = (payoutPerWinner - actualPayout) * winners.length;
  }
  
  // Transaction voor atomiciteit
  const transaction = db.transaction(() => {
    // Update bet status
    db.prepare(`
      UPDATE bets 
      SET status = 'resolved', outcome = ?, resolved_at = datetime('now')
      WHERE id = ?
    `).run(outcome, betId);
    
    // Betaal winnaars uit
    if (winners.length > 0) {
      const updatePayout = db.prepare(`
        UPDATE bet_entries SET payout = ? WHERE bet_id = ? AND user_id = ?
      `);
      
      winners.forEach(winner => {
        addBalance(winner.user_id, winner.username, actualPayout, `Gewonnen bet #${betId}`);
        updatePayout.run(actualPayout, betId, winner.user_id);
      });
    }
  });
  
  transaction();
  
  return {
    success: true,
    bet,
    outcome,
    winners,
    losers,
    totalPool,
    poolAfterTax,
    payoutPerWinner: actualPayout,
    taxBurned: Math.floor(totalPool * TAX_RATE),
    excessBurned
  };
}

/**
 * Laat alle open bets aan einde maand verlopen
 */
function expireOpenBets() {
  const db = getDatabase();
  const monthKey = getCurrentMonthKey();
  
  // Haal alle open bets op
  const openBets = db.prepare(`
    SELECT * FROM bets WHERE status = 'open' AND month_key = ?
  `).all(monthKey);
  
  const expiredBets = [];
  
  const transaction = db.transaction(() => {
    openBets.forEach(bet => {
      const betWithEntries = getBetWithEntries(bet.id);
      
      // Geef iedereen hun inzet terug
      betWithEntries.entries.forEach(entry => {
        addBalance(entry.user_id, entry.username, entry.amount, `Terugbetaling verlopen bet #${bet.id}`);
      });
      
      // Markeer als expired
      db.prepare(`
        UPDATE bets SET status = 'expired', resolved_at = datetime('now')
        WHERE id = ?
      `).run(bet.id);
      
      expiredBets.push(betWithEntries);
    });
  });
  
  transaction();
  
  return expiredBets;
}

// =====================================================
// SHOP FUNCTIES
// =====================================================

/**
 * Haal huidige shop inventory op
 */
function getShopInventory() {
  const db = getDatabase();
  const monthKey = getCurrentMonthKey();
  
  // Check of inventory voor deze maand bestaat
  let inventory = db.prepare('SELECT * FROM shop_inventory WHERE id = 1').get();
  
  if (!inventory || inventory.month_key !== monthKey) {
    // Reset inventory voor nieuwe maand
    db.prepare(`
      INSERT OR REPLACE INTO shop_inventory (id, month_key, haribo_stock)
      VALUES (1, ?, ?)
    `).run(monthKey, HARIBO_STOCK_PER_MONTH);
    
    inventory = db.prepare('SELECT * FROM shop_inventory WHERE id = 1').get();
  }
  
  return inventory;
}

/**
 * Koop haribo
 */
function buyHaribo(userId, username) {
  const db = getDatabase();
  const monthKey = getCurrentMonthKey();
  
  // Check inventory
  const inventory = getShopInventory();
  if (inventory.haribo_stock <= 0) {
    return { success: false, error: 'Sorry, de Haribo voorraad is op voor deze maand!' };
  }
  
  // Check balance
  const balance = getUserBalance(userId);
  if (balance < HARIBO_PRICE) {
    return { success: false, error: `Je hebt niet genoeg punten! Je hebt ${balance} punten, maar Haribo kost ${HARIBO_PRICE} punten.` };
  }
  
  // Transaction
  const transaction = db.transaction(() => {
    // Trek punten af
    subtractBalance(userId, HARIBO_PRICE);
    
    // Verlaag voorraad
    db.prepare(`
      UPDATE shop_inventory 
      SET haribo_stock = haribo_stock - 1, last_updated = datetime('now')
      WHERE id = 1
    `).run();
    
    // Log aankoop
    db.prepare(`
      INSERT INTO shop_purchases (user_id, username, item, price, month_key)
      VALUES (?, ?, 'haribo', ?, ?)
    `).run(userId, username, HARIBO_PRICE, monthKey);
  });
  
  transaction();
  
  const newInventory = getShopInventory();
  const newBalance = getUserBalance(userId);
  
  return {
    success: true,
    newBalance,
    remainingStock: newInventory.haribo_stock
  };
}

// =====================================================
// MAANDELIJKSE RESET
// =====================================================

/**
 * Voer maandelijkse reset uit
 * - Log top 3 
 * - Reset alle balances naar 0
 * - Geef top 3 hun startbonus
 */
function performMonthlyReset() {
  const db = getDatabase();
  const monthKey = getCurrentMonthKey();
  
  // Bereken vorige maand voor logging
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
  
  // Haal alle users met balance op
  const allUsers = getAllUsersWithBalance();
  
  if (allUsers.length === 0) {
    return { success: true, message: 'Geen users met balance om te resetten', topUsers: [] };
  }
  
  // Top 3 bepalen
  const top3 = allUsers.slice(0, 3);
  
  const resetLog = [];
  
  const transaction = db.transaction(() => {
    // Log alle users en reset
    allUsers.forEach((user, index) => {
      const position = index + 1;
      const bonus = START_BONUSES[position] || 0;
      
      // Log in reset log
      db.prepare(`
        INSERT INTO monthly_reset_log (month_key, user_id, username, final_balance, position, bonus_received)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(prevMonthKey, user.user_id, user.username, user.balance, position <= 3 ? position : null, bonus);
      
      if (position <= 3) {
        resetLog.push({
          user_id: user.user_id,
          username: user.username,
          final_balance: user.balance,
          position,
          bonus
        });
      }
    });
    
    // Reset alle balances naar 0
    db.prepare(`
      UPDATE users SET balance = 0, last_updated = datetime('now')
    `).run();
    
    // Geef top 3 hun startbonus
    top3.forEach((user, index) => {
      const position = index + 1;
      const bonus = START_BONUSES[position];
      
      db.prepare(`
        UPDATE users 
        SET balance = ?, total_earned = total_earned + ?, last_updated = datetime('now')
        WHERE user_id = ?
      `).run(bonus, bonus, user.user_id);
    });
  });
  
  transaction();
  
  return {
    success: true,
    prevMonthKey,
    topUsers: resetLog,
    totalUsersReset: allUsers.length
  };
}

// =====================================================
// EMBED BUILDERS
// =====================================================

/**
 * Bouw embed voor een enkele bet (met buttons)
 */
function buildBetEmbed(bet) {
  const betWithEntries = getBetWithEntries(bet.id);
  const jaCount = betWithEntries.jaVotes.length;
  const neeCount = betWithEntries.neeVotes.length;
  const totalEntries = jaCount + neeCount;
  
  // Bereken potentiële winst
  const poolAfterTax = Math.floor(betWithEntries.totalPool * (1 - TAX_RATE));
  
  let jaMultiplier = '-';
  let neeMultiplier = '-';
  
  if (totalEntries > 0) {
    if (jaCount > 0) {
      jaMultiplier = Math.min(poolAfterTax / jaCount / BET_AMOUNT, 3).toFixed(1) + 'x';
    }
    if (neeCount > 0) {
      neeMultiplier = Math.min(poolAfterTax / neeCount / BET_AMOUNT, 3).toFixed(1) + 'x';
    }
  }
  
  // Namen verzamelen
  const jaNames = betWithEntries.jaVotes.map(e => e.username).join(', ') || 'Nog niemand';
  const neeNames = betWithEntries.neeVotes.map(e => e.username).join(', ') || 'Nog niemand';
  
  const embed = new EmbedBuilder()
    .setTitle(`🎲 Weddenschap #${bet.id}`)
    .setDescription(`**${bet.question}**`)
    .setColor('#FFD700')
    .addFields(
      { name: `✅ JA (${jaCount}) • ${jaMultiplier}`, value: jaNames, inline: true },
      { name: `❌ NEE (${neeCount}) • ${neeMultiplier}`, value: neeNames, inline: true }
    )
    .setFooter({ text: `💰 Pot: ${betWithEntries.totalPool} punten • Inzet: ${BET_AMOUNT} punten` })
    .setTimestamp();
  
  return { embed, betWithEntries };
}

/**
 * Bouw buttons voor een bet
 */
function buildBetButtons(betId) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`bet_${betId}_JA`)
        .setLabel('Ja')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`bet_${betId}_NEE`)
        .setLabel('Nee')
        .setStyle(ButtonStyle.Danger)
    );
  
  return row;
}

/**
 * Bouw casino overzicht embed (zonder details, alleen lijst)
 */
function buildCasinoStatusEmbed(bets) {
  const embed = new EmbedBuilder()
    .setTitle('🎰 Casino - Actieve Weddenschappen')
    .setColor('#FFD700')
    .setTimestamp();
  
  if (bets.length === 0) {
    embed.setDescription('Er zijn momenteel geen actieve weddenschappen.');
    return embed;
  }
  
  let description = '';
  
  bets.forEach((bet) => {
    const betWithEntries = getBetWithEntries(bet.id);
    const jaCount = betWithEntries.jaVotes.length;
    const neeCount = betWithEntries.neeVotes.length;
    
    description += `**#${bet.id}** ${bet.question}\n`;
    description += `JA: ${jaCount} • NEE: ${neeCount} • Pot: ${betWithEntries.totalPool}\n\n`;
  });
  
  embed.setDescription(description);
  embed.setFooter({ text: `Klik op de knoppen bij een weddenschap om te stemmen` });
  
  return embed;
}

/**
 * Bouw saldo embed
 */
function buildSaldoEmbed(userId, username) {
  const user = getOrCreateUser(userId, username);
  const position = getUserPosition(userId);
  const totalUsers = getAllUsersWithBalance().length;
  
  const embed = new EmbedBuilder()
    .setTitle(`💰 Saldo van ${username}`)
    .setColor('#00FF00')
    .addFields(
      { name: '💵 Huidig Saldo', value: `${user.balance} punten`, inline: true },
      { name: '📊 Positie', value: `#${position} van ${totalUsers || 1}`, inline: true },
      { name: '📈 Totaal Verdiend', value: `${user.total_earned} punten`, inline: true },
      { name: '📉 Totaal Uitgegeven', value: `${user.total_spent} punten`, inline: true }
    )
    .setTimestamp();
  
  // Voeg progress naar Haribo toe
  const progress = Math.min((user.balance / HARIBO_PRICE) * 100, 100).toFixed(1);
  const progressBar = '█'.repeat(Math.floor(progress / 10)) + '░'.repeat(10 - Math.floor(progress / 10));
  
  embed.addFields({
    name: '🍬 Progress naar Haribo',
    value: `${progressBar} ${progress}% (${user.balance}/${HARIBO_PRICE})`,
    inline: false
  });
  
  return embed;
}

/**
 * Bouw shop embed
 */
function buildShopEmbed() {
  const inventory = getShopInventory();
  
  const embed = new EmbedBuilder()
    .setTitle('🛒 Vissstick Shop')
    .setColor('#FF69B4')
    .setDescription('Wissel je punten in voor echte beloningen!')
    .addFields(
      {
        name: '🍬 Haribo Zakje',
        value: `**Prijs:** ${HARIBO_PRICE} punten\n**Voorraad:** ${inventory.haribo_stock}/${HARIBO_STOCK_PER_MONTH} deze maand`,
        inline: false
      }
    )
    .setFooter({ text: 'Gebruik /shop buy haribo om te kopen' })
    .setTimestamp();
  
  return embed;
}

/**
 * Bouw resolve resultaat embed
 */
function buildResolveEmbed(result) {
  const embed = new EmbedBuilder()
    .setTitle('🎲 Weddenschap Afgelopen!')
    .setColor(result.winners.length > 0 ? '#00FF00' : '#FF0000')
    .setDescription(`**${result.bet.question}**\n\nUitslag: **${result.outcome}**`)
    .addFields(
      { name: '🏆 Winnaars', value: result.winners.length > 0 ? result.winners.map(w => `${w.username} (+${result.payoutPerWinner})`).join('\n') : 'Niemand', inline: true },
      { name: '💔 Verliezers', value: result.losers.length > 0 ? result.losers.map(l => `${l.username} (-${BET_AMOUNT})`).join('\n') : 'Niemand', inline: true },
      { name: '📊 Statistieken', value: `Pot: ${result.totalPool}\nBelasting (10%): ${result.taxBurned}\nUitbetaling p.p.: ${result.payoutPerWinner}`, inline: false }
    )
    .setTimestamp();
  
  if (result.excessBurned > 0) {
    embed.addFields({
      name: '🔥 Overschot Verbrand',
      value: `${result.excessBurned} punten (max uitbetaling: ${MAX_PAYOUT})`,
      inline: false
    });
  }
  
  return embed;
}

/**
 * Bouw gesloten bet embed voor het originele bet bericht
 */
function buildClosedBetEmbed(result) {
  const betWithEntries = getBetWithEntries(result.bet.id);
  const jaCount = betWithEntries.jaVotes.length;
  const neeCount = betWithEntries.neeVotes.length;

  const jaNames = betWithEntries.jaVotes.map(e => e.username).join(', ') || 'Nog niemand';
  const neeNames = betWithEntries.neeVotes.map(e => e.username).join(', ') || 'Nog niemand';

  const embed = new EmbedBuilder()
    .setTitle(`🎲 Weddenschap #${result.bet.id} (Afgelopen)`)
    .setDescription(`**${result.bet.question}**\n\nUitslag: **${result.outcome}**`)
    .setColor(result.winners.length > 0 ? '#00FF00' : '#FF0000')
    .addFields(
      { name: `✅ JA (${jaCount})`, value: jaNames, inline: true },
      { name: `❌ NEE (${neeCount})`, value: neeNames, inline: true }
    )
    .setFooter({ text: `💰 Pot: ${betWithEntries.totalPool} punten • Inzet: ${BET_AMOUNT} punten` })
    .setTimestamp();

  return embed;
}

module.exports = {
  // Constants
  BET_AMOUNT,
  TAX_RATE,
  MAX_PAYOUT,
  HARIBO_PRICE,
  QUIZ_REWARD,
  START_BONUSES,
  
  // User functions
  getOrCreateUser,
  getUserBalance,
  addBalance,
  subtractBalance,
  getTopUsers,
  getAllUsersWithBalance,
  getUserPosition,
  
  // Bet functions
  createBet,
  updateBetMessageId,
  getOpenBets,
  getBetWithEntries,
  placeBet,
  resolveBet,
  expireOpenBets,
  
  // Shop functions
  getShopInventory,
  buyHaribo,
  
  // Monthly reset
  performMonthlyReset,
  getCurrentMonthKey,
  
  // Embed builders
  buildCasinoStatusEmbed,
  buildBetEmbed,
  buildBetButtons,
  buildSaldoEmbed,
  buildShopEmbed,
  buildResolveEmbed,
  buildClosedBetEmbed
};
