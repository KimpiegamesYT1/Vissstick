#!/usr/bin/env node
/**
 * Genereert zabbix/vissstick_template.yaml (Zabbix 6.0 exportformaat, ook te
 * importeren in 6.2/6.4/7.x).
 *
 *   node zabbix/generate-template.js
 *
 * UUID's zijn afgeleid van de item-key, dus opnieuw genereren + importeren werkt
 * bestaande items bij in plaats van dubbele aan te maken.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEMPLATE = 'Vissstick Discord Bot';
const GROUP = 'Templates/Applications';
const MASTER_KEY = 'vissstick.metrics[{$VISSSTICK.METRICS.PORT}]';
const BOT_PROC = 'node,,,bot.js';
const OUT = path.join(__dirname, 'vissstick_template.yaml');

function uuid(seed) {
  const hash = crypto.createHash('sha1').update(`vissstick:${seed}`).digest('hex').slice(0, 32).split('');
  hash[12] = '4'; // Zabbix accepteert alleen UUIDv4-opmaak (vast afgeleid van de naam)
  hash[16] = ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  return hash.join('');
}

const T = (key) => `/${TEMPLATE}/${key}`;

// ----------------------------------------------------------------------------
// Items die uit de JSON-snapshot komen
// ----------------------------------------------------------------------------

/**
 * kind: 'gauge' (waarde zoals hij is), 'per_min' (verschil per minuut-scrape),
 *       'per_sec' (verandering per seconde), 'text'
 */
const dependent = [
  // Algemeen
  ['vissstick.healthy', 'Bot: healthy', '$.healthy', { valuemap: 'Vissstick healthy', tag: 'health' }],
  ['vissstick.problem_count', 'Bot: aantal problemen', '$.problemCount', { tag: 'health' }],
  ['vissstick.problems', 'Bot: problemen', '$.problems', { kind: 'text', tag: 'health' }],

  // Proces
  ['vissstick.uptime', 'Proces: uptime', '$.process.uptimeSeconds', { units: 'uptime', tag: 'process' }],
  ['vissstick.node_version', 'Proces: Node.js versie', '$.process.nodeVersion', { kind: 'char', tag: 'process' }],
  ['vissstick.rss', 'Proces: geheugen (RSS)', '$.process.rssBytes', { units: 'B', tag: 'process' }],
  ['vissstick.heap_used', 'Proces: heap gebruikt', '$.process.heapUsedBytes', { units: 'B', tag: 'process' }],
  ['vissstick.heap_total', 'Proces: heap totaal', '$.process.heapTotalBytes', { units: 'B', tag: 'process' }],
  ['vissstick.external', 'Proces: extern geheugen (buffers, native)', '$.process.externalBytes', { units: 'B', tag: 'process' }],
  ['vissstick.cpu_user', 'Proces: CPU user', '$.process.cpuUserPercent', { units: '%', float: true, tag: 'process' }],
  ['vissstick.cpu_system', 'Proces: CPU system', '$.process.cpuSystemPercent', { units: '%', float: true, tag: 'process' }],
  ['vissstick.loop.mean', 'Proces: event loop lag gemiddeld', '$.process.eventLoopLagMeanMs', { units: 'ms', float: true, tag: 'process' }],
  ['vissstick.loop.p99', 'Proces: event loop lag p99', '$.process.eventLoopLagP99Ms', { units: 'ms', float: true, tag: 'process' }],
  ['vissstick.loop.max', 'Proces: event loop lag max', '$.process.eventLoopLagMaxMs', { units: 'ms', float: true, tag: 'process' }],
  ['vissstick.handles', 'Proces: actieve handles', '$.process.activeHandles', { tag: 'process' }],
  ['vissstick.errors', 'Proces: gelogde fouten per minuut', '$.process.errorsLogged', { kind: 'per_min', tag: 'process' }],
  ['vissstick.warnings', 'Proces: gelogde waarschuwingen per minuut', '$.process.warningsLogged', { kind: 'per_min', tag: 'process' }],
  ['vissstick.unhandled_rejections', 'Proces: unhandled rejections per minuut', '$.process.unhandledRejections', { kind: 'per_min', tag: 'process' }],
  ['vissstick.last_error', 'Proces: laatste foutmelding', '$.process.lastErrorMessage', { kind: 'text', tag: 'process' }],

  // Discord
  ['vissstick.discord.ready', 'Discord: verbonden', '$.discord.ready', { valuemap: 'Vissstick yes/no', tag: 'discord' }],
  ['vissstick.discord.ws_status', 'Discord: gateway status', '$.discord.wsStatus', { valuemap: 'Discord gateway status', tag: 'discord' }],
  ['vissstick.discord.ping', 'Discord: gateway ping', '$.discord.pingMs', { units: 'ms', tag: 'discord' }],
  ['vissstick.discord.guilds', 'Discord: servers', '$.discord.guilds', { tag: 'discord' }],
  ['vissstick.discord.cached_users', 'Discord: gebruikers in cache', '$.discord.cachedUsers', { tag: 'discord' }],
  ['vissstick.discord.voice', 'Discord: voice verbindingen', '$.discord.voiceConnections', { tag: 'discord' }],
  ['vissstick.discord.ready_since', 'Discord: verbonden sinds', '$.discord.readySinceSeconds', { units: 's', tag: 'discord' }],
  ['vissstick.discord.disconnects', 'Discord: disconnects per minuut', '$.discord.disconnects', { kind: 'per_min', tag: 'discord' }],
  ['vissstick.discord.reconnects', 'Discord: reconnects per minuut', '$.discord.reconnects', { kind: 'per_min', tag: 'discord' }],
  ['vissstick.discord.shard_errors', 'Discord: shard errors per minuut', '$.discord.shardErrors', { kind: 'per_min', tag: 'discord' }],
  ['vissstick.discord.client_errors', 'Discord: client errors per minuut', '$.discord.clientErrors', { kind: 'per_min', tag: 'discord' }],
  ['vissstick.discord.invalidated', 'Discord: sessie ongeldig verklaard (totaal)', '$.discord.invalidated', { tag: 'discord' }],
  ['vissstick.discord.rest_rate_limits', 'Discord: REST rate limits per minuut', '$.discord.restRateLimits', { kind: 'per_min', tag: 'discord' }],
  ['vissstick.discord.messages', 'Discord: berichten ontvangen per minuut', '$.discord.messagesReceived', { kind: 'per_min', tag: 'discord' }],
  ['vissstick.discord.interactions', 'Discord: interacties per minuut', '$.discord.interactionsReceived', { kind: 'per_min', tag: 'discord' }],

  // Webserver
  ['vissstick.http.listening', 'Web: luistert', '$.http.listening', { valuemap: 'Vissstick yes/no', tag: 'web' }],
  ['vissstick.http.rps', 'Web: requests per seconde', '$.http.requestsTotal', { kind: 'per_sec', tag: 'web' }],
  ['vissstick.http.active', 'Web: lopende requests', '$.http.activeRequests', { tag: 'web' }],
  ['vissstick.http.2xx', 'Web: 2xx per seconde', '$.http.responses2xx', { kind: 'per_sec', tag: 'web' }],
  ['vissstick.http.3xx', 'Web: 3xx per seconde', '$.http.responses3xx', { kind: 'per_sec', tag: 'web' }],
  ['vissstick.http.4xx', 'Web: 4xx per minuut', '$.http.responses4xx', { kind: 'per_min', tag: 'web' }],
  ['vissstick.http.5xx', 'Web: 5xx per minuut', '$.http.responses5xx', { kind: 'per_min', tag: 'web' }],
  ['vissstick.http.429', 'Web: rate limited (429) per minuut', '$.http.rateLimited', { kind: 'per_min', tag: 'web' }],
  ['vissstick.http.aborted', 'Web: afgebroken requests per minuut', '$.http.aborted', { kind: 'per_min', tag: 'web' }],
  ['vissstick.http.latency.avg', 'Web: responstijd gemiddeld (5 min)', '$.http.latencyAvgMs', { units: 'ms', float: true, tag: 'web' }],
  ['vissstick.http.latency.p95', 'Web: responstijd p95 (5 min)', '$.http.latencyP95Ms', { units: 'ms', float: true, tag: 'web' }],
  ['vissstick.http.latency.p99', 'Web: responstijd p99 (5 min)', '$.http.latencyP99Ms', { units: 'ms', float: true, tag: 'web' }],
  ['vissstick.http.latency.max', 'Web: responstijd max (5 min)', '$.http.latencyMaxMs', { units: 'ms', float: true, tag: 'web' }],
  ['vissstick.http.sse_clients', 'Web: live verbindingen (SSE) totaal', '$.http.sseClients', { tag: 'web' }],
  ['vissstick.http.sse_limit', 'Web: live verbindingen (SSE) limiet', '$.http.sseLimit', { tag: 'web' }],
  ['vissstick.http.sse.rocket', 'Web: live verbindingen Rocket', '$.http.sseClientsByStream.rocket', { tag: 'web' }],
  ['vissstick.http.sse.blackjack', 'Web: live verbindingen Blackjack', '$.http.sseClientsByStream.blackjack', { tag: 'web' }],
  ['vissstick.http.sse.roulette', 'Web: live verbindingen Roulette', '$.http.sseClientsByStream.roulette', { tag: 'web' }],
  ['vissstick.http.sse.sterrenrad', 'Web: live verbindingen Sterrenrad', '$.http.sseClientsByStream.sterrenrad', { tag: 'web' }],
  ['vissstick.http.online_users', 'Web: spelers online', '$.http.onlineUsers', { tag: 'web' }],

  // Database
  ['vissstick.db.ok', 'Database: bereikbaar', '$.database.ok', { valuemap: 'Vissstick yes/no', tag: 'database' }],
  ['vissstick.db.latency', 'Database: query tijd', '$.database.checkLatencyMs', { units: 'ms', float: true, tag: 'database' }],
  ['vissstick.db.size', 'Database: bestandsgrootte', '$.database.sizeBytes', { units: 'B', tag: 'database' }],
  ['vissstick.db.wal_size', 'Database: WAL grootte', '$.database.walSizeBytes', { units: 'B', tag: 'database' }],
  ['vissstick.db.tables', 'Database: tabellen', '$.database.tables', { tag: 'database' }],
  ['vissstick.db.error', 'Database: laatste fout', '$.database.lastError', { kind: 'text', tag: 'database' }],

  // Back-ups (gemaakt door startscript bij elke (her)start)
  ['vissstick.backup.readable', 'Back-ups: map leesbaar', '$.backups.dirReadable', { valuemap: 'Vissstick yes/no', tag: 'backup' }],
  ['vissstick.backup.count', 'Back-ups: aantal', '$.backups.count', { tag: 'backup' }],
  ['vissstick.backup.size', 'Back-ups: totale grootte', '$.backups.totalBytes', { units: 'B', tag: 'backup' }],
  ['vissstick.backup.age', 'Back-ups: leeftijd nieuwste', '$.backups.newestAgeSeconds', { units: 's', tag: 'backup' }],

  // Hok
  ['vissstick.hok.open', 'Hok: open', '$.hok.isOpen', { valuemap: 'Vissstick yes/no', tag: 'hok' }],
  ['vissstick.hok.updated_age', 'Hok: laatste statuswijziging geleden', '$.hok.lastUpdatedAgeSeconds', { units: 's', tag: 'hok' }]
];

function preprocessingFor(jsonPath, kind) {
  const steps = [{ type: 'JSONPATH', parameters: [jsonPath] }];
  if (kind === 'per_min') steps.push({ type: 'SIMPLE_CHANGE', parameters: [''] });
  if (kind === 'per_sec') steps.push({ type: 'CHANGE_PER_SECOND', parameters: [''] });
  if (kind === 'text' || kind === 'char') steps.push({ type: 'DISCARD_UNCHANGED_HEARTBEAT', parameters: ['1h'] });
  return steps;
}

function valueTypeFor(opts) {
  if (opts.kind === 'text') return 'TEXT';
  if (opts.kind === 'char') return 'CHAR';
  if (opts.float || opts.kind === 'per_sec') return 'FLOAT';
  // Tellers kunnen -1 (onbekend) zijn, dus FLOAT i.p.v. UNSIGNED
  return 'FLOAT';
}

function dependentItem([key, name, jsonPath, opts]) {
  const item = {
    uuid: uuid(key),
    name,
    type: 'DEPENDENT',
    key,
    delay: '0',
    history: opts.kind === 'text' || opts.kind === 'char' ? '30d' : '31d',
    value_type: valueTypeFor(opts)
  };
  if (opts.kind === 'text' || opts.kind === 'char') item.trends = '0';
  if (opts.units) item.units = opts.units;
  if (opts.kind === 'per_sec' && !opts.units) item.units = 'rps';
  item.preprocessing = preprocessingFor(jsonPath, opts.kind);
  item.master_item = { key: MASTER_KEY };
  if (opts.valuemap) item.valuemap = { name: opts.valuemap };
  item.tags = [{ tag: 'component', value: opts.tag }];
  return item;
}

// ----------------------------------------------------------------------------
// Items die de agent zelf meet (rond het proces)
// ----------------------------------------------------------------------------

const agentItems = [
  {
    uuid: uuid(MASTER_KEY),
    name: 'Bot: metrics snapshot (JSON)',
    key: MASTER_KEY,
    history: '0',
    trends: '0',
    value_type: 'TEXT',
    description: 'Master item: leest http://127.0.0.1:<poort>/metrics via de UserParameter in zabbix/userparameter_vissstick.conf. Alle "Bot/Proces/Discord/Web/Database" items zijn hiervan afgeleid.',
    tags: [{ tag: 'component', value: 'raw' }]
  },
  {
    uuid: uuid(`proc.num[${BOT_PROC}]`),
    name: 'Proces: aantal bot-processen',
    key: `proc.num[${BOT_PROC}]`,
    tags: [{ tag: 'component', value: 'process' }]
  },
  {
    uuid: uuid(`proc.mem[${BOT_PROC},rss]`),
    name: 'Proces: geheugen volgens OS (RSS)',
    key: `proc.mem[node,,,bot.js,rss]`,
    units: 'B',
    tags: [{ tag: 'component', value: 'process' }]
  },
  {
    uuid: uuid(`proc.cpu.util[${BOT_PROC}]`),
    name: 'Proces: CPU volgens OS',
    key: `proc.cpu.util[${BOT_PROC}]`,
    value_type: 'FLOAT',
    units: '%',
    tags: [{ tag: 'component', value: 'process' }]
  },
  {
    uuid: uuid('net.tcp.listen[web]'),
    name: 'Web: poort {$VISSSTICK.WEB.PORT} luistert',
    key: 'net.tcp.listen[{$VISSSTICK.WEB.PORT}]',
    valuemap: { name: 'Vissstick yes/no' },
    tags: [{ tag: 'component', value: 'web' }]
  },
  {
    uuid: uuid('web.page.perf[hok]'),
    name: 'Web: laadtijd /api/public/hok/status',
    key: 'web.page.perf[127.0.0.1,/api/public/hok/status,{$VISSSTICK.WEB.PORT}]',
    value_type: 'FLOAT',
    units: 's',
    description: 'End-to-end check via de echte webserver (raakt ook de database). 0 = request mislukt.',
    tags: [{ tag: 'component', value: 'web' }]
  },
  {
    uuid: uuid('proc.num[cloudflared]'),
    name: 'Tunnel: aantal cloudflared-processen',
    key: 'proc.num[cloudflared]',
    description: 'Zet {$VISSSTICK.CLOUDFLARED.MIN} op 0 als cloudflared niet in deze LXC draait.',
    tags: [{ tag: 'component', value: 'tunnel' }]
  }
];

// ----------------------------------------------------------------------------
// Triggers
// ----------------------------------------------------------------------------

const PROC_DOWN = 'Vissstick: bot-proces draait niet';
const PROC_DOWN_EXPR = `last(${T(`proc.num[${BOT_PROC}]`)})=0`;
const NO_METRICS = 'Vissstick: geen monitoring data (bot reageert niet)';
const NO_METRICS_EXPR = `nodata(${T('vissstick.uptime')},5m)=1`;
const depOnProc = [{ name: PROC_DOWN, expression: PROC_DOWN_EXPR }];
const depOnMetrics = [{ name: NO_METRICS, expression: NO_METRICS_EXPR }];
const warm = `last(${T('vissstick.uptime')})>300`;

const triggers = [
  [PROC_DOWN_EXPR, PROC_DOWN, 'HIGH', 'Er draait geen "node bot.js" proces in deze container.'],
  [NO_METRICS_EXPR, NO_METRICS, 'HIGH', 'Het /metrics endpoint gaf 5 minuten geen antwoord. Het proces draait wel: waarschijnlijk hangt de event loop, of METRICS_ENABLED staat uit.', depOnProc],
  [`last(${T('vissstick.uptime')})<600`, 'Vissstick: bot is herstart', 'INFO', 'Uptime is minder dan 10 minuten.', null, { manual_close: true }],
  [`max(${T('vissstick.discord.ready')},5m)=0 and ${warm}`, 'Vissstick: Discord gateway niet verbonden', 'HIGH', 'De bot is al 5 minuten niet verbonden met Discord.', depOnMetrics],
  [`min(${T('vissstick.discord.ping')},10m)>{$VISSSTICK.DISCORD.PING.MAX}`, 'Vissstick: hoge Discord ping (>{$VISSSTICK.DISCORD.PING.MAX} ms)', 'WARNING', '', depOnMetrics],
  [`sum(${T('vissstick.discord.reconnects')},1h)>{$VISSSTICK.DISCORD.RECONNECTS.MAX}`, 'Vissstick: Discord gateway reconnect vaak (>{$VISSSTICK.DISCORD.RECONNECTS.MAX} per uur)', 'WARNING', ''],
  [`sum(${T('vissstick.discord.rest_rate_limits')},15m)>{$VISSSTICK.DISCORD.RATELIMITS.MAX}`, 'Vissstick: Discord REST rate limits (>{$VISSSTICK.DISCORD.RATELIMITS.MAX} per 15 min)', 'WARNING', 'De bot stuurt te veel API-verzoeken naar Discord; berichten/updates kunnen vertraagd zijn.'],
  [`last(${T('net.tcp.listen[{$VISSSTICK.WEB.PORT}]')})=0 and ${warm}`, 'Vissstick: webserver luistert niet op poort {$VISSSTICK.WEB.PORT}', 'HIGH', '', depOnProc],
  [`max(${T('web.page.perf[127.0.0.1,/api/public/hok/status,{$VISSSTICK.WEB.PORT}]')},5m)=0 or nodata(${T('web.page.perf[127.0.0.1,/api/public/hok/status,{$VISSSTICK.WEB.PORT}]')},5m)=1`, 'Vissstick: hok API geeft geen antwoord', 'AVERAGE', 'web.page.perf naar /api/public/hok/status mislukt al 5 minuten.', [{ name: `Vissstick: webserver luistert niet op poort {$VISSSTICK.WEB.PORT}`, expression: `last(${T('net.tcp.listen[{$VISSSTICK.WEB.PORT}]')})=0 and ${warm}` }]],
  [`min(${T('web.page.perf[127.0.0.1,/api/public/hok/status,{$VISSSTICK.WEB.PORT}]')},5m)>{$VISSSTICK.WEB.LOADTIME.MAX}`, 'Vissstick: hok API traag (>{$VISSSTICK.WEB.LOADTIME.MAX}s)', 'WARNING', ''],
  [`sum(${T('vissstick.http.5xx')},5m)>{$VISSSTICK.HTTP.5XX.MAX}`, 'Vissstick: webserver geeft 5xx fouten (>{$VISSSTICK.HTTP.5XX.MAX} in 5 min)', 'AVERAGE', 'Zie de route-discovery welke route het is, en "Proces: laatste foutmelding".', depOnMetrics],
  [`min(${T('vissstick.http.latency.p95')},5m)>{$VISSSTICK.HTTP.P95.MAX}`, 'Vissstick: webserver traag (p95 >{$VISSSTICK.HTTP.P95.MAX} ms)', 'WARNING', '', depOnMetrics],
  [`sum(${T('vissstick.http.429')},5m)>{$VISSSTICK.HTTP.429.MAX}`, 'Vissstick: veel rate-limited requests (>{$VISSSTICK.HTTP.429.MAX} in 5 min)', 'INFO', 'Mogelijk misbruik of een kapotte client die te vaak pollt.'],
  [`last(${T('vissstick.http.sse_clients')})>=last(${T('vissstick.http.sse_limit')})*0.9 and last(${T('vissstick.http.sse_limit')})>0`, 'Vissstick: live verbindingen bijna op limiet', 'WARNING', 'Boven de limiet krijgen nieuwe spelers 503 too_many_clients.'],
  [`min(${T('vissstick.loop.p99')},5m)>{$VISSSTICK.LOOP.P99.MAX}`, 'Vissstick: event loop geblokkeerd (p99 >{$VISSSTICK.LOOP.P99.MAX} ms)', 'WARNING', 'Alles in de bot (Discord, web, spellen) reageert dan trager.', depOnMetrics],
  [`min(${T('vissstick.rss')},15m)>{$VISSSTICK.RSS.MAX}`, 'Vissstick: hoog geheugengebruik (>{$VISSSTICK.RSS.MAX})', 'WARNING', 'Blijft dit stijgen na een herstart, dan is er waarschijnlijk een geheugenlek.', depOnMetrics],
  [`sum(${T('vissstick.errors')},10m)>{$VISSSTICK.ERRORS.MAX}`, 'Vissstick: veel fouten in de log (>{$VISSSTICK.ERRORS.MAX} in 10 min)', 'WARNING', 'Laatste fout: zie item "Proces: laatste foutmelding" of logs/bot-<datum>.log.', depOnMetrics],
  [`sum(${T('vissstick.unhandled_rejections')},1h)>0`, 'Vissstick: unhandled promise rejection', 'WARNING', 'Er is een fout niet afgevangen. Zie logs/bot-<datum>.log.', null, { manual_close: true }],
  [`max(${T('vissstick.db.ok')},3m)=0 and ${warm}`, 'Vissstick: database niet bereikbaar', 'HIGH', 'Zie item "Database: laatste fout".', depOnMetrics],
  [`min(${T('vissstick.db.latency')},5m)>{$VISSSTICK.DB.LATENCY.MAX}`, 'Vissstick: database traag (>{$VISSSTICK.DB.LATENCY.MAX} ms)', 'WARNING', ''],
  [`last(${T('vissstick.db.wal_size')})>{$VISSSTICK.DB.WAL.MAX}`, 'Vissstick: SQLite WAL bestand groot (>{$VISSSTICK.DB.WAL.MAX})', 'WARNING', 'De WAL wordt niet meer gecheckpoint; vaak een lang lopende lees-transactie.'],
  [`last(${T('vissstick.backup.age')})>{$VISSSTICK.BACKUP.AGE.MAX}`, 'Vissstick: laatste database back-up ouder dan {$VISSSTICK.BACKUP.AGE.MAX}', 'WARNING', 'startscript maakt alleen een back-up bij een (her)start van de bot.'],
  [`last(${T('vissstick.backup.readable')})=0 and ${warm}`, 'Vissstick: back-up map niet leesbaar', 'INFO', 'Controleer METRICS_BACKUP_DIR in config.json (standaard /root/discord-bot-backup).'],
  [`max(${T('vissstick.healthy')},5m)=0`, 'Vissstick: bot meldt problemen', 'INFO', 'Samenvatting van de bot zelf; zie item "Bot: problemen". Specifiekere triggers hierboven geven de details.', depOnMetrics],
  [`last(${T('proc.num[cloudflared]')})<{$VISSSTICK.CLOUDFLARED.MIN}`, 'Vissstick: cloudflared tunnel draait niet', 'HIGH', 'De casino-site is dan niet bereikbaar van buitenaf.']
];

function trigger([expression, name, priority, description, dependencies, extra = {}]) {
  const t = { uuid: uuid(`trigger:${name}`), expression, name, priority };
  if (description) t.description = description;
  if (extra.manual_close) t.manual_close = 'YES';
  if (dependencies) t.dependencies = dependencies;
  t.tags = [{ tag: 'scope', value: priority === 'HIGH' ? 'availability' : 'performance' }];
  return t;
}

// ----------------------------------------------------------------------------
// Discovery: taken en webroutes
// ----------------------------------------------------------------------------

const jobPath = (field) => `$.jobs[?(@.name=='{#JOB}')].${field}.first()`;
const routePath = (field) => `$.http.routes[?(@.route=='{#ROUTE}')].${field}.first()`;

function protoItem(key, name, jsonPath, opts) {
  const item = dependentItem([key, name, jsonPath, opts]);
  item.uuid = uuid(`proto:${key}`);
  return item;
}

const jobsDiscovery = {
  uuid: uuid('vissstick.jobs.discovery'),
  name: 'Taken discovery (cron, pollers, chatbot)',
  type: 'DEPENDENT',
  key: 'vissstick.jobs.discovery',
  delay: '0',
  lifetime: '7d',
  description: 'Elke periodieke taak in de bot: quiz, rekensom, spin-meldingen, hok-sync, rooster-check, pauze-meldingen, maandreset, chatbot, ...',
  item_prototypes: [
    protoItem('vissstick.job.consecutive_failures[{#JOB}]', 'Taak {#JOB}: mislukt op rij', jobPath('consecutiveFailures'), { tag: 'jobs' }),
    protoItem('vissstick.job.failures[{#JOB}]', 'Taak {#JOB}: mislukte runs per minuut', jobPath('failures'), { kind: 'per_min', tag: 'jobs' }),
    protoItem('vissstick.job.runs[{#JOB}]', 'Taak {#JOB}: runs per minuut', jobPath('runs'), { kind: 'per_min', tag: 'jobs' }),
    protoItem('vissstick.job.last_success[{#JOB}]', 'Taak {#JOB}: laatste succes geleden', jobPath('lastSuccessAgeSeconds'), { units: 's', tag: 'jobs' }),
    protoItem('vissstick.job.duration[{#JOB}]', 'Taak {#JOB}: duur laatste run', jobPath('lastDurationMs'), { units: 'ms', tag: 'jobs' }),
    protoItem('vissstick.job.stale[{#JOB}]', 'Taak {#JOB}: te lang niet geslaagd', jobPath('stale'), { valuemap: 'Vissstick yes/no', tag: 'jobs' }),
    protoItem('vissstick.job.last_error[{#JOB}]', 'Taak {#JOB}: laatste fout', jobPath('lastError'), { kind: 'text', tag: 'jobs' })
  ],
  trigger_prototypes: [
    {
      uuid: uuid('proto-trigger:job-fails'),
      expression: `last(${T('vissstick.job.consecutive_failures[{#JOB}]')})>={$VISSSTICK.JOB.FAILS.MAX:"{#JOB}"}`,
      name: 'Vissstick: taak {#JOB} mislukt {ITEM.LASTVALUE1}x op rij',
      opdata: '{ITEM.LASTVALUE1}',
      priority: 'AVERAGE',
      description: 'Zie item "Taak {#JOB}: laatste fout".',
      tags: [{ tag: 'scope', value: 'jobs' }]
    },
    {
      uuid: uuid('proto-trigger:job-stale'),
      expression: `last(${T('vissstick.job.stale[{#JOB}]')})=1`,
      name: 'Vissstick: taak {#JOB} draait niet meer (te lang geen succes)',
      priority: 'AVERAGE',
      description: 'De taak is langer dan zijn maximale stilte (maxSilenceSeconds) niet geslaagd.',
      tags: [{ tag: 'scope', value: 'jobs' }]
    }
  ],
  master_item: { key: MASTER_KEY },
  lld_macro_paths: [{ lld_macro: '{#JOB}', path: '$.name' }],
  preprocessing: [{ type: 'JSONPATH', parameters: ['$.jobs'] }]
};

const routesDiscovery = {
  uuid: uuid('vissstick.routes.discovery'),
  name: 'Webroutes discovery',
  type: 'DEPENDENT',
  key: 'vissstick.routes.discovery',
  delay: '0',
  lifetime: '7d',
  description: 'Routegroepen van de webserver: page, static, sse, hok_api, api_<spel>, other.',
  item_prototypes: [
    protoItem('vissstick.route.rps[{#ROUTE}]', 'Route {#ROUTE}: requests per seconde', routePath('requests'), { kind: 'per_sec', tag: 'web' }),
    protoItem('vissstick.route.4xx[{#ROUTE}]', 'Route {#ROUTE}: 4xx per minuut', routePath('errors4xx'), { kind: 'per_min', tag: 'web' }),
    protoItem('vissstick.route.5xx[{#ROUTE}]', 'Route {#ROUTE}: 5xx per minuut', routePath('errors5xx'), { kind: 'per_min', tag: 'web' }),
    protoItem('vissstick.route.latency[{#ROUTE}]', 'Route {#ROUTE}: gemiddelde responstijd (sinds start)', routePath('avgLatencyMs'), { units: 'ms', float: true, tag: 'web' })
  ],
  trigger_prototypes: [
    {
      uuid: uuid('proto-trigger:route-5xx'),
      expression: `sum(${T('vissstick.route.5xx[{#ROUTE}]')},5m)>{$VISSSTICK.HTTP.5XX.MAX}`,
      name: 'Vissstick: route {#ROUTE} geeft 5xx fouten',
      priority: 'WARNING',
      tags: [{ tag: 'scope', value: 'performance' }]
    }
  ],
  master_item: { key: MASTER_KEY },
  lld_macro_paths: [{ lld_macro: '{#ROUTE}', path: '$.route' }],
  preprocessing: [{ type: 'JSONPATH', parameters: ['$.http.routes'] }]
};

// ----------------------------------------------------------------------------
// Macros, value maps, grafieken
// ----------------------------------------------------------------------------

const macros = [
  ['{$VISSSTICK.METRICS.PORT}', '9464', 'METRICS_PORT van de bot'],
  ['{$VISSSTICK.WEB.PORT}', '3000', 'PUBLIC_API_PORT van de bot'],
  ['{$VISSSTICK.CLOUDFLARED.MIN}', '1', 'Minimaal aantal cloudflared processen; 0 als de tunnel elders draait'],
  ['{$VISSSTICK.DISCORD.PING.MAX}', '500', 'ms'],
  ['{$VISSSTICK.DISCORD.RECONNECTS.MAX}', '5', 'per uur'],
  ['{$VISSSTICK.DISCORD.RATELIMITS.MAX}', '10', 'per 15 minuten'],
  ['{$VISSSTICK.WEB.LOADTIME.MAX}', '2', 'seconden'],
  ['{$VISSSTICK.HTTP.5XX.MAX}', '5', 'per 5 minuten'],
  ['{$VISSSTICK.HTTP.429.MAX}', '100', 'per 5 minuten'],
  ['{$VISSSTICK.HTTP.P95.MAX}', '500', 'ms (exclusief SSE)'],
  ['{$VISSSTICK.LOOP.P99.MAX}', '200', 'ms'],
  ['{$VISSSTICK.RSS.MAX}', '1G', 'bytes'],
  ['{$VISSSTICK.ERRORS.MAX}', '20', 'per 10 minuten'],
  ['{$VISSSTICK.DB.LATENCY.MAX}', '100', 'ms'],
  ['{$VISSSTICK.DB.WAL.MAX}', '100M', 'bytes'],
  ['{$VISSSTICK.BACKUP.AGE.MAX}', '14d', ''],
  ['{$VISSSTICK.JOB.FAILS.MAX}', '3', 'Aantal keer op rij mislukt voor een alarm (per taak te overschrijven met context)'],
  // Taken die maar één keer per dag/maand draaien: één mislukking is al een probleem
  ...['quiz_start', 'quiz_end', 'spin_reminders', 'math_schedule', 'math_close', 'monthly_reset', 'register_commands']
    .map((job) => [`{$VISSSTICK.JOB.FAILS.MAX:"${job}"}`, '1', 'Draait één keer per dag/maand/start'])
].map(([macro, value, description]) => (description ? { macro, value, description } : { macro, value }));

const valuemaps = [
  {
    uuid: uuid('valuemap:discord'),
    name: 'Discord gateway status',
    mappings: [
      ['-1', 'Onbekend'], ['0', 'Ready'], ['1', 'Connecting'], ['2', 'Reconnecting'], ['3', 'Idle'],
      ['4', 'Nearly'], ['5', 'Disconnected'], ['6', 'WaitingForGuilds'], ['7', 'Identifying'], ['8', 'Resuming']
    ].map(([value, newvalue]) => ({ value, newvalue }))
  },
  {
    uuid: uuid('valuemap:healthy'),
    name: 'Vissstick healthy',
    mappings: [{ value: '0', newvalue: 'Problemen' }, { value: '1', newvalue: 'OK' }]
  },
  {
    uuid: uuid('valuemap:yesno'),
    name: 'Vissstick yes/no',
    mappings: [{ value: '-1', newvalue: 'Onbekend' }, { value: '0', newvalue: 'Nee' }, { value: '1', newvalue: 'Ja' }]
  }
];

const COLORS = ['1A7C11', 'F63100', '2774A4', 'A54F10', 'FC6EA3', '6C59DC'];
function graph(name, keys) {
  return {
    uuid: uuid(`graph:${name}`),
    name,
    graph_items: keys.map((key, index) => ({
      sortorder: String(index),
      color: COLORS[index % COLORS.length],
      item: { host: TEMPLATE, key }
    }))
  };
}

const graphs = [
  graph('Vissstick: geheugen', ['vissstick.rss', 'vissstick.heap_used', 'vissstick.heap_total', 'vissstick.external']),
  graph('Vissstick: event loop lag', ['vissstick.loop.mean', 'vissstick.loop.p99', 'vissstick.loop.max']),
  graph('Vissstick: CPU', ['vissstick.cpu_user', 'vissstick.cpu_system']),
  graph('Vissstick: webverkeer', ['vissstick.http.rps', 'vissstick.http.2xx', 'vissstick.http.3xx']),
  graph('Vissstick: webfouten', ['vissstick.http.4xx', 'vissstick.http.5xx', 'vissstick.http.429', 'vissstick.http.aborted']),
  graph('Vissstick: responstijd', ['vissstick.http.latency.avg', 'vissstick.http.latency.p95', 'vissstick.http.latency.p99']),
  graph('Vissstick: live spelers', ['vissstick.http.online_users', 'vissstick.http.sse.rocket', 'vissstick.http.sse.blackjack', 'vissstick.http.sse.roulette', 'vissstick.http.sse.sterrenrad']),
  graph('Vissstick: Discord', ['vissstick.discord.ping', 'vissstick.discord.messages', 'vissstick.discord.interactions']),
  graph('Vissstick: database', ['vissstick.db.size', 'vissstick.db.wal_size'])
];

// ----------------------------------------------------------------------------
// YAML
// ----------------------------------------------------------------------------

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function toYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (entry !== null && typeof entry === 'object') {
        const body = toYaml(entry, indent + 2).replace(/^\s+/, '');
        return `${pad}- ${body}`;
      }
      return `${pad}- ${quote(entry)}\n`;
    }).join('');
  }
  return Object.entries(value).map(([key, entry]) => {
    if (entry !== null && typeof entry === 'object') {
      return `${pad}${key}:\n${toYaml(entry, indent + 2)}`;
    }
    return `${pad}${key}: ${quote(entry)}\n`;
  }).join('');
}

const exportDoc = {
  zabbix_export: {
    version: '6.0',
    groups: [{ uuid: uuid(`group:${GROUP}`), name: GROUP }],
    templates: [{
      uuid: uuid(`template:${TEMPLATE}`),
      template: TEMPLATE,
      name: TEMPLATE,
      description: 'White-box monitoring van de Vissstick Discord bot (proces, Discord gateway, webserver/casino, SQLite, back-ups en alle periodieke taken). Vereist zabbix/userparameter_vissstick.conf op de agent. Gegenereerd door zabbix/generate-template.js.',
      groups: [{ name: GROUP }],
      items: [...agentItems, ...dependent.map(dependentItem)],
      discovery_rules: [jobsDiscovery, routesDiscovery],
      tags: [{ tag: 'class', value: 'application' }, { tag: 'target', value: 'vissstick' }],
      macros,
      valuemaps
    }],
    triggers: triggers.map(trigger),
    graphs
  }
};

const header = '# Gegenereerd door zabbix/generate-template.js — pas dat script aan, niet dit bestand.\n';
fs.writeFileSync(OUT, header + toYaml(exportDoc));
console.log(`Geschreven: ${path.relative(process.cwd(), OUT)}`);
