const {
  applySecurityHeaders,
  createRateLimiter,
  createResponseCache,
  getClientIp,
} = require('./security');

function getAmsterdamHour() {
  return parseInt(
    new Date().toLocaleString('nl-NL', {
      timeZone: 'Europe/Amsterdam',
      hour: '2-digit',
      hour12: false,
    }),
    10
  );
}

function getPredictionTargetDay(isOpen) {
  if (isOpen) {
    return { targetDay: new Date().getDay(), daysFromNow: 0 };
  }

  const currentHour = getAmsterdamHour();
  if (currentHour >= 5 && currentHour < 17) {
    return { targetDay: new Date().getDay(), daysFromNow: 0 };
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { targetDay: tomorrow.getDay(), daysFromNow: 1 };
}

function getConfidence(sampleCount) {
  if (sampleCount >= 10) return 'high';
  if (sampleCount >= 5) return 'medium';
  return 'low';
}

function buildPublicHokPayload(hokModule) {
  const state = hokModule.getHokState();
  const isOpen = Boolean(state?.is_open);
  const prediction = hokModule.predictOpeningTime(isOpen);

  const { targetDay } = getPredictionTargetDay(isOpen);
  const stats = hokModule.getWeightedStatisticsForWeekday(targetDay, 120);
  const sampleCount = Number(stats?.sampleCount || 0);

  return {
    status: isOpen ? 'open' : 'closed',
    isOpen,
    nextEvent: isOpen ? 'closes' : 'opens',
    predictedTime: prediction?.time || null,
    daysFromNow: Number.isInteger(prediction?.daysFromNow) ? prediction.daysFromNow : null,
    lastUpdated: state?.last_updated || null,
    sampleCount,
    confidence: getConfidence(sampleCount),
    timezone: 'Europe/Amsterdam',
    generatedAt: new Date().toISOString(),
    apiVersion: 'v1',
  };
}

function createHokPublicApiHandler(hokModule, options = {}) {
  const {
    corsOrigin = '*',
    cacheSeconds = 30,
    rateLimitWindowMs = 60 * 1000,
    rateLimitMaxRequests = 60,
  } = options;

  const limiter = createRateLimiter({
    windowMs: rateLimitWindowMs,
    maxRequests: rateLimitMaxRequests,
  });

  const cache = createResponseCache(cacheSeconds);

  return function handleHokPublicApi(req, res) {
    const requestStart = Date.now();
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const clientIp = getClientIp(req);

    applySecurityHeaders(res, {
      corsOrigin,
      cacheSeconds,
      requestOrigin: req.headers.origin,
      requestId,
    });

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, OPTIONS');
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    const limitResult = limiter.check(clientIp);
    res.setHeader('X-RateLimit-Remaining', String(limitResult.remaining));
    if (!limitResult.allowed) {
      res.statusCode = 429;
      res.setHeader('Retry-After', String(limitResult.retryAfterSeconds));
      res.end(JSON.stringify({ error: 'rate_limited' }));
      return;
    }

    const cached = cache.read();
    const clientEtag = req.headers['if-none-match'];

    if (cached) {
      res.setHeader('ETag', cached.etag);
      res.setHeader('X-Cache', 'HIT');
      if (clientEtag && clientEtag === cached.etag) {
        res.statusCode = 304;
        res.end();
      } else {
        res.statusCode = 200;
        res.end(cached.payloadJson);
      }

      console.log('[PUBLIC_API]', JSON.stringify({
        route: '/api/public/hok/status',
        requestId,
        method: req.method,
        statusCode: res.statusCode,
        durationMs: Date.now() - requestStart,
        ip: clientIp,
        cache: 'hit',
      }));
      return;
    }

    try {
      const payload = buildPublicHokPayload(hokModule);
      const written = cache.write(payload);

      res.setHeader('ETag', written.etag);
      res.setHeader('X-Cache', 'MISS');
      res.statusCode = 200;
      res.end(written.payloadJson);

      console.log('[PUBLIC_API]', JSON.stringify({
        route: '/api/public/hok/status',
        requestId,
        method: req.method,
        statusCode: res.statusCode,
        durationMs: Date.now() - requestStart,
        ip: clientIp,
        cache: 'miss',
      }));
    } catch (error) {
      console.error('[PUBLIC_API] Fout bij bouwen hok status response:', error);
      res.statusCode = 503;
      res.end(JSON.stringify({ error: 'service_unavailable' }));
    }
  };
}

module.exports = {
  buildPublicHokPayload,
  createHokPublicApiHandler,
};
