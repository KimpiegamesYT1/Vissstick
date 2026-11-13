/**
 * Casino website (Rocket + Dagelijkse spin + Blackjack tafel)
 *   GET  /                          doorsturen naar /rocket
 *   GET  /rocket                    Rocket pagina
 *   GET  /spin, /daily              Dagelijkse spin pagina
 *   GET  /blackjack                 Blackjack tafel (3D)
 *   GET  /vendor/three/*.js         three.js (uit node_modules)
 *   GET  /cards/<naam>.png          kaartafbeeldingen
 *   GET  /audio/<naam>.mp3          achtergrondmuziek (web/audio)
 *   GET  /login?code=...&next=...   eenmalige code uit Discord inwisselen voor een sessie-cookie
 *   GET  /rocket/login?code=...     (oude links uit /rocket)
 *   GET  /api/me                    ingelogde speler + saldo
 *   GET  /api/rocket/state          spelstatus
 *   GET  /api/rocket/stream         Server-Sent Events met live spelstatus
 *   POST /api/rocket/{start,join,leave,cashout}
 *   GET  /api/spin/status           rad + spins van vandaag
 *   POST /api/spin/spin             draai aan het rad
 *   POST /api/spin/reminder         ochtendmelding aan/uit
 *   GET  /api/blackjack/stream      Server-Sent Events met de tafelstatus
 *   POST /api/blackjack/{sit,leave,bet,act,insurance}
 *   POST /api/logout
 */

const fs = require('fs');
const path = require('path');
const rocketGame = require('../modules/rocketGame');
const dailySpin = require('../modules/dailySpin');
const blackjackTable = require('../modules/blackjackTable');
const rocketAuth = require('../modules/rocketAuth');
const casino = require('../modules/casino');
const { createRateLimiter, getClientIp } = require('./security');

const WEB_DIR = path.join(__dirname, '..', 'web');
const COOKIE_NAME = 'rk_session';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const MAX_STREAM_CLIENTS = 300;
const HEARTBEAT_MS = 15000;
const MAX_BODY_BYTES = 1024;
const LOGIN_TARGETS = ['/rocket', '/spin', '/blackjack'];
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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
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
    blackjack: fs.readFileSync(path.join(WEB_DIR, 'blackjack.html'))
  };
  const staticCache = new Map();
  const actionLimiter = createRateLimiter({ windowMs: 10000, maxRequests: 40 });

  // Live streams per spel
  const streams = {
    rocket: { clients: new Set(), getState: rocketGame.getPublicState },
    blackjack: { clients: new Set(), getState: blackjackTable.getPublicState }
  };

  function broadcast(stream) {
    const message = `data: ${JSON.stringify(stream.getState())}\n\n`;
    for (const res of stream.clients) res.write(message);
  }

  rocketGame.events.on('update', () => broadcast(streams.rocket));
  blackjackTable.events.on('update', () => broadcast(streams.blackjack));

  // Houdt verbindingen (en de Cloudflare tunnel) open en geeft de browser een verse server tijd
  setInterval(() => {
    const message = `event: time\ndata: ${JSON.stringify({ serverNow: Date.now() })}\n\n`;
    for (const stream of Object.values(streams)) {
      for (const res of stream.clients) res.write(message);
    }
  }, HEARTBEAT_MS).unref();

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

  async function handleAction(req, res, action) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      sendJson(res, 415, { ok: false, message: 'Verkeerd verzoek.' });
      return;
    }
    const user = getUser(req);
    if (!user) {
      sendJson(res, 401, { ok: false, message: 'Je bent niet ingelogd. Typ /rocket, /spin of /tafel in Discord voor je persoonlijke link.' });
      return;
    }
    if (!actionLimiter.check(user.id).allowed) {
      sendJson(res, 429, { ok: false, message: 'Rustig aan! Probeer het over een paar seconden opnieuw.' });
      return;
    }

    let body;
    try {
      body = await readJsonBody(req);
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
      case 'blackjack/insurance': result = blackjackTable.insurance(user, Boolean(body.take)); break;
      case 'spin/reminder':
        dailySpin.setReminder(user.id, Boolean(body.enabled));
        result = { ok: true, message: body.enabled ? 'Je krijgt elke ochtend een DM als je spin klaarstaat.' : 'Ochtendmeldingen staan uit.' };
        break;
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
  return function handleCasinoWeb(req, res, url) {
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
        case '/rocket/login':
          url.searchParams.set('next', '/rocket');
          handleLogin(req, res, url);
          return true;
        case '/api/me':
        case '/api/rocket/me': {
          const user = getUser(req);
          if (!user) {
            sendJson(res, 200, { linked: false });
            return true;
          }
          casino.getOrCreateUser(user.id, user.username);
          sendJson(res, 200, { linked: true, user, balance: casino.getUserBalance(user.id) });
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

    const actionMatch = pathname.match(/^\/api\/(rocket\/(?:start|join|leave|cashout)|spin\/(?:spin|reminder)|blackjack\/(?:sit|leave|bet|act|insurance)|logout|rocket\/logout)$/);
    if (actionMatch && req.method === 'POST') {
      const action = actionMatch[1] === 'rocket/logout' ? 'logout' : actionMatch[1];
      handleAction(req, res, action).catch(error => {
        console.error('[CASINO_WEB] Fout bij actie:', error);
        if (!res.headersSent) sendJson(res, 500, { ok: false, message: 'Er ging iets mis.' });
      });
      return true;
    }

    return false;
  };
}

module.exports = {
  createCasinoWebHandler
};
