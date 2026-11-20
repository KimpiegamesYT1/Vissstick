/**
 * Casino website (Rocket + Dagelijkse spin + Blackjack tafel + Roulette + Sterrenrad + Routegok)
 *   GET  /                          doorsturen naar /rocket
 *   GET  /rocket                    Rocket pagina
 *   GET  /spin, /daily              Dagelijkse spin pagina
 *   GET  /blackjack                 Blackjack tafel (3D)
 *   GET  /plinko                    Plinko
 *   GET  /slots                     Slots (fruitautomaat)
 *   GET  /roulette                  Roulette (Europees)
 *   GET  /sterrenrad                Sterrenrad (gameshow-rad in de ruimte, multiplayer)
 *   GET  /afwas                     Afwassen (alleen onder 50 punten)
 *   GET  /fuik                      Fuiken (elke 15 minuten ophalen voor een paar punten)
 *   GET  /stats                     Statistieken en leaderboard van alle spelers
 *   GET  /connection.js             verbindingspopup voor alle casino-pagina's
 *   GET  /vendor/three/*.js         three.js (uit node_modules)
 *   GET  /cards/<naam>.png          kaartafbeeldingen
 *   GET  /audio/<naam>.mp3          achtergrondmuziek (web/audio)
 *   GET  /login?code=...&next=...   eenmalige code uit Discord inwisselen voor een sessie-cookie
 *   GET  /rocket/login?code=...     (oude links uit /rocket)
 *   GET  /api/me                    ingelogde speler + saldo
 *   GET  /api/online                wie er nu actief op de casino-site is (telt jezelf ook als actief)
 *   GET  /api/rocket/state          spelstatus
 *   GET  /api/rocket/stream         Server-Sent Events met live spelstatus
 *   POST /api/rocket/{start,join,leave,cashout}
 *   GET  /api/spin/status           rad + spins van vandaag
 *   POST /api/spin/spin             draai aan het rad
 *   POST /api/spin/reminder         ochtendmelding aan/uit
 *   GET  /api/blackjack/stream      Server-Sent Events met de tafelstatus
 *   POST /api/blackjack/{sit,leave,bet,act,insurance}
 *   GET  /api/plinko/status         instellingen, tabellen en eigen stats
 *   POST /api/plinko/drop           laat een bal vallen
 *   GET  /api/slots/status          instellingen, niveaus en eigen voortgang
 *   POST /api/slots/spin            één spin
 *   GET  /api/roulette/status       instellingen, saldo en eigen stats
 *   GET  /api/roulette/stream       Server-Sent Events met de gedeelde roulettetafel
 *   POST /api/roulette/bet          eigen fiches voor deze ronde vervangen (eerste fiche opent een ronde)
 *   GET  /api/sterrenrad/status     instellingen, saldo en eigen stats
 *   GET  /api/sterrenrad/stream     Server-Sent Events met de gedeelde show
 *   GET  /api/sterrenrad/time       servertijd, voor de klokmeting van de browser
 *   POST /api/sterrenrad/bet        eigen fiches voor deze ronde vervangen (eerste fiche opent een ronde)
 *   POST /api/sterrenrad/choose     keuze in een bonus (doel in de Sterrenjacht, wijzer in het Wormgat)
 *   GET  /routegok                  Routegok (raad de reistijd van een willekeurige route, multiplayer)
 *   GET  /api/routegok/status       instellingen, saldo, eigen stats en eigen (geheime) gok
 *   GET  /api/routegok/stream       Server-Sent Events met de gedeelde ronde
 *   GET  /api/routegok/tile/z/x/y.jpg  satelliettegel (proxy + cache, alleen rond de routes)
 *   POST /api/routegok/{start,guess}  nieuwe route zoeken / gok plaatsen
 *   GET  /api/afwas/status          instellingen, saldo en eigen stats
 *   GET  /api/stats                 leaderboard + stats per speler (iedereen, 'me' gemarkeerd als ingelogd)
 *   POST /api/afwas/{plate,clean,reject}  nieuw bord / bord schoon (+1) / bord afgekeurd
 *   GET  /api/fuik/status           instellingen, eigen fuiken, stats en vangstboek
 *   POST /api/fuik/{tap,all}        één fuik aantikken (uitzetten/ophalen) / alles ophalen
 *   GET  /keys                      Keys: kisten openen en aan het rad draaien
 *   GET  /api/keys/status           kisten, eigen keys, stats en laatste openingen
 *   POST /api/keys/open             een kist openen met een key (de server bepaalt de uitslag)
 *   GET  /api/chat                  laatste chatberichten (chat zit rechtsonder op elke pagina, live via /api/live)
 *   POST /api/chat/send             chatbericht plaatsen (met automatische moderatie)
 *   POST /api/logout
 */

const fs = require('fs');
const path = require('path');
const rocketGame = require('../modules/rocketGame');
const dailySpin = require('../modules/dailySpin');
const blackjackTable = require('../modules/blackjackTable');
const plinko = require('../modules/plinko');
const slots = require('../modules/slots');
const roulette = require('../modules/roulette');
const sterrenrad = require('../modules/sterrenrad');
const routegok = require('../modules/routegok');
const afwas = require('../modules/afwas');
const fuik = require('../modules/fuik');
const crates = require('../modules/crates');
const rocketAuth = require('../modules/rocketAuth');
const casino = require('../modules/casino');
const stats = require('../modules/stats');
const chat = require('../modules/chat');
const { createRateLimiter, getClientIp } = require('./security');

const WEB_DIR = path.join(__dirname, '..', 'web');
const COOKIE_NAME = 'rk_session';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const MAX_STREAM_CLIENTS = 300;
const HEARTBEAT_MS = 15000;
const MAX_BODY_BYTES = 1024;
const MAX_ROULETTE_BODY_BYTES = 8192; // een volle roulettetafel past niet in 1 kB
const ONLINE_WINDOW_MS = 45000; // zo lang na de laatste ping telt iemand als online
const MAX_ONLINE_SHOWN = 50;
// Spellen die in de online-lijst getoond worden (pad zonder '/' → naam)
const ONLINE_GAMES = {
  rocket: 'Rocket',
  blackjack: 'Blackjack',
  plinko: 'Plinko',
  slots: 'Slots',
  roulette: 'Roulette',
  sterrenrad: 'Sterrenrad',
  routegok: 'Routegok',
  spin: 'Daily spin',
  afwas: 'Afwassen',
  fuik: 'Fuiken',
  keys: 'Keys',
  stats: 'Stats'
};
const LOGIN_TARGETS = ['/rocket', '/spin', '/blackjack', '/plinko', '/slots', '/roulette', '/sterrenrad', '/routegok', '/afwas', '/fuik', '/keys', '/stats'];
const VENDOR_FILES = {
  'three.module.js': path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.module.js'),
  'three.core.js': path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.core.js')
};
const CARDS_DIR = path.join(__dirname, '..', 'audio', 'Cards');
const CSP = "default-src 'self'; img-src 'self' data: https://cdn.discordapp.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'";

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function isHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted);
}

function sessionCookie(req, value, maxAge) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}

function setBaseHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res, status, payload) {
  setBaseHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sendStatic(res, body, contentType) {
  setBaseHeaders(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(body);
}

function sendPage(res, page) {
  setBaseHeaders(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Security-Policy', CSP);
  res.end(page);
}

function redirect(res, location, cookie) {
  setBaseHeaders(res);
  res.statusCode = 302;
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function createCasinoWebHandler() {
  const pages = {
    rocket: fs.readFileSync(path.join(WEB_DIR, 'rocket.html')),
    spin: fs.readFileSync(path.join(WEB_DIR, 'spin.html')),
    blackjack: fs.readFileSync(path.join(WEB_DIR, 'blackjack.html')),
    plinko: fs.readFileSync(path.join(WEB_DIR, 'plinko.html')),
    slots: fs.readFileSync(path.join(WEB_DIR, 'slots.html')),
    roulette: fs.readFileSync(path.join(WEB_DIR, 'roulette.html')),
    sterrenrad: fs.readFileSync(path.join(WEB_DIR, 'sterrenrad.html')),
    routegok: fs.readFileSync(path.join(WEB_DIR, 'routegok.html')),
    afwas: fs.readFileSync(path.join(WEB_DIR, 'afwas.html')),
    fuik: fs.readFileSync(path.join(WEB_DIR, 'fuik.html')),
    keys: fs.readFileSync(path.join(WEB_DIR, 'keys.html')),
    stats: fs.readFileSync(path.join(WEB_DIR, 'stats.html'))
  };
  const staticCache = new Map();
  const actionLimiter = createRateLimiter({ windowMs: 10000, maxRequests: 40 });
  // Plinko: veel snelle ballen achter elkaar (auto-modus), daarom een eigen, ruimere limiet
  const plinkoLimiter = createRateLimiter({ windowMs: 10000, maxRequests: 100 });
  // Roulette: elke wijziging op de tafel wordt (gebundeld) naar de server gestuurd
  const rouletteLimiter = createRateLimiter({ windowMs: 10000, maxRequests: 80 });
  // Routegok: een kaart laadt veel tegels tegelijk (per IP, want kijken mag ook zonder inloggen)
  const tileLimiter = createRateLimiter({ windowMs: 10000, maxRequests: 600 });

  // Live streams per spel
  const streams = {
    rocket: { clients: new Set(), getState: rocketGame.getPublicState },
    blackjack: { clients: new Set(), getState: blackjackTable.getPublicState },
    roulette: { clients: new Set(), getState: roulette.getPublicState },
    sterrenrad: { clients: new Set(), getState: sterrenrad.getPublicState },
    routegok: { clients: new Set(), getState: routegok.getPublicState }
  };

  // Lichte stream voor elke pagina: meldt een herstart en laat een nieuwe opstart herkennen (bootId)
  const BOOT_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const liveClients = new Set();

  function handleLive(req, res) {
    setBaseHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 1000\n');
    res.write(`data: ${JSON.stringify({ boot: BOOT_ID })}\n\n`);
    liveClients.add(res);
    req.on('close', () => liveClients.delete(res));
  }

  function broadcast(stream) {
    const message = `data: ${JSON.stringify(stream.getState())}\n\n`;
    for (const res of stream.clients) res.write(message);
  }

  chat.events.on('message', message => {
    const text = `event: chat\ndata: ${JSON.stringify(message)}\n\n`;
    for (const res of liveClients) res.write(text);
  });
  rocketGame.events.on('update', () => broadcast(streams.rocket));
  blackjackTable.events.on('update', () => broadcast(streams.blackjack));
  roulette.events.on('update', () => broadcast(streams.roulette));
  sterrenrad.events.on('update', () => broadcast(streams.sterrenrad));
  routegok.events.on('update', () => broadcast(streams.routegok));

  // Houdt verbindingen (en de Cloudflare tunnel) open en geeft de browser een verse server tijd
  setInterval(() => {
    const message = `event: time\ndata: ${JSON.stringify({ serverNow: Date.now() })}\n\n`;
    for (const stream of Object.values(streams)) {
      for (const res of stream.clients) res.write(message);
    }
    for (const res of liveClients) res.write(message);
  }, HEARTBEAT_MS).unref();

  // Wie er online is: alleen ingelogde spelers met een zichtbaar tabblad (connection.js pingt elke 15 s)
  const online = new Map();

  function markOnline(user, page, idle) {
    const game = String(page || '').replace(/^\/+|\/+$/g, '').split('/')[0];
    online.set(user.id, {
      username: user.username,
      avatar: user.avatar,
      game: Object.prototype.hasOwnProperty.call(ONLINE_GAMES, game) ? game : null,
      idle: Boolean(idle),
      lastSeen: Date.now()
    });
  }

  function getOnline() {
    const cutoff = Date.now() - ONLINE_WINDOW_MS;
    const users = [];
    for (const [id, entry] of online) {
      if (entry.lastSeen < cutoff) online.delete(id);
      else users.push({ id, ...entry });
    }
    // Actieve spelers eerst; wie 10+ min niets doet staat als idle onderaan en telt niet mee
    users.sort((a, b) => (a.idle - b.idle) || (b.lastSeen - a.lastSeen));
    return {
      count: users.filter(u => !u.idle).length,
      users: users.slice(0, MAX_ONLINE_SHOWN).map(({ id, username, avatar, game, idle }) => ({
        username,
        avatar,
        idle,
        balance: casino.getUserBalance(id),
        game: game ? { name: ONLINE_GAMES[game], path: `/${game}` } : null
      }))
    };
  }

  function readStatic(file) {
    if (!staticCache.has(file)) staticCache.set(file, fs.readFileSync(file));
    return staticCache.get(file);
  }

  function getUser(req) {
    return rocketAuth.getSessionUser(parseCookies(req)[COOKIE_NAME]);
  }

  function handleLogin(req, res, url) {
    const next = LOGIN_TARGETS.includes(url.searchParams.get('next')) ? url.searchParams.get('next') : '/rocket';
    const ipLimit = actionLimiter.check(`login:${getClientIp(req)}`);
    const token = ipLimit.allowed ? rocketAuth.redeemLoginCode(url.searchParams.get('code')) : null;
    if (!token) {
      // Al ingelogd op dit apparaat? Dan is een verlopen link geen probleem
      redirect(res, getUser(req) ? next : `${next}?login=invalid`);
      return;
    }
    redirect(res, next, sessionCookie(req, token, COOKIE_MAX_AGE));
  }

  function handleStream(req, res, stream) {
    const total = Object.values(streams).reduce((sum, s) => sum + s.clients.size, 0);
    if (total >= MAX_STREAM_CLIENTS) {
      sendJson(res, 503, { error: 'too_many_clients' });
      return;
    }
    setBaseHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 2000\n');
    res.write(`data: ${JSON.stringify(stream.getState())}\n\n`);
    stream.clients.add(res);
    // Aan de blackjack tafel telt een open verbinding als "aanwezig"
    const user = stream === streams.blackjack ? getUser(req) : null;
    if (user) blackjackTable.connect(user.id);
    req.on('close', () => {
      stream.clients.delete(res);
      if (user) blackjackTable.disconnect(user.id);
    });
  }

  async function handleTile(req, res, z, x, y) {
    if (!tileLimiter.check(`tile:${getClientIp(req)}`).allowed || !routegok.isTileAllowed(z, x, y)) {
      setBaseHeaders(res);
      res.statusCode = 404;
      res.setHeader('Cache-Control', 'no-store');
      res.end();
      return;
    }
    const body = await routegok.getTile(z, x, y).catch(() => null);
    if (!body) {
      setBaseHeaders(res);
      res.statusCode = 502;
      res.setHeader('Cache-Control', 'no-store');
      res.end();
      return;
    }
    setBaseHeaders(res);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/jpeg');
    // Niet in de browser cachen buiten het gebied: daar beslist de server elke ronde opnieuw over
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(body);
  }

  async function handleAction(req, res, action) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      sendJson(res, 415, { ok: false, message: 'Verkeerd verzoek.' });
      return;
    }
    const user = getUser(req);
    if (!user) {
      sendJson(res, 401, { ok: false, message: 'Je bent niet ingelogd. Typ /rocket, /spin, /tafel, /plinko, /slots, /roulette, /sterrenrad, /routegok, /fuik of /afwassen in Discord voor je persoonlijke link.' });
      return;
    }
    const limiter = action === 'plinko/drop' ? plinkoLimiter : (action === 'roulette/bet' || action.startsWith('sterrenrad/') || action.startsWith('routegok/')) ? rouletteLimiter : actionLimiter;
    if (!limiter.check(user.id).allowed) {
      sendJson(res, 429, { ok: false, message: 'Rustig aan! Probeer het over een paar seconden opnieuw.' });
      return;
    }

    let body;
    try {
      body = await readJsonBody(req, action === 'roulette/bet' ? MAX_ROULETTE_BODY_BYTES : MAX_BODY_BYTES);
    } catch (error) {
      sendJson(res, 400, { ok: false, message: 'Verkeerd verzoek.' });
      return;
    }

    let result;
    switch (action) {
      case 'rocket/start': result = rocketGame.startGame(user); break;
      case 'rocket/join': result = rocketGame.join(user, body.bet, body.autoCashout); break;
      case 'rocket/leave': result = rocketGame.leave(user); break;
      case 'rocket/cashout': result = rocketGame.cashOut(user); break;
      case 'spin/spin': result = dailySpin.spin(user); break;
      case 'blackjack/sit': result = blackjackTable.sit(user, Number.isInteger(body.seat) ? body.seat : null); break;
      case 'blackjack/leave': result = blackjackTable.standUp(user); break;
      case 'blackjack/bet': result = blackjackTable.placeBet(user, body.amount); break;
      case 'blackjack/act': result = blackjackTable.act(user, String(body.action || '')); break;
      case 'plinko/drop': result = plinko.drop(user, body.bet, body.risk, body.rows); break;
      case 'slots/spin': result = slots.spin(user, body.bet, body.machine); break;
      case 'roulette/bet': result = roulette.placeBets(user, body.bets); break;
      case 'sterrenrad/bet': result = sterrenrad.placeBets(user, body.bets); break;
      case 'sterrenrad/choose': result = sterrenrad.choose(user, body.choice); break;
      case 'routegok/start': result = routegok.startRound(user); break;
      case 'routegok/guess': result = routegok.placeGuess(user, body); break;
      case 'routegok/peek': result = routegok.peek(user); break;
      case 'afwas/plate': result = afwas.nextPlate(user); break;
      case 'afwas/clean': result = afwas.cleanPlate(user, body.plate); break;
      case 'afwas/reject': result = afwas.rejectPlate(user, body.plate); break;
      case 'fuik/tap': result = fuik.tap(user, body.slot); break;
      case 'fuik/all': result = fuik.tapAll(user); break;
      case 'keys/open': result = crates.open(user, body.kind); break;
      case 'blackjack/insurance': result = blackjackTable.insurance(user, Boolean(body.take)); break;
      case 'spin/reminder':
        dailySpin.setReminder(user.id, Boolean(body.enabled));
        result = { ok: true, message: body.enabled ? 'Je krijgt elke ochtend een DM als je spin klaarstaat.' : 'Ochtendmeldingen staan uit.' };
        break;
      case 'chat/send': {
        const sent = chat.send(user, body.text);
        sendJson(res, sent.ok ? 200 : 400, { ok: sent.ok, message: sent.message, notice: sent.notice });
        return;
      }
      case 'logout':
        rocketAuth.deleteSession(parseCookies(req)[COOKIE_NAME]);
        res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
        result = { ok: true, message: 'Uitgelogd.' };
        break;
      default:
        sendJson(res, 404, { ok: false, message: 'Onbekende actie.' });
        return;
    }

    sendJson(res, result.ok ? 200 : 400, { ...result, balance: casino.getUserBalance(user.id) });
  }

  /**
   * @returns {boolean} true als het verzoek door de website is afgehandeld
   */
  function getMonitoringStats() {
    const cutoff = Date.now() - ONLINE_WINDOW_MS;
    let onlineUsers = 0;
    for (const entry of online.values()) if (entry.lastSeen >= cutoff && !entry.idle) onlineUsers++;
    const perStream = {};
    let sseClients = 0;
    for (const [name, stream] of Object.entries(streams)) {
      perStream[name] = stream.clients.size;
      sseClients += stream.clients.size;
    }
    return { streams: perStream, sseClients, sseLimit: MAX_STREAM_CLIENTS, onlineUsers };
  }

  // Laat alle open pagina's meteen weten dat de bot herstart, zodat ze direct de herstart-melding tonen
  function announceRestart() {
    const message = `event: restart\ndata: {}\n\n`;
    const targets = [...liveClients];
    for (const stream of Object.values(streams)) targets.push(...stream.clients);
    for (const res of targets) {
      try { res.write(message); } catch (error) { /* verbinding is al weg */ }
    }
  }

  handleCasinoWeb.getMonitoringStats = getMonitoringStats;
  handleCasinoWeb.announceRestart = announceRestart;
  return handleCasinoWeb;

  function handleCasinoWeb(req, res, url) {
    const { pathname } = url;

    if (req.method === 'GET') {
      switch (pathname) {
        case '/':
          redirect(res, '/rocket');
          return true;
        case '/rocket':
        case '/rocket/':
          sendPage(res, pages.rocket);
          return true;
        case '/blackjack':
        case '/blackjack/':
          sendPage(res, pages.blackjack);
          return true;
        case '/plinko':
        case '/plinko/':
          sendPage(res, pages.plinko);
          return true;
        case '/api/plinko/status': {
          const user = getUser(req);
          const payload = { linked: Boolean(user), config: plinko.getConfig() };
          if (user) {
            casino.getOrCreateUser(user.id, user.username);
            Object.assign(payload, { user, balance: casino.getUserBalance(user.id), stats: plinko.getStats(user.id) });
          }
          sendJson(res, 200, payload);
          return true;
        }
        case '/slots':
        case '/slots/':
          sendPage(res, pages.slots);
          return true;
        case '/api/slots/status': {
          const user = getUser(req);
          const payload = { linked: Boolean(user), config: slots.getConfig() };
          if (user) {
            casino.getOrCreateUser(user.id, user.username);
            Object.assign(payload, { user, balance: casino.getUserBalance(user.id), ...slots.getStatus(user.id) });
          }
          sendJson(res, 200, payload);
          return true;
        }
        case '/roulette':
        case '/roulette/':
          sendPage(res, pages.roulette);
          return true;
        case '/api/roulette/status': {
          const user = getUser(req);
          const payload = { linked: Boolean(user), config: roulette.getConfig() };
          if (user) {
            casino.getOrCreateUser(user.id, user.username);
            Object.assign(payload, { user, balance: casino.getUserBalance(user.id), stats: roulette.getStats(user.id) });
          }
          sendJson(res, 200, payload);
          return true;
        }
        case '/api/live':
          handleLive(req, res);
          return true;
        case '/api/roulette/stream':
          handleStream(req, res, streams.roulette);
          return true;
        case '/sterrenrad':
        case '/sterrenrad/':
          sendPage(res, pages.sterrenrad);
          return true;
        case '/api/sterrenrad/status': {
          const user = getUser(req);
          const payload = { linked: Boolean(user), config: sterrenrad.getConfig() };
          if (user) {
            casino.getOrCreateUser(user.id, user.username);
            Object.assign(payload, { user, balance: casino.getUserBalance(user.id), stats: sterrenrad.getStats(user.id) });
          }
          sendJson(res, 200, payload);
          return true;
        }
        case '/api/sterrenrad/stream':
          handleStream(req, res, streams.sterrenrad);
          return true;
        case '/api/sterrenrad/time':
          // Klokmeting (heen-en-terug) zodat de show in elke browser gelijk loopt met de server
          sendJson(res, 200, { serverNow: Date.now() });
          return true;
        case '/routegok':
        case '/routegok/':
          sendPage(res, pages.routegok);
          return true;
        case '/api/routegok/status': {
          const user = getUser(req);
          const payload = { linked: Boolean(user), config: routegok.getConfig() };
          if (user) {
            casino.getOrCreateUser(user.id, user.username);
            Object.assign(payload, { user, balance: casino.getUserBalance(user.id), stats: routegok.getStats(user.id), mine: routegok.getMyEntry(user.id) });
          }
          sendJson(res, 200, payload);
          return true;
        }
        case '/api/routegok/stream':
          handleStream(req, res, streams.routegok);
          return true;
        case '/afwas':
        case '/afwas/':
          sendPage(res, pages.afwas);
          return true;
        case '/api/afwas/status': {
          const user = getUser(req);
          const payload = { linked: Boolean(user), config: afwas.getConfig() };
          if (user) {
            casino.getOrCreateUser(user.id, user.username);
            Object.assign(payload, { user, balance: casino.getUserBalance(user.id), canWash: afwas.canWash(user.id), stats: afwas.getStats(user.id) });
          }
          sendJson(res, 200, payload);
          return true;
        }
        case '/fuik':
        case '/fuik/':
          sendPage(res, pages.fuik);
          return true;
        case '/api/fuik/status': {
          const user = getUser(req);
          const payload = { linked: Boolean(user), config: fuik.getConfig(), serverNow: Date.now() };
          if (user) {
            casino.getOrCreateUser(user.id, user.username);
            Object.assign(payload, { user, balance: casino.getUserBalance(user.id), ...fuik.getStatus(user.id) });
          }
          sendJson(res, 200, payload);
          return true;
        }
        case '/keys':
        case '/keys/':
          sendPage(res, pages.keys);
          return true;
        case '/api/keys/status': {
          const user = getUser(req);
          const payload = { linked: Boolean(user), config: crates.getConfig(), serverNow: Date.now() };
          if (user) {
            casino.getOrCreateUser(user.id, user.username);
            Object.assign(payload, { user, balance: casino.getUserBalance(user.id), ...crates.getStatus(user.id) });
          }
          sendJson(res, 200, payload);
          return true;
        }
        case '/stats':
        case '/stats/':
          sendPage(res, pages.stats);
          return true;
        case '/api/stats': {
          const user = getUser(req);
          const payload = stats.getOverview(user ? user.id : null);
          payload.linked = Boolean(user);
          if (user) Object.assign(payload, { user, balance: casino.getUserBalance(user.id) });
          sendJson(res, 200, payload);
          return true;
        }
        case '/api/blackjack/stream':
          handleStream(req, res, streams.blackjack);
          return true;
        case '/spin':
        case '/spin/':
        case '/daily':
        case '/daily/':
          sendPage(res, pages.spin);
          return true;
        case '/login':
          handleLogin(req, res, url);
          return true;
        case '/connection.js':
          sendStatic(res, readStatic(path.join(WEB_DIR, 'connection.js')), 'text/javascript; charset=utf-8');
          return true;
        case '/rocket/login':
          url.searchParams.set('next', '/rocket');
          handleLogin(req, res, url);
          return true;
        case '/api/me':
        case '/api/rocket/me': {
          const user = getUser(req);
          if (!user) {
            sendJson(res, 200, { linked: false, washBelow: afwas.MAX_BALANCE });
            return true;
          }
          casino.getOrCreateUser(user.id, user.username);
          sendJson(res, 200, { linked: true, user, balance: casino.getUserBalance(user.id), washBelow: afwas.MAX_BALANCE, canWash: afwas.canWash(user.id), keys: crates.countKeys(user.id) });
          return true;
        }
        case '/api/chat':
          sendJson(res, 200, { messages: chat.getHistory(), max: chat.MAX_LENGTH });
          return true;
        case '/api/online': {
          const user = getUser(req);
          if (user && url.searchParams.get('active') === '1') markOnline(user, url.searchParams.get('page'), url.searchParams.get('idle') === '1');
          sendJson(res, 200, getOnline());
          return true;
        }
        case '/api/rocket/state':
          sendJson(res, 200, rocketGame.getPublicState());
          return true;
        case '/api/rocket/stream':
          handleStream(req, res, streams.rocket);
          return true;
        case '/api/spin/status': {
          const user = getUser(req);
          const payload = { serverNow: Date.now(), wheel: dailySpin.getWheel(), linked: Boolean(user) };
          if (user) {
            casino.getOrCreateUser(user.id, user.username);
            Object.assign(payload, { user, balance: casino.getUserBalance(user.id), ...dailySpin.getStatus(user) });
          }
          sendJson(res, 200, payload);
          return true;
        }
        default:
          break;
      }

      const vendorMatch = pathname.match(/^\/vendor\/three\/(three\.(?:module|core)\.js)$/);
      if (vendorMatch) {
        sendStatic(res, readStatic(VENDOR_FILES[vendorMatch[1]]), 'text/javascript; charset=utf-8');
        return true;
      }
      const tileMatch = pathname.match(/^\/api\/routegok\/tile\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.jpg$/);
      if (tileMatch) {
        handleTile(req, res, Number(tileMatch[1]), Number(tileMatch[2]), Number(tileMatch[3]));
        return true;
      }
      const audioMatch = pathname.match(/^\/audio\/([a-z0-9-]+\.mp3)$/);
      if (audioMatch) {
        const file = path.join(WEB_DIR, 'audio', audioMatch[1]);
        if (!fs.existsSync(file)) return false;
        sendStatic(res, readStatic(file), 'audio/mpeg');
        return true;
      }
      const cardMatch = pathname.match(/^\/cards\/([a-z0-9_]+\.png)$/);
      if (cardMatch) {
        const file = path.join(CARDS_DIR, cardMatch[1]);
        if (!fs.existsSync(file)) return false;
        sendStatic(res, readStatic(file), 'image/png');
        return true;
      }
    }

    const actionMatch = pathname.match(/^\/api\/(rocket\/(?:start|join|leave|cashout)|spin\/(?:spin|reminder)|blackjack\/(?:sit|leave|bet|act|insurance)|plinko\/drop|slots\/spin|roulette\/bet|sterrenrad\/(?:bet|choose)|routegok\/(?:start|guess|peek)|afwas\/(?:plate|clean|reject)|fuik\/(?:tap|all)|keys\/open|chat\/send|logout|rocket\/logout)$/);
    if (actionMatch && req.method === 'POST') {
      const action = actionMatch[1] === 'rocket/logout' ? 'logout' : actionMatch[1];
      handleAction(req, res, action).catch(error => {
        console.error('[CASINO_WEB] Fout bij actie:', error);
        if (!res.headersSent) sendJson(res, 500, { ok: false, message: 'Er ging iets mis.' });
      });
      return true;
    }

    return false;
  }
}

module.exports = {
  createCasinoWebHandler
};
