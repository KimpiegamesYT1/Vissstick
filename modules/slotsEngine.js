/**
 * Slots engine (fruitautomaat) — pure spel-logica, zonder database.
 *
 * Eén spin geeft een volledig "script" terug: de rollen, eventuele events, alle cascades, free spins en
 * hold & win respins. De website speelt dat script alleen af; de uitslag ligt vast op de server.
 *
 * Bedragen in het script zijn in punten (kommagetallen); de module rondt het totaal pas aan het eind af.
 *
 * Balans: elk niveau heeft een eigen `scale` op lijn- en scatterwinsten. Die is met een simulatie zo gekozen
 * dat elk niveau (inclusief de fever-meter) ongeveer TARGET_RTP terugbetaalt. Pas je iets aan de wiskunde aan,
 * simuleer dan opnieuw en werk de `scale` waardes bij.
 */

const TARGET_RTP = 0.96;
const MAX_WIN_X = 2500;          // maximale winst per betaalde spin (× inzet)
const MAX_FREE_SPINS = 100;
const MAX_CASCADES = 25;
const CASCADE_MULTS = [1, 2, 3, 5, 8, 10];
const EVENT_CHANCE = 0.1;
const RESPINS = 3;

// Fever-meter: na FEVER_SPINS betaalde spins draai je aan het fever-rad (prijs × je gemiddelde inzet).
// Alle vakken zijn even groot en even waarschijnlijk.
const FEVER_SPINS = 75;
const FEVER_WHEEL = [2, 5, 3, 8, 2, 4, 15, 3, 6, 2, 10, 4, 50, 3, 5, 8, 4, 20, 6, 12];
const FEVER_EV = FEVER_WHEEL.reduce((a, b) => a + b, 0) / FEVER_WHEEL.length;
const FEVER_RTP = FEVER_EV / FEVER_SPINS;

// Gewone symbolen van laag naar hoog
const FRUITS = ['C', 'L', 'O', 'P', 'G', 'M', 'B', 'R', '7'];

// 3 rollen: drie op een lijn (× lijninzet). Kersen betalen ook voor 1 of 2 vanaf links.
const PAY3 = { C: 5, L: 6, O: 8, P: 10, G: 12, M: 20, B: 30, R: 60, 7: 120, W: 200 };
const CHERRY3 = [0, 1.5, 3];
// 5 rollen: 3, 4 en 5 op een lijn vanaf links (× lijninzet). Kersen betalen ook voor 2.
const PAY5 = {
  C: [4, 12, 40], L: [5, 15, 50], O: [6, 20, 60], P: [8, 25, 80], G: [10, 30, 100],
  M: [15, 50, 150], B: [20, 75, 250], R: [30, 120, 400], 7: [50, 250, 1000], W: [50, 250, 1000]
};
const CHERRY5_TWO = 2;
// Scatters overal: × totale inzet, plus free spins
const SCATTER_PAY = { 3: 2, 4: 10, 5: 50 };
const SCATTER_SPINS = { 3: 8, 4: 12, 5: 20 };
const RETRIGGER_SPINS = 5;

// Geldfruit (× inzet, wordt niet geschaald)
const COIN_VALUES = [
  [0.5, 28], [1, 26], [2, 18], [3, 11], [5, 8], [8, 4], [10, 2.5], [15, 1.3],
  ['MINI', 0.6], ['MINOR', 0.2], ['MAJOR', 0.04]
];
const JACKPOTS = { MINI: 25, MINOR: 75, MAJOR: 250, GRAND: 1000 };
const WILD_MULTS = [[1, 62], [2, 26], [3, 9], [5, 3]];

const BASE3 = { C: 14, L: 16, O: 16, P: 14, G: 12, M: 10, B: 8, R: 6, 7: 4 };
const BASE5 = { C: 18, L: 18, O: 16, P: 15, G: 13, M: 10, B: 8, R: 6, 7: 4 };

/**
 * Niveaus. Elk niveau zet nieuwe features aan; je kunt altijd terug naar een lager niveau.
 * weights.W/S/K: gewicht van wild, scatter en geldfruit per vakje.
 */
const LEVELS = [
  {
    level: 1, xp: 0, name: 'Klassiek', unlock: 'Drie rollen, vijf lijnen. Kersen betalen altijd.',
    reels: 3, rows: 3, base: BASE3, wild: 0, scatter: 0, coin: 0, scale: 2.084
  },
  {
    level: 2, xp: 10, name: 'Wilds', unlock: 'WILD verschijnt op de middelste rol en vervangt elk fruit.',
    reels: 3, rows: 3, base: BASE3, wild: 9, scatter: 0, coin: 0, scale: 1.574
  },
  {
    level: 3, xp: 30, name: 'Vijf rollen', unlock: 'De machine groeit: vijf rollen en twintig lijnen.',
    reels: 5, rows: 3, base: BASE5, wild: 6, scatter: 0, coin: 0, scale: 1.903
  },
  {
    level: 4, xp: 60, name: 'Free spins', unlock: '3+ sterren = free spins. Elke winst verhoogt de multiplier.',
    reels: 5, rows: 3, base: BASE5, wild: 6, scatter: 4.2, coin: 0, scale: 1.618
  },
  {
    level: 5, xp: 100, name: 'Fruitregen', unlock: 'Winnende symbolen ontploffen en nieuwe vallen erin: ×1, ×2, ×3, ×5…',
    reels: 5, rows: 3, base: BASE5, wild: 6, scatter: 4.2, coin: 0, cascade: true, scale: 1.009
  },
  {
    level: 6, xp: 150, name: 'Geldfruit', unlock: '6+ munten = Hold & Win met MINI, MINOR, MAJOR en GRAND jackpots.',
    reels: 5, rows: 3, base: BASE5, wild: 6, scatter: 4.2, coin: 15, cascade: true, scale: 1.386
  },
  {
    level: 7, xp: 220, name: 'Gekke events', unlock: 'Willekeurige events: wildstorm, multiplier-regen, fruitsalade en muntenregen.',
    reels: 5, rows: 3, base: BASE5, wild: 6, scatter: 4.2, coin: 13, cascade: true, events: true, scale: 0.726
  },
  {
    level: 8, xp: 300, name: 'Mega-rollen', unlock: 'Vier rijen hoog en veertig lijnen.',
    reels: 5, rows: 4, base: BASE5, wild: 6, scatter: 3.1, coin: 13, cascade: true, events: true, scale: 0.804
  },
  {
    level: 9, xp: 400, name: 'Gouden spins', unlock: 'In free spins blijven wilds plakken en start de multiplier op ×2.',
    reels: 5, rows: 4, base: BASE5, wild: 6, scatter: 3.1, coin: 13, cascade: true, events: true, sticky: true, fsStart: 2, scale: 0.652
  },
  {
    level: 10, xp: 520, name: 'Vissstick-modus', unlock: 'Vijf bij vijf, vijftig lijnen en wilds met ×2, ×3 en ×5.',
    reels: 5, rows: 5, base: BASE5, wild: 5, scatter: 2.5, coin: 12, cascade: true, events: true, sticky: true, fsStart: 2, wildMults: true, scale: 0.466
  }
];

// =====================================================
// LIJNEN
// =====================================================

/**
 * Lijnen voor 5 rollen: alle paden waarbij elke stap hooguit één rij verspringt. Symmetrische lijnen eerst,
 * daarna zo weinig mogelijk op en neer, en zo dicht mogelijk bij het midden.
 */
function buildLines(rows, count) {
  const paths = [];
  const walk = path => {
    if (path.length === 5) { paths.push(path); return; }
    const last = path[path.length - 1];
    for (let r = Math.max(0, last - 1); r <= Math.min(rows - 1, last + 1); r++) walk([...path, r]);
  };
  for (let r = 0; r < rows; r++) walk([r]);
  const mid = (rows - 1) / 2;
  const key = p => {
    const symmetric = p[0] === p[4] && p[1] === p[3] ? 0 : 1;
    const flat = p.every(v => v === p[0]) ? 0 : 1;
    let move = 0;
    for (let i = 1; i < 5; i++) move += Math.abs(p[i] - p[i - 1]);
    const center = p.reduce((s, v) => s + Math.abs(v - mid), 0);
    return [flat, symmetric, move, center];
  };
  paths.sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    for (let i = 0; i < 5; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
  return paths.slice(0, count);
}

const LINES = {
  '3x3': [[1, 1, 1], [0, 0, 0], [2, 2, 2], [0, 1, 2], [2, 1, 0]],
  '5x3': buildLines(3, 20),
  '5x4': buildLines(4, 40),
  '5x5': buildLines(5, 50)
};

function linesFor(cfg) {
  return LINES[`${cfg.reels}x${cfg.rows}`];
}

// =====================================================
// RNG + TREKKEN
// =====================================================

function pickWeighted(table, rand) {
  let total = 0;
  for (const [, w] of table) total += w;
  let x = rand() * total;
  for (const [value, w] of table) {
    x -= w;
    if (x < 0) return value;
  }
  return table[table.length - 1][0];
}

const drawerCache = new WeakMap();

/**
 * Gewichten per rol. Wilds alleen op de middelste rollen; scatters en munten overal (munten niet in free spins).
 */
function drawer(cfg, mode) {
  let cached = drawerCache.get(cfg);
  if (!cached) { cached = {}; drawerCache.set(cfg, cached); }
  if (cached[mode]) return cached[mode];
  const perReel = [];
  for (let r = 0; r < cfg.reels; r++) {
    const table = Object.entries(cfg.base).map(([s, w]) => [s, w]);
    const wildReel = cfg.reels === 3 ? r === 1 : r >= 1 && r <= 3;
    // In free spins meer wilds, behalve als ze blijven plakken
    if (cfg.wild && wildReel) table.push(['W', cfg.wild * (mode === 'fs' ? (cfg.sticky ? 0.55 : 1.25) : 1)]);
    if (cfg.scatter) table.push(['S', cfg.scatter]);
    if (cfg.coin && mode === 'base') table.push(['K', cfg.coin]);
    perReel.push(table);
  }
  cached[mode] = perReel;
  return perReel;
}

function makeCell(s, cfg, rand) {
  if (s === 'W') return cfg.wildMults ? { s, m: pickWeighted(WILD_MULTS, rand) } : { s };
  if (s === 'K') return coinCell(rand);
  return { s };
}

function coinCell(rand) {
  const v = pickWeighted(COIN_VALUES, rand);
  return typeof v === 'string' ? { s: 'K', v: JACKPOTS[v], j: v } : { s: 'K', v };
}

/** Eén vakje trekken voor rol `reel`. Maximaal één scatter per rol. */
function drawCell(cfg, mode, reel, column, rand) {
  const table = drawer(cfg, mode)[reel];
  for (let tries = 0; tries < 20; tries++) {
    const s = pickWeighted(table, rand);
    if (s === 'S' && column.some(c => c && c.s === 'S')) continue;
    return makeCell(s, cfg, rand);
  }
  return { s: 'C' };
}

function drawGrid(cfg, mode, rand, sticky) {
  const grid = [];
  for (let r = 0; r < cfg.reels; r++) {
    const col = new Array(cfg.rows).fill(null);
    for (let row = 0; row < cfg.rows; row++) {
      const fixed = sticky && sticky.get(r * 10 + row);
      if (fixed) col[row] = { ...fixed, st: 1 };
    }
    for (let row = 0; row < cfg.rows; row++) {
      if (!col[row]) col[row] = drawCell(cfg, mode, r, col, rand);
    }
    grid.push(col);
  }
  return grid;
}

const cloneGrid = grid => grid.map(col => col.map(c => ({ ...c })));

// =====================================================
// WINSTEN
// =====================================================

/**
 * Alle lijnwinsten op een grid. Bedragen in "× lijninzet" (nog zonder schaal en multipliers).
 */
function evaluate(grid, cfg) {
  const lines = linesFor(cfg);
  const wins = [];
  const reels = cfg.reels;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let target = null, count = 0, wildRun = 0, leading = true;
    for (let r = 0; r < reels; r++) {
      const c = grid[r][line[r]];
      if (c.s === 'W') {
        count++;
        if (leading) wildRun++;
        continue;
      }
      leading = false;
      if (c.s === 'S' || c.s === 'K') break;
      if (target === null) { target = c.s; count++; continue; }
      if (c.s === target) { count++; continue; }
      break;
    }

    let pay = 0, n = 0, sym = null;
    if (target !== null) {
      if (reels === 3) {
        if (count === 3) pay = PAY3[target];
        else if (target === 'C') pay = CHERRY3[count];
      } else if (count >= 3) {
        pay = PAY5[target][count - 3];
      } else if (target === 'C' && count === 2) {
        pay = CHERRY5_TWO;
      }
      n = count; sym = target;
    }
    // Alleen wilds kan meer opleveren dan het fruit erna
    const wildPay = reels === 3 ? (wildRun === 3 ? PAY3.W : 0) : (wildRun >= 3 ? PAY5.W[wildRun - 3] : 0);
    if (wildPay > pay) { pay = wildPay; n = wildRun; sym = 'W'; }
    if (!pay) continue;

    // Wild-multipliers tellen bij elkaar op (×2 en ×3 = ×5)
    let wm = 0;
    const cells = [];
    for (let r = 0; r < n; r++) {
      const c = grid[r][line[r]];
      if (c.s === 'W' && c.m > 1) wm += c.m;
      cells.push([r, line[r]]);
    }
    wins.push({ line: li, sym, n, cells, pay, wm: wm || 1 });
  }
  return wins;
}

function countSymbol(grid, s) {
  const cells = [];
  grid.forEach((col, r) => col.forEach((c, row) => { if (c.s === s) cells.push([r, row]); }));
  return cells;
}

/**
 * Cascade: verwijderde vakjes weg, de rest valt naar beneden (plakkende wilds blijven staan), bovenin nieuw fruit.
 * drops[reel][row] = rij waar het symbool vandaan komt (negatief = nieuw, van boven).
 */
function refill(grid, removed, cfg, mode, rand) {
  const next = [];
  const drops = [];
  for (let r = 0; r < cfg.reels; r++) {
    const col = grid[r];
    const gone = new Set(removed.filter(([rr]) => rr === r).map(([, row]) => row));
    const survivors = [];
    for (let row = 0; row < cfg.rows; row++) {
      if (!gone.has(row) && !col[row].st) survivors.push(row);
    }
    const newCol = new Array(cfg.rows).fill(null);
    const from = new Array(cfg.rows).fill(null);
    for (let row = 0; row < cfg.rows; row++) {
      if (col[row].st) { newCol[row] = col[row]; from[row] = row; }
    }
    // Van onder naar boven vullen met wat overbleef
    let si = survivors.length - 1;
    let fresh = 0;
    for (let row = cfg.rows - 1; row >= 0; row--) {
      if (newCol[row]) continue;
      if (si >= 0) { newCol[row] = col[survivors[si]]; from[row] = survivors[si]; si--; } else { fresh++; from[row] = -fresh; }
    }
    for (let row = 0; row < cfg.rows; row++) {
      if (!newCol[row]) newCol[row] = drawCell(cfg, mode, r, newCol, rand);
    }
    next.push(newCol);
    drops.push(from);
  }
  return { next, drops };
}

/**
 * Speel één grid uit (inclusief cascades).
 * ctx: { lineBet, scale, mode, fs (free spin staat), eventMult }
 */
function resolve(grid, cfg, ctx, rand) {
  const steps = [];
  let g = grid;
  let win = 0;
  for (let step = 0; step < MAX_CASCADES; step++) {
    const wins = evaluate(g, cfg);
    // Free spins: vaste multiplier van de bonus (+1 per cascade binnen de spin); anders de cascade-reeks
    let mult = ctx.mode === 'fs' ? ctx.fs.mult + step : (cfg.cascade ? CASCADE_MULTS[Math.min(step, CASCADE_MULTS.length - 1)] : 1);
    mult *= ctx.eventMult || 1;
    let stepWin = 0;
    for (const w of wins) {
      w.amount = w.pay * w.wm * ctx.lineBet * ctx.scale * mult;
      stepWin += w.amount;
    }
    const entry = { wins, mult, win: stepWin };
    steps.push(entry);
    win += stepWin;
    if (!cfg.cascade || !wins.length) break;

    const seen = new Set();
    const removed = [];
    for (const w of wins) {
      for (const [r, row] of w.cells) {
        const k = r * 10 + row;
        if (seen.has(k) || g[r][row].st) continue;
        seen.add(k);
        removed.push([r, row]);
      }
    }
    if (!removed.length) break;
    const { next, drops } = refill(g, removed, cfg, ctx.mode, rand);
    entry.removed = removed;
    entry.drops = drops;
    entry.next = next;
    g = next;
  }
  return { steps, win, final: g };
}

// =====================================================
// EVENTS
// =====================================================

function randomCells(grid, count, rand, ok) {
  const pool = [];
  grid.forEach((col, r) => col.forEach((c, row) => { if (ok(c)) pool.push([r, row]); }));
  const out = [];
  while (out.length < count && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

const EVENTS = [['wildstorm', 36], ['multiplier', 32], ['fruitsalad', 20], ['coinrain', 12]];

function rollEvent(grid, cfg, rand) {
  let type = pickWeighted(EVENTS, rand);
  if (type === 'coinrain' && !cfg.coin) type = 'wildstorm';
  const plain = c => c.s !== 'S' && c.s !== 'K' && c.s !== 'W';
  if (type === 'wildstorm') {
    const cells = randomCells(grid, 3 + Math.floor(rand() * 4), rand, plain);
    cells.forEach(([r, row]) => { grid[r][row] = makeCell('W', cfg, rand); });
    return { type, cells: cells.map(([r, row]) => [r, row, grid[r][row]]) };
  }
  if (type === 'multiplier') {
    return { type, mult: pickWeighted([[2, 50], [3, 30], [5, 15], [10, 5]], rand) };
  }
  if (type === 'fruitsalad') {
    const present = FRUITS.slice(0, 5).filter(s => grid.some(col => col.some(c => c.s === s)));
    const from = present.length ? present[Math.floor(rand() * present.length)] : 'C';
    const to = pickWeighted([['M', 40], ['B', 30], ['R', 20], ['7', 10]], rand);
    const cells = [];
    grid.forEach((col, r) => col.forEach((c, row) => { if (c.s === from) { col[row] = { s: to }; cells.push([r, row]); } }));
    return { type, from, to, cells };
  }
  const cells = randomCells(grid, 2 + Math.floor(rand() * 2), rand, c => c.s !== 'S' && c.s !== 'K');
  cells.forEach(([r, row]) => { grid[r][row] = coinCell(rand); });
  return { type: 'coinrain', cells: cells.map(([r, row]) => [r, row, grid[r][row]]) };
}

// =====================================================
// FEATURES
// =====================================================

function freeSpins(cfg, count, lineBet, scale, rand) {
  const fs = { mult: cfg.fsStart || 1 };
  const sticky = cfg.sticky ? new Map() : null;
  const spins = [];
  let total = count;
  let win = 0;
  for (let i = 0; i < total && i < MAX_FREE_SPINS; i++) {
    const grid = drawGrid(cfg, 'fs', rand, sticky);
    const multBefore = fs.mult;
    const res = resolve(cloneGrid(grid), cfg, { lineBet, scale, mode: 'fs', fs }, rand);
    if (res.win > 0) fs.mult++;
    const spin = { grid, steps: res.steps, win: res.win, multBefore, multAfter: fs.mult };
    const scatters = countSymbol(res.final, 'S');
    if (scatters.length >= 3 && total < MAX_FREE_SPINS) {
      const extra = Math.min(RETRIGGER_SPINS, MAX_FREE_SPINS - total);
      total += extra;
      spin.retrigger = { cells: scatters, spins: extra };
    }
    if (sticky) {
      const fresh = [];
      res.final.forEach((col, r) => col.forEach((c, row) => {
        if (c.s === 'W' && !sticky.has(r * 10 + row)) { sticky.set(r * 10 + row, { s: 'W', m: c.m }); fresh.push([r, row]); }
      }));
      if (fresh.length) spin.sticky = fresh;
    }
    win += res.win;
    spins.push(spin);
  }
  return { count, total: spins.length, spins, win, startMult: cfg.fsStart || 1, endMult: fs.mult };
}

// Aantal munten voor Hold & Win: 6 op 5×3, 7 op 5×4, 8 op 5×5
function coinTrigger(cfg) {
  return 6 + Math.max(0, cfg.rows - 3);
}

/** Hold & Win: munten blijven staan, 3 respins, elke nieuwe munt zet de respins terug op 3. */
function holdAndWin(grid, cfg, rand) {
  const cells = cfg.reels * cfg.rows;
  const board = grid.map(col => col.map(c => (c.s === 'K' ? c : null)));
  let filled = board.flat().filter(Boolean).length;
  const start = board.map(col => col.map(c => c && { ...c }));
  const fillChance = 0.4 / cells;
  const respins = [];
  let left = RESPINS;
  while (left > 0 && filled < cells) {
    left--;
    const fresh = [];
    for (let r = 0; r < cfg.reels; r++) {
      for (let row = 0; row < cfg.rows; row++) {
        if (board[r][row] || rand() >= fillChance * (1 + filled / cells)) continue;
        board[r][row] = coinCell(rand);
        fresh.push([r, row, board[r][row]]);
        filled++;
      }
    }
    if (fresh.length) left = RESPINS;
    respins.push({ coins: fresh, left });
  }
  let x = 0;
  board.forEach(col => col.forEach(c => { if (c) x += c.v; }));
  const grand = filled === cells;
  if (grand) x += JACKPOTS.GRAND;
  return { start, respins, x, grand };
}

// =====================================================
// SPIN
// =====================================================

/**
 * Eén betaalde spin.
 * @param {object} cfg niveau uit LEVELS
 * @param {number} bet inzet in punten
 * @param {() => number} rand random in [0, 1)
 * @param {number} [scaleOverride] voor de balanssimulatie
 */
function spin(cfg, bet, rand, scaleOverride) {
  const scale = scaleOverride === undefined ? cfg.scale : scaleOverride;
  const lineBet = bet / linesFor(cfg).length;
  const grid = drawGrid(cfg, 'base', rand);
  const start = cloneGrid(grid);
  const result = { grid: start };

  let eventMult = 1;
  if (cfg.events && rand() < EVENT_CHANCE) {
    result.event = rollEvent(grid, cfg, rand);
    if (result.event.mult) eventMult = result.event.mult;
  }

  const base = resolve(grid, cfg, { lineBet, scale, mode: 'base', eventMult }, rand);
  result.steps = base.steps;
  let lineWin = base.win;

  if (cfg.scatter) {
    const scat = countSymbol(base.final, 'S');
    if (scat.length >= 3) {
      const n = Math.min(5, scat.length);
      const pay = SCATTER_PAY[n] * bet * scale;
      lineWin += pay;
      result.scatter = { cells: scat, pay, spins: SCATTER_SPINS[n] };
      result.free = freeSpins(cfg, SCATTER_SPINS[n], lineBet, scale, rand);
      lineWin += result.free.win;
    }
  }

  let fixedWin = 0;
  if (cfg.coin) {
    const coins = countSymbol(base.final, 'K');
    if (coins.length >= coinTrigger(cfg)) {
      result.hold = holdAndWin(base.final, cfg, rand);
      result.hold.win = result.hold.x * bet;
      fixedWin = result.hold.win;
    }
  }

  let total = lineWin + fixedWin;
  const cap = MAX_WIN_X * bet;
  if (total > cap) { total = cap; result.capped = true; }
  result.lineWin = lineWin;
  result.fixedWin = fixedWin;
  result.total = total;
  return result;
}

function spinFever(avgBet, rand) {
  const index = Math.floor(rand() * FEVER_WHEEL.length);
  return { index, x: FEVER_WHEEL[index], win: FEVER_WHEEL[index] * avgBet };
}

/** Wat de website moet weten om te tekenen (tabellen al met de schaal van elk niveau) */
function publicLevels() {
  return LEVELS.map(cfg => ({
    level: cfg.level, xp: cfg.xp, name: cfg.name, unlock: cfg.unlock, reels: cfg.reels, rows: cfg.rows,
    lines: linesFor(cfg),
    features: {
      wild: Boolean(cfg.wild), scatter: Boolean(cfg.scatter), cascade: Boolean(cfg.cascade), coins: Boolean(cfg.coin),
      events: Boolean(cfg.events), sticky: Boolean(cfg.sticky), wildMults: Boolean(cfg.wildMults), fsStart: cfg.fsStart || 1
    },
    coinTrigger: cfg.coin ? coinTrigger(cfg) : null,
    scale: cfg.scale
  }));
}

module.exports = {
  TARGET_RTP, MAX_WIN_X, FEVER_SPINS, FEVER_WHEEL, FEVER_EV, FEVER_RTP, CASCADE_MULTS,
  PAY3, CHERRY3, PAY5, CHERRY5_TWO, SCATTER_PAY, SCATTER_SPINS, RETRIGGER_SPINS, JACKPOTS, FRUITS,
  LEVELS, LINES, linesFor, spin, spinFever, publicLevels, coinTrigger
};
