/**
 * Routegok: een multiplayer reisgok op een satellietkaart.
 * Eén gedeelde ronde voor iedereen op de website (live via api/casinoWeb.js, net als Roulette en Sterrenrad).
 *
 * Verloop van een ronde:
 *   1. loading  — iemand drukt op "Nieuwe route". De server zoekt een willekeurige route ergens op de wereld
 *                 (OpenStreetMap via OSRM van FOSSGIS) met de auto, de fiets of te voet.
 *   2. betting  — BETTING_MS lang (of korter als iedereen op "Klaar" heeft gedrukt) gokt iedereen hoeveel
 *                 minuten de route duurt, zet punten in en stemt op het land waar de route ligt.
 *                 De inzet gaat meteen van je saldo af en staat in open_stakes (teruggestort na een herstart).
 *   3. reveal   — het voertuig rijdt de route af terwijl de klok optelt tot de echte reistijd.
 *   4. result   — uitbetaling. Na RESULT_MS kan de volgende route gezocht worden.
 *
 * Uitbetaling (inclusief inzet) hangt af van hoe ver je ernaast zit (relatieve fout):
 *   exact op de minuut (en hooguit 3% ernaast) = JACKPOT ×25, daarna ×8, ×4, ×2,5, ×1,6, ×1,1, ×0,5 en daarna niets.
 *   Goed land gestemd: +0,5× je inzet extra.
 *
 * 1% van de routes gaat naar de maan (384.400 km, ongeveer), met de snelheid van het voertuig.
 *
 * De satelliettegels (Esri World Imagery) komen via de server (de CSP laat alleen 'self' toe) en worden gecachet.
 * Ingezoomde tegels mogen alleen rond de huidige/recente routes opgehaald worden, zodat de proxy niet als
 * gratis kaartenserver te misbruiken is en je tijdens het gokken niet ver weg kunt kijken.
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { getDatabase } = require('../database');
const casino = require('./casino');

const ROUTER_URL = 'https://routing.openstreetmap.de';
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
const USER_AGENT = 'RouteGuessGame/1.0 (OSM routing; small hobby game)';

const MIN_BET = 1;
const MAX_BET = 500;
const CHIPS = [10, 25, 50, 100, 250, 500];
const MAX_GUESS = 99999999;
const MAX_PLAYERS = 30;
const HISTORY_SIZE = 12;
const BETTING_MS = 45000;
const MIN_BETTING_MS = 15000;      // eerder sluiten (iedereen klaar) kan pas na zoveel ms
const READY_GRACE_MS = 1500;
const CLOSE_MARGIN_MS = 400;     // net voor het sluiten geen nieuwe gokken meer
const PREFETCH_MS = 3000;
const PEEK_USERNAMES = ['kimpiegamesyt']; // mogen tijdens het gokken het antwoord zien (typ 'stijn' op de pagina)        // zo lang mag de server tegels voorladen voor het gokken begint
const REVEAL_DELAY_MS = 600;
const REVEAL_MS = 15000;
const MOON_REVEAL_MS = 22000;
const RESULT_MS = 20000;
const JACKPOT_RESULT_MS = 38000;
const MOON_CHANCE = 0.01;
const FETCH_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 7;
const MIN_MINUTES = 8;
const MAX_MINUTES = 150;
const START_SPREAD_KM = 5;
const MAX_SNAP_M = 1500;
const MAX_ROUTE_POINTS = 900;

const JACKPOT_MULT = 25;
const JACKPOT_MAX_ERROR = 0.03;
const COUNTRY_BONUS = 0.5;
const TIERS = [
  { maxError: 0.03, mult: 8, key: 'strike', label: 'Voltreffer' },
  { maxError: 0.07, mult: 4, key: 'super', label: 'Super' },
  { maxError: 0.12, mult: 2.5, key: 'goed', label: 'Goed' },
  { maxError: 0.20, mult: 1.6, key: 'aardig', label: 'Aardig' },
  { maxError: 0.30, mult: 1.1, key: 'net', label: 'Net' },
  { maxError: 0.45, mult: 0.5, key: 'mwah', label: 'Mwah' }
];

const MODES = {
  car: { name: 'Auto', profile: 'routed-car', minKm: 5, maxKm: 35, moonKmh: 100 },
  bike: { name: 'Fiets', profile: 'routed-bike', minKm: 2, maxKm: 12, moonKmh: 18 },
  foot: { name: 'Lopen', profile: 'routed-foot', minKm: 0.7, maxKm: 3.5, moonKmh: 5 }
};

const COUNTRIES = {
  NL: 'Nederland', BE: 'België', DE: 'Duitsland', FR: 'Frankrijk', GB: 'Verenigd Koninkrijk', IE: 'Ierland',
  ES: 'Spanje', PT: 'Portugal', IT: 'Italië', CH: 'Zwitserland', AT: 'Oostenrijk', PL: 'Polen', CZ: 'Tsjechië',
  DK: 'Denemarken', SE: 'Zweden', NO: 'Noorwegen', FI: 'Finland', IS: 'IJsland', GR: 'Griekenland', HU: 'Hongarije',
  RO: 'Roemenië', TR: 'Turkije', RU: 'Rusland', US: 'Verenigde Staten', CA: 'Canada', MX: 'Mexico', BR: 'Brazilië',
  AR: 'Argentinië', CL: 'Chili', CO: 'Colombia', PE: 'Peru', ZA: 'Zuid-Afrika', NA: 'Namibië', EG: 'Egypte',
  MA: 'Marokko', KE: 'Kenia', NG: 'Nigeria', JP: 'Japan', KR: 'Zuid-Korea', CN: 'China', IN: 'India',
  TH: 'Thailand', VN: 'Vietnam', ID: 'Indonesië', PH: 'Filipijnen', MY: 'Maleisië', AU: 'Australië',
  NZ: 'Nieuw-Zeeland', AE: 'Verenigde Arabische Emiraten', SA: 'Saoedi-Arabië'
};

// Startpunten: [plaats, land, lat, lon]. Bewust niet te dicht bij een grens.
const SEEDS = [
  ['Amsterdam', 'NL', 52.37, 4.90], ['Utrecht', 'NL', 52.09, 5.12], ['Groningen', 'NL', 53.22, 6.57], ['Zwolle', 'NL', 52.51, 6.09], ['Rotterdam', 'NL', 51.92, 4.48],
  ['Brussel', 'BE', 50.85, 4.35], ['Leuven', 'BE', 50.88, 4.70], ['Namen', 'BE', 50.47, 4.87],
  ['Berlijn', 'DE', 52.52, 13.40], ['München', 'DE', 48.14, 11.58], ['Hamburg', 'DE', 53.55, 9.99], ['Keulen', 'DE', 50.94, 6.96], ['Leipzig', 'DE', 51.34, 12.37],
  ['Parijs', 'FR', 48.86, 2.35], ['Lyon', 'FR', 45.76, 4.84], ['Toulouse', 'FR', 43.60, 1.44], ['Bordeaux', 'FR', 44.84, -0.58], ['Nantes', 'FR', 47.22, -1.55], ['Avignon', 'FR', 43.95, 4.81],
  ['Londen', 'GB', 51.51, -0.13], ['Manchester', 'GB', 53.48, -2.24], ['Edinburgh', 'GB', 55.95, -3.19], ['Birmingham', 'GB', 52.49, -1.89], ['Inverness', 'GB', 57.48, -4.22],
  ['Dublin', 'IE', 53.35, -6.26], ['Cork', 'IE', 51.90, -8.47],
  ['Madrid', 'ES', 40.42, -3.70], ['Sevilla', 'ES', 37.39, -5.98], ['Valencia', 'ES', 39.47, -0.38], ['Zaragoza', 'ES', 41.65, -0.88],
  ['Lissabon', 'PT', 38.72, -9.14], ['Porto', 'PT', 41.15, -8.61],
  ['Rome', 'IT', 41.90, 12.50], ['Milaan', 'IT', 45.46, 9.19], ['Napels', 'IT', 40.85, 14.27], ['Florence', 'IT', 43.77, 11.26], ['Palermo', 'IT', 38.12, 13.36], ['Siena', 'IT', 43.32, 11.33],
  ['Bern', 'CH', 46.95, 7.45], ['Luzern', 'CH', 47.05, 8.31],
  ['Wenen', 'AT', 48.21, 16.37], ['Graz', 'AT', 47.07, 15.44],
  ['Warschau', 'PL', 52.23, 21.01], ['Krakau', 'PL', 50.06, 19.94], ['Poznań', 'PL', 52.41, 16.93],
  ['Praag', 'CZ', 50.08, 14.44], ['Brno', 'CZ', 49.20, 16.61],
  ['Odense', 'DK', 55.40, 10.39], ['Aarhus', 'DK', 56.16, 10.20],
  ['Stockholm', 'SE', 59.33, 18.07], ['Göteborg', 'SE', 57.71, 11.97],
  ['Oslo', 'NO', 59.91, 10.75], ['Bergen', 'NO', 60.39, 5.32], ['Tromsø', 'NO', 69.65, 18.96],
  ['Helsinki', 'FI', 60.17, 24.94], ['Tampere', 'FI', 61.50, 23.76],
  ['Reykjavik', 'IS', 64.15, -21.94], ['Akureyri', 'IS', 65.68, -18.09],
  ['Athene', 'GR', 37.98, 23.73], ['Thessaloniki', 'GR', 40.64, 22.94],
  ['Boedapest', 'HU', 47.50, 19.04],
  ['Boekarest', 'RO', 44.43, 26.10], ['Cluj-Napoca', 'RO', 46.77, 23.59],
  ['Istanbul', 'TR', 41.01, 28.98], ['Ankara', 'TR', 39.93, 32.86], ['Izmir', 'TR', 38.42, 27.14],
  ['Moskou', 'RU', 55.76, 37.62], ['Sint-Petersburg', 'RU', 59.94, 30.31],
  ['New York', 'US', 40.71, -74.01], ['Los Angeles', 'US', 34.05, -118.24], ['Chicago', 'US', 41.88, -87.63], ['Houston', 'US', 29.76, -95.37],
  ['Denver', 'US', 39.74, -104.99], ['Seattle', 'US', 47.61, -122.33], ['Miami', 'US', 25.76, -80.19], ['Phoenix', 'US', 33.45, -112.07],
  ['Atlanta', 'US', 33.75, -84.39], ['Moab', 'US', 38.57, -109.55],
  ['Toronto', 'CA', 43.65, -79.38], ['Montreal', 'CA', 45.50, -73.57], ['Calgary', 'CA', 51.05, -114.07], ['Banff', 'CA', 51.18, -115.57],
  ['Mexico-Stad', 'MX', 19.43, -99.13], ['Guadalajara', 'MX', 20.67, -103.35], ['Monterrey', 'MX', 25.69, -100.32],
  ['São Paulo', 'BR', -23.55, -46.63], ['Rio de Janeiro', 'BR', -22.91, -43.17], ['Brasília', 'BR', -15.79, -47.88], ['Belo Horizonte', 'BR', -19.92, -43.94],
  ['Buenos Aires', 'AR', -34.60, -58.38], ['Córdoba', 'AR', -31.42, -64.18], ['Mendoza', 'AR', -32.89, -68.84],
  ['Santiago', 'CL', -33.45, -70.67],
  ['Bogotá', 'CO', 4.71, -74.07], ['Medellín', 'CO', 6.24, -75.58],
  ['Lima', 'PE', -12.05, -77.04],
  ['Kaapstad', 'ZA', -33.92, 18.42], ['Johannesburg', 'ZA', -26.20, 28.05], ['Durban', 'ZA', -29.86, 31.02],
  ['Windhoek', 'NA', -22.56, 17.08],
  ['Caïro', 'EG', 30.04, 31.24],
  ['Marrakech', 'MA', 31.63, -8.01], ['Casablanca', 'MA', 33.57, -7.59],
  ['Nairobi', 'KE', -1.29, 36.82],
  ['Lagos', 'NG', 6.52, 3.38],
  ['Tokio', 'JP', 35.68, 139.69], ['Osaka', 'JP', 34.69, 135.50], ['Sapporo', 'JP', 43.06, 141.35], ['Fukuoka', 'JP', 33.59, 130.40], ['Kyoto', 'JP', 35.01, 135.77],
  ['Seoul', 'KR', 37.57, 126.98], ['Busan', 'KR', 35.18, 129.08],
  ['Peking', 'CN', 39.90, 116.40], ['Shanghai', 'CN', 31.23, 121.47], ['Chengdu', 'CN', 30.57, 104.07],
  ['Delhi', 'IN', 28.61, 77.21], ['Mumbai', 'IN', 19.08, 72.88], ['Bangalore', 'IN', 12.97, 77.59],
  ['Bangkok', 'TH', 13.76, 100.50], ['Chiang Mai', 'TH', 18.79, 98.98],
  ['Hanoi', 'VN', 21.03, 105.85], ['Ho Chi Minhstad', 'VN', 10.82, 106.63],
  ['Jakarta', 'ID', -6.21, 106.85], ['Denpasar', 'ID', -8.65, 115.22],
  ['Manilla', 'PH', 14.60, 120.98],
  ['Kuala Lumpur', 'MY', 3.14, 101.69],
  ['Sydney', 'AU', -33.87, 151.21], ['Melbourne', 'AU', -37.81, 144.96], ['Brisbane', 'AU', -27.47, 153.03], ['Perth', 'AU', -31.95, 115.86],
  ['Adelaide', 'AU', -34.93, 138.60], ['Hobart', 'AU', -42.88, 147.33],
  ['Auckland', 'NZ', -36.85, 174.76], ['Christchurch', 'NZ', -43.53, 172.64],
  ['Dubai', 'AE', 25.20, 55.27],
  ['Riyad', 'SA', 24.71, 46.68]
];

const events = new EventEmitter();
const history = [];
let round = null;
let roundSeq = 0;
const recentAreas = [];  // bbox's van de laatste routes (voor de tegelproxy)

const stakeRef = (r, userId) => `${r.id}:${userId}`;
const emitUpdate = () => events.emit('update');
const rand = () => crypto.randomInt(0, 1e9) / 1e9;

function getConfig() {
  return {
    minBet: MIN_BET, maxBet: MAX_BET, chips: CHIPS, maxGuess: MAX_GUESS, maxPlayers: MAX_PLAYERS,
    bettingMs: BETTING_MS, revealMs: REVEAL_MS, moonRevealMs: MOON_REVEAL_MS, resultMs: RESULT_MS,
    jackpotMult: JACKPOT_MULT, jackpotMaxError: JACKPOT_MAX_ERROR, countryBonus: COUNTRY_BONUS, tiers: TIERS,
    modes: Object.fromEntries(Object.entries(MODES).map(([key, m]) => [key, { name: m.name, moonKmh: m.moonKmh }])),
    countries: COUNTRIES
  };
}

function getStats(userId) {
  return getDatabase().prepare('SELECT games_played, total_bet, total_payout, biggest_win, best_error, jackpots, countries_right FROM routegok_stats WHERE user_id = ?').get(userId) || null;
}

/** Je eigen (geheime) gok in de lopende ronde, zodat hij na herladen terugkomt */
function getMyEntry(userId) {
  const r = round;
  if (!r || r.phase !== 'betting') return null;
  const p = r.players.get(userId);
  return p ? { roundId: r.id, guess: p.guess, amount: p.amount, country: p.country, ready: p.ready } : null;
}

// =====================================================
// UITBETALING
// =====================================================
function scoreGuess(guess, minutes) {
  const error = Math.abs(guess - minutes) / Math.max(minutes, 0.01);
  if (Math.round(minutes) === guess && error <= JACKPOT_MAX_ERROR) return { error, mult: JACKPOT_MULT, tier: 'jackpot', label: 'JACKPOT' };
  for (const t of TIERS) if (error <= t.maxError) return { error, mult: t.mult, tier: t.key, label: t.label };
  return { error, mult: 0, tier: 'mis', label: 'Mis' };
}

// =====================================================
// PUBLIEKE STATUS
// =====================================================
function getPublicState() {
  const r = round;
  if (!r) return { serverNow: Date.now(), history, round: null };
  const secret = r.phase === 'loading' || r.phase === 'betting';
  const votes = {};
  for (const p of r.players.values()) if (p.country) votes[p.country] = (votes[p.country] || 0) + 1;
  const route = r.route;
  return {
    serverNow: Date.now(),
    history,
    round: {
      id: r.id,
      phase: r.phase,
      message: r.message || null,
      mode: r.mode,
      moon: route ? route.moon : false,
      start: route ? route.start : null,
      end: route && !route.moon ? route.end : null,
      geometry: route ? route.geometry : null,
      bbox: route ? route.bbox : null,
      openedAt: r.openedAt,
      bettingEndsAt: r.bettingEndsAt,
      closeAt: r.closeAt,
      revealStartAt: r.revealStartAt,
      revealEndAt: r.revealEndAt,
      nextAt: r.nextAt,
      votes,
      players: [...r.players.values()].map(p => ({
        userId: p.userId,
        username: p.username,
        avatar: p.avatar,
        amount: p.amount,
        ready: p.ready,
        guess: secret ? null : p.guess,
        country: secret ? null : p.country,
        payout: p.payout,
        mult: p.mult,
        tier: p.tier,
        error: p.error,
        countryRight: p.countryRight,
        rank: p.rank,
        balance: casino.getUserBalance(p.userId)
      })),
      result: secret || !route ? null : {
        minutes: route.minutes,
        distanceKm: route.distanceKm,
        times: route.times,
        country: route.country,
        countryName: COUNTRIES[route.country],
        place: route.place
      },
      outcome: r.outcome || null
    }
  };
}

// =====================================================
// ROUTE ZOEKEN (OpenStreetMap / OSRM)
// =====================================================
async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function offsetPoint(lat, lon, km, bearing) {
  const dLat = (km / 111.32) * Math.cos(bearing);
  const dLon = (km / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.sin(bearing);
  return { lat: lat + dLat, lon: lon + dLon };
}

function haversineKm(a, b) {
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Ramer-Douglas-Peucker op (ongeveer) meters; geeft de indexen die blijven
function rdp(points, epsilon) {
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let maxDist = 0, index = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (points[i][0] - ax) - dx * (points[i][1] - ay)) / len;
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (index !== -1 && maxDist > epsilon) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  const result = [];
  keep.forEach((k, i) => { if (k) result.push(i); });
  return result;
}

function simplifyRoute(coords, cumulative) {
  const lat0 = coords[0][1] * Math.PI / 180;
  const points = coords.map(([lon, lat]) => [lon * 111320 * Math.cos(lat0), lat * 110540]);
  let epsilon = 1.5, indexes;
  do {
    indexes = rdp(points, epsilon);
    epsilon *= 1.6;
  } while (indexes.length > MAX_ROUTE_POINTS);
  return {
    geometry: indexes.map(i => [Math.round(coords[i][0] * 1e5) / 1e5, Math.round(coords[i][1] * 1e5) / 1e5]),
    times: indexes.map(i => Math.round(cumulative[i] * 10) / 10)
  };
}

function bboxOf(geometry) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of geometry) {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  return [minLon, minLat, maxLon, maxLat];
}

function randomStart() {
  const [place, country, lat, lon] = SEEDS[crypto.randomInt(0, SEEDS.length)];
  const start = offsetPoint(lat, lon, Math.sqrt(rand()) * START_SPREAD_KM, rand() * Math.PI * 2);
  return { place, country, start };
}

function moonRoute(modeKey) {
  const { place, country, start } = randomStart();
  // De afstand tot de maan schommelt tussen perigeum en apogeum
  const distanceKm = 356500 + rand() * (406700 - 356500);
  const minutes = distanceKm / MODES[modeKey].moonKmh * 60;
  const s = { lat: Math.round(start.lat * 1e5) / 1e5, lon: Math.round(start.lon * 1e5) / 1e5 };
  const geometry = [[s.lon, s.lat]];
  return {
    moon: true, place, country, start: s, end: null, geometry, times: [0, minutes * 60],
    minutes, distanceKm: Math.round(distanceKm), bbox: [s.lon - 0.02, s.lat - 0.015, s.lon + 0.02, s.lat + 0.015]
  };
}

async function findRoute(modeKey) {
  const mode = MODES[modeKey];
  let lastError = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { place, country, start } = randomStart();
    const end = offsetPoint(start.lat, start.lon, mode.minKm + rand() * (mode.maxKm - mode.minKm), rand() * Math.PI * 2);
    const url = `${ROUTER_URL}/${mode.profile}/route/v1/driving/${start.lon.toFixed(5)},${start.lat.toFixed(5)};${end.lon.toFixed(5)},${end.lat.toFixed(5)}` +
      '?overview=full&geometries=geojson&annotations=duration&alternatives=false&steps=false';
    try {
      const data = await fetchJson(url);
      if (data.code !== 'Ok' || !data.routes || !data.routes.length) continue;
      const route = data.routes[0];
      if ((data.waypoints || []).some(w => w.distance > MAX_SNAP_M)) continue;
      const minutes = route.duration / 60;
      if (minutes < MIN_MINUTES || minutes > MAX_MINUTES) continue;
      const coords = route.geometry.coordinates;
      if (!coords || coords.length < 2) continue;
      const a = { lon: coords[0][0], lat: coords[0][1] };
      const b = { lon: coords[coords.length - 1][0], lat: coords[coords.length - 1][1] };
      // Rare omwegen (veerboten, bergpassen om een meer heen) overslaan
      if (route.distance / 1000 > haversineKm(a, b) * 3.5 + 2) continue;

      // Opgetelde reistijd per punt, zodat het voertuig in de stad langzamer gaat dan op de snelweg
      const durations = route.legs && route.legs[0] && route.legs[0].annotation && route.legs[0].annotation.duration;
      const cumulative = [0];
      if (Array.isArray(durations) && durations.length === coords.length - 1) {
        for (let i = 0; i < durations.length; i++) cumulative.push(cumulative[i] + Math.max(0, durations[i]));
      } else {
        for (let i = 1; i < coords.length; i++) {
          cumulative.push(cumulative[i - 1] + haversineKm({ lon: coords[i - 1][0], lat: coords[i - 1][1] }, { lon: coords[i][0], lat: coords[i][1] }));
        }
      }
      const total = cumulative[cumulative.length - 1] || 1;
      for (let i = 0; i < cumulative.length; i++) cumulative[i] = cumulative[i] / total * route.duration;

      const { geometry, times } = simplifyRoute(coords, cumulative);
      return {
        moon: false, place, country,
        start: { lon: geometry[0][0], lat: geometry[0][1] },
        end: { lon: geometry[geometry.length - 1][0], lat: geometry[geometry.length - 1][1] },
        geometry, times, minutes,
        distanceKm: Math.round(route.distance / 100) / 10,
        bbox: bboxOf(geometry)
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Geen bruikbare route gevonden');
}

function rememberArea(bbox) {
  recentAreas.unshift(bbox);
  if (recentAreas.length > 6) recentAreas.pop();
}

// =====================================================
// RONDE
// =====================================================
function isBusy() {
  if (!round) return false;
  if (round.phase === 'loading' || round.phase === 'betting' || round.phase === 'reveal') return true;
  return round.phase === 'result' && Date.now() < round.nextAt;
}

/**
 * Nieuwe route zoeken. Iedereen die ingelogd is mag dit doen als er geen ronde loopt.
 */
function startRound(user) {
  if (isBusy()) {
    const phase = round.phase;
    return { ok: false, code: 'busy', message: phase === 'loading' ? 'Er wordt al een route gezocht.' : 'Er loopt al een ronde.' };
  }
  const modeKeys = Object.keys(MODES);
  const mode = modeKeys[crypto.randomInt(0, modeKeys.length)];
  const r = {
    id: `${Date.now().toString(36)}${(++roundSeq).toString(36)}`,
    phase: 'loading',
    mode,
    startedBy: user.username,
    players: new Map(),
    route: null,
    openedAt: null, bettingEndsAt: null, closeAt: null,
    revealStartAt: null, revealEndAt: null, nextAt: null,
    outcome: null, message: null
  };
  round = r;
  emitUpdate();

  const moon = rand() < MOON_CHANCE;
  const job = moon ? Promise.resolve(moonRoute(mode)) : findRoute(mode);
  job.then(async route => {
    if (round !== r) return;
    rememberArea(route.bbox);
    // Satellietbeeld rond de route alvast in de cache, zodat iedereen meteen beeld heeft
    await Promise.race([prefetchTiles(route), new Promise(res => setTimeout(res, PREFETCH_MS))]);
    if (round !== r) return;
    r.route = route;
    r.phase = 'betting';
    r.openedAt = Date.now();
    r.bettingEndsAt = r.openedAt + BETTING_MS;
    r.closeTimer = setTimeout(() => safeClose(r), BETTING_MS);
    emitUpdate();
  }).catch(error => {
    console.error('[ROUTEGOK] Geen route gevonden:', error.message);
    if (round !== r) return;
    r.phase = 'cancelled';
    r.message = 'Geen route gevonden (de routeserver reageert niet). Probeer het nog eens.';
    r.nextAt = Date.now();
    emitUpdate();
  });
  return { ok: true, message: '' };
}

function refundRound(r) {
  for (const p of r.players.values()) {
    if (p.amount > 0) casino.addBalance(p.userId, p.username, p.amount, 'Routegok: terugbetaling na fout');
    casino.releaseStake('routegok', stakeRef(r, p.userId));
  }
  r.phase = 'cancelled';
  r.message = 'Er ging iets mis, alle inzetten zijn teruggestort.';
  r.nextAt = Date.now();
  emitUpdate();
}

/**
 * Gok plaatsen of aanpassen (minuten + inzet + land). De oude inzet wordt teruggestort, de nieuwe afgeschreven.
 * @param {{id: string, username: string, avatar: string|null}} user
 */
function placeGuess(user, input) {
  const r = round;
  // Tot vlak voor het sluiten mag je nog instappen (ook als iedereen al op Klaar heeft gedrukt)
  if (!r || r.phase !== 'betting' || Date.now() >= (r.closeAt || r.bettingEndsAt) - CLOSE_MARGIN_MS) {
    return { ok: false, code: 'closed', message: 'Er kan nu niet gegokt worden.' };
  }
  const guess = Number(input && input.minutes);
  const amount = Number(input && input.amount);
  const country = input && input.country ? String(input.country) : null;
  if (!Number.isInteger(guess) || guess < 0 || guess > MAX_GUESS) return { ok: false, message: 'Vul een geldig aantal minuten in (hele minuten).' };
  if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) return { ok: false, message: `Je inzet moet tussen ${MIN_BET} en ${MAX_BET} punten liggen.` };
  if (country && !Object.prototype.hasOwnProperty.call(COUNTRIES, country)) return { ok: false, message: 'Onbekend land.' };

  const existing = r.players.get(user.id);
  if (existing && existing.ready) return { ok: false, message: 'Je hebt je gok al vastgezet.' };
  if (!existing && r.players.size >= MAX_PLAYERS) return { ok: false, message: `Vol: er spelen al ${MAX_PLAYERS} spelers mee.` };

  casino.getOrCreateUser(user.id, user.username);
  const result = getDatabase().transaction(() => {
    const previous = existing ? existing.amount : 0;
    const available = casino.getUserBalance(user.id) + previous;
    if (available < amount) return { ok: false, message: `Niet genoeg punten: je wilt ${amount} inzetten, maar je hebt er maar ${available}.` };
    if (previous) casino.addBalance(user.id, user.username, previous, 'Routegok inzet aangepast');
    casino.subtractBalance(user.id, amount);
    casino.setStake('routegok', stakeRef(r, user.id), user.id, user.username, amount);
    return { ok: true };
  })();
  if (!result.ok) return result;

  r.players.set(user.id, {
    userId: user.id, username: user.username, avatar: user.avatar || null,
    guess, amount, country, ready: false,
    payout: null, mult: null, tier: null, error: null, countryRight: null, rank: null
  });
  // Er is weer iemand niet klaar: dan niet meer vroeg sluiten
  if (r.closeAt) {
    r.closeAt = null;
    clearTimeout(r.closeTimer);
    r.closeTimer = setTimeout(() => safeClose(r), Math.max(0, r.bettingEndsAt - Date.now()));
  }
  emitUpdate();
  return { ok: true, message: '', roundId: r.id, guess, amount, country };
}

/** Geheime spiekfunctie voor de eigenaar: het antwoord tijdens het gokken */
function peek(user) {
  if (!PEEK_USERNAMES.includes(String(user.username || '').toLowerCase())) return { ok: false, message: 'Onbekende actie.' };
  const r = round;
  if (!r || r.phase !== 'betting' || !r.route) return { ok: false, message: 'Er is nu geen route om te spieken.' };
  return { ok: true, message: '', minutes: r.route.minutes, country: r.route.country, countryName: COUNTRIES[r.route.country], place: r.route.place, moon: r.route.moon };
}

/** Gok vastzetten. Staat iedereen klaar, dan sluit de ronde vroeger. */
function setReady(user) {
  const r = round;
  if (!r || r.phase !== 'betting' || Date.now() >= (r.closeAt || r.bettingEndsAt)) return { ok: false, code: 'closed', message: 'Er kan nu niet gegokt worden.' };
  const p = r.players.get(user.id);
  if (!p) return { ok: false, message: 'Plaats eerst een gok.' };
  p.ready = true;
  const allReady = [...r.players.values()].every(x => x.ready);
  if (allReady && !r.closeAt) {
    const closeAt = Math.max(Date.now() + READY_GRACE_MS, r.openedAt + MIN_BETTING_MS);
    if (closeAt < r.bettingEndsAt) {
      r.closeAt = closeAt;
      clearTimeout(r.closeTimer);
      r.closeTimer = setTimeout(() => safeClose(r), closeAt - Date.now());
    }
  }
  emitUpdate();
  return { ok: true, message: '', ready: true };
}

function safeClose(r) {
  try {
    closeBets(r);
  } catch (error) {
    console.error('[ROUTEGOK] Fout bij sluiten, inzetten worden teruggestort:', error);
    refundRound(r);
  }
}

function closeBets(r) {
  if (round !== r || r.phase !== 'betting') return;
  clearTimeout(r.closeTimer);
  if (!r.players.size) {
    r.phase = 'cancelled';
    r.message = 'Niemand heeft gegokt.';
    r.nextAt = Date.now();
    emitUpdate();
    return;
  }
  r.phase = 'reveal';
  r.revealStartAt = Date.now() + REVEAL_DELAY_MS;
  r.revealEndAt = r.revealStartAt + (r.route.moon ? MOON_REVEAL_MS : REVEAL_MS);
  emitUpdate();
  setTimeout(() => {
    try {
      settle(r);
    } catch (error) {
      console.error('[ROUTEGOK] Fout bij uitbetalen, inzetten worden teruggestort:', error);
      refundRound(r);
    }
  }, r.revealEndAt - Date.now());
}

function settle(r) {
  if (r.phase !== 'reveal') return;
  const route = r.route;
  const db = getDatabase();
  const insertStats = db.prepare(`
    INSERT INTO routegok_stats (user_id, username, games_played, total_bet, total_payout, biggest_win, best_error, jackpots, countries_right, last_played)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      games_played = games_played + 1,
      total_bet = total_bet + excluded.total_bet,
      total_payout = total_payout + excluded.total_payout,
      biggest_win = MAX(biggest_win, excluded.biggest_win),
      best_error = CASE WHEN best_error IS NULL THEN excluded.best_error ELSE MIN(best_error, excluded.best_error) END,
      jackpots = jackpots + excluded.jackpots,
      countries_right = countries_right + excluded.countries_right,
      last_played = excluded.last_played
  `);

  const players = [...r.players.values()];
  db.transaction(() => {
    for (const p of players) {
      const score = scoreGuess(p.guess, route.minutes);
      p.error = Math.round(score.error * 10000) / 10000;
      p.mult = score.mult;
      p.tier = score.tier;
      p.countryRight = p.country === route.country;
      p.payout = Math.floor(p.amount * score.mult + (p.countryRight ? p.amount * COUNTRY_BONUS : 0));
      if (p.payout > 0) casino.addBalance(p.userId, p.username, p.payout, `Routegok ${score.label}`);
      casino.releaseStake('routegok', stakeRef(r, p.userId));
      insertStats.run(p.userId, p.username, p.amount, p.payout, Math.max(0, p.payout - p.amount), score.error,
        score.tier === 'jackpot' ? 1 : 0, p.countryRight ? 1 : 0);
    }
  })();

  players.sort((a, b) => a.error - b.error);
  players.forEach((p, i) => { p.rank = i + 1; });
  const jackpotIds = players.filter(p => p.tier === 'jackpot').map(p => p.userId);
  r.outcome = {
    winnerId: players[0].userId,
    loserId: players.length > 1 ? players[players.length - 1].userId : null,
    jackpot: jackpotIds.length > 0,
    jackpotIds
  };
  history.unshift({ mode: r.mode, minutes: Math.round(route.minutes), moon: route.moon, country: route.country, place: route.place, jackpot: r.outcome.jackpot });
  if (history.length > HISTORY_SIZE) history.pop();
  r.phase = 'result';
  r.nextAt = Date.now() + (r.outcome.jackpot ? JACKPOT_RESULT_MS : RESULT_MS);
  emitUpdate();
}

// =====================================================
// SATELLIETTEGELS (proxy + cache)
// =====================================================
const TILE_CACHE_MAX = 3000;
const FREE_ZOOM = 3;       // wereld en continenten mogen altijd
const WIDE_ZOOM = 7;       // tot dit niveau mag het pas na het gokken, ruim rond de route (uitzoomen bij de jackpot/maan)
const MAX_TILE_ZOOM = 18;
const tileCache = new Map();
const tileInflight = new Map();

function tileBounds(z, x, y) {
  const n = 2 ** z;
  const lon = v => v / n * 360 - 180;
  const lat = v => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}

const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
function grow(bbox, factor, minDeg) {
  const w = Math.max((bbox[2] - bbox[0]) * factor, minDeg);
  const h = Math.max((bbox[3] - bbox[1]) * factor, minDeg);
  return [bbox[0] - w, bbox[1] - h, bbox[2] + w, bbox[3] + h];
}

function isTileAllowed(z, x, y) {
  if (!Number.isInteger(z) || z < 0 || z > MAX_TILE_ZOOM) return false;
  const n = 2 ** z;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) return false;
  if (z <= FREE_ZOOM) return true;
  const tile = tileBounds(z, x, y);
  const secret = round && (round.phase === 'loading' || round.phase === 'betting');
  return recentAreas.some((bbox, i) => {
    // Tijdens het gokken mag je alleen rond de huidige route kijken
    if (secret && i > 0) return false;
    if (z <= WIDE_ZOOM) return !secret && overlaps(tile, grow(bbox, 0, 40));
    return overlaps(tile, grow(bbox, 2, 0.15));
  });
}

function lonToTile(lon, n) { return Math.floor((lon + 180) / 360 * n); }
function latToTile(lat, n) { const l = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2 * n); }

/** Tegels van het startbeeld (ongeveer de zoom waarop de website de route laat zien, ±1) */
function prefetchTiles(route) {
  const [a, b, c, d] = grow(route.bbox, 0.25, 0.004);
  const fit = route.moon ? 15 : Math.floor(Math.log2(Math.min(900 / ((c - a) / 360 * 256), 650 / ((d - b) / 360 * 256 * 1.4))));
  const jobs = [];
  for (const z of [fit - 1, fit, fit + 1]) {
    if (z < 0 || z > MAX_TILE_ZOOM) continue;
    const n = 2 ** z;
    for (let x = lonToTile(a, n); x <= lonToTile(c, n); x++) {
      for (let y = latToTile(d, n); y <= latToTile(b, n); y++) {
        if (jobs.length < 90 && isTileAllowed(z, x, y)) jobs.push([z, x, y]);
      }
    }
  }
  // Met een paar tegelijk, om Esri niet te overspoelen
  let next = 0;
  const worker = async () => { while (next < jobs.length) { const [z, x, y] = jobs[next++]; await getTile(z, x, y); } };
  return Promise.all(Array.from({ length: 8 }, worker));
}

/** @returns {Promise<Buffer|null>} */
async function getTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) {
    const hit = tileCache.get(key);
    tileCache.delete(key);
    tileCache.set(key, hit);
    return hit;
  }
  if (tileInflight.has(key)) return tileInflight.get(key);
  const job = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${TILE_URL}/${z}/${y}/${x}`, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
      if (!res.ok) return null;
      const body = Buffer.from(await res.arrayBuffer());
      tileCache.set(key, body);
      if (tileCache.size > TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value);
      return body;
    } catch (error) {
      return null;
    } finally {
      clearTimeout(timer);
      tileInflight.delete(key);
    }
  })();
  tileInflight.set(key, job);
  return job;
}

module.exports = {
  MODES,
  COUNTRIES,
  events,
  getConfig,
  getStats,
  getMyEntry,
  getPublicState,
  startRound,
  placeGuess,
  setReady,
  peek,
  isTileAllowed,
  getTile,
  scoreGuess
};
