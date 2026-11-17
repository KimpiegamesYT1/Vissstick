/**
 * Sterrenrad: een multiplayer geldrad-gameshow in een ruimtestation, gepresenteerd door Max Nova (zie sterrenradHost.js).
 * Eén gedeelde ronde voor iedereen op de website (live via api/casinoWeb.js, net als Roulette).
 *
 * Verloop van een ronde (tijden iets sneller dan een live show):
 *   1. betting  — de eerste fiche opent de ronde; precies BETTING_MS (15 s) om fiches te leggen of weg te halen.
 *                 De inzet gaat meteen van je saldo af en staat in open_stakes (teruggestort na een herstart).
 *   2. comets   — 1 tot 3 kometen landen op een vak en geven daar een multiplier (×2 tot ×50).
 *   3. spinning — het rad (54 vakken) draait ±8 s. De uitslag ligt vast zodra het rad begint te draaien.
 *   4. bonus    — alleen als het rad op een bonus stopt. Wie op die bonus had ingezet speelt mee.
 *   5. result   — uitbetaling. Na RESULT_MS kan de volgende ronde beginnen.
 *
 * Uitbetaling (inclusief inzet): inzet × (waarde × komeet + 1)
 *   getallen 1, 2, 5, 10: waarde = het getal; bonussen: waarde = jouw uitkomst in de bonus.
 *
 * Bonussen:
 *   MAANMUNT     — een munt met een rode en een blauwe kant, elk met een multiplier, wordt opgegooid. 50/50.
 *   METEORENMUUR — Max laat een meteoor langs een muur met pinnen vallen naar 16 vakken. Een DUBBEL-vak
 *                  verdubbelt alle vakken en de meteoor valt opnieuw.
 *   STERRENJACHT — 108 doelen met elk een verborgen multiplier; iedere speler kiest zelf een doel.
 *   WORMGAT      — door het portaal naar een reuzenrad met drie wijzers (groen, blauw, geel). Elke speler kiest
 *                  een wijzer. DUBBEL/TRIPEL op jouw wijzer: alles ×2/×3 en het rad draait opnieuw. Tot 20.000×.
 *
 * De verdeling is met een simulatie zo gekozen dat elk vak ongeveer 97% terugbetaalt (zie rtpReport()).
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { getDatabase } = require('../database');
const casino = require('./casino');
const host = require('./sterrenradHost');

const MIN_CHIP = 1;
const MAX_TOTAL_BET = 500;
const MAX_PLAYERS = 30;
const MAX_X = 20000;           // maximale winst per vak (× inzet, zonder de inzet zelf)
const HISTORY_SIZE = 24;
const CHIPS = [1, 5, 10, 25, 100];

// Tijden (ms)
const BETTING_MS = 15000;
const COMET_LEAD_MS = 1400;     // van "geen inzetten meer" tot de eerste komeet
const COMET_STEP_MS = 1700;    // tussen twee kometen
const COMET_TAIL_MS = 3000;    // na de laatste komeet, voor het rad draait
const SPIN_MS = 10000;          // draai van het rad
const LANDED_MS = 4000;        // getal: even vieren voor de uitbetaling
const RESULT_MS = 8000;        // uitslag blijft staan
const BONUS_TRAVEL_MS = 5500;  // camera + Max naar de bonus
const BONUS_OUTRO_MS = 5000;
const COIN_REVEAL_MS = 4500;
const COIN_FLIP_MS = 5000;
const METEOR_SETUP_MS = 4000;
const METEOR_DROP_MS = 6500;
const METEOR_DOUBLE_MS = 3500;
const HUNT_SHUFFLE_MS = 4500;
const HUNT_PICK_MS = 14000;
const HUNT_REVEAL_MS = 8000;
const WORM_PORTAL_MS = 4500;
const WORM_PICK_MS = 11000;
const WORM_SPIN_MS = 8000;
const WORM_BETWEEN_MS = 3500;
const EMPTY_PICK_MS = 2500;    // niemand speelt mee: kort
const HYPE_EVERY_MS = 7500;
const IDLE_EVERY_MS = 16000;

// =====================================================
// RAD
// =====================================================

const SPOTS = ['1', '2', '5', '10', 'coin', 'meteor', 'hunt', 'worm'];
const NUMBER_VALUE = { 1: 1, 2: 2, 5: 5, 10: 10 };
const BONUS_NAMES = { coin: 'Maanmunt', meteor: 'Meteorenmuur', hunt: 'Sterrenjacht', worm: 'Wormgat' };
const SPOT_NAMES = {
  1: 'de 1', 2: 'de 2', 5: 'de 5', 10: 'de 10',
  coin: 'de Maanmunt', meteor: 'de Meteorenmuur', hunt: 'de Sterrenjacht', worm: 'het Wormgat'
};
const COUNTS = { 1: 21, 2: 13, 5: 7, 10: 4 };
const BONUS_ORDER = ['coin', 'meteor', 'coin', 'hunt', 'worm', 'coin', 'meteor', 'coin', 'hunt'];
const SEGMENT_COUNT = 54;

/**
 * Indeling: om de 6 vakken een bonus, daartussen de getallen zo gelijkmatig mogelijk verspreid
 */
function buildWheel() {
  const wheel = new Array(SEGMENT_COUNT).fill(null);
  BONUS_ORDER.forEach((bonus, i) => { wheel[3 + i * 6] = bonus; });
  const left = { ...COUNTS };
  const used = { 1: 0, 2: 0, 5: 0, 10: 0 };
  const total = Object.values(COUNTS).reduce((a, b) => a + b, 0);
  let placed = 0;
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    if (wheel[i]) continue;
    const prev = wheel[(i + SEGMENT_COUNT - 1) % SEGMENT_COUNT];
    let best = null;
    let bestScore = -Infinity;
    for (const key of Object.keys(COUNTS)) {
      if (!left[key] || key === prev) continue;
      const score = (COUNTS[key] * (placed + 1)) / total - used[key];
      if (score > bestScore) { bestScore = score; best = key; }
    }
    if (!best) best = Object.keys(COUNTS).find(key => left[key]);
    wheel[i] = best;
    left[best]--;
    used[best]++;
    placed++;
  }
  return wheel;
}

const WHEEL = buildWheel();

// =====================================================
// KOMETEN
// =====================================================

const COMET_COUNT = [[1, 55], [2, 34], [3, 11]];
const COMET_SPOT_WEIGHT = { 1: 3, 2: 2.5, 5: 0.8, 10: 0.5, coin: 1.3, meteor: 1, hunt: 1, worm: 0.8 };
const BONUS_COMET = [[2, 54], [3, 26], [5, 13], [10, 7]];
const COMET_MULTS = {
  1: [[2, 86], [3, 10], [5, 3], [10, 1]],
  2: [[2, 76], [3, 16], [5, 6], [7, 1.5], [10, 0.5]],
  5: [[2, 56], [3, 24], [5, 13], [10, 5], [20, 2]],
  10: [[2, 58], [3, 22], [5, 12], [10, 6], [25, 1.5], [50, 0.5]],
  coin: BONUS_COMET, meteor: BONUS_COMET, hunt: BONUS_COMET, worm: BONUS_COMET
};

// =====================================================
// BONUSSEN
// =====================================================

const COIN_MULTS = [[2, 10], [3, 13], [4, 13], [5, 14], [6, 9], [7, 7], [8, 8], [10, 10], [12, 5], [15, 4], [20, 3], [25, 2], [50, 1.2], [100, 1]];

const METEOR_SLOTS = 16;
const METEOR_ROWS = 12;
const METEOR_DOUBLES = 2;
const METEOR_MAX_DROPS = 6;
const METEOR_VALUES = [[3, 18], [4, 14], [5, 18], [7, 14], [10, 10], [15, 8], [25, 8], [40, 4], [50, 3], [100, 2.7], [250, 1]];

const HUNT_COLS = 12;
const HUNT_ROWS = 9;
const HUNT_VALUES = [[5, 24], [7, 15], [10, 19], [15, 14], [20, 10], [25, 7], [50, 6], [75, 2], [100, 2], [200, 0.5], [500, 0.2], [1000, 0.03]];
const HUNT_SYMBOLS = ['planet', 'star', 'moon', 'ufo', 'rocket', 'comet'];

// Wormgat-rad: 64 vakken, waarvan 4× DUBBEL en 2× TRIPEL
const WORM_SEGMENTS = 64;
const WORM_POINTERS = [-6, 0, 6];             // vakken t.o.v. de middelste wijzer
const WORM_POINTER_NAMES = ['Groen', 'Blauw', 'Geel'];
const WORM_MAX_SPINS = 6;
function buildWormWheel() {
  const values = [
    ...Array(14).fill(10), ...Array(8).fill(15), ...Array(10).fill(20), ...Array(8).fill(25), ...Array(8).fill(50),
    ...Array(4).fill(75), ...Array(4).fill(100), 150, 150
  ];
  const wheel = new Array(WORM_SEGMENTS).fill(null);
  [4, 20, 36, 52].forEach(i => { wheel[i] = 'D'; });
  [12, 44].forEach(i => { wheel[i] = 'T'; });
  // Getallen deterministisch door elkaar (groot naast klein)
  const sorted = [...values].sort((a, b) => a - b);
  const mixed = [];
  while (sorted.length) {
    mixed.push(sorted.shift());
    if (sorted.length) mixed.push(sorted.pop());
    if (sorted.length) mixed.push(sorted.splice(Math.floor(sorted.length / 2), 1)[0]);
  }
  let k = 0;
  for (let i = 0; i < WORM_SEGMENTS; i++) if (!wheel[i]) wheel[i] = mixed[k++];
  return wheel;
}
const WORM_WHEEL = buildWormWheel();

// =====================================================
// RANDOM
// =====================================================

const rand = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const randInt = n => crypto.randomInt(0, n);
function pickWeighted(table, rnd = rand) {
  let total = 0;
  for (const [, w] of table) total += w;
  let x = rnd() * total;
  for (const [value, w] of table) {
    x -= w;
    if (x < 0) return value;
  }
  return table[table.length - 1][0];
}
function shuffle(list, rnd = rand) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function rollComets(rnd = rand) {
  const count = pickWeighted(COMET_COUNT, rnd);
  const available = new Set(SPOTS);
  const comets = [];
  for (let i = 0; i < count; i++) {
    const spot = pickWeighted([...available].map(s => [s, COMET_SPOT_WEIGHT[s]]), rnd);
    available.delete(spot);
    comets.push({ spot, mult: pickWeighted(COMET_MULTS[spot], rnd) });
  }
  return comets;
}

function coinRoll(rnd = rand) {
  const red = pickWeighted(COIN_MULTS, rnd);
  let blue = pickWeighted(COIN_MULTS, rnd);
  if (blue === red) blue = pickWeighted(COIN_MULTS, rnd);
  return { red, blue, side: rnd() < 0.5 ? 'red' : 'blue' };
}

/**
 * Meteorenmuur: vakken, en de val(len). Elke rij gaat de meteoor een half vak naar links of rechts.
 */
function meteorRoll(rnd = rand) {
  const slots = Array.from({ length: METEOR_SLOTS }, () => pickWeighted(METEOR_VALUES, rnd));
  const doublePos = shuffle(Array.from({ length: METEOR_SLOTS - 4 }, (_, i) => i + 2), rnd).slice(0, METEOR_DOUBLES);
  doublePos.forEach(i => { slots[i] = 'D'; });
  const drops = [];
  let factor = 1;
  for (let d = 0; d < METEOR_MAX_DROPS; d++) {
    const start = 2 + Math.floor(rnd() * (METEOR_SLOTS - 4));
    const path = [];
    let x = start;
    for (let row = 0; row < METEOR_ROWS; row++) {
      let step = rnd() < 0.5 ? -0.5 : 0.5;
      if (x + step < 0 || x + step > METEOR_SLOTS - 1) step = -step;
      x += step;
      path.push(step > 0 ? 1 : 0);
    }
    const slot = Math.round(x);
    const isDouble = slots[slot] === 'D';
    drops.push({ start, path, slot, double: isDouble, factor });
    if (!isDouble) return { slots, drops, value: Math.min(MAX_X, slots[slot] * factor) };
    factor *= 2;
  }
  // Te vaak dubbel: hoogste vak telt
  const top = Math.max(...slots.filter(v => v !== 'D'));
  return { slots, drops, value: Math.min(MAX_X, top * factor) };
}

function huntRoll(rnd = rand) {
  const count = HUNT_COLS * HUNT_ROWS;
  const values = Array.from({ length: count }, () => pickWeighted(HUNT_VALUES, rnd));
  const symbols = Array.from({ length: count }, () => HUNT_SYMBOLS[Math.floor(rnd() * HUNT_SYMBOLS.length)]);
  return { values, symbols };
}

/**
 * Wormgat: draai tot alle drie de wijzers op een getal staan.
 */
function wormRoll(rnd = rand) {
  const mult = [1, 1, 1];
  const result = [null, null, null];
  const spins = [];
  for (let s = 0; s < WORM_MAX_SPINS && result.some(r => r === null); s++) {
    const offset = Math.floor(rnd() * WORM_SEGMENTS);
    const hits = WORM_POINTERS.map((shift, p) => {
      if (result[p] !== null) return null;
      const seg = WORM_WHEEL[(offset + shift + WORM_SEGMENTS) % WORM_SEGMENTS];
      if (seg === 'D') mult[p] *= 2;
      else if (seg === 'T') mult[p] *= 3;
      else result[p] = { value: Math.min(MAX_X, seg * mult[p]), base: seg, mult: mult[p], spin: s };
      return seg;
    });
    spins.push({ offset, hits, mult: [...mult] });
  }
  // Na te veel draaien: het hoogste vak telt
  for (let p = 0; p < 3; p++) {
    if (result[p] === null) result[p] = { value: Math.min(MAX_X, 200 * mult[p]), base: 200, mult: mult[p], spin: spins.length - 1 };
  }
  return { spins, results: result };
}

// =====================================================
// TAFELSTATUS
// =====================================================

const events = new EventEmitter();
const history = [];
let round = null;
let roundSeq = 0;
let bonusDrought = 0;
let speech = { id: 0, text: '', mood: 'happy', at: 0 };
const speechLog = [];
let lastSpeechAt = 0;
let hypeTimer = null;

const stakeRef = (r, userId) => `${r.id}:${userId}`;
const emitUpdate = () => events.emit('update');
const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
const xLabel = x => `${x}×`;

// Bijzaken worden overgeslagen als Max net iets zei, zodat er tijd is om te lezen
const MINOR_LINES = new Set(['idle', 'hype', 'join', 'bonusBet', 'comet', 'spinning', 'slowing', 'nextRound', 'meteorFalling', 'huntHurry']);
const MIN_GAP_MS = 4000;

function say(category, vars, { silent = false } = {}) {
  if (MINOR_LINES.has(category) && Date.now() - lastSpeechAt < MIN_GAP_MS) return;
  const { text, mood } = host.line(category, vars);
  if (!text) return;
  speech = { id: speech.id + 1, text, mood, at: Date.now(), category };
  speechLog.unshift({ id: speech.id, text, mood });
  if (speechLog.length > 8) speechLog.pop();
  lastSpeechAt = Date.now();
  if (!silent) emitUpdate();
}

function getConfig() {
  return {
    minChip: MIN_CHIP, maxTotalBet: MAX_TOTAL_BET, maxPlayers: MAX_PLAYERS, chips: CHIPS, maxX: MAX_X,
    bettingMs: BETTING_MS, cometLeadMs: COMET_LEAD_MS, cometStepMs: COMET_STEP_MS, spinMs: SPIN_MS, resultMs: RESULT_MS,
    coinRevealMs: COIN_REVEAL_MS, coinFlipMs: COIN_FLIP_MS,
    meteorDropMs: METEOR_DROP_MS, meteorDoubleMs: METEOR_DOUBLE_MS, meteorSlots: METEOR_SLOTS, meteorRows: METEOR_ROWS,
    huntCols: HUNT_COLS, huntRows: HUNT_ROWS, huntPickMs: HUNT_PICK_MS,
    wormSpinMs: WORM_SPIN_MS, wormBetweenMs: WORM_BETWEEN_MS, wormWheel: WORM_WHEEL, wormPointers: WORM_POINTERS,
    wormPointerNames: WORM_POINTER_NAMES,
    wheel: WHEEL, spots: SPOTS, bonusNames: BONUS_NAMES
  };
}

function getStats(userId) {
  return getDatabase().prepare('SELECT games_played, total_bet, total_payout, biggest_win, biggest_multiplier, bonuses FROM sterrenrad_stats WHERE user_id = ?').get(userId) || null;
}

function publicBonus(b) {
  if (!b) return null;
  const out = { type: b.type, stage: b.stage, stageAt: b.stageAt, stageEndsAt: b.stageEndsAt, empty: b.empty };
  if (b.type === 'coin') {
    if (b.stage !== 'travel') Object.assign(out, { red: b.red, blue: b.blue });
    if (b.stage === 'flip' || b.stage === 'done') Object.assign(out, { side: b.side, flipAt: b.flipAt, landAt: b.landAt });
  } else if (b.type === 'meteor') {
    out.slots = b.slots;
    if (b.stage === 'drop' || b.stage === 'done') Object.assign(out, { drops: b.drops, dropStartAt: b.dropStartAt, value: b.value });
  } else if (b.type === 'hunt') {
    out.symbols = b.symbols;
    if (b.stage === 'reveal' || b.stage === 'done') out.values = b.values;
  } else if (b.type === 'worm') {
    if (b.stage === 'spin' || b.stage === 'done') Object.assign(out, { spins: b.spins, results: b.results, spinStartAt: b.spinStartAt });
  }
  return out;
}

/**
 * Publieke tafelstatus. De uitslag van het rad zit er pas in als het rad draait.
 */
function getPublicState() {
  const r = round;
  const hidden = r && (r.phase === 'betting' || r.phase === 'comets');
  return {
    serverNow: Date.now(),
    history,
    host: speech,
    hostLog: speechLog,
    round: r && {
      id: r.id,
      phase: r.phase,
      bettingEndsAt: r.bettingEndsAt,
      cometsAt: r.cometsAt,
      comets: r.phase === 'betting' ? null : r.comets,
      spinStartAt: r.spinStartAt,
      landAt: r.landAt,
      segIndex: hidden ? null : r.segIndex,
      segment: hidden ? null : r.segment,
      bonus: publicBonus(r.bonus),
      nextAt: r.nextAt,
      players: [...r.players.values()].map(p => ({
        userId: p.userId,
        username: p.username,
        avatar: p.avatar,
        bets: p.bets,
        total: p.total,
        payout: p.payout,
        choice: p.choice,
        bonusX: p.bonusX,
        balance: casino.getUserBalance(p.userId)
      }))
    }
  };
}

// =====================================================
// INZETTEN
// =====================================================

/**
 * @returns {{error: string} | {bets: Object<string, number>, total: number}}
 */
function parseBets(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Ongeldige inzet.' };
  const bets = {};
  let total = 0;
  for (const [spot, raw] of Object.entries(input)) {
    if (!SPOTS.includes(spot)) return { error: 'Ongeldig vak.' };
    const amount = Number(raw);
    if (amount === 0) continue;
    if (!Number.isInteger(amount) || amount < MIN_CHIP) return { error: 'Ongeldig bedrag.' };
    bets[spot] = amount;
    total += amount;
  }
  if (total > MAX_TOTAL_BET) return { error: `Je mag maximaal ${MAX_TOTAL_BET} punten per ronde inzetten (nu ${total}).` };
  return { bets, total };
}

function openRound() {
  const now = Date.now();
  round = {
    id: `${now.toString(36)}${(++roundSeq).toString(36)}`,
    phase: 'betting',
    players: new Map(),
    bettingEndsAt: now + BETTING_MS,
    cometsAt: null,
    comets: [],
    spinStartAt: null,
    landAt: null,
    segIndex: null,
    segment: null,
    bonus: null,
    nextAt: null,
    saidLastCall: false
  };
  const r = round;
  runRound(r).catch(error => {
    console.error('[STERRENRAD] Fout in ronde, inzetten worden teruggestort:', error);
    refundRound(r);
  });
  return r;
}

function refundRound(r) {
  for (const p of r.players.values()) {
    if (p.total > 0 && p.payout === null) casino.addBalance(p.userId, p.username, p.total, 'Sterrenrad: terugbetaling na fout');
    casino.releaseStake('sterrenrad', stakeRef(r, p.userId));
  }
  r.phase = 'cancelled';
  r.nextAt = Date.now();
  emitUpdate();
}

/**
 * Eigen inzetten voor deze ronde vervangen. De eerste fiche opent een nieuwe ronde.
 * @param {{id: string, username: string, avatar: string|null}} user
 */
function placeBets(user, betsInput) {
  const parsed = parseBets(betsInput);
  if (parsed.error) return { ok: false, message: parsed.error };
  const { bets, total } = parsed;

  if (round && !['betting', 'result', 'cancelled'].includes(round.phase)) {
    return { ok: false, code: 'closed', message: 'De inzetten zijn gesloten, de show is bezig.' };
  }
  if (round && round.phase === 'result' && Date.now() < round.nextAt) {
    return { ok: false, code: 'closed', message: 'Even wachten, de volgende ronde begint zo.' };
  }
  let opened = false;
  if (!round || round.phase !== 'betting') {
    if (!total) return { ok: true, message: '' };
    openRound();
    opened = true;
  }
  const r = round;
  if (Date.now() >= r.bettingEndsAt) return { ok: false, code: 'closed', message: 'De inzetten zijn gesloten.' };

  const existing = r.players.get(user.id);
  if (!existing && total && r.players.size >= MAX_PLAYERS) {
    return { ok: false, message: `Het rad zit vol: er spelen al ${MAX_PLAYERS} spelers mee.` };
  }

  const db = getDatabase();
  casino.getOrCreateUser(user.id, user.username);
  const result = db.transaction(() => {
    const previous = existing ? existing.total : 0;
    const available = casino.getUserBalance(user.id) + previous;
    if (available < total) {
      return { ok: false, message: `Niet genoeg punten: je wilt ${total} inzetten, maar je hebt er maar ${available}.` };
    }
    if (previous) casino.addBalance(user.id, user.username, previous, 'Sterrenrad inzet aangepast');
    if (total) casino.subtractBalance(user.id, total);
    casino.setStake('sterrenrad', stakeRef(r, user.id), user.id, user.username, total);
    return { ok: true, message: '' };
  })();
  if (!result.ok) {
    if (opened && !r.players.size) r.phase = 'cancelled';
    return result;
  }

  if (total) {
    const before = existing ? existing.bets : {};
    r.players.set(user.id, {
      userId: user.id, username: user.username, avatar: user.avatar || null, bets, total,
      payout: null, choice: null, bonusX: null
    });
    // Max reageert op nieuwe spelers, grote inzetten en bonusgokken
    if (opened) say(total >= 100 ? 'bigBet' : 'open', { naam: user.username, bedrag: total }, { silent: true });
    else if (!existing) say('join', { naam: user.username }, { silent: true });
    else if (total >= 100 && existing.total < 100) say('bigBet', { naam: user.username, bedrag: total }, { silent: true });
    else {
      const newBonus = ['coin', 'meteor', 'hunt', 'worm'].find(b => bets[b] && !before[b]);
      if (newBonus && rand() < 0.7) say('bonusBet', { naam: user.username, bonus: BONUS_NAMES[newBonus] }, { silent: true });
    }
  } else {
    r.players.delete(user.id);
  }
  emitUpdate();
  return { ok: true, message: '', roundId: r.id, bets, total };
}

function participant(user) {
  const r = round;
  if (!r || r.phase !== 'bonus' || !r.bonus) return { error: 'Er is nu geen bonus bezig.' };
  const p = r.players.get(user.id);
  if (!p || !p.bets[r.bonus.type]) return { error: `Je speelt niet mee in ${SPOT_NAMES[r.bonus.type]}: je had er niet op ingezet.` };
  return { r, p, b: r.bonus };
}

/**
 * Keuze in een bonus: doel (0-107) in de Sterrenjacht of wijzer (0-2) in het Wormgat
 */
function choose(user, value) {
  const { error, p, b } = participant(user);
  if (error) return { ok: false, message: error };
  const idx = Number(value);
  if (b.type === 'hunt') {
    if (b.stage !== 'pick' && b.stage !== 'shuffle') return { ok: false, message: 'Je kunt nu niet meer richten.' };
    if (!Number.isInteger(idx) || idx < 0 || idx >= HUNT_COLS * HUNT_ROWS) return { ok: false, message: 'Kies een doel.' };
    p.choice = idx;
  } else if (b.type === 'worm') {
    if (!['travel', 'portal', 'pick'].includes(b.stage)) return { ok: false, message: 'Het rad draait al.' };
    if (!Number.isInteger(idx) || idx < 0 || idx >= WORM_POINTERS.length) return { ok: false, message: 'Kies een wijzer.' };
    p.choice = idx;
  } else {
    return { ok: false, message: 'In deze bonus hoef je niets te kiezen.' };
  }
  emitUpdate();
  return { ok: true, message: '' };
}

// =====================================================
// RONDE
// =====================================================

function startHype(r) {
  stopHype();
  hypeTimer = setInterval(() => {
    if (round !== r || r.phase !== 'betting') return stopHype();
    const left = r.bettingEndsAt - Date.now();
    if (left < 6000 && !r.saidLastCall) {
      r.saidLastCall = true;
      say('lastCall');
      return;
    }
    if (left > 7000 && Date.now() - lastSpeechAt > HYPE_EVERY_MS) say('hype');
  }, 700);
}

function stopHype() {
  clearInterval(hypeTimer);
  hypeTimer = null;
}

async function runRound(r) {
  startHype(r);
  await sleep(r.bettingEndsAt - Date.now());
  stopHype();
  if (round !== r || r.phase !== 'betting') return;
  if (!r.players.size) {
    r.phase = 'cancelled';
    r.nextAt = Date.now();
    emitUpdate();
    return;
  }

  // Kometen
  r.comets = rollComets();
  r.phase = 'comets';
  r.cometsAt = Date.now() + COMET_LEAD_MS;
  say('closed');
  for (let i = 0; i < r.comets.length; i++) {
    await sleep(r.cometsAt + i * COMET_STEP_MS + 650 - Date.now());
    const c = r.comets[i];
    if (i === 0 || c.mult >= 10) say(c.mult >= 10 ? 'cometBig' : 'comet', { x: xLabel(c.mult), vak: SPOT_NAMES[c.spot] });
  }
  await sleep(r.cometsAt + (r.comets.length - 1) * COMET_STEP_MS + COMET_TAIL_MS - Date.now());

  // Rad
  r.segIndex = randInt(SEGMENT_COUNT);
  r.segment = WHEEL[r.segIndex];
  r.phase = 'spinning';
  r.spinStartAt = Date.now() + 250;
  r.landAt = r.spinStartAt + SPIN_MS;
  say('spinning');
  await sleep(r.landAt - 4000 - Date.now());
  say('slowing');
  await sleep(r.landAt - Date.now());

  const comet = r.comets.find(c => c.spot === r.segment);
  history.unshift({ seg: r.segment, mult: comet ? comet.mult : null });
  if (history.length > HISTORY_SIZE) history.pop();

  if (NUMBER_VALUE[r.segment]) {
    bonusDrought++;
    r.phase = 'landed';
    say(`number${r.segment}`);
    if (comet) {
      await sleep(2200);
      say('cometHit', { x: xLabel(comet.mult) });
    }
    await sleep(r.landAt + LANDED_MS - Date.now());
    settle(r);
    return;
  }

  bonusDrought = 0;
  r.phase = 'bonus';
  say('bonusHit', { bonus: BONUS_NAMES[r.segment] });
  if (r.segment === 'coin') await runCoin(r);
  else if (r.segment === 'meteor') await runMeteor(r);
  else if (r.segment === 'hunt') await runHunt(r);
  else await runWorm(r);
  await sleep(BONUS_OUTRO_MS);
  settle(r);
}

function bonusPlayers(r, type) {
  return [...r.players.values()].filter(p => p.bets[type]);
}

function stage(b, name, ms) {
  b.stage = name;
  b.stageAt = Date.now();
  b.stageEndsAt = ms ? b.stageAt + ms : null;
}

async function travel(r, b, introLine) {
  r.bonus = b;
  b.empty = bonusPlayers(r, b.type).length === 0;
  stage(b, 'travel', BONUS_TRAVEL_MS);
  emitUpdate();
  await sleep(1600);
  say(b.empty ? 'bonusEmpty' : introLine, { bonus: BONUS_NAMES[b.type] });
  await sleep(b.stageEndsAt - Date.now());
}

async function runCoin(r) {
  const b = { type: 'coin', ...coinRoll() };
  await travel(r, b, 'coinIntro');
  stage(b, 'reveal', COIN_REVEAL_MS);
  emitUpdate();
  await sleep(COIN_REVEAL_MS - 900);
  say('coinReveal', { rood: xLabel(b.red), blauw: xLabel(b.blue) });
  await sleep(b.stageEndsAt - Date.now());

  stage(b, 'flip', COIN_FLIP_MS);
  b.flipAt = Date.now() + 300;
  b.landAt = b.flipAt + COIN_FLIP_MS - 600;
  say('coinFlip');
  await sleep(b.landAt - Date.now());
  const x = b[b.side];
  for (const p of bonusPlayers(r, 'coin')) p.bonusX = x;
  stage(b, 'done');
  say('coinResult', { kant: b.side === 'red' ? 'ROOD' : 'BLAUW', x: xLabel(x) });
}

async function runMeteor(r) {
  const b = { type: 'meteor', ...meteorRoll() };
  await travel(r, b, 'meteorIntro');
  stage(b, 'setup', METEOR_SETUP_MS);
  emitUpdate();
  await sleep(METEOR_SETUP_MS);

  stage(b, 'drop');
  b.dropStartAt = Date.now() + 300;
  say('meteorDrop');
  let t = b.dropStartAt;
  for (let i = 0; i < b.drops.length; i++) {
    const d = b.drops[i];
    await sleep(t + METEOR_DROP_MS - Date.now());
    if (d.double) {
      say('meteorDouble', { n: d.factor * 2 });
      t += METEOR_DROP_MS + METEOR_DOUBLE_MS;
    } else {
      t += METEOR_DROP_MS;
    }
  }
  for (const p of bonusPlayers(r, 'meteor')) p.bonusX = b.value;
  stage(b, 'done');
  say('meteorResult', { x: xLabel(b.value) });
}

async function runHunt(r) {
  const b = { type: 'hunt', ...huntRoll() };
  await travel(r, b, 'huntIntro');
  stage(b, 'shuffle', HUNT_SHUFFLE_MS);
  emitUpdate();
  await sleep(HUNT_SHUFFLE_MS);

  stage(b, 'pick', b.empty ? EMPTY_PICK_MS : HUNT_PICK_MS);
  if (!b.empty) say('huntPick');
  else emitUpdate();
  const hurry = setTimeout(() => { if (!b.empty) say('huntHurry'); }, HUNT_PICK_MS - 4000);
  await sleep(b.stageEndsAt - Date.now());
  clearTimeout(hurry);

  for (const p of bonusPlayers(r, 'hunt')) {
    if (p.choice === null) p.choice = randInt(HUNT_COLS * HUNT_ROWS);
    p.bonusX = b.values[p.choice];
  }
  stage(b, 'reveal', HUNT_REVEAL_MS);
  say('huntFire');
  await sleep(HUNT_REVEAL_MS);
  stage(b, 'done');
  const best = bonusPlayers(r, 'hunt').sort((a, c) => c.bonusX - a.bonusX)[0];
  if (best) say('huntResult', { naam: best.username, x: xLabel(best.bonusX) });
  else say('huntMissed', { x: xLabel(Math.max(...b.values)) });
}

async function runWorm(r) {
  const b = { type: 'worm', ...wormRoll() };
  await travel(r, b, 'wormIntro');
  stage(b, 'portal', WORM_PORTAL_MS);
  emitUpdate();
  await sleep(1200);
  say('wormPortal');
  await sleep(b.stageEndsAt - Date.now());

  stage(b, 'pick', b.empty ? EMPTY_PICK_MS : WORM_PICK_MS);
  if (!b.empty) say('wormPick');
  else emitUpdate();
  await sleep(b.stageEndsAt - Date.now());

  for (const p of bonusPlayers(r, 'worm')) if (p.choice === null) p.choice = 1;
  stage(b, 'spin');
  b.spinStartAt = Date.now() + 300;
  say('wormSpin');
  let t = b.spinStartAt;
  for (let s = 0; s < b.spins.length; s++) {
    await sleep(t + WORM_SPIN_MS - Date.now());
    const spin = b.spins[s];
    const boost = spin.hits.includes('T') ? 'T' : spin.hits.includes('D') ? 'D' : null;
    if (boost && s < b.spins.length - 1) say(boost === 'T' ? 'wormTriple' : 'wormDouble');
    else if (s === b.spins.length - 1) {
      const best = Math.max(...b.results.map(res => res.value));
      say(best >= 500 ? 'wormHuge' : 'wormResult', { x: xLabel(best) });
    }
    t += WORM_SPIN_MS + WORM_BETWEEN_MS;
  }
  for (const p of bonusPlayers(r, 'worm')) p.bonusX = b.results[p.choice].value;
  stage(b, 'done');
}

/**
 * Wat een speler terugkrijgt (inclusief inzet)
 */
function payoutFor(p, segment, comets) {
  const amount = p.bets[segment];
  if (!amount) return 0;
  const value = NUMBER_VALUE[segment] || p.bonusX || 0;
  const comet = comets.find(c => c.spot === segment);
  const x = Math.min(MAX_X, value * (comet ? comet.mult : 1));
  return amount * (x + 1);
}

function settle(r) {
  if (r.phase === 'result' || r.phase === 'cancelled') return;
  const db = getDatabase();
  const insertStats = db.prepare(`
    INSERT INTO sterrenrad_stats (user_id, username, games_played, total_bet, total_payout, biggest_win, biggest_multiplier, bonuses, last_played)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      games_played = games_played + 1,
      total_bet = total_bet + excluded.total_bet,
      total_payout = total_payout + excluded.total_payout,
      biggest_win = MAX(biggest_win, excluded.biggest_win),
      biggest_multiplier = MAX(biggest_multiplier, excluded.biggest_multiplier),
      bonuses = bonuses + excluded.bonuses,
      last_played = excluded.last_played
  `);
  const winners = [];
  db.transaction(() => {
    for (const p of r.players.values()) {
      const payout = payoutFor(p, r.segment, r.comets);
      p.payout = payout;
      if (payout > 0) {
        casino.addBalance(p.userId, p.username, payout, `Sterrenrad ${BONUS_NAMES[r.segment] || r.segment}`);
        winners.push(p);
      }
      casino.releaseStake('sterrenrad', stakeRef(r, p.userId));
      const mult = p.bets[r.segment] ? Math.round((payout / p.bets[r.segment]) * 100) / 100 : 0;
      const playedBonus = !NUMBER_VALUE[r.segment] && p.bets[r.segment] ? 1 : 0;
      insertStats.run(p.userId, p.username, p.total, payout, Math.max(0, payout - p.total), mult, playedBonus);
    }
  })();

  r.phase = 'result';
  r.nextAt = Date.now() + RESULT_MS;

  winners.sort((a, b) => (b.payout - b.total) - (a.payout - a.total));
  const top = winners[0];
  if (!top) say('nobody', {}, { silent: true });
  else if (top.payout - top.total >= 1000) say('bigWin', { naam: top.username, bedrag: top.payout }, { silent: true });
  else if (winners.length >= 3) say('manyWinners', { n: winners.length, naam: top.username, bedrag: top.payout }, { silent: true });
  else say('winners', { naam: top.username, bedrag: top.payout }, { silent: true });
  emitUpdate();

  // Iets later: opmerkingen over reeksen
  setTimeout(() => {
    if (round !== r || r.phase !== 'result') return;
    let streak = 0;
    while (streak < history.length && history[streak].seg === history[0].seg) streak++;
    if (streak >= 3) say('streak', { n: streak, vak: SPOT_NAMES[history[0].seg] });
    else if (bonusDrought >= 7 && rand() < 0.6) say('drought', { n: bonusDrought });
    else say('nextRound');
  }, 4500);
}

// Max praat ook als er niemand speelt
setInterval(() => {
  const busy = round && (['betting', 'comets', 'spinning', 'landed', 'bonus'].includes(round.phase) ||
    (round.phase === 'result' && Date.now() < round.nextAt + 3000));
  if (!busy && Date.now() - lastSpeechAt > IDLE_EVERY_MS) say('idle');
}, 3000).unref();
say('idle', {}, { silent: true });

// =====================================================
// BALANS (alleen voor ontwikkeling)
// =====================================================

/**
 * Simuleer de terugbetaling per vak (in %). Keuzes in bonussen zijn willekeurig.
 */
function rtpReport(spins = 500000) {
  const back = Object.fromEntries(SPOTS.map(s => [s, 0]));
  const rnd = Math.random;
  for (let i = 0; i < spins; i++) {
    const comets = rollComets(rnd);
    const seg = WHEEL[Math.floor(rnd() * SEGMENT_COUNT)];
    let value;
    if (NUMBER_VALUE[seg]) value = NUMBER_VALUE[seg];
    else if (seg === 'coin') { const c = coinRoll(rnd); value = c[c.side]; }
    else if (seg === 'meteor') value = meteorRoll(rnd).value;
    else if (seg === 'hunt') value = huntRoll(rnd).values[Math.floor(rnd() * HUNT_COLS * HUNT_ROWS)];
    else value = wormRoll(rnd).results[Math.floor(rnd() * 3)].value;
    const comet = comets.find(c => c.spot === seg);
    back[seg] += Math.min(MAX_X, value * (comet ? comet.mult : 1)) + 1;
  }
  return Object.fromEntries(SPOTS.map(s => [s, Math.round((back[s] / spins) * 10000) / 100]));
}

module.exports = {
  WHEEL,
  SPOTS,
  events,
  getConfig,
  getStats,
  getPublicState,
  placeBets,
  choose,
  rtpReport
};
