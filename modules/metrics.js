/**
 * White-box monitoring voor Zabbix (agent 2)
 *
 * Verzamelt in het bot-proces zelf hoe alles erbij staat (proces, Discord gateway,
 * webserver, database, back-ups en elke periodieke taak) en serveert dat als JSON op
 * een aparte poort die standaard alleen op 127.0.0.1 luistert. Zo is het niet via de
 * Cloudflare tunnel bereikbaar; de Zabbix agent in dezelfde LXC leest het uit.
 *
 *   GET /metrics   volledige snapshot (JSON, alle getallen; onbekend = -1)
 *   GET /health    200 als alles in orde is, anders 503 + lijst met problemen
 *
 * Config (config.json, allemaal optioneel):
 *   METRICS_ENABLED     standaard true
 *   METRICS_HOST        standaard "127.0.0.1"
 *   METRICS_PORT        standaard 9464
 *   METRICS_BACKUP_DIR  standaard "/root/discord-bot-backup" (zie startscript)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { monitorEventLoopDelay } = require('perf_hooks');

const BOT_DIR = path.join(__dirname, '..');
const DB_FILE = path.join(BOT_DIR, 'bot.db');
const LATENCY_WINDOW_MS = 5 * 60 * 1000;
const LATENCY_MAX_SAMPLES = 5000;
const MAX_ERROR_LENGTH = 300;
const EVENT_LOOP_P99_PROBLEM_MS = 500;

const startedAt = Date.now();

// ----------------------------------------------------------------------------
// Proces
// ----------------------------------------------------------------------------

const LOOP_RESOLUTION_MS = 10;
const loopDelay = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
loopDelay.enable();

const processStats = {
  errorsLogged: 0,
  warningsLogged: 0,
  unhandledRejections: 0,
  lastErrorAt: 0,
  lastErrorMessage: ''
};

let lastCpuSample = { usage: process.cpuUsage(), at: process.hrtime.bigint() };

function truncate(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > MAX_ERROR_LENGTH ? `${value.slice(0, MAX_ERROR_LENGTH - 1)}…` : value;
}

function describeError(value) {
  if (value instanceof Error) return value.message || String(value);
  if (typeof value === 'object' && value !== null) {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

/**
 * Telt elke console.error/console.warn. Aanroepen ná setupFileLogging, zodat het
 * logbestand gewoon blijft werken.
 */
function instrumentConsole() {
  const originalError = console.error;
  const originalWarn = console.warn;

  console.error = (...args) => {
    processStats.errorsLogged++;
    processStats.lastErrorAt = Date.now();
    processStats.lastErrorMessage = truncate(args.map(describeError).join(' '));
    originalError(...args);
  };

  console.warn = (...args) => {
    processStats.warningsLogged++;
    originalWarn(...args);
  };
}

function recordUnhandledRejection() {
  processStats.unhandledRejections++;
}

function getCpuPercent() {
  const now = process.hrtime.bigint();
  const usage = process.cpuUsage();
  const elapsedMicros = Number(now - lastCpuSample.at) / 1000;
  const user = usage.user - lastCpuSample.usage.user;
  const system = usage.system - lastCpuSample.usage.system;
  lastCpuSample = { usage, at: now };
  if (elapsedMicros <= 0) return { user: 0, system: 0 };
  return {
    user: round((user / elapsedMicros) * 100, 2),
    system: round((system / elapsedMicros) * 100, 2)
  };
}

function round(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function ageSeconds(timestamp) {
  return timestamp ? Math.round((Date.now() - timestamp) / 1000) : -1;
}

function snapshotProcess() {
  const memory = process.memoryUsage();
  const cpu = getCpuPercent();
  // De histogram meet de volledige timer-periode; trek de resolutie eraf zodat 0 = geen vertraging
  const toMs = (ns) => (Number.isFinite(ns) && ns > 0 ? round(Math.max(0, ns / 1e6 - LOOP_RESOLUTION_MS), 1) : -1);
  const loop = {
    mean: toMs(loopDelay.mean),
    p99: toMs(loopDelay.percentile(99)),
    max: toMs(loopDelay.max)
  };
  // Elke scrape meet het interval sinds de vorige scrape
  loopDelay.reset();

  return {
    pid: process.pid,
    nodeVersion: process.version,
    startedAt: Math.floor(startedAt / 1000),
    uptimeSeconds: Math.round(process.uptime()),
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
    cpuUserPercent: cpu.user,
    cpuSystemPercent: cpu.system,
    eventLoopLagMeanMs: loop.mean,
    eventLoopLagP99Ms: loop.p99,
    eventLoopLagMaxMs: loop.max,
    activeHandles: typeof process._getActiveHandles === 'function' ? process._getActiveHandles().length : -1,
    errorsLogged: processStats.errorsLogged,
    warningsLogged: processStats.warningsLogged,
    unhandledRejections: processStats.unhandledRejections,
    lastErrorAgeSeconds: ageSeconds(processStats.lastErrorAt),
    lastErrorMessage: processStats.lastErrorMessage
  };
}

// ----------------------------------------------------------------------------
// Taken (cron, pollers, chatbot, ...)
// ----------------------------------------------------------------------------

const jobs = new Map();

/**
 * Leg een taak vast. maxSilenceSeconds: hoe lang er maximaal geen geslaagde run
 * mag zijn voordat de taak als "stil" (stale) geldt. 0 = niet controleren.
 */
function defineJob(name, options = {}) {
  let job = jobs.get(name);
  if (!job) {
    job = {
      name,
      maxSilenceSeconds: 0,
      runs: 0,
      successes: 0,
      failures: 0,
      consecutiveFailures: 0,
      running: 0,
      lastRunAt: 0,
      lastSuccessAt: 0,
      lastFailureAt: 0,
      lastDurationMs: -1,
      lastError: '',
      currentRunFailed: false
    };
    jobs.set(name, job);
  }
  if (options.maxSilenceSeconds !== undefined) job.maxSilenceSeconds = Number(options.maxSilenceSeconds) || 0;
  return job;
}

function finishRun(job, startedAtMs, error) {
  job.running = Math.max(0, job.running - 1);
  job.lastDurationMs = Date.now() - startedAtMs;
  if (error || job.currentRunFailed) {
    if (error && !job.currentRunFailed) recordFailure(job, error);
  } else {
    job.successes++;
    job.consecutiveFailures = 0;
    job.lastSuccessAt = Date.now();
  }
}

function recordFailure(job, error) {
  job.failures++;
  job.consecutiveFailures++;
  job.lastFailureAt = Date.now();
  job.lastError = truncate(describeError(error));
}

/**
 * Voer een taak uit en meet hem. Een throw/reject telt als mislukt (en wordt
 * doorgegeven); een taak die zelf zijn fout afvangt kan markJobFailure aanroepen.
 */
function runJob(name, fn) {
  const job = defineJob(name);
  const start = Date.now();
  job.runs++;
  job.running++;
  job.lastRunAt = start;
  job.currentRunFailed = false;

  let result;
  try {
    result = fn();
  } catch (error) {
    finishRun(job, start, error);
    throw error;
  }

  if (result && typeof result.then === 'function') {
    return result.then(
      (value) => { finishRun(job, start, null); return value; },
      (error) => { finishRun(job, start, error); throw error; }
    );
  }
  finishRun(job, start, null);
  return result;
}

/**
 * Markeer de lopende (of laatste) run van een taak als mislukt, voor taken die
 * hun fouten zelf afvangen en alleen loggen.
 */
function markJobFailure(name, error) {
  const job = defineJob(name);
  if (job.running > 0) {
    if (!job.currentRunFailed) recordFailure(job, error);
    job.currentRunFailed = true;
    return;
  }
  // Buiten runJob om (bv. event-gedreven): direct als losse mislukte run tellen
  job.runs++;
  job.lastRunAt = Date.now();
  recordFailure(job, error);
}

/**
 * Geslaagde run buiten runJob om (bv. een event-gedreven update).
 */
function markJobSuccess(name) {
  const job = defineJob(name);
  job.runs++;
  job.successes++;
  job.consecutiveFailures = 0;
  job.lastRunAt = Date.now();
  job.lastSuccessAt = job.lastRunAt;
}

function isJobStale(job) {
  if (!job.maxSilenceSeconds) return false;
  const reference = job.lastSuccessAt || startedAt;
  return (Date.now() - reference) / 1000 > job.maxSilenceSeconds;
}

function snapshotJobs() {
  return [...jobs.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((job) => ({
      name: job.name,
      runs: job.runs,
      successes: job.successes,
      failures: job.failures,
      consecutiveFailures: job.consecutiveFailures,
      running: job.running,
      lastRunAgeSeconds: ageSeconds(job.lastRunAt),
      lastSuccessAgeSeconds: ageSeconds(job.lastSuccessAt),
      lastFailureAgeSeconds: ageSeconds(job.lastFailureAt),
      lastDurationMs: job.lastDurationMs,
      maxSilenceSeconds: job.maxSilenceSeconds,
      stale: isJobStale(job) ? 1 : 0,
      lastError: job.lastError
    }));
}

// ----------------------------------------------------------------------------
// Discord
// ----------------------------------------------------------------------------

let discordClient = null;
const discordStats = {
  readyAt: 0,
  readyCount: 0,
  disconnects: 0,
  reconnects: 0,
  resumes: 0,
  shardErrors: 0,
  invalidated: 0,
  clientErrors: 0,
  restRateLimits: 0,
  lastDisconnectAt: 0,
  messagesReceived: 0,
  interactionsReceived: 0
};

function attachDiscordClient(client) {
  discordClient = client;
  client.on('shardReady', () => { discordStats.readyAt = Date.now(); discordStats.readyCount++; });
  client.on('shardDisconnect', () => { discordStats.disconnects++; discordStats.lastDisconnectAt = Date.now(); });
  client.on('shardReconnecting', () => { discordStats.reconnects++; });
  client.on('shardResume', () => { discordStats.resumes++; });
  client.on('shardError', () => { discordStats.shardErrors++; });
  client.on('invalidated', () => { discordStats.invalidated++; });
  client.on('error', () => { discordStats.clientErrors++; });
  client.on('messageCreate', () => { discordStats.messagesReceived++; });
  client.on('interactionCreate', () => { discordStats.interactionsReceived++; });
  if (client.rest && typeof client.rest.on === 'function') {
    client.rest.on('rateLimited', () => { discordStats.restRateLimits++; });
  }
}

function snapshotDiscord() {
  const client = discordClient;
  let voiceConnections = -1;
  try {
    voiceConnections = require('@discordjs/voice').getVoiceConnections().size;
  } catch {
    // voice module niet beschikbaar
  }

  const ready = Boolean(client && typeof client.isReady === 'function' && client.isReady());
  const ping = client?.ws?.ping;

  return {
    ready: ready ? 1 : 0,
    // discord.js Status: 0 = Ready, 1 = Connecting, 2 = Reconnecting, 3 = Idle,
    // 4 = Nearly, 5 = Disconnected, 6 = WaitingForGuilds, 7 = Identifying, 8 = Resuming
    wsStatus: Number.isInteger(client?.ws?.status) ? client.ws.status : -1,
    pingMs: Number.isFinite(ping) && ping >= 0 ? Math.round(ping) : -1,
    guilds: ready ? client.guilds.cache.size : -1,
    cachedUsers: ready ? client.users.cache.size : -1,
    voiceConnections,
    readySinceSeconds: ageSeconds(discordStats.readyAt),
    readyCount: discordStats.readyCount,
    disconnects: discordStats.disconnects,
    reconnects: discordStats.reconnects,
    resumes: discordStats.resumes,
    shardErrors: discordStats.shardErrors,
    invalidated: discordStats.invalidated,
    clientErrors: discordStats.clientErrors,
    restRateLimits: discordStats.restRateLimits,
    lastDisconnectAgeSeconds: ageSeconds(discordStats.lastDisconnectAt),
    messagesReceived: discordStats.messagesReceived,
    interactionsReceived: discordStats.interactionsReceived
  };
}

// ----------------------------------------------------------------------------
// Webserver
// ----------------------------------------------------------------------------

const KNOWN_API_GROUPS = new Set([
  'me', 'online', 'rocket', 'spin', 'blackjack', 'plinko', 'slots',
  'roulette', 'sterrenrad', 'routegok', 'afwas', 'fuik', 'stats', 'logout'
]);
const PAGE_PATHS = new Set([
  '', 'rocket', 'spin', 'daily', 'blackjack', 'plinko', 'slots',
  'roulette', 'sterrenrad', 'routegok', 'afwas', 'fuik', 'stats', 'login'
]);

const httpStats = {
  requests: 0,
  active: 0,
  byClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
  rateLimited: 0,
  aborted: 0,
  sseOpened: 0,
  routes: new Map()
};
const latencySamples = []; // [timestampMs, durationMs]
let casinoStatsProvider = null;

/** Houdt het aantal labels klein en voorspelbaar (geen ID's of codes in de naam). */
function routeGroup(pathname) {
  if (pathname === '/api/public/hok/status') return 'hok_api';
  if (pathname.startsWith('/api/')) {
    const group = pathname.split('/')[2] || '';
    if (pathname.endsWith('/stream')) return 'sse';
    return KNOWN_API_GROUPS.has(group) ? `api_${group}` : 'api_other';
  }
  if (pathname === '/connection.js' || /^\/(cards|audio|vendor)\//.test(pathname)) return 'static';
  const first = pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (first.length <= 2 && PAGE_PATHS.has(first[0])) return 'page';
  return 'other';
}

function getRoute(name) {
  let route = httpStats.routes.get(name);
  if (!route) {
    route = { requests: 0, errors4xx: 0, errors5xx: 0, totalDurationMs: 0, timedRequests: 0 };
    httpStats.routes.set(name, route);
  }
  return route;
}

/**
 * Aanroepen aan het begin van elk verzoek; meet de afhandeling tot 'finish'.
 * Server-Sent Events tellen niet mee in de responstijd (die blijven open).
 */
function trackHttpRequest(req, res) {
  const start = process.hrtime.bigint();
  let pathname = '/';
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    // ongeldige URL → 'other'
  }
  const route = getRoute(routeGroup(pathname));
  httpStats.requests++;
  httpStats.active++;
  route.requests++;

  let done = false;
  const finish = (completed) => {
    if (done) return;
    done = true;
    httpStats.active = Math.max(0, httpStats.active - 1);

    const status = res.statusCode || 0;
    const statusClass = `${Math.floor(status / 100)}xx`;
    if (httpStats.byClass[statusClass] !== undefined) httpStats.byClass[statusClass]++;
    if (status === 429) httpStats.rateLimited++;
    if (status >= 500) route.errors5xx++;
    else if (status >= 400) route.errors4xx++;

    const isStream = String(res.getHeader('content-type') || '').startsWith('text/event-stream');
    if (isStream) {
      httpStats.sseOpened++;
      return;
    }
    if (!completed) {
      httpStats.aborted++;
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    route.totalDurationMs += durationMs;
    route.timedRequests++;
    latencySamples.push([Date.now(), durationMs]);
    if (latencySamples.length > LATENCY_MAX_SAMPLES) latencySamples.splice(0, latencySamples.length - LATENCY_MAX_SAMPLES);
  };

  res.on('finish', () => finish(true));
  res.on('close', () => finish(false));
}

function setCasinoStatsProvider(provider) {
  casinoStatsProvider = typeof provider === 'function' ? provider : null;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return -1;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function snapshotHttp() {
  const cutoff = Date.now() - LATENCY_WINDOW_MS;
  while (latencySamples.length > 0 && latencySamples[0][0] < cutoff) latencySamples.shift();
  const durations = latencySamples.map(([, duration]) => duration).sort((a, b) => a - b);
  const sum = durations.reduce((total, value) => total + value, 0);

  let casinoStats = { streams: {}, sseClients: -1, sseLimit: -1, onlineUsers: -1 };
  if (casinoStatsProvider) {
    try {
      casinoStats = casinoStatsProvider();
    } catch {
      // casino handler niet beschikbaar
    }
  }

  return {
    listening: publicServerListening ? 1 : 0,
    requestsTotal: httpStats.requests,
    activeRequests: httpStats.active,
    responses2xx: httpStats.byClass['2xx'],
    responses3xx: httpStats.byClass['3xx'],
    responses4xx: httpStats.byClass['4xx'],
    responses5xx: httpStats.byClass['5xx'],
    rateLimited: httpStats.rateLimited,
    aborted: httpStats.aborted,
    sseOpened: httpStats.sseOpened,
    sseClients: casinoStats.sseClients,
    sseLimit: casinoStats.sseLimit ?? -1,
    sseClientsByStream: casinoStats.streams,
    onlineUsers: casinoStats.onlineUsers,
    // Over de laatste 5 minuten, exclusief SSE
    latencySamples: durations.length,
    latencyAvgMs: durations.length ? round(sum / durations.length, 2) : -1,
    latencyP95Ms: durations.length ? round(percentile(durations, 95), 2) : -1,
    latencyP99Ms: durations.length ? round(percentile(durations, 99), 2) : -1,
    latencyMaxMs: durations.length ? round(durations[durations.length - 1], 2) : -1,
    routes: [...httpStats.routes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, route]) => ({
        route: name,
        requests: route.requests,
        errors4xx: route.errors4xx,
        errors5xx: route.errors5xx,
        avgLatencyMs: route.timedRequests ? round(route.totalDurationMs / route.timedRequests, 2) : -1
      }))
  };
}

let publicServerListening = false;
function setPublicServerListening(value) {
  publicServerListening = Boolean(value);
}

// ----------------------------------------------------------------------------
// Database, back-ups, hok
// ----------------------------------------------------------------------------

let databaseReady = false;
let backupDir = '/root/discord-bot-backup';

function markDatabaseReady() {
  databaseReady = true;
}

function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return -1;
  }
}

function snapshotDatabase() {
  const result = {
    ready: databaseReady ? 1 : 0,
    ok: 0,
    checkLatencyMs: -1,
    sizeBytes: fileSize(DB_FILE),
    walSizeBytes: fileSize(`${DB_FILE}-wal`),
    tables: -1,
    lastError: ''
  };
  if (!databaseReady) return result;

  try {
    const { getDatabase } = require('../database');
    const start = process.hrtime.bigint();
    const row = getDatabase().prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get();
    result.checkLatencyMs = round(Number(process.hrtime.bigint() - start) / 1e6, 3);
    result.tables = row?.n ?? -1;
    result.ok = 1;
  } catch (error) {
    result.lastError = truncate(describeError(error));
  }
  return result;
}

function snapshotBackups() {
  try {
    const files = fs.readdirSync(backupDir).filter((name) => name.startsWith('bot.db.backup-'));
    let newest = 0;
    let totalBytes = 0;
    for (const name of files) {
      const stat = fs.statSync(path.join(backupDir, name));
      newest = Math.max(newest, stat.mtimeMs);
      totalBytes += stat.size;
    }
    return { dirReadable: 1, count: files.length, totalBytes, newestAgeSeconds: ageSeconds(newest) };
  } catch {
    return { dirReadable: 0, count: -1, totalBytes: -1, newestAgeSeconds: -1 };
  }
}

function snapshotHok() {
  if (!databaseReady) return { isOpen: -1, lastUpdatedAgeSeconds: -1 };
  try {
    const state = require('./hok').getHokState();
    // last_updated komt uit SQLite datetime('now'): "YYYY-MM-DD HH:MM:SS" in UTC
    const updated = state?.last_updated ? Date.parse(`${String(state.last_updated).replace(' ', 'T')}Z`) : 0;
    return {
      isOpen: state ? (state.is_open ? 1 : 0) : -1,
      lastUpdatedAgeSeconds: Number.isFinite(updated) && updated > 0 ? ageSeconds(updated) : -1
    };
  } catch {
    return { isOpen: -1, lastUpdatedAgeSeconds: -1 };
  }
}

// ----------------------------------------------------------------------------
// Snapshot + server
// ----------------------------------------------------------------------------

function collectProblems(snapshot) {
  const problems = [];
  const warmedUp = snapshot.process.uptimeSeconds > 120;

  if (warmedUp && !snapshot.discord.ready) problems.push('Discord gateway niet verbonden');
  if (warmedUp && !snapshot.database.ok) problems.push(`Database niet bereikbaar${snapshot.database.lastError ? `: ${snapshot.database.lastError}` : ''}`);
  if (warmedUp && publicServerEnabled && !snapshot.http.listening) problems.push('Webserver luistert niet');
  if (snapshot.process.eventLoopLagP99Ms > EVENT_LOOP_P99_PROBLEM_MS) problems.push(`Event loop lag p99 ${snapshot.process.eventLoopLagP99Ms} ms`);
  for (const job of snapshot.jobs) {
    if (job.consecutiveFailures >= 3) problems.push(`Taak ${job.name} faalt ${job.consecutiveFailures}x achter elkaar: ${job.lastError}`);
    if (job.stale) problems.push(`Taak ${job.name} al ${job.lastSuccessAgeSeconds < 0 ? 'nooit' : `${job.lastSuccessAgeSeconds}s niet`} geslaagd`);
  }
  return problems;
}

function getSnapshot() {
  const snapshot = {
    schema: 1,
    generatedAt: Math.floor(Date.now() / 1000),
    process: snapshotProcess(),
    discord: snapshotDiscord(),
    http: snapshotHttp(),
    database: snapshotDatabase(),
    backups: snapshotBackups(),
    hok: snapshotHok(),
    jobs: snapshotJobs()
  };
  const problems = collectProblems(snapshot);
  return {
    healthy: problems.length === 0 ? 1 : 0,
    problemCount: problems.length,
    problems: problems.join('; '),
    ...snapshot
  };
}

let metricsServer = null;
let publicServerEnabled = true;

function startMetricsServer(config = {}) {
  if (config.METRICS_ENABLED === false) {
    console.log('[METRICS] Uitgeschakeld via config (METRICS_ENABLED=false)');
    return null;
  }
  publicServerEnabled = config.PUBLIC_API_ENABLED !== false;
  if (config.METRICS_BACKUP_DIR) backupDir = String(config.METRICS_BACKUP_DIR);

  const host = config.METRICS_HOST || '127.0.0.1';
  const port = Number.isFinite(Number(config.METRICS_PORT)) ? Number(config.METRICS_PORT) : 9464;

  metricsServer = http.createServer((req, res) => {
    const pathname = String(req.url || '/').split('?')[0];
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET' || (pathname !== '/metrics' && pathname !== '/health')) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    try {
      const snapshot = getSnapshot();
      if (pathname === '/health') {
        res.statusCode = snapshot.healthy ? 200 : 503;
        res.end(JSON.stringify({ healthy: snapshot.healthy, problems: snapshot.problems }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify(snapshot));
    } catch (error) {
      console.error('[METRICS] Fout bij maken snapshot:', error);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'snapshot_failed' }));
    }
  });

  metricsServer.requestTimeout = 5000;
  metricsServer.on('error', (error) => {
    console.error('[METRICS] Serverfout:', error);
  });
  metricsServer.listen(port, host, () => {
    console.log(`[METRICS] Monitoring endpoint actief op http://${host}:${port}/metrics`);
  });
  metricsServer.unref();
  return metricsServer;
}

function closeMetricsServer() {
  if (!metricsServer) return;
  metricsServer.close();
  metricsServer = null;
}

module.exports = {
  instrumentConsole,
  recordUnhandledRejection,
  defineJob,
  runJob,
  markJobFailure,
  markJobSuccess,
  attachDiscordClient,
  trackHttpRequest,
  setCasinoStatsProvider,
  setPublicServerListening,
  markDatabaseReady,
  startMetricsServer,
  closeMetricsServer,
  getSnapshot,
  routeGroup
};
