const crypto = require('crypto');

function parseAllowedOrigins(originsConfig) {
  if (!originsConfig || originsConfig === '*') {
    return '*';
  }

  if (Array.isArray(originsConfig)) {
    return originsConfig.map((origin) => String(origin).trim()).filter(Boolean);
  }

  return String(originsConfig)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function applySecurityHeaders(res, options = {}) {
  const {
    corsOrigin = '*',
    cacheSeconds = 30,
    requestId = null,
  } = options;

  const allowedOrigins = parseAllowedOrigins(corsOrigin);
  const requestOrigin = options.requestOrigin ? String(options.requestOrigin) : null;

  if (allowedOrigins === '*') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
  res.setHeader('Access-Control-Max-Age', '86400');

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=()');
  res.setHeader('Cache-Control', `public, max-age=${cacheSeconds}, stale-while-revalidate=30`);

  if (requestId) {
    res.setHeader('X-Request-Id', requestId);
  }
}

function createRateLimiter(options = {}) {
  const {
    windowMs = 60 * 1000,
    maxRequests = 60,
  } = options;

  const buckets = new Map();

  function check(clientIp) {
    const now = Date.now();
    const key = clientIp || 'unknown';

    let entry = buckets.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = {
        count: 0,
        resetAt: now + windowMs,
      };
      buckets.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, maxRequests - entry.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    if (entry.count > maxRequests) {
      return {
        allowed: false,
        remaining,
        retryAfterSeconds,
      };
    }

    return {
      allowed: true,
      remaining,
      retryAfterSeconds,
    };
  }

  // Prevent unbounded memory growth.
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of buckets.entries()) {
      if (now >= value.resetAt) {
        buckets.delete(key);
      }
    }
  }, Math.max(30_000, windowMs)).unref();

  return { check };
}

function createResponseCache(ttlSeconds = 30) {
  let cachedAt = 0;
  let payloadJson = null;
  let etag = null;

  function read(now = Date.now()) {
    if (!payloadJson || now - cachedAt > ttlSeconds * 1000) {
      return null;
    }

    return {
      payloadJson,
      etag,
      ageSeconds: Math.floor((now - cachedAt) / 1000),
    };
  }

  function write(payload) {
    payloadJson = JSON.stringify(payload);
    etag = `W/\"${crypto.createHash('sha1').update(payloadJson).digest('hex')}\"`;
    cachedAt = Date.now();
    return { payloadJson, etag };
  }

  return { read, write };
}

function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp) return String(cfIp);

  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    return String(forwardedFor).split(',')[0].trim();
  }

  return req.socket?.remoteAddress || 'unknown';
}

module.exports = {
  applySecurityHeaders,
  createRateLimiter,
  createResponseCache,
  getClientIp,
};
