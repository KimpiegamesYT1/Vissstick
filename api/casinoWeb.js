/**
 * Rocket website
 * Serveert de pagina (web/rocket.html), de koppel-flow en de live API:
 *   GET  /                       doorsturen naar /rocket
 *   GET  /rocket                 pagina
 *   GET  /rocket/login?code=...  eenmalige code uit /rocket inwisselen voor een sessie-cookie
 *   GET  /api/rocket/state       spelstatus
 *   GET  /api/rocket/me          ingelogde speler + saldo
 *   GET  /api/rocket/stream      Server-Sent Events met live spelstatus
 *   POST /api/rocket/{start,join,leave,cashout,logout}
 */

const fs = require('fs');
const path = require('path');
const rocketGame = require('../modules/rocketGame');
const rocketAuth = require('../modules/rocketAuth');
const casino = require('../modules/casino');
const { createRateLimiter, getClientIp } = require('./security');

const PAGE_PATH = path.join(__dirname, '..', 'web', 'rocket.html');
const COOKIE_NAME = 'rk_session';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const MAX_STREAM_CLIENTS = 300;
const HEARTBEAT_MS = 15000;
const MAX_BODY_BYTES = 1024;

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

function createRocketWebHandler() {
  const page = fs.readFileSync(PAGE_PATH);
  const actionLimiter = createRateLimiter({ windowMs: 10000, maxRequests: 30 });
  const streamClients = new Set();

  function broadcast(payload) {
    const message = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of streamClients) res.write(message);
  }

  rocketGame.events.on('update', () => broadcast(rocketGame.getPublicState()));

  // Houdt verbindingen (en de Cloudflare tunnel) open en geeft de browser een verse server tijd
  setInterval(() => {
    const message = `event: time\ndata: ${JSON.stringify({ serverNow: Date.now() })}\n\n`;
    for (const res of streamClients) res.write(message);
  }, HEARTBEAT_MS).unref();

  function getUser(req) {
    return rocketAuth.getSessionUser(parseCookies(req)[COOKIE_NAME]);
  }

  function handleStream(req, res) {
    if (streamClients.size >= MAX_STREAM_CLIENTS) {
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
    res.write(`data: ${JSON.stringify(rocketGame.getPublicState())}\n\n`);
    streamClients.add(res);
    req.on('close', () => streamClients.delete(res));
  }

  async function handleAction(req, res, action) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      sendJson(res, 415, { ok: false, message: 'Verkeerd verzoek.' });
      return;
    }
    const user = getUser(req);
    if (!user) {
      sendJson(res, 401, { ok: false, message: 'Niet gekoppeld. Typ /rocket in Discord voor je link.' });
      return;
    }
    if (!actionLimiter.check(user.id).allowed) {
      sendJson(res, 429, { ok: false, message: 'Rustig aan!' });
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
    if (action === 'start') result = rocketGame.startGame(user);
    else if (action === 'join') result = rocketGame.join(user, body.bet, body.autoCashout);
    else if (action === 'leave') result = rocketGame.leave(user);
    else if (action === 'cashout') result = rocketGame.cashOut(user);
    else if (action === 'logout') {
      rocketAuth.deleteSession(parseCookies(req)[COOKIE_NAME]);
      res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
      result = { ok: true, message: 'Uitgelogd.' };
    }

    sendJson(res, result.ok ? 200 : 400, { ...result, balance: casino.getUserBalance(user.id) });
  }

  /**
   * @returns {boolean} true als het verzoek door Rocket is afgehandeld
   */
  return function handleRocketWeb(req, res, url) {
    const { pathname } = url;

    if (req.method === 'GET' && pathname === '/') {
      redirect(res, '/rocket');
      return true;
    }

    if (req.method === 'GET' && (pathname === '/rocket' || pathname === '/rocket/')) {
      setBaseHeaders(res);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Security-Policy',
        "default-src 'self'; img-src 'self' data: https://cdn.discordapp.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
      res.end(page);
      return true;
    }

    if (req.method === 'GET' && pathname === '/rocket/login') {
      const ipLimit = actionLimiter.check(`login:${getClientIp(req)}`);
      const token = ipLimit.allowed ? rocketAuth.redeemLoginCode(url.searchParams.get('code')) : null;
      if (!token) {
        redirect(res, '/rocket?login=invalid');
        return true;
      }
      redirect(res, '/rocket', sessionCookie(req, token, COOKIE_MAX_AGE));
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/rocket/state') {
      sendJson(res, 200, rocketGame.getPublicState());
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/rocket/me') {
      const user = getUser(req);
      if (!user) {
        sendJson(res, 200, { linked: false });
        return true;
      }
      casino.getOrCreateUser(user.id, user.username);
      sendJson(res, 200, { linked: true, user, balance: casino.getUserBalance(user.id) });
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/rocket/stream') {
      handleStream(req, res);
      return true;
    }

    const actionMatch = pathname.match(/^\/api\/rocket\/(start|join|leave|cashout|logout)$/);
    if (actionMatch && req.method === 'POST') {
      handleAction(req, res, actionMatch[1]).catch(error => {
        console.error('[ROCKET_WEB] Fout bij actie:', error);
        if (!res.headersSent) sendJson(res, 500, { ok: false, message: 'Er ging iets mis.' });
      });
      return true;
    }

    return false;
  };
}

module.exports = {
  createRocketWebHandler
};
