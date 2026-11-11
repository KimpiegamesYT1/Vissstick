/**
 * Dagelijkse spin
 * Iedereen mag één keer per dag (Europe/Amsterdam) aan het rad draaien. Het rad heeft 16 even grote vakken;
 * de prijs wordt op de server gekozen met de kansen hieronder, daarna kiest de server een vak met die prijs.
 * Met "+3 SPINS" krijg je die dag 3 extra spins.
 * Wie wil krijgt elke ochtend een DM met een persoonlijke link naar het rad.
 */

const crypto = require('crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getDatabase } = require('../database');
const casino = require('./casino');
const rocketAuth = require('./rocketAuth');

const TIME_ZONE = 'Europe/Amsterdam';

// Kans per prijs in promille (samen 1000)
const PRIZES = {
  p25: { label: '25', amount: 25, weight: 175 },
  p50: { label: '50', amount: 50, weight: 180 },
  p75: { label: '75', amount: 75, weight: 120 },
  p100: { label: '100', amount: 100, weight: 140 },
  p150: { label: '150', amount: 150, weight: 100 },
  p200: { label: '200', amount: 200, weight: 80 },
  p300: { label: '300', amount: 300, weight: 60 },
  p500: { label: '500', amount: 500, weight: 45 },
  p1000: { label: '1.000', amount: 1000, weight: 25 },
  spins: { label: '+3 SPINS', amount: 0, spins: 3, weight: 35 },
  mega: { label: '2.500', amount: 2500, weight: 33, tier: 'mega' },        // ~1 op 30
  jackpot: { label: '10.000', amount: 10000, weight: 7, tier: 'jackpot' } // ~1 op 140
};

// Indeling van het rad (met de klok mee). Grote prijzen liggen naast kleine, voor de spanning.
const WHEEL = [
  'p25', 'p100', 'p50', 'p300', 'p75', 'jackpot', 'p25', 'p150',
  'p50', 'mega', 'p100', 'spins', 'p75', 'p1000', 'p200', 'p500'
];

const TOTAL_WEIGHT = Object.values(PRIZES).reduce((sum, p) => sum + p.weight, 0);

/**
 * Dag in Nederlandse tijd, bv. "2026-11-11"
 */
function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/**
 * Tijdstip (ms) van de volgende middernacht in Nederlandse tijd
 */
function nextResetAt(now = Date.now()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(now))
      .map(p => [p.type, Number(p.value)])
  );
  const elapsed = ((parts.hour * 60 + parts.minute) * 60 + parts.second) * 1000;
  return now - (now % 1000) + (24 * 60 * 60 * 1000 - elapsed);
}

function getDay(userId, day) {
  const db = getDatabase();
  db.prepare('INSERT OR IGNORE INTO daily_spin_days (user_id, day) VALUES (?, ?)').run(userId, day);
  return db.prepare('SELECT * FROM daily_spin_days WHERE user_id = ? AND day = ?').get(userId, day);
}

function spinsLeft(row) {
  return Math.max(0, 1 + row.bonus_spins - row.spins_used);
}

function pickPrizeKey() {
  let roll = crypto.randomInt(0, TOTAL_WEIGHT);
  for (const [key, prize] of Object.entries(PRIZES)) {
    if (roll < prize.weight) return key;
    roll -= prize.weight;
  }
  return 'p25';
}

/**
 * Publieke info over het rad (voor de website)
 */
function getWheel() {
  return {
    segments: WHEEL.map(key => ({ key, label: PRIZES[key].label, tier: PRIZES[key].tier || (PRIZES[key].spins ? 'spins' : 'normal') })),
    odds: Object.entries(PRIZES)
      .map(([key, p]) => ({ key, label: p.label, amount: p.amount, spins: p.spins || 0, chance: p.weight / TOTAL_WEIGHT }))
      .sort((a, b) => b.chance - a.chance)
  };
}

/**
 * Status van een speler voor vandaag
 */
function getStatus(user) {
  const day = dayKey();
  const row = getDay(user.id, day);
  const today = getDatabase()
    .prepare('SELECT prize_key, amount, created_at FROM daily_spin_log WHERE user_id = ? AND day = ? ORDER BY id')
    .all(user.id, day)
    .map(r => ({ key: r.prize_key, label: PRIZES[r.prize_key] ? PRIZES[r.prize_key].label : r.prize_key, amount: r.amount }));
  return { spinsLeft: spinsLeft(row), totalWonToday: row.total_won, today, nextResetAt: nextResetAt(), reminder: getReminder(user.id) };
}

/**
 * Draai aan het rad
 * @param {{id: string, username: string}} user
 */
function spin(user) {
  const db = getDatabase();
  const day = dayKey();
  casino.getOrCreateUser(user.id, user.username);

  const result = db.transaction(() => {
    const row = getDay(user.id, day);
    if (spinsLeft(row) <= 0) return null;

    const prizeKey = pickPrizeKey();
    const prize = PRIZES[prizeKey];
    const options = WHEEL.map((key, index) => ({ key, index })).filter(s => s.key === prizeKey);
    const segmentIndex = options[crypto.randomInt(0, options.length)].index;

    db.prepare(`
      UPDATE daily_spin_days
      SET spins_used = spins_used + 1, bonus_spins = bonus_spins + ?, total_won = total_won + ?
      WHERE user_id = ? AND day = ?
    `).run(prize.spins || 0, prize.amount, user.id, day);
    db.prepare('INSERT INTO daily_spin_log (user_id, username, day, prize_key, amount) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, user.username, day, prizeKey, prize.amount);

    if (prize.amount > 0) casino.addBalance(user.id, user.username, prize.amount, `Dagelijkse spin: ${prize.label}`);
    return { prizeKey, prize, segmentIndex };
  })();

  if (!result) {
    return { ok: false, message: 'Je hebt vandaag al gespind. Morgen kun je weer!', ...getStatus(user) };
  }

  const { prizeKey, prize, segmentIndex } = result;
  const message = prize.spins
    ? `Je hebt ${prize.spins} extra spins gewonnen!`
    : `Je hebt ${prize.label} punten gewonnen!`;
  return {
    ok: true,
    message,
    segmentIndex,
    prize: { key: prizeKey, label: prize.label, amount: prize.amount, spins: prize.spins || 0, tier: prize.tier || (prize.spins ? 'spins' : 'normal') },
    ...getStatus(user)
  };
}

// =====================================================
// OCHTENDMELDING
// =====================================================

const REMINDER_LINK_TTL_MS = 18 * 60 * 60 * 1000; // link in de DM werkt de hele dag

/**
 * @returns {boolean|null} null = nog nooit gevraagd
 */
function getReminder(userId) {
  const row = getDatabase().prepare('SELECT enabled FROM daily_spin_reminders WHERE user_id = ?').get(userId);
  return row ? Boolean(row.enabled) : null;
}

function setReminder(userId, enabled) {
  getDatabase().prepare(`
    INSERT INTO daily_spin_reminders (user_id, enabled, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
  `).run(userId, enabled ? 1 : 0);
}

/**
 * Stuur iedereen met de melding aan een DM met een persoonlijke link naar het rad
 */
async function sendMorningReminders(client, config) {
  const webUrl = (config.ROCKET_WEB_URL || '').replace(/\/+$/, '');
  if (!webUrl) return;

  const rows = getDatabase().prepare('SELECT user_id FROM daily_spin_reminders WHERE enabled = 1').all();
  for (const { user_id: userId } of rows) {
    try {
      const user = await client.users.fetch(userId);
      const link = rocketAuth.createLoginLink(webUrl, {
        id: user.id,
        username: user.username,
        avatar: user.displayAvatarURL({ extension: 'png', size: 64 })
      }, '/spin', REMINDER_LINK_TTL_MS);

      const embed = new EmbedBuilder()
        .setTitle('🎡 Je dagelijkse spin staat klaar!')
        .setDescription('Draai aan het rad en win punten. Vandaag ligt er weer een jackpot van **10.000** punten klaar.')
        .setColor('#F6C343');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Draai aan het rad').setStyle(ButtonStyle.Link).setURL(link),
        new ButtonBuilder().setCustomId('spinreminder_off').setLabel('Meldingen uitzetten').setStyle(ButtonStyle.Secondary)
      );
      await user.send({ embeds: [embed], components: [row] });
    } catch (error) {
      // DM's dicht of gebruiker onbekend: niet blijven proberen
      console.log(`Kon spin-melding niet sturen naar ${userId}: ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * Knop "Meldingen uitzetten" onder de ochtend-DM
 */
async function handleReminderButton(interaction) {
  if (interaction.customId !== 'spinreminder_off') return false;
  setReminder(interaction.user.id, false);
  await interaction.update({
    content: '🔕 Ochtendmeldingen staan uit. Je kunt ze weer aanzetten op de spin-pagina.',
    embeds: interaction.message.embeds,
    components: interaction.message.components.map(row => new ActionRowBuilder().addComponents(
      row.components.filter(c => c.url).map(c => ButtonBuilder.from(c))
    )).filter(row => row.components.length > 0)
  });
  return true;
}

module.exports = {
  getWheel,
  getStatus,
  spin,
  setReminder,
  sendMorningReminders,
  handleReminderButton
};
