/**
 * Rocket (Crash) - Spellogica en uitslagkaart
 * De multiplier groeit exponentieel vanaf 1.00x tot het vooraf bepaalde crashpunt.
 * De vlucht wordt live in de browser getekend (web/rocket.html, zelfde formule via GROWTH);
 * hier wordt alleen de uitslagkaart voor Discord gemaakt.
 */

const crypto = require('crypto');
const sharp = require('sharp');

const HOUSE_EDGE = 0.97;       // 3% huisvoordeel, net als Mines
const MAX_CRASH = 50;          // Raket crasht uiterlijk op 50x
const MIN_CASHOUT = 1.01;
const MAX_CASHOUT = 25;
const GROWTH = 0.18;           // m(t) = e^(GROWTH * t) → 2x na ~3.9s, 10x na ~12.8s

// Uitslagkaart
const W = 520;
const FONT = 'DejaVu Sans, Arial, sans-serif';

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

// =====================================================
// UITSLAG KAART
// =====================================================

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatMult(m) {
  return `${m.toFixed(2)}x`;
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Render een scorebord-afbeelding met de uitslag van een ronde
 * @param {{crashPoint: number, players: Array<{username, bet, cashedAt, payout}>, history: number[]}} data
 * @returns {Promise<Buffer>} PNG
 */
async function renderResults({ crashPoint, players, history }) {
  const winners = players.filter(p => p.cashedAt).sort((a, b) => (b.payout - b.bet) - (a.payout - a.bet));
  const losers = players.filter(p => !p.cashedAt).sort((a, b) => b.bet - a.bet);
  const rows = [...winners, ...losers];

  const totalBet = players.reduce((sum, p) => sum + p.bet, 0);
  const totalPaid = players.reduce((sum, p) => sum + (p.payout || 0), 0);

  const PAD = 20;
  const HEADER_H = 96;
  const COLS_H = 26;
  const ROW_H = 30;
  const FOOTER_H = history.length > 0 ? 54 : 16;
  const height = HEADER_H + COLS_H + rows.length * ROW_H + FOOTER_H + PAD;
  const col = { name: PAD + 16, bet: 270, cashout: 360, result: W - PAD - 6 };

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}">`;
  svg += `<rect width="${W}" height="${height}" rx="14" fill="#12142b"/>`;

  // Kop: crashpunt links, totalen rechts
  svg += `<text x="${PAD}" y="30" font-family="${FONT}" font-size="12" fill="#8b90b8" letter-spacing="3">ROCKET · CRASHED</text>`;
  svg += `<text x="${PAD}" y="74" font-family="${FONT}" font-size="44" font-weight="bold" fill="#ed4245">${formatMult(crashPoint)}</text>`;

  const stats = [
    ['SPELERS', `${players.length}`, '#dcdfee'],
    ['INGEZET', `${totalBet}`, '#dcdfee'],
    ['UITBETAALD', `${totalPaid}`, totalPaid >= totalBet ? '#57f287' : '#ffb347']
  ];
  stats.forEach(([label, value, color], i) => {
    const x = W - PAD - (2 - i) * 92;
    svg += `<text x="${x}" y="46" font-family="${FONT}" font-size="10" fill="#8b90b8" text-anchor="end" letter-spacing="1">${label}</text>`;
    svg += `<text x="${x}" y="70" font-family="${FONT}" font-size="20" font-weight="bold" fill="${color}" text-anchor="end">${value}</text>`;
  });

  // Kolomkoppen
  const colsY = HEADER_H + 14;
  svg += `<line x1="${PAD}" y1="${HEADER_H - 4}" x2="${W - PAD}" y2="${HEADER_H - 4}" stroke="#ffffff" stroke-opacity="0.08"/>`;
  [['SPELER', col.name, 'start'], ['INZET', col.bet, 'end'], ['CASHOUT', col.cashout, 'middle'], ['RESULTAAT', col.result, 'end']]
    .forEach(([label, x, anchor]) => {
      svg += `<text x="${x}" y="${colsY}" font-family="${FONT}" font-size="10" fill="#8b90b8" text-anchor="${anchor}" letter-spacing="1">${label}</text>`;
    });

  // Rijen
  rows.forEach((p, i) => {
    const top = HEADER_H + COLS_H + i * ROW_H;
    const mid = top + ROW_H / 2;
    const won = Boolean(p.cashedAt);
    const accent = won ? '#57f287' : '#ed4245';
    const profit = won ? p.payout - p.bet : -p.bet;

    svg += `<rect x="${PAD}" y="${top + 2}" width="${W - PAD * 2}" height="${ROW_H - 4}" rx="6" fill="#ffffff" fill-opacity="${i % 2 === 0 ? 0.05 : 0.025}"/>`;
    svg += `<rect x="${PAD}" y="${top + 2}" width="4" height="${ROW_H - 4}" rx="2" fill="${accent}"/>`;
    svg += `<text x="${col.name}" y="${mid + 5}" font-family="${FONT}" font-size="14" font-weight="bold" fill="#eceef8">${escapeXml(truncate(p.username, 18))}</text>`;
    svg += `<text x="${col.bet}" y="${mid + 5}" font-family="${FONT}" font-size="13" fill="#b5b9d6" text-anchor="end">${p.bet}</text>`;

    const pill = won ? formatMult(p.cashedAt) : 'crash';
    svg += `<rect x="${col.cashout - 32}" y="${mid - 10}" width="64" height="20" rx="10" fill="${accent}" fill-opacity="0.18"/>`;
    svg += `<text x="${col.cashout}" y="${mid + 4}" font-family="${FONT}" font-size="12" font-weight="bold" fill="${accent}" text-anchor="middle">${pill}</text>`;

    svg += `<text x="${col.result}" y="${mid + 5}" font-family="${FONT}" font-size="15" font-weight="bold" fill="${accent}" text-anchor="end">${profit >= 0 ? '+' : ''}${profit}</text>`;
  });

  // Laatste crashes als gekleurde chips
  if (history.length > 0) {
    const y = height - PAD - 20;
    svg += `<text x="${PAD}" y="${y + 14}" font-family="${FONT}" font-size="10" fill="#8b90b8" letter-spacing="1">LAATSTE</text>`;
    history.slice(0, 8).forEach((m, i) => {
      const x = PAD + 66 + i * 54;
      const color = m >= 2 ? '#57f287' : '#ed4245';
      svg += `<rect x="${x}" y="${y}" width="48" height="20" rx="10" fill="${color}" fill-opacity="0.15"/>`;
      svg += `<text x="${x + 24}" y="${y + 14}" font-family="${FONT}" font-size="11" font-weight="bold" fill="${color}" text-anchor="middle">${m >= 10 ? m.toFixed(1) : m.toFixed(2)}x</text>`;
    });
  }

  svg += '</svg>';
  return sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
}

module.exports = {
  MIN_CASHOUT,
  MAX_CASHOUT,
  MAX_CRASH,
  HOUSE_EDGE,
  generateCrashPoint,
  parseCashout,
  GROWTH,
  calculatePayout,
  multiplierAt,
  timeForMultiplier,
  renderResults
};
