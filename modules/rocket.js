/**
 * Rocket (Crash) - Spellogica en GIF renderer
 * De multiplier groeit exponentieel vanaf 1.00x tot het vooraf bepaalde crashpunt.
 * Spelers kiezen vooraf een auto-cashout; wie onder het crashpunt zit wint inzet × cashout.
 */

const crypto = require('crypto');
const sharp = require('sharp');

const HOUSE_EDGE = 0.97;       // 3% huisvoordeel, net als Mines
const MAX_CRASH = 50;          // Raket crasht uiterlijk op 50x
const MIN_CASHOUT = 1.01;
const MAX_CASHOUT = 25;
const GROWTH = 0.25;           // m(t) = e^(GROWTH * t) → 2x na ~2.8s, 10x na ~9.2s

// Render instellingen
const W = 520;
const H = 300;
const FRAME_MS = 70;
const PREROLL_FRAMES = 10;
const EXPLOSION_FRAMES = 18;
const HOLD_FRAMES = 25;
const PLOT = { left: 48, right: W - 18, top: 18, bottom: H - 32 };
const FONT = 'DejaVu Sans, Arial, sans-serif';

const STARS = Array.from({ length: 40 }, (_, i) => {
  // Vaste pseudo-random posities zodat elke render hetzelfde sterrenveld heeft
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 12345.6789;
  return {
    x: (a - Math.floor(a)) * W,
    y: (b - Math.floor(b)) * H,
    r: i % 5 === 0 ? 1.4 : 0.8,
    speed: i % 3 === 0 ? 1 : 0.5
  };
});

/**
 * Bepaal het crashpunt. P(crash >= x) = HOUSE_EDGE / x, ~3% directe crash op 1.00x
 */
function generateCrashPoint() {
  const r = crypto.randomInt(0, 2 ** 32) / 2 ** 32;
  const raw = Math.floor((100 * HOUSE_EDGE) / (1 - r)) / 100;
  return Math.min(Math.max(1, raw), MAX_CRASH);
}

function multiplierAt(t) {
  return Math.exp(GROWTH * t);
}

function timeForMultiplier(m) {
  return Math.log(m) / GROWTH;
}

/**
 * Parse een cashout invoer zoals "2", "2.5", "2,5" of "2.5x"
 */
function parseCashout(input) {
  const value = parseFloat(String(input).trim().toLowerCase().replace('x', '').replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function calculatePayout(bet, cashout) {
  return Math.floor(bet * cashout);
}

/**
 * Bereken de uitslag per speler
 */
function resolvePlayers(players, crashPoint) {
  return players.map(p => {
    const won = p.cashout <= crashPoint;
    return { ...p, won, payout: won ? calculatePayout(p.bet, p.cashout) : 0 };
  });
}

// =====================================================
// RENDERER
// =====================================================

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function shortName(name) {
  return name.length > 12 ? `${name.slice(0, 11)}…` : name;
}

function niceStep(range, maxLines) {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
  return steps.find(s => range / s <= maxLines) || 20;
}

function formatMult(m) {
  return `${m.toFixed(2)}x`;
}

/**
 * Bouw de schaal voor een moment in de vlucht (assen zoomen mee uit)
 */
function buildScale(t, m) {
  const xMax = Math.max(4, t * 1.12);
  const yMax = Math.max(2, 1 + (m - 1) * 1.22);
  const px = time => PLOT.left + (time / xMax) * (PLOT.right - PLOT.left);
  const py = mult => PLOT.bottom - ((mult - 1) / (yMax - 1)) * (PLOT.bottom - PLOT.top);
  return { xMax, yMax, px, py };
}

function renderBackground(t) {
  const stars = STARS.map(s => {
    const x = ((s.x - t * 18 * s.speed) % W + W) % W;
    return `<circle cx="${x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${s.r}" fill="#ffffff" opacity="0.55"/>`;
  }).join('');

  return `
    <defs>
      <linearGradient id="trail" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#ffb347"/>
        <stop offset="1" stop-color="#ff5e3a"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="#12142b"/>
    ${stars}`;
}

function renderGrid(scale) {
  const { xMax, yMax, px, py } = scale;
  let out = '';

  const yStep = niceStep(yMax - 1, 5);
  // Begin bij een rond veelvoud van de stap (dus 10x, 20x i.p.v. 11x, 21x)
  for (let v = Math.floor(1 / yStep + 1) * yStep; v < yMax; v += yStep) {
    const y = py(v).toFixed(1);
    out += `<line x1="${PLOT.left}" y1="${y}" x2="${PLOT.right}" y2="${y}" stroke="#ffffff" stroke-opacity="0.08"/>`;
    out += `<text x="${PLOT.left - 6}" y="${(+y + 4).toFixed(1)}" font-family="${FONT}" font-size="11" fill="#8b90b8" text-anchor="end">${+v.toFixed(1)}x</text>`;
  }

  const xStep = niceStep(xMax, 6);
  for (let v = xStep; v < xMax; v += xStep) {
    const x = px(v).toFixed(1);
    out += `<line x1="${x}" y1="${PLOT.top}" x2="${x}" y2="${PLOT.bottom}" stroke="#ffffff" stroke-opacity="0.05"/>`;
    out += `<text x="${x}" y="${PLOT.bottom + 16}" font-family="${FONT}" font-size="11" fill="#8b90b8" text-anchor="middle">${+v.toFixed(1)}s</text>`;
  }

  out += `<line x1="${PLOT.left}" y1="${PLOT.bottom}" x2="${PLOT.right}" y2="${PLOT.bottom}" stroke="#8b90b8" stroke-opacity="0.5"/>`;
  out += `<line x1="${PLOT.left}" y1="${PLOT.top}" x2="${PLOT.left}" y2="${PLOT.bottom}" stroke="#8b90b8" stroke-opacity="0.5"/>`;
  return out;
}

function renderCurve(scale, t, crashed) {
  const { px, py } = scale;
  const samples = 48;
  const points = [];
  for (let i = 0; i <= samples; i++) {
    const time = (t * i) / samples;
    points.push(`${px(time).toFixed(1)},${py(multiplierAt(time)).toFixed(1)}`);
  }
  const line = points.join(' ');
  const area = `${PLOT.left},${PLOT.bottom} ${line} ${px(t).toFixed(1)},${PLOT.bottom}`;
  const stroke = crashed ? '#ed4245' : 'url(#trail)';
  const fill = crashed ? '#ed4245' : '#ff9f1c';
  return `
    <polygon points="${area}" fill="${fill}" fill-opacity="0.13"/>
    <polyline points="${line}" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function renderRocket(x, y, angleDeg, frame) {
  const flame = 10 + (frame % 3) * 4;
  return `
    <g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${angleDeg.toFixed(1)}) scale(1.15)">
      <polygon points="-16,-5 ${-16 - flame},0 -16,5" fill="#ff7b29"/>
      <polygon points="-16,-3 ${-16 - flame * 0.6},0 -16,3" fill="#ffe066"/>
      <polygon points="-16,-6 -9,-6 -21,-13" fill="#ed4245"/>
      <polygon points="-16,6 -9,6 -21,13" fill="#ed4245"/>
      <rect x="-17" y="-6" width="26" height="12" rx="4" fill="#eceef8"/>
      <path d="M8,-6 Q21,0 8,6 Z" fill="#ed4245"/>
      <circle cx="0" cy="0" r="3.2" fill="#4fc3f7" stroke="#2b2d31" stroke-width="1.2"/>
    </g>`;
}

function renderExplosion(x, y, step) {
  const p = step / EXPLOSION_FRAMES;
  const fade = Math.max(0, 1 - p);
  let out = '';
  out += `<circle cx="${x}" cy="${y}" r="${(10 + p * 46).toFixed(1)}" fill="#ff5e3a" opacity="${(0.55 * fade).toFixed(2)}"/>`;
  out += `<circle cx="${x}" cy="${y}" r="${(6 + p * 28).toFixed(1)}" fill="#ffb347" opacity="${(0.8 * fade).toFixed(2)}"/>`;
  out += `<circle cx="${x}" cy="${y}" r="${Math.max(0, 12 - p * 14).toFixed(1)}" fill="#fff6d5" opacity="${fade.toFixed(2)}"/>`;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.3;
    const r1 = 8 + p * 40;
    const r2 = r1 + 8;
    out += `<line x1="${(x + Math.cos(a) * r1).toFixed(1)}" y1="${(y + Math.sin(a) * r1).toFixed(1)}" x2="${(x + Math.cos(a) * r2).toFixed(1)}" y2="${(y + Math.sin(a) * r2).toFixed(1)}" stroke="#ffd166" stroke-width="2.5" stroke-linecap="round" opacity="${fade.toFixed(2)}"/>`;
  }
  return out;
}

/**
 * Lijst met spelers linksboven + groene stippen op de curve bij uitcashen
 */
function renderPlayers(scale, players, m, t, crashed) {
  const { px, py } = scale;
  let out = '';

  const sorted = [...players].sort((a, b) => a.cashout - b.cashout);
  sorted.forEach(p => {
    if (p.cashout > m) return;
    const tp = timeForMultiplier(p.cashout);
    const x = px(tp);
    const y = py(p.cashout);
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="#57f287" stroke="#12142b" stroke-width="1.5"/>`;
    const since = t - tp;
    if (since < 1.2 && !crashed) {
      const lift = since * 22;
      const opacity = Math.max(0, 1 - since / 1.2).toFixed(2);
      out += `<text x="${x.toFixed(1)}" y="${(y - 10 - lift).toFixed(1)}" font-family="${FONT}" font-size="12" font-weight="bold" fill="#57f287" text-anchor="middle" opacity="${opacity}">${escapeXml(shortName(p.username))} +${calculatePayout(p.bet, p.cashout) - p.bet}</text>`;
    }
  });

  const rows = sorted.slice(0, 8);
  const panelH = 10 + rows.length * 16 + (sorted.length > 8 ? 14 : 0);
  out += `<rect x="${PLOT.left + 8}" y="${PLOT.top + 4}" width="170" height="${panelH}" rx="6" fill="#000000" fill-opacity="0.35"/>`;
  rows.forEach((p, i) => {
    const y = PLOT.top + 20 + i * 16;
    const cashed = p.cashout <= m;
    const color = cashed ? '#57f287' : crashed ? '#ed4245' : '#dcdfee';
    const right = cashed ? `+${calculatePayout(p.bet, p.cashout) - p.bet}` : crashed ? `-${p.bet}` : formatMult(p.cashout);
    out += `<text x="${PLOT.left + 16}" y="${y}" font-family="${FONT}" font-size="12" fill="${color}">${escapeXml(shortName(p.username))}</text>`;
    out += `<text x="${PLOT.left + 170}" y="${y}" font-family="${FONT}" font-size="12" font-weight="bold" fill="${color}" text-anchor="end">${right}</text>`;
  });
  if (sorted.length > 8) {
    out += `<text x="${PLOT.left + 16}" y="${PLOT.top + 20 + 8 * 16}" font-family="${FONT}" font-size="11" fill="#8b90b8">+${sorted.length - 8} meer</text>`;
  }
  return out;
}

function renderCenterText(m, phase) {
  const cx = (PLOT.left + PLOT.right) / 2 + 40;
  const cy = (PLOT.top + PLOT.bottom) / 2 + 10;
  if (phase === 'preroll') {
    return `<text x="${cx}" y="${cy}" font-family="${FONT}" font-size="50" font-weight="bold" fill="#ffffff" text-anchor="middle">1.00x</text>
      <text x="${cx}" y="${cy + 26}" font-family="${FONT}" font-size="15" fill="#ffb347" text-anchor="middle" letter-spacing="3">LIFTOFF</text>`;
  }
  if (phase === 'crashed') {
    return `<text x="${cx}" y="${cy}" font-family="${FONT}" font-size="50" font-weight="bold" fill="#ed4245" text-anchor="middle">${formatMult(m)}</text>
      <text x="${cx}" y="${cy + 26}" font-family="${FONT}" font-size="15" font-weight="bold" fill="#ed4245" text-anchor="middle" letter-spacing="3">CRASHED</text>`;
  }
  return `<text x="${cx}" y="${cy}" font-family="${FONT}" font-size="50" font-weight="bold" fill="#ffffff" text-anchor="middle">${formatMult(m)}</text>`;
}

/**
 * Render één frame als SVG string
 */
function renderFrameSvg({ t, m, phase, players, frame, explosionStep = 0 }) {
  const crashed = phase === 'crashed';
  const scale = buildScale(t, m);
  const x = scale.px(t);
  const y = scale.py(m);

  // Hoek van de raket volgt de raaklijn van de curve op het scherm
  const dxdt = (PLOT.right - PLOT.left) / scale.xMax;
  const dydt = (GROWTH * m * (PLOT.bottom - PLOT.top)) / (scale.yMax - 1);
  const angle = (Math.atan2(-dydt, dxdt) * 180) / Math.PI;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  svg += renderBackground(t);
  svg += renderGrid(scale);
  svg += renderCurve(scale, t, crashed);
  svg += renderCenterText(m, phase);
  svg += renderPlayers(scale, players, m, t, crashed);
  if (crashed) {
    if (explosionStep < EXPLOSION_FRAMES) svg += renderExplosion(x, y, explosionStep);
  } else {
    svg += renderRocket(x, y, phase === 'preroll' ? -20 : angle, frame);
  }
  svg += '</svg>';
  return svg;
}

async function svgToPng(svg) {
  return sharp(Buffer.from(svg)).png({ compressionLevel: 0 }).toBuffer();
}

/**
 * Render de hele vlucht als geanimeerde GIF + een statisch eindbeeld
 * @returns {Promise<{gif: Buffer, finalImage: Buffer, durationMs: number}>}
 */
async function renderFlight(players, crashPoint) {
  const specs = [];
  const crashTime = timeForMultiplier(crashPoint);

  for (let i = 0; i < PREROLL_FRAMES; i++) {
    specs.push({ t: 0, m: 1, phase: 'preroll', frame: i });
  }

  const flightFrames = Math.ceil((crashTime * 1000) / FRAME_MS);
  for (let i = 0; i < flightFrames; i++) {
    const t = (i * FRAME_MS) / 1000;
    specs.push({ t, m: multiplierAt(t), phase: 'flying', frame: i });
  }

  for (let i = 0; i < EXPLOSION_FRAMES + HOLD_FRAMES; i++) {
    specs.push({ t: crashTime, m: crashPoint, phase: 'crashed', frame: i, explosionStep: i });
  }

  const frames = [];
  for (const spec of specs) {
    frames.push(await svgToPng(renderFrameSvg({ ...spec, players })));
  }

  const gif = await sharp(frames, { join: { animated: true } })
    .gif({ delay: FRAME_MS, loop: 1, colours: 96, effort: 7, dither: 0 })
    .toBuffer();

  const finalImage = await sharp(frames[frames.length - 1]).png().toBuffer();

  return { gif, finalImage, durationMs: specs.length * FRAME_MS };
}

module.exports = {
  MIN_CASHOUT,
  MAX_CASHOUT,
  MAX_CRASH,
  HOUSE_EDGE,
  generateCrashPoint,
  parseCashout,
  calculatePayout,
  resolvePlayers,
  renderFlight
};
