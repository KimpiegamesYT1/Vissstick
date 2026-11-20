/**
 * Verbindingsbewaking voor de casino-pagina's (Rocket, Blackjack, Plinko, Slots, Roulette, Sterrenrad, Routegok, Daily spin).
 *
 * Als de server even weg is (bot herstart, internet weg, proxy geeft 502/503/504) verschijnt er een popup die
 * zelf opnieuw verbinding probeert te maken. Is de server terug, dan wordt de pagina herladen zodat alles
 * (saldo, lopende rondes) weer klopt met de server.
 *
 * Bouwt ook de navigatie op (Casino-menu met alle spellen, incl. Fuiken, + Daily spin + Keys + Afwassen + Stats), zie GAMES hieronder.
 *
 * Daarnaast regelt dit script de "Afwassen" knop in de navigatie: die is verborgen, behalve als je
 * minder dan 50 punten hebt. Het saldo komt uit /api/me en uit elke actie die een saldo teruggeeft.
 *
 * Werkt door fetch en EventSource te omwikkelen, dus de pagina's zelf hoeven niets te doen: dit script moet
 * alleen vóór het eigen script van de pagina geladen worden.
 *
 * Toont daarnaast in de menubalk hoeveel ingelogde spelers er nu actief zijn (met hun profielfoto's en saldo).
 * Alleen een zichtbaar tabblad meldt zich als actief, dus wie wegklikt verdwijnt vanzelf uit de lijst.
 *
 * Rechtsonder zit op elke pagina een kleine chat (zie CHAT hieronder): doorzichtig in rust, volgt de kleuren van de pagina.
 *
 * Daarnaast krijgen Firefox-gebruikers max. 1x per week een melding linksonder dat een Chromium-browser beter presteert.
 */
(() => {
  'use strict';

  const PROBE_URL = '/api/me';
  const OUTSIDE_URL = 'https://www.gstatic.com/generate_204';  // om te zien of het aan jouw internet ligt
  const BLIP_PROBES = 3;          // zo vaak controleren we een haperende verbinding voor we een melding tonen
  const BLIP_GAP_MS = 1200;
  const RETRY_RESTART_MS = 1000;  // bot herstart: elke seconde proberen
  const RETRY_OFFLINE_MS = 3000;  // geen internet: elke 3 seconden
  const HEARTBEAT_MS = 15000;
  // 5xx van de server/proxy/Cloudflare betekent: de bot is er niet (herstart). Meteen melden, geen wachttijd.
  const DOWN_STATUS = new Set([502, 503, 504, 521, 522, 523, 524, 530]);

  const nativeFetch = window.fetch.bind(window);
  let down = false;
  let kind = 'restart';           // 'restart' = server herstart, 'offline' = jij hebt geen internet
  let checking = false;
  let attempts = 0;
  let retryTimer = null;
  let countdownTimer = null;
  let nextRetryAt = 0;
  let ui = null;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // =====================================================
  // CONTROLEREN
  // =====================================================
  // 'ok' | 'restart' (server geeft aan er niet te zijn) | 'fail' (helemaal geen antwoord)
  async function probe() {
    try {
      const res = await nativeFetch(`${PROBE_URL}?t=${Date.now()}`, { credentials: 'same-origin', cache: 'no-store' });
      return res.status < 500 ? 'ok' : 'restart';
    } catch (error) {
      return 'fail';
    }
  }

  async function internetReachable() {
    if (navigator.onLine === false) return false;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      await nativeFetch(`${OUTSIDE_URL}?t=${Date.now()}`, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
      clearTimeout(timer);
      return true;
    } catch (error) {
      return false;
    }
  }

  // null = alles goed, anders de soort storing. Een herstart wordt meteen herkend,
  // een haperende verbinding krijgt een paar kansen om vanzelf te herstellen.
  async function diagnose() {
    let result = await probe();
    for (let i = 1; result === 'fail' && i < BLIP_PROBES; i++) {
      await sleep(BLIP_GAP_MS);
      result = await probe();
    }
    if (result === 'ok') return null;
    if (result === 'restart') return 'restart';
    return (await internetReachable()) ? 'restart' : 'offline';
  }

  async function suspect() {
    if (down || checking) return;
    checking = true;
    const found = await diagnose();
    checking = false;
    if (found) goDown(found);
  }

  function goDown(why) {
    if (down) {
      if (why && why !== kind) { kind = why; render(); }
      return;
    }
    down = true;
    kind = why || 'restart';
    attempts = 0;
    show();
    scheduleRetry(retryDelay());
  }

  function retryDelay() {
    return kind === 'offline' ? RETRY_OFFLINE_MS : RETRY_RESTART_MS;
  }

  function scheduleRetry(ms) {
    clearTimeout(retryTimer);
    nextRetryAt = Date.now() + ms;
    retryTimer = setTimeout(retry, ms);
    tickCountdown();
  }

  async function retry() {
    clearTimeout(retryTimer);
    attempts++;
    setStatus('Verbinden…', true);
    const result = await probe();
    if (result === 'ok') {
      recovered();
      return;
    }
    if (result === 'fail') kind = (await internetReachable()) ? 'restart' : 'offline';
    else kind = 'restart';
    render();
    scheduleRetry(retryDelay());
  }

  function recovered() {
    clearTimeout(retryTimer);
    clearInterval(countdownTimer);
    ui.box.classList.add('ok');
    ui.title.textContent = 'Weer verbonden!';
    ui.text.textContent = 'De pagina wordt opnieuw geladen…';
    setStatus('', false);
    ui.button.hidden = true;
    setTimeout(() => location.reload(), 900);
  }

  // =====================================================
  // FETCH + EVENTSOURCE OMWIKKELEN
  // =====================================================
  window.fetch = async function (...args) {
    try {
      const res = await nativeFetch(...args);
      if (DOWN_STATUS.has(res.status)) suspect();
      else watchBalance(args, res);
      return res;
    } catch (error) {
      // Afgebroken verzoeken (bijv. bij wegnavigeren) zijn geen storing
      if (!(error && error.name === 'AbortError')) suspect();
      throw error;
    }
  };

  if (window.EventSource) {
    const NativeEventSource = window.EventSource;
    class WatchedEventSource extends NativeEventSource {
      constructor(url, options) {
        super(url, options);
        // De server meldt zelf dat hij herstart: dan hoeft er niets meer gecontroleerd te worden
        this.addEventListener('restart', () => goDown('restart'));
        // Verbinding weg: meteen controleren. Een herstart wordt direct gemeld, een hapering krijgt een paar kansen.
        this.addEventListener('error', () => {
          if (this.readyState !== NativeEventSource.OPEN) suspect();
        });
      }
    }
    window.EventSource = WatchedEventSource;
  }

  // Lichte live-verbinding op élke pagina: de server meldt hiermee een herstart (ook voor pagina's zonder eigen stream).
  // Krijgen we na een verbinding een andere bootId, dan is de bot tussendoor herstart (ook als dat heel kort duurde).
  let liveSource = null;
  if (window.EventSource) {
    let bootId = null;
    const live = new window.EventSource('/api/live');
    liveSource = live;
    live.addEventListener('message', event => {
      let boot = null;
      try { boot = JSON.parse(event.data).boot; } catch (error) { return; }
      if (!boot) return;
      if (bootId && boot !== bootId) {
        goDown('restart');
        retry();
      }
      bootId = boot;
    });
  }

  // Pagina's zonder live-verbinding merken een storing anders pas bij de volgende klik
  setInterval(() => {
    if (!down && !checking && !document.hidden) suspect();
  }, HEARTBEAT_MS);

  window.addEventListener('offline', () => suspect());
  window.addEventListener('online', () => { if (down) retry(); });

  // =====================================================
  // ONLINE SPELERS IN DE MENUBALK
  // =====================================================
  const ONLINE_URL = '/api/online';
  const ONLINE_POLL_MS = 15000;
  const ONLINE_AVATARS = 4;
  const ONLINE_CSS = `
    .vso { position: relative; pointer-events: auto; font-family: inherit; }
    .vso[hidden] { display: none; }
    .vso-btn { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px 0 6px; border-radius: 999px; cursor: pointer;
      background: var(--panel, #16181b); border: 1px solid var(--line, rgba(255,255,255,.07)); color: var(--text, #eceae6);
      font: inherit; font-size: 13px; font-weight: 700; }
    .vso-btn:hover { background: var(--raise, #262a2f); }
    .vso-stack { display: flex; }
    .vso-av { width: 26px; height: 26px; border-radius: 50%; object-fit: cover; flex: none; background: var(--raise, #262a2f);
      border: 2px solid var(--panel, #16181b); display: grid; place-items: center; font-size: 11px; font-weight: 800; color: var(--muted, #8d9299); }
    .vso-stack .vso-av + .vso-av { margin-left: -9px; }
    .vso-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green, #4cd47b); box-shadow: 0 0 0 3px rgba(76,212,123,.18); flex: none; }
    .vso-stack:empty + .vso-dot { margin-left: 6px; }
    .vso-count { font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; max-width: 90px;
      transition: max-width .35s ease, opacity .25s ease, margin .35s ease; }
    .vso-btn { transition: padding .35s ease, gap .35s ease; }
    .vso.collapsed:not(:hover) .vso-btn { padding-right: 8px; gap: 6px; }
    .vso.collapsed:not(:hover) .vso-count { max-width: 0; opacity: 0; margin-left: -6px; }
    .vso-pop { position: absolute; top: calc(100% + 8px); right: 0; z-index: 50; min-width: 200px; max-width: 260px; max-height: 320px; overflow: auto;
      background: var(--side, #1b1d21); border: 1px solid var(--line, rgba(255,255,255,.07)); border-radius: 12px; padding: 6px;
      box-shadow: 0 16px 40px rgba(0,0,0,.5); }
    .vso-pop[hidden] { display: none; }
    .vso-pop h3 { margin: 4px 8px 6px; font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted, #8d9299); }
    .vso-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; font-size: 14px; font-weight: 600; color: var(--text, #eceae6); }
    .vso-row .vso-av { border: 0; width: 28px; height: 28px; }
    a.vso-row { text-decoration: none; cursor: pointer; }
    a.vso-row:hover { background: var(--raise, #262a2f); }
    .vso-info { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
    .vso-info span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vso-game { font-size: 12px; font-weight: 600; color: var(--muted, #8d9299); }
    a.vso-row .vso-game { color: var(--green, #4cd47b); }
    .vso-bal { margin-left: auto; padding-left: 8px; flex: none; font-size: 12px; font-weight: 800; color: var(--gold, #f2c14e);
      font-variant-numeric: tabular-nums; white-space: nowrap; }
    .vso-more { padding: 6px 8px; font-size: 12px; color: var(--muted, #8d9299); }
    @media (max-width: 640px) {
      .vso { margin-left: auto; }
      .vso + .user { margin-left: 0 !important; }
      .vso-btn { padding: 0 10px 0 4px; gap: 6px; }
      .vso-stack .vso-av:nth-child(n+3) { display: none; }
      .vso-label { display: none; }
    }
  `;
  let onlineUi = null;
  let onlineTimer = null;
  const ONLINE_COLLAPSE_MS = 3000; // daarna klapt de tekst in en blijven alleen de foto's staan (hover toont hem weer)

  function avatarEl(user) {
    if (user.avatar) {
      const img = document.createElement('img');
      img.className = 'vso-av';
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.src = user.avatar;
      return img;
    }
    const span = document.createElement('span');
    span.className = 'vso-av';
    span.textContent = (user.username || '?').charAt(0).toUpperCase();
    return span;
  }

  function buildOnline() {
    const header = document.querySelector('header');
    if (!header) return null;
    const style = document.createElement('style');
    style.textContent = ONLINE_CSS;
    document.head.append(style);
    const root = document.createElement('div');
    root.className = 'vso';
    root.hidden = true;
    root.innerHTML = `
      <button class="vso-btn" type="button" aria-haspopup="true" aria-expanded="false">
        <span class="vso-stack"></span><span class="vso-dot" aria-hidden="true"></span>
        <span class="vso-count"></span>
      </button>
      <div class="vso-pop" hidden><h3></h3><div class="vso-list"></div></div>`;
    const user = header.querySelector('#user');
    if (user) header.insertBefore(root, user); else header.append(root);
    setTimeout(() => root.classList.add('collapsed'), ONLINE_COLLAPSE_MS);
    const ui = {
      root,
      button: root.querySelector('.vso-btn'),
      stack: root.querySelector('.vso-stack'),
      count: root.querySelector('.vso-count'),
      pop: root.querySelector('.vso-pop'),
      list: root.querySelector('.vso-list')
    };
    const setOpen = open => {
      ui.pop.hidden = !open;
      ui.button.setAttribute('aria-expanded', String(open));
    };
    ui.button.addEventListener('click', event => {
      event.stopPropagation();
      setOpen(ui.pop.hidden);
    });
    document.addEventListener('click', event => { if (!root.contains(event.target)) setOpen(false); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') setOpen(false); });
    return ui;
  }

  function renderOnline(data) {
    if (!onlineUi) onlineUi = buildOnline();
    if (!onlineUi) return;
    const users = Array.isArray(data.users) ? data.users : [];
    const count = Number(data.count) || 0;
    onlineUi.root.hidden = count === 0;
    onlineUi.stack.replaceChildren(...users.slice(0, ONLINE_AVATARS).map(avatarEl));
    onlineUi.count.innerHTML = '';
    onlineUi.count.append(String(count));
    const label = document.createElement('span');
    label.className = 'vso-label';
    label.textContent = ' online';
    onlineUi.count.append(label);
    onlineUi.button.title = `${count} ${count === 1 ? 'speler' : 'spelers'} online`;
    onlineUi.pop.querySelector('h3').textContent = `Nu online · ${count}`;
    onlineUi.list.replaceChildren(...users.map(user => {
      // Met een bekend spel wordt de rij een link naar dat spel
      const game = user.game && typeof user.game.path === 'string' && user.game.path.startsWith('/') ? user.game : null;
      const row = document.createElement(game ? 'a' : 'div');
      row.className = 'vso-row';
      if (game) {
        row.href = game.path;
        row.title = `Naar ${game.name}`;
      }
      const info = document.createElement('div');
      info.className = 'vso-info';
      const name = document.createElement('span');
      name.textContent = user.username;
      info.append(name);
      if (game) {
        const where = document.createElement('span');
        where.className = 'vso-game';
        where.textContent = game.name;
        info.append(where);
      }
      row.append(avatarEl(user), info);
      if (Number.isFinite(user.balance)) {
        const bal = document.createElement('span');
        bal.className = 'vso-bal';
        bal.textContent = `${user.balance.toLocaleString('nl-NL')} pt`;
        bal.title = `${user.balance.toLocaleString('nl-NL')} punten`;
        row.append(bal);
      }
      return row;
    }));
    if (count > users.length) {
      const more = document.createElement('div');
      more.className = 'vso-more';
      more.textContent = `+ ${count - users.length} meer`;
      onlineUi.list.append(more);
    }
  }

  async function pollOnline() {
    clearTimeout(onlineTimer);
    // Een verborgen tabblad telt niet als actief en hoeft ook niets op te halen
    if (!document.hidden && !down) {
      try {
        const res = await nativeFetch(`${ONLINE_URL}?active=1&page=${encodeURIComponent(location.pathname)}&t=${Date.now()}`, { credentials: 'same-origin', cache: 'no-store' });
        if (res.ok) renderOnline(await res.json());
      } catch (error) {
        // Storingen worden al door de verbindingsbewaking afgehandeld
      }
    }
    onlineTimer = setTimeout(pollOnline, ONLINE_POLL_MS);
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollOnline(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pollOnline);
  else pollOnline();

  // =====================================================
  // NAVIGATIE (één keer opgebouwd voor alle pagina's)
  // =====================================================
  // Nieuwe game? Voeg hem hier toe (plus een tekening in GAME_ART), de pagina's hoeven niets te doen.
  const GAMES = [
    { key: 'rocket', name: 'Rocket', desc: 'Cash out voordat de raket ontploft', live: true },
    { key: 'blackjack', name: 'Blackjack', desc: 'Versla de dealer zonder over de 21 te gaan', live: true },
    { key: 'plinko', name: 'Plinko', desc: 'Laat ballen vallen en jaag op de randen' },
    { key: 'slots', name: 'Slots', desc: 'Draai de rollen en mik op drie op een rij' },
    { key: 'roulette', name: 'Roulette', desc: 'Europese roulette: zet in op je geluksgetal', live: true },
    { key: 'sterrenrad', name: 'Sterrenrad', desc: 'Gameshow in de ruimte met vier bonusspellen', live: true },
    { key: 'routegok', name: 'Routegok', desc: 'Raad de reistijd van een route ergens op aarde', live: true },
    { key: 'fuik', name: 'Fuiken', desc: 'Zet je fuiken uit en haal elk kwartier je vangst op' }
  ];
  const NAV_LINKS = [
    { key: 'spin', name: 'Daily spin' },
    { key: 'keys', name: 'Keys' },
    { key: 'afwas', name: 'Afwassen', cls: 'wash-link locked' },
    { key: 'stats', name: 'Stats' }
  ];

  const r2 = n => Math.round(n * 100) / 100;

  // Spade/hart rond (0,0), ongeveer 14 breed
  const HEART = 'M0 5C-8-1-7-7-3.5-7C-1.5-7 0-5.5 0-4.5C0-5.5 1.5-7 3.5-7C7-7 8-1 0 5Z';
  const SPADE = 'M0-6C-8 0-7 6-3.5 6C-1.5 6 0 4.5 0 3.5C0 4.5 1.5 6 3.5 6C7 6 8 0 0-6ZM0 3L-2.6 9H2.6Z';

  function rocketArt() {
    const stars = [[14, 12], [38, 8], [62, 18], [90, 10], [140, 14], [150, 44], [28, 36], [70, 40], [132, 66], [104, 58]]
      .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 0.8 : 1.3}" fill="#fff" opacity="${i % 2 ? 0.45 : 0.8}"/>`).join('');
    return `<svg viewBox="0 0 160 90" aria-hidden="true"><defs>
      <linearGradient id="vn-rk-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26306a"/><stop offset="1" stop-color="#0c1022"/></linearGradient>
      <linearGradient id="vn-rk-ln" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f2c14e" stop-opacity=".1"/><stop offset="1" stop-color="#f2c14e"/></linearGradient>
      <radialGradient id="vn-rk-gl" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff8a3d" stop-opacity=".55"/><stop offset="1" stop-color="#ff8a3d" stop-opacity="0"/></radialGradient></defs>
      <rect width="160" height="90" fill="url(#vn-rk-bg)"/>${stars}
      <path d="M0 70H160M0 50H160M0 30H160" stroke="#fff" stroke-opacity=".05"/>
      <path d="M8 84Q78 82 116 36" fill="none" stroke="url(#vn-rk-ln)" stroke-width="3" stroke-linecap="round"/>
      <circle cx="116" cy="38" r="16" fill="url(#vn-rk-gl)"/>
      <g transform="translate(106 12) scale(.95) rotate(45 20 20)">
        <path d="M16.6 28.6h6.8L20 38z" fill="#ff7a2f"/><path d="M18.2 28.6h3.6L20 34z" fill="#ffd36b"/>
        <path d="M20 5.5c4.2 3.6 5.8 8.8 5.8 14v8H14.2v-8c0-5.2 1.6-10.4 5.8-14z" fill="#eceae6"/>
        <path d="M14.2 20.5l-4.2 5.6v3.4l4.2-2.4zM25.8 20.5l4.2 5.6v3.4l-4.2-2.4z" fill="#ef5b4c"/>
        <circle cx="20" cy="16.5" r="2.7" fill="#4fa3ff"/>
      </g>
      <text x="12" y="76" font-family="system-ui,sans-serif" font-size="15" font-weight="800" fill="#f2c14e">2.47×</text>
    </svg>`;
  }

  function blackjackArt() {
    const card = (x, y, rot, letter, suit, color) => `<g transform="rotate(${rot} ${x + 19} ${y + 26})">
      <rect x="${x}" y="${y}" width="38" height="52" rx="5" fill="#f7f4ec" stroke="#000" stroke-opacity=".15"/>
      <text x="${x + 5}" y="${y + 13}" font-family="system-ui,sans-serif" font-size="11" font-weight="800" fill="${color}">${letter}</text>
      <path d="${suit}" fill="${color}" transform="translate(${x + 19} ${y + 29}) scale(1.25)"/></g>`;
    const chip = (cx, cy, color) => `<ellipse cx="${cx}" cy="${cy + 2}" rx="12" ry="4.5" fill="#000" opacity=".3"/>
      <ellipse cx="${cx}" cy="${cy}" rx="12" ry="4.5" fill="${color}"/>
      <ellipse cx="${cx}" cy="${cy}" rx="12" ry="4.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="3 3.3"/>
      <ellipse cx="${cx}" cy="${cy}" rx="6" ry="2.2" fill="none" stroke="#fff" stroke-opacity=".6"/>`;
    return `<svg viewBox="0 0 160 90" aria-hidden="true"><defs>
      <radialGradient id="vn-bj-bg" cx=".5" cy=".2" r=".9"><stop offset="0" stop-color="#2a8a58"/><stop offset="1" stop-color="#0d3a24"/></radialGradient></defs>
      <rect width="160" height="90" fill="url(#vn-bj-bg)"/>
      <path d="M-10 100A92 64 0 0 1 170 100" fill="none" stroke="#f2c14e" stroke-opacity=".35" stroke-width="1.2"/>
      <path d="M-10 108A92 64 0 0 1 170 108" fill="none" stroke="#f2c14e" stroke-opacity=".2" stroke-width="1.2"/>
      ${card(42, 16, -13, 'A', SPADE, '#16181b')}${card(74, 14, 10, 'K', HEART, '#d0342c')}
      ${chip(132, 78, '#16181b')}${chip(132, 72, '#ef5b4c')}${chip(132, 66, '#2f6fd4')}
      <text x="12" y="80" font-family="system-ui,sans-serif" font-size="15" font-weight="800" fill="#f2c14e">21</text>
    </svg>`;
  }

  function plinkoArt() {
    let pegs = '';
    for (let row = 0; row < 6; row++) {
      for (let i = 0; i <= row + 2; i++) {
        pegs += `<circle cx="${r2(80 + (i - (row + 2) / 2) * 15)}" cy="${r2(12 + row * 10.5)}" r="1.9" fill="#fff" opacity=".8"/>`;
      }
    }
    const colors = ['#ef5b4c', '#f28a4e', '#f2c14e', '#4cd47b', '#f2c14e', '#f28a4e', '#ef5b4c'];
    const slots = colors.map((c, i) => `<rect x="${28.5 + i * 15}" y="77" width="13" height="9" rx="2.5" fill="${c}"/>`).join('');
    return `<svg viewBox="0 0 160 90" aria-hidden="true"><defs>
      <linearGradient id="vn-pl-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d2475"/><stop offset="1" stop-color="#160d2c"/></linearGradient>
      <radialGradient id="vn-pl-gl" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff5fa2" stop-opacity=".6"/><stop offset="1" stop-color="#ff5fa2" stop-opacity="0"/></radialGradient></defs>
      <rect width="160" height="90" fill="url(#vn-pl-bg)"/>${pegs}${slots}
      <path d="M80 0Q80 8 76 14T84 26T88 40" fill="none" stroke="#ff5fa2" stroke-opacity=".5" stroke-width="1.4" stroke-dasharray="2 3" stroke-linecap="round"/>
      <circle cx="88" cy="42" r="9" fill="url(#vn-pl-gl)"/>
      <circle cx="88" cy="42" r="3.6" fill="#ff5fa2"/><circle cx="86.9" cy="40.8" r="1.2" fill="#fff" opacity=".8"/>
    </svg>`;
  }

  function slotsArt() {
    const reels = [0, 1, 2].map(i => {
      const x = 39 + i * 28;
      return `<rect x="${x}" y="26" width="25" height="36" rx="4" fill="url(#vn-sl-reel)"/>
        <text x="${x + 12.5}" y="52" text-anchor="middle" font-family="system-ui,sans-serif" font-size="22" font-weight="900" fill="#d0342c">7</text>`;
    }).join('');
    const bulbs = Array.from({ length: 9 }, (_, i) => `<circle cx="${40 + i * 10}" cy="19" r="1.7" fill="${i % 2 ? '#fff6d2' : '#ffb347'}"/>`).join('');
    return `<svg viewBox="0 0 160 90" aria-hidden="true"><defs>
      <radialGradient id="vn-sl-bg" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="#7a1e33"/><stop offset="1" stop-color="#22080f"/></radialGradient>
      <linearGradient id="vn-sl-fr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd977"/><stop offset="1" stop-color="#c9902a"/></linearGradient>
      <linearGradient id="vn-sl-reel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfcac0"/><stop offset=".3" stop-color="#fbf8f1"/><stop offset=".7" stop-color="#fbf8f1"/><stop offset="1" stop-color="#cfcac0"/></linearGradient></defs>
      <rect width="160" height="90" fill="url(#vn-sl-bg)"/>
      <path d="M140 46V24" stroke="#9aa0a8" stroke-width="3" stroke-linecap="round"/><circle cx="140" cy="21" r="4.5" fill="#ef5b4c"/>
      <rect x="30" y="12" width="104" height="60" rx="11" fill="url(#vn-sl-fr)"/>
      <rect x="35" y="22" width="94" height="44" rx="7" fill="#16181b"/>${bulbs}${reels}
      <path d="M36 44H128" stroke="#ef5b4c" stroke-width="1.2" stroke-opacity=".7"/>
      <rect x="56" y="74" width="52" height="8" rx="4" fill="#16181b" stroke="#c9902a"/>
    </svg>`;
  }

  function rouletteArt() {
    const cx = 80, cy = 46, r = 32, n = 19;
    let seg = '';
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((k + 1) / n) * Math.PI * 2 - Math.PI / 2;
      const color = k === 0 ? '#2fb862' : (k % 2 ? '#d0342c' : '#16181b');
      seg += `<path d="M${cx} ${cy}L${r2(cx + r * Math.cos(a0))} ${r2(cy + r * Math.sin(a0))}A${r} ${r} 0 0 1 ${r2(cx + r * Math.cos(a1))} ${r2(cy + r * Math.sin(a1))}Z" fill="${color}"/>`;
    }
    const ball = -0.7;
    return `<svg viewBox="0 0 160 90" aria-hidden="true"><defs>
      <radialGradient id="vn-rl-bg" cx=".5" cy=".5" r=".75"><stop offset="0" stop-color="#16603f"/><stop offset="1" stop-color="#072216"/></radialGradient>
      <radialGradient id="vn-rl-wd" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#9a6a3a"/><stop offset="1" stop-color="#4a2c14"/></radialGradient></defs>
      <rect width="160" height="90" fill="url(#vn-rl-bg)"/>
      <circle cx="${cx}" cy="${cy + 3}" r="38" fill="#000" opacity=".35"/>
      <circle cx="${cx}" cy="${cy}" r="37" fill="url(#vn-rl-wd)"/>${seg}
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e8c27a" stroke-opacity=".5" stroke-width=".6"/>
      <circle cx="${cx}" cy="${cy}" r="19" fill="url(#vn-rl-wd)" stroke="#e8c27a" stroke-width="1.2"/>
      <path d="M${cx - 11} ${cy}H${cx + 11}M${cx} ${cy - 11}V${cy + 11}" stroke="#e8c27a" stroke-width="2" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="4" fill="#f2d48a"/>
      <circle cx="${r2(cx + 26 * Math.cos(ball))}" cy="${r2(cy + 26 * Math.sin(ball))}" r="2.8" fill="#fff"/>
    </svg>`;
  }

  function sterrenradArt() {
    const cx = 80, cy = 70, r = 46, n = 18;
    const colors = ['#2fc4d6', '#f2b233', '#2fc4d6', '#e0459b', '#2fc4d6', '#7ad94a', '#f2b233', '#2fc4d6', '#c9a6ff'];
    let seg = '';
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((k + 1) / n) * Math.PI * 2 - Math.PI / 2;
      seg += `<path d="M${cx} ${cy}L${r2(cx + r * Math.cos(a0))} ${r2(cy + r * Math.sin(a0))}A${r} ${r} 0 0 1 ${r2(cx + r * Math.cos(a1))} ${r2(cy + r * Math.sin(a1))}Z" fill="${colors[k % colors.length]}"/>`;
    }
    const bulbs = Array.from({ length: 14 }, (_, i) => {
      const a = Math.PI + (i / 13) * Math.PI;
      return `<circle cx="${r2(cx + 50 * Math.cos(a))}" cy="${r2(cy + 50 * Math.sin(a))}" r="1.6" fill="${i % 2 ? '#fff6d2' : '#ffb347'}"/>`;
    }).join('');
    const stars = [[12, 10], [30, 26], [140, 14], [150, 40], [118, 8], [20, 50], [46, 8]]
      .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 2 ? 0.8 : 1.2}" fill="#fff" opacity=".7"/>`).join('');
    return `<svg viewBox="0 0 160 90" aria-hidden="true"><defs>
      <radialGradient id="vn-sr-bg" cx=".7" cy=".1" r=".9"><stop offset="0" stop-color="#3b2a7a"/><stop offset=".6" stop-color="#120c2c"/><stop offset="1" stop-color="#05040e"/></radialGradient>
      <radialGradient id="vn-sr-pl" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#ffb46b"/><stop offset="1" stop-color="#7a2d18"/></radialGradient></defs>
      <rect width="160" height="90" fill="url(#vn-sr-bg)"/>${stars}
      <circle cx="136" cy="22" r="11" fill="url(#vn-sr-pl)"/>
      <ellipse cx="136" cy="22" rx="18" ry="4" fill="none" stroke="#ffd9a8" stroke-opacity=".6"/>
      <circle cx="${cx}" cy="${cy}" r="52" fill="#1a1530" stroke="#c9a6ff" stroke-opacity=".5"/>${seg}${bulbs}
      <circle cx="${cx}" cy="${cy}" r="11" fill="#1a1530" stroke="#f2c14e" stroke-width="2"/>
      <path d="M${cx - 5} 14L${cx + 5} 14L${cx} 26Z" fill="#f2c14e"/>
    </svg>`;
  }

  function routegokArt() {
    const fields = [[0, 0, 70, 40, '#3f5a2c'], [70, 0, 90, 34, '#5b6b3a'], [0, 40, 52, 50, '#4d6a34'], [52, 34, 60, 56, '#6b6a45'], [112, 34, 48, 56, '#3a5530']]
      .map(([x, y, w, h, c]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`).join('');
    return `<svg viewBox="0 0 160 90" aria-hidden="true"><defs>
      <linearGradient id="vn-rg-w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d4b6e"/><stop offset="1" stop-color="#0f2c44"/></linearGradient></defs>
      ${fields}
      <path d="M118 0Q128 30 160 40V0Z" fill="url(#vn-rg-w)"/>
      <path d="M0 62L160 50M44 0L58 90M96 0L104 90" stroke="#c9c2a8" stroke-opacity=".35" stroke-width="1.4"/>
      <path d="M22 72C40 70 48 52 62 50S86 58 96 44S118 26 134 22" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="6" stroke-linecap="round"/>
      <path d="M22 72C40 70 48 52 62 50S86 58 96 44S118 26 134 22" fill="none" stroke="#3fc6b0" stroke-width="3.4" stroke-linecap="round"/>
      <circle cx="22" cy="72" r="6" fill="#4cd47b" stroke="#fff" stroke-width="1.6"/><text x="22" y="75.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="8" font-weight="900" fill="#062612">A</text>
      <circle cx="134" cy="22" r="6" fill="#ef5b4c" stroke="#fff" stroke-width="1.6"/><text x="134" y="25.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="8" font-weight="900" fill="#fff">B</text>
      <rect x="8" y="8" width="52" height="18" rx="9" fill="#000" opacity=".55"/>
      <text x="34" y="21" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="800" fill="#f2c14e">37 min?</text>
    </svg>`;
  }


  function fuikArt() {
    const bubbles = [[22, 70, 2.2], [30, 56, 1.4], [128, 64, 2], [138, 48, 1.3], [118, 30, 1.6], [48, 24, 1.2], [96, 74, 1.5]]
      .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#bff3e4" stroke-opacity=".55" stroke-width=".9"/>`).join('');
    const hoops = [42, 56, 70, 84, 98].map((x, i) => {
      const ry = 17 - i * 1.8;
      return `<ellipse cx="${x}" cy="52" rx="4.2" ry="${ry}" fill="none" stroke="#c8b58a" stroke-width="1.7"/>`;
    }).join('');
    return `<svg viewBox="0 0 160 90" aria-hidden="true"><defs>
      <linearGradient id="vn-fk-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f7f86"/><stop offset=".55" stop-color="#0f4a5c"/><stop offset="1" stop-color="#082a38"/></linearGradient>
      <linearGradient id="vn-fk-net" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e7d9b0" stop-opacity=".5"/><stop offset="1" stop-color="#b9a46f" stop-opacity=".22"/></linearGradient>
      <linearGradient id="vn-fk-fish" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#e49b2c"/></linearGradient></defs>
      <rect width="160" height="90" fill="url(#vn-fk-bg)"/>
      <path d="M0 0H160V9Q140 4 120 9T80 9T40 9T0 9Z" fill="#8fe3d0" opacity=".35"/>
      <path d="M30 0L52 90H18ZM92 0L120 90H84Z" fill="#fff" opacity=".05"/>
      <path d="M0 84Q40 76 80 82T160 80V90H0Z" fill="#0a1f29"/>
      <path d="M26 86c1-8 0-12-2-16M138 88c0-9 2-14 4-18" stroke="#2f8f64" stroke-width="2.2" stroke-linecap="round" fill="none"/>
      <path d="M112 48L152 40V64L112 56Z" fill="#000" opacity=".15"/>
      <path d="M36 36L106 40V64L36 68Z" fill="url(#vn-fk-net)" stroke="#c8b58a" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M36 44H106M36 52H106M36 60H106" stroke="#e7d9b0" stroke-opacity=".28" stroke-width=".7"/>
      ${hoops}
      <path d="M36 36Q20 52 36 68" fill="none" stroke="#c8b58a" stroke-width="2" stroke-linecap="round"/>
      <path d="M34 40Q56 52 34 64" fill="#06202b" fill-opacity=".85" stroke="#c8b58a" stroke-width="1.3"/>
      <g transform="translate(62 50)"><path d="M0 4c4-6 10-7 15-3l5-4v11l-5-4c-5 4-11 3-15-0z" fill="url(#vn-fk-fish)"/><circle cx="4.5" cy="2.6" r="1.1" fill="#3b2400"/></g>
      <g transform="translate(78 57) scale(.7)"><path d="M0 4c4-6 10-7 15-3l5-4v11l-5-4c-5 4-11 3-15-0z" fill="#b9c6cf"/><circle cx="4.5" cy="2.6" r="1.1" fill="#26323a"/></g>
      <path d="M106 52C122 46 136 30 140 12" fill="none" stroke="#e7d9b0" stroke-width="1.4" stroke-dasharray="3 2.2"/>
      <circle cx="140" cy="9" r="5.2" fill="#ef5b4c" stroke="#fff" stroke-width="1.2"/><path d="M134.8 9h10.4" stroke="#fff" stroke-width="1.2"/>
      ${bubbles}
    </svg>`;
  }

  const GAME_ART = { rocket: rocketArt, blackjack: blackjackArt, plinko: plinkoArt, slots: slotsArt, roulette: rouletteArt, sterrenrad: sterrenradArt, routegok: routegokArt, fuik: fuikArt };

  const NAV_CSS = `
    .nav { display: flex; align-items: center; gap: 4px; background: var(--nav-bg, var(--panel, #16181b)); border: 1px solid var(--line, rgba(255,255,255,.07));
      border-radius: 999px; padding: 4px; margin-right: auto; margin-left: 18px; backdrop-filter: var(--nav-blur, none); -webkit-backdrop-filter: var(--nav-blur, none); }
    .nav > a, .vn-trigger { display: flex; align-items: center; justify-content: center; gap: 7px; color: var(--muted, #8d9299); text-decoration: none;
      font: inherit; font-size: 14px; font-weight: 700; line-height: 1.2; padding: 7px 14px; border-radius: 999px; white-space: nowrap;
      background: none; border: 0; cursor: pointer; }
    .nav > a:hover, .vn-trigger:hover { color: var(--text, #eceae6); }
    .nav > a.active, .vn-trigger.active, .vn-trigger[aria-expanded="true"] { background: var(--raise, #262a2f); color: var(--text, #eceae6); }
    .vn-trigger .vn-chip { width: 15px; height: 15px; flex: none; color: #f2c14e; }
    .vn-trigger .vn-chev { width: 10px; height: 10px; flex: none; opacity: .7; transition: transform .2s ease; }
    .vn-trigger[aria-expanded="true"] .vn-chev { transform: rotate(180deg); }
    .brand .word b { white-space: nowrap; }

    .vn-panel { position: absolute; top: 0; left: 0; z-index: 2147482000; box-sizing: border-box; padding: 14px; border-radius: 18px;
      background: var(--side, #1b1d21); border: 1px solid var(--line, rgba(255,255,255,.07)); box-shadow: 0 24px 60px rgba(0,0,0,.55);
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "DejaVu Sans", sans-serif; color: var(--text, #eceae6);
      opacity: 0; visibility: hidden; transform: translateY(-6px) scale(.985); transform-origin: top left;
      transition: opacity .18s ease, transform .25s cubic-bezier(.2,1,.3,1), visibility 0s linear .25s; }
    .vn-panel.open { opacity: 1; visibility: visible; transform: none; transition-delay: 0s; }
    .vn-head { display: flex; justify-content: space-between; align-items: baseline; margin: 0 4px 12px; }
    .vn-head span { font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--muted, #8d9299); }
    .vn-head small { font-size: 12px; color: var(--muted, #8d9299); }
    .vn-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
    .vn-card { display: flex; flex-direction: column; gap: 3px; padding: 6px 6px 10px; border-radius: 14px; text-decoration: none;
      color: var(--text, #eceae6); border: 1px solid transparent; transition: background .15s ease, transform .15s ease, border-color .15s ease; }
    .vn-card:hover, .vn-card:focus-visible { background: var(--raise, #262a2f); transform: translateY(-2px); outline: none; }
    .vn-card.active { border-color: rgba(242,193,78,.5); background: rgba(242,193,78,.06); }
    .vn-art { position: relative; display: block; aspect-ratio: 16 / 9; border-radius: 10px; overflow: hidden; margin-bottom: 6px;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.06), 0 6px 16px rgba(0,0,0,.35); }
    .vn-art svg { display: block; width: 100%; height: 100%; transition: transform .4s ease; }
    .vn-card:hover .vn-art svg { transform: scale(1.07); }
    .vn-live { position: absolute; top: 6px; right: 6px; font-size: 9px; font-weight: 800; letter-spacing: .08em; line-height: 1;
      padding: 3px 6px 3px 13px; border-radius: 999px; background: rgba(0,0,0,.6); color: #fff; }
    .vn-live::before { content: ''; position: absolute; left: 5px; top: 50%; width: 5px; height: 5px; margin-top: -2.5px; border-radius: 50%;
      background: #ef5b4c; animation: vn-pulse 1.4s ease-out infinite; }
    .vn-now { position: absolute; left: 6px; bottom: 6px; font-size: 9px; font-weight: 800; letter-spacing: .08em; line-height: 1;
      padding: 3px 6px; border-radius: 999px; background: #f2c14e; color: #16181b; }
    .vn-name { font-size: 14px; font-weight: 800; padding: 0 4px; }
    .vn-desc { font-size: 12px; line-height: 1.3; color: var(--muted, #8d9299); padding: 0 4px; }
    @keyframes vn-pulse { 0% { box-shadow: 0 0 0 0 rgba(239,91,76,.7); } 100% { box-shadow: 0 0 0 5px rgba(239,91,76,0); } }

    @media (max-width: 760px) { .vn-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 640px) {
      .nav > a, .vn-trigger { flex: 1; padding: 7px 4px; font-size: 12px; gap: 5px; }
      .vn-trigger .vn-chip { display: none; }
    }
    @media (max-width: 480px) {
      .vn-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .vn-panel { padding: 10px; }
      .vn-desc { display: none; }
    }
  `;

  // Vóór de eigen stijl van de pagina, zodat die (bv. mobiele indeling van de kopregel) nog kan overschrijven
  const navStyle = document.createElement('style');
  navStyle.textContent = NAV_CSS;
  document.head.prepend(navStyle);

  function buildNav() {
    const nav = document.querySelector('nav.nav');
    if (!nav) return;
    const current = location.pathname.replace(/\/+$/, '').split('/')[1] || 'rocket';
    const activeGame = GAMES.find(game => game.key === current);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'vn-trigger' + (activeGame ? ' active' : '');
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'vn-casino');
    trigger.innerHTML = `<svg class="vn-chip" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3.1 1.9"/><circle cx="8" cy="8" r="3" fill="currentColor"/></svg>`
      + `<span>${activeGame ? activeGame.name : 'Casino'}</span>`
      + `<svg class="vn-chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    const links = NAV_LINKS.map(link =>
      `<a href="/${link.key}" class="${[link.cls, link.key === current ? 'active' : ''].filter(Boolean).join(' ')}">${link.name}</a>`).join('');
    nav.replaceChildren(trigger);
    nav.insertAdjacentHTML('beforeend', links);
    // De afwas-pagina zelf is nooit verborgen
    const ownWash = nav.querySelector('a.wash-link.active');
    if (ownWash) ownWash.classList.remove('locked');

    const panel = document.createElement('div');
    panel.className = 'vn-panel';
    panel.id = 'vn-casino';
    panel.innerHTML = `<div class="vn-head"><span>Casino</span><small>${GAMES.length} spellen</small></div><div class="vn-grid">${
      GAMES.map(game => `<a class="vn-card${game.key === current ? ' active' : ''}" href="/${game.key}">
        <span class="vn-art">${GAME_ART[game.key] ? GAME_ART[game.key]() : ''}${game.live ? '<span class="vn-live">LIVE</span>' : ''}${game.key === current ? '<span class="vn-now">JE SPEELT</span>' : ''}</span>
        <span class="vn-name">${game.name}</span><span class="vn-desc">${game.desc}</span></a>`).join('')
    }</div>`;
    document.body.append(panel);

    // Het paneel hangt aan de body (de kopregel van Blackjack heeft een blur die 'fixed' zou breken) en wordt onder de knop gezet
    function place() {
      const rect = nav.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const width = Math.min(820, vw - 24);
      panel.style.width = `${width}px`;
      panel.style.left = `${Math.max(12, Math.min(rect.left, vw - width - 12)) + window.scrollX}px`;
      panel.style.top = `${rect.bottom + window.scrollY + 8}px`;
    }
    function setOpen(open) {
      if (open) place();
      panel.classList.toggle('open', open);
      trigger.setAttribute('aria-expanded', String(open));
    }
    const isOpen = () => panel.classList.contains('open');

    trigger.addEventListener('click', () => setOpen(!isOpen()));
    document.addEventListener('click', e => {
      if (isOpen() && !panel.contains(e.target) && !trigger.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen()) { setOpen(false); trigger.focus(); }
    });
    window.addEventListener('resize', () => { if (isOpen()) place(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildNav);
  else buildNav();

  // =====================================================
  // AFWASSEN-KNOP IN DE NAVIGATIE
  // =====================================================
  let washBelow = 50;

  function setWashLink(open) {
    document.querySelectorAll('.nav a.wash-link').forEach(link => {
      link.classList.toggle('locked', !open);
      link.title = open
        ? 'Blut? Was borden af voor punten'
        : `Alleen beschikbaar als je minder dan ${washBelow} punten hebt`;
      if (open) link.removeAttribute('aria-disabled');
      else link.setAttribute('aria-disabled', 'true');
    });
  }

  // Pulse bij Keys in de navigatie zodra je een key hebt om een kist te openen
  let keyCount = 0;
  function setKeysLink(count) {
    if (Number.isFinite(count)) keyCount = count;
    document.querySelectorAll('.nav a[href="/keys"]').forEach(link => {
      link.classList.toggle('has-keys', keyCount > 0);
      link.title = keyCount > 0 ? (keyCount === 1 ? 'Je hebt 1 key: open een kist!' : `Je hebt ${keyCount} keys: open een kist!`) : '';
    });
  }

  async function refreshWashLink() {
    try {
      const res = await nativeFetch(`${PROBE_URL}?t=${Date.now()}`, { credentials: 'same-origin', cache: 'no-store' });
      const me = await res.json();
      if (Number.isFinite(me.washBelow)) washBelow = me.washBelow;
      setWashLink(Boolean(me.canWash));
      setKeysLink(me.linked === false ? 0 : Number(me.keys) || 0);
    } catch (error) { /* knop blijft zoals hij is */ }
  }

  // Na een gewonnen/verloren spel kan de knop open of dicht gaan
  function watchBalance(args, res) {
    const url = String(args[0] && args[0].url ? args[0].url : args[0] || '');
    if (!url.includes('/api/') || url.includes(PROBE_URL)) return;
    if (!String(res.headers.get('content-type') || '').includes('application/json')) return;
    res.clone().json().then(data => {
      if (data && data.linked !== false && Number.isFinite(data.balance)) setWashLink(data.balance < washBelow);
      if (data && data.keys && typeof data.keys === 'object') setKeysLink(Object.values(data.keys).reduce((a, b) => a + (Number(b) || 0), 0));
    }).catch(() => {});
  }

  const WASH_CSS = `
    .nav a.wash-link { position: relative; }
    .nav a.wash-link:not(.locked):not(.active) { color: #7fd3ff; }
    .nav a.wash-link:not(.locked):not(.active)::after { content: ''; position: absolute; top: 5px; right: 6px; width: 6px; height: 6px;
      border-radius: 50%; background: #7fd3ff; animation: vsc-bub 1.8s ease-out infinite; }
    .nav a.wash-link.locked { display: none; }
    .nav a.has-keys { position: relative; color: #ffd978; animation: vsc-keyglow 2s ease-in-out infinite; }
    .nav a.has-keys::before { content: ''; position: absolute; inset: 0; border-radius: 999px; pointer-events: none;
      box-shadow: 0 0 0 0 rgba(242,193,78,.55); animation: vsc-keyring 2s ease-out infinite; }
    .nav a.has-keys::after { content: ''; position: absolute; top: 4px; right: 5px; width: 7px; height: 7px; border-radius: 50%;
      background: #f2c14e; box-shadow: 0 0 8px #f2c14e; animation: vsc-keydot 1s ease-in-out infinite; }
    @keyframes vsc-keyring { 0% { box-shadow: 0 0 0 0 rgba(242,193,78,.55); } 70%, 100% { box-shadow: 0 0 0 10px rgba(242,193,78,0); } }
    @keyframes vsc-keyglow { 50% { text-shadow: 0 0 12px rgba(242,193,78,.8); } }
    @keyframes vsc-keydot { 50% { transform: scale(1.35); opacity: .65; } }
    @keyframes vsc-bub { 0% { box-shadow: 0 0 0 0 rgba(127,211,255,.6); } 100% { box-shadow: 0 0 0 7px rgba(127,211,255,0); } }
  `;

  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = WASH_CSS;
    document.head.append(style);
    document.addEventListener('click', e => {
      if (e.target.closest && e.target.closest('.nav a.wash-link.locked')) e.preventDefault();
    });
    refreshWashLink();
  });
  window.addEventListener('focus', () => refreshWashLink());

  // =====================================================
  // POPUP
  // =====================================================
  const CSS = `
    .vsc-ov { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; padding: 16px;
      background: rgba(5, 6, 8, .78); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "DejaVu Sans", sans-serif; color: #eceae6;
      opacity: 0; transition: opacity .25s ease; }
    .vsc-ov.show { opacity: 1; }
    .vsc-box { width: min(420px, 100%); background: #1b1d21; border: 1px solid rgba(255,255,255,.08); border-radius: 18px;
      padding: 30px 26px 24px; text-align: center; box-shadow: 0 24px 60px rgba(0,0,0,.6);
      transform: translateY(14px) scale(.96); transition: transform .35s cubic-bezier(.2,1.4,.4,1); }
    .vsc-ov.show .vsc-box { transform: none; }
    .vsc-icon { width: 76px; height: 76px; margin: 0 auto 18px; border-radius: 50%; display: grid; place-items: center;
      background: rgba(239, 91, 76, .12); color: #ef5b4c; position: relative; }
    .vsc-icon::after { content: ''; position: absolute; inset: -6px; border-radius: 50%; border: 2px solid rgba(239,91,76,.5);
      animation: vsc-pulse 1.6s ease-out infinite; }
    .vsc-icon svg { width: 36px; height: 36px; }
    .vsc-box.restart .vsc-icon { background: rgba(242, 193, 78, .13); color: #f2c14e; }
    .vsc-box.restart .vsc-icon::after { border-color: rgba(242,193,78,.5); }
    .vsc-box.restart .vsc-icon svg { animation: vsc-rot 2.4s linear infinite; }
    .vsc-box.ok .vsc-icon { background: rgba(76, 212, 123, .14); color: #4cd47b; }
    .vsc-box.ok .vsc-icon::after { border-color: rgba(76,212,123,.5); }
    .vsc-title { margin: 0 0 8px; font-size: 21px; font-weight: 800; }
    .vsc-text { margin: 0; color: #a9adb3; font-size: 14px; line-height: 1.55; }
    .vsc-safe { margin: 16px 0 0; padding: 10px 12px; border-radius: 10px; background: rgba(242,193,78,.08);
      border: 1px solid rgba(242,193,78,.25); color: #f2dca0; font-size: 13px; line-height: 1.5; text-align: left; }
    .vsc-box.ok .vsc-safe { display: none; }
    .vsc-status { margin-top: 18px; min-height: 18px; font-size: 13px; font-weight: 700; color: #8d9299;
      display: flex; align-items: center; justify-content: center; gap: 8px; font-variant-numeric: tabular-nums; }
    .vsc-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(242,193,78,.25); border-top-color: #f2c14e;
      animation: vsc-rot .8s linear infinite; }
    .vsc-spin[hidden] { display: none; }
    .vsc-btn { margin-top: 16px; width: 100%; border: 0; border-radius: 10px; padding: 12px; font: inherit; font-size: 15px;
      font-weight: 800; cursor: pointer; background: #f2c14e; color: #1d1203; }
    .vsc-btn:hover { filter: brightness(1.06); }
    .vsc-btn[hidden] { display: none; }
    @keyframes vsc-pulse { from { transform: scale(.92); opacity: 1; } to { transform: scale(1.3); opacity: 0; } }
    @keyframes vsc-rot { to { transform: rotate(360deg); } }
  `;
  const ICON_RESTART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M20.5 3.5v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_OFFLINE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    const ov = document.createElement('div');
    ov.className = 'vsc-ov';
    ov.setAttribute('role', 'alertdialog');
    ov.setAttribute('aria-live', 'assertive');
    ov.innerHTML = `
      <div class="vsc-box">
        <div class="vsc-icon"></div>
        <h2 class="vsc-title"></h2>
        <p class="vsc-text"></p>
        <p class="vsc-safe"></p>
        <div class="vsc-status"><span class="vsc-spin" hidden></span><span class="vsc-msg"></span></div>
        <button class="vsc-btn" type="button">Nu opnieuw proberen</button>
      </div>`;
    document.body.append(ov);
    ui = {
      ov,
      box: ov.querySelector('.vsc-box'),
      icon: ov.querySelector('.vsc-icon'),
      title: ov.querySelector('.vsc-title'),
      safe: ov.querySelector('.vsc-safe'),
      text: ov.querySelector('.vsc-text'),
      spin: ov.querySelector('.vsc-spin'),
      msg: ov.querySelector('.vsc-msg'),
      button: ov.querySelector('.vsc-btn')
    };
    ui.button.addEventListener('click', () => retry());
  }

  function show() {
    if (!ui) build();
    render();
    ui.button.hidden = false;
    ui.ov.hidden = false;
    requestAnimationFrame(() => ui.ov.classList.add('show'));
    clearInterval(countdownTimer);
    countdownTimer = setInterval(tickCountdown, 250);
  }

  // Twee meldingen: de bot herstart (geeft de server aan) of jij hebt zelf geen internet
  function render() {
    if (!ui || ui.box.classList.contains('ok')) return;
    const restart = kind === 'restart';
    ui.box.classList.toggle('restart', restart);
    ui.icon.innerHTML = restart ? ICON_RESTART : ICON_OFFLINE;
    ui.title.textContent = restart ? 'De bot wordt herstart' : 'Je bent offline';
    ui.text.textContent = restart
      ? 'De server is zo weer terug, meestal binnen een minuut. Je hoeft niets te doen: de pagina laadt vanzelf opnieuw.'
      : 'Er is geen verbinding met internet. Controleer je wifi of mobiele data; zodra je weer online bent gaan we verder.';
    ui.safe.textContent = restart
      ? 'Je punten zijn veilig. Inzetten van spellen die door de herstart zijn afgebroken, worden automatisch teruggestort.'
      : 'Je punten zijn veilig. Er gaat niets verloren terwijl je offline bent.';
  }

  function setStatus(text, spinning) {
    if (!ui) return;
    ui.msg.textContent = text;
    ui.spin.hidden = !spinning;
  }

  function tickCountdown() {
    if (!ui || !down || !nextRetryAt) return;
    const left = Math.ceil((nextRetryAt - Date.now()) / 1000);
    if (left > 0) setStatus(`Opnieuw proberen over ${left} s${attempts ? ` · poging ${attempts + 1}` : ''}`, false);
  }

  // =====================================================
  // FIREFOX MELDING
  // =====================================================
  const FIREFOX_KEY = 'firefoxNoticeAt';
  const FIREFOX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

  function showFirefoxNotice() {
    if (!/firefox|fxios/i.test(navigator.userAgent)) return;
    try {
      const last = Number(localStorage.getItem(FIREFOX_KEY)) || 0;
      if (Date.now() - last < FIREFOX_INTERVAL_MS) return;
      localStorage.setItem(FIREFOX_KEY, String(Date.now()));
    } catch (error) {
      // Geen opslag: dan maar elke keer tonen
    }

    const style = document.createElement('style');
    style.textContent = `
      .vsc-ff { position: fixed; left: 16px; bottom: 16px; z-index: 2147482000; width: min(340px, calc(100vw - 32px));
        display: flex; gap: 10px; align-items: flex-start; padding: 12px 12px 12px 14px; border-radius: 12px;
        background: #1b1d21; border: 1px solid rgba(242,193,78,.3); box-shadow: 0 12px 32px rgba(0,0,0,.5);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "DejaVu Sans", sans-serif; color: #eceae6;
        font-size: 13px; line-height: 1.5; opacity: 0; transform: translateY(10px); transition: opacity .25s ease, transform .25s ease; }
      .vsc-ff.show { opacity: 1; transform: none; }
      .vsc-ff b { color: #f2c14e; }
      .vsc-ff p { margin: 0; flex: 1; }
      .vsc-ff button { flex: none; width: 24px; height: 24px; margin: -2px -2px 0 0; border: 0; border-radius: 6px; padding: 0;
        background: transparent; color: #8d9299; font-size: 18px; line-height: 24px; cursor: pointer; }
      .vsc-ff button:hover { background: rgba(255,255,255,.08); color: #eceae6; }
    `;
    document.head.append(style);

    const box = document.createElement('div');
    box.className = 'vsc-ff';
    box.setAttribute('role', 'status');
    box.innerHTML = `
      <p><b>Je gebruikt Firefox.</b> Het kan zijn dat de game-performance niet optimaal is. Probeer een Chromium-based browser (zoals Chrome, Edge of Brave) voor betere performance.</p>
      <button type="button" aria-label="Sluiten" title="Sluiten">×</button>`;
    box.querySelector('button').addEventListener('click', () => {
      box.classList.remove('show');
      setTimeout(() => box.remove(), 250);
    });
    document.body.append(box);
    requestAnimationFrame(() => box.classList.add('show'));
  }

  // =====================================================
  // CHAT (rechtsonder, op elke pagina)
  // =====================================================
  // Een klein glazen bolletje dat de kleuren van de pagina volgt (--panel/--line/--text/--raise/--gold).
  // In rust is het doorzichtig; een nieuw bericht schuift er even naast uit en klapt daarna weer in.
  // Berichten komen live binnen via de /api/live stream, versturen gaat via POST /api/chat/send.
  const CHAT_MAX_SHOWN = 60;
  const CHAT_PREVIEW_MS = 6000;
  const CHAT_CSS = `
    .vsc { position: fixed; right: 16px; bottom: 16px; z-index: 2147481000; font-family: inherit; color: var(--text, #eceae6); pointer-events: none;
      display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
    .vsc > * { pointer-events: auto; }
    .vsc-btn { display: flex; align-items: center; justify-content: center; gap: 0; height: 38px; min-width: 38px; max-width: 280px; padding: 0 10px; box-sizing: border-box; border-radius: 999px; cursor: pointer;
      background: color-mix(in srgb, var(--panel, #16181b) 62%, transparent); border: 1px solid var(--line, rgba(255,255,255,.07));
      backdrop-filter: blur(10px) saturate(1.2); -webkit-backdrop-filter: blur(10px) saturate(1.2);
      color: var(--muted, #8d9299); font: inherit; font-size: 13px; font-weight: 700; opacity: .55;
      box-shadow: 0 6px 20px rgba(0,0,0,.25); transition: opacity .25s ease, background .25s ease, color .25s ease; }
    .vsc-btn:hover, .vsc-btn:focus-visible, .vsc.open .vsc-btn, .vsc.peek .vsc-btn { opacity: 1; color: var(--text, #eceae6); }
    .vsc-btn svg { width: 17px; height: 17px; flex: none; }
    .vsc-peek { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 0; opacity: 0;
      transition: max-width .35s ease, opacity .25s ease; font-weight: 600; }
    .vsc-peek b { color: var(--gold, #f2c14e); font-weight: 800; }
    .vsc.peek:not(.open) .vsc-peek { max-width: 210px; opacity: 1; margin-left: 8px; }
    .vsc-badge { margin-left: 6px; }
    .vsc-badge { min-width: 17px; height: 17px; padding: 0 5px; border-radius: 999px; background: var(--gold, #f2c14e); color: #1a1405;
      font-size: 11px; font-weight: 900; display: grid; place-items: center; font-variant-numeric: tabular-nums; }
    .vsc-badge[hidden] { display: none; }
    .vsc-panel { width: 300px; max-width: calc(100vw - 32px); display: flex; flex-direction: column; border-radius: 16px; overflow: hidden;
      background: color-mix(in srgb, var(--side, #1b1d21) 88%, transparent); border: 1px solid var(--line, rgba(255,255,255,.07));
      backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2); box-shadow: 0 16px 40px rgba(0,0,0,.5);
      transform-origin: bottom right; transition: opacity .18s ease, transform .18s ease; }
    .vsc-panel[hidden] { display: none; }
    .vsc-panel.pre { opacity: 0; transform: translateY(8px) scale(.97); }
    .vsc-head { display: flex; align-items: center; padding: 9px 12px 7px; font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted, #8d9299); }
    .vsc-head button { margin-left: auto; background: none; border: 0; color: inherit; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; }
    .vsc-head button:hover { color: var(--text, #eceae6); }
    .vsc-list { height: 220px; overflow-y: auto; padding: 2px 12px 8px; display: flex; flex-direction: column; gap: 5px; overscroll-behavior: contain;
      scrollbar-width: thin; scrollbar-color: var(--raise, #262a2f) transparent; }
    .vsc-msg { font-size: 13px; line-height: 1.35; font-weight: 500; overflow-wrap: anywhere; }
    .vsc-msg b { font-weight: 800; margin-right: 6px; }
    .vsc-empty { margin: auto; font-size: 12px; color: var(--muted, #8d9299); text-align: center; }
    .vsc-note { padding: 0 12px 6px; font-size: 12px; font-weight: 600; color: var(--red, #ef5b4c); min-height: 0; }
    .vsc-note:empty { display: none; }
    .vsc-note.info { color: var(--gold, #f2c14e); }
    .vsc-form { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--line, rgba(255,255,255,.07)); }
    .vsc-form input { flex: 1; min-width: 0; height: 32px; padding: 0 11px; border-radius: 999px; font: inherit; font-size: 13px; color: var(--text, #eceae6);
      background: var(--field, rgba(0,0,0,.25)); border: 1px solid var(--line, rgba(255,255,255,.07)); outline: none; }
    .vsc-form input:focus { border-color: var(--gold, #f2c14e); }
    .vsc-form input::placeholder { color: var(--muted, #8d9299); }
    .vsc-form button { height: 32px; padding: 0 12px; border-radius: 999px; border: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 800;
      background: var(--raise, #262a2f); color: var(--text, #eceae6); }
    .vsc-form button:hover { background: var(--gold, #f2c14e); color: #1a1405; }
    .vsc-form button:disabled, .vsc-form input:disabled { opacity: .5; cursor: not-allowed; }
    @media (max-width: 640px) {
      .vsc { right: 10px; bottom: 10px; }
      .vsc-list { height: 180px; }
    }
    @media (prefers-reduced-motion: reduce) { .vsc *, .vsc { transition: none !important; } }
  `;
  const CHAT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/></svg>';

  function initChat() {
    if (document.getElementById('vsc-root')) return;
    const style = document.createElement('style');
    style.textContent = CHAT_CSS;
    document.head.append(style);
    const root = document.createElement('div');
    root.id = 'vsc-root';
    root.className = 'vsc';
    root.innerHTML = `
      <div class="vsc-panel" hidden role="dialog" aria-label="Chat">
        <div class="vsc-head"><span>Chat</span><button type="button" class="vsc-close" aria-label="Sluiten" title="Sluiten">×</button></div>
        <div class="vsc-list" aria-live="polite"></div>
        <div class="vsc-note" role="status"></div>
        <form class="vsc-form" autocomplete="off">
          <input type="text" maxlength="200" placeholder="Typ een bericht…" aria-label="Bericht">
          <button type="submit">Stuur</button>
        </form>
      </div>
      <button class="vsc-btn" type="button" aria-expanded="false" title="Chat">
        ${CHAT_ICON}<span class="vsc-peek"></span><span class="vsc-badge" hidden></span>
      </button>`;
    document.body.append(root);

    const panel = root.querySelector('.vsc-panel');
    const list = root.querySelector('.vsc-list');
    const note = root.querySelector('.vsc-note');
    const form = root.querySelector('.vsc-form');
    const input = form.querySelector('input');
    const sendBtn = form.querySelector('button');
    const btn = root.querySelector('.vsc-btn');
    const peek = root.querySelector('.vsc-peek');
    const badge = root.querySelector('.vsc-badge');

    let open = false;
    let unread = 0;
    let lastId = 0;
    let peekTimer = null;
    let noteTimer = null;
    let sending = false;
    let loggedIn = null;
    const seen = new Set();

    const colorFor = name => {
      let h = 0;
      for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
      return `hsl(${h} 70% 68%)`;
    };

    function showNote(text, info) {
      clearTimeout(noteTimer);
      note.textContent = text || '';
      note.classList.toggle('info', Boolean(info));
      if (text) noteTimer = setTimeout(() => { note.textContent = ''; }, 5000);
    }

    function setLogin(value) {
      loggedIn = value;
      input.disabled = sendBtn.disabled = !value;
      input.placeholder = value ? 'Typ een bericht…' : 'Log in via Discord om te chatten';
    }

    function nearBottom() { return list.scrollHeight - list.scrollTop - list.clientHeight < 40; }

    function addMessage(msg, fresh) {
      if (!msg || seen.has(msg.id)) return;
      seen.add(msg.id);
      lastId = Math.max(lastId, msg.id);
      list.querySelector('.vsc-empty')?.remove();
      const stick = nearBottom();
      const row = document.createElement('div');
      row.className = 'vsc-msg';
      const name = document.createElement('b');
      name.textContent = msg.username;
      name.style.color = colorFor(String(msg.username));
      row.append(name, document.createTextNode(msg.text));
      list.append(row);
      while (list.children.length > CHAT_MAX_SHOWN) list.firstChild.remove();
      if (stick || !fresh) list.scrollTop = list.scrollHeight;
      if (fresh && !open) {
        unread++;
        badge.hidden = false;
        badge.textContent = unread > 9 ? '9+' : String(unread);
        peek.replaceChildren();
        const who = document.createElement('b');
        who.textContent = msg.username;
        peek.append(who, ` ${msg.text}`);
        root.classList.add('peek');
        clearTimeout(peekTimer);
        peekTimer = setTimeout(() => root.classList.remove('peek'), CHAT_PREVIEW_MS);
      }
    }

    function renderEmpty() {
      if (list.children.length) return;
      const empty = document.createElement('div');
      empty.className = 'vsc-empty';
      empty.textContent = 'Nog geen berichten. Zeg eens hallo!';
      list.append(empty);
    }

    async function loadHistory() {
      try {
        const res = await nativeFetch(`/api/chat?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        for (const msg of data.messages || []) addMessage(msg, false);
        renderEmpty();
      } catch (error) {
        // Storingen worden al door de verbindingsbewaking afgehandeld
      }
    }

    async function checkLogin() {
      try {
        const res = await nativeFetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
        if (res.ok) setLogin(Boolean((await res.json()).linked));
      } catch (error) { /* zie hierboven */ }
    }

    function setOpen(value) {
      open = value;
      root.classList.toggle('open', value);
      btn.setAttribute('aria-expanded', String(value));
      if (value) {
        panel.hidden = false;
        panel.classList.add('pre');
        requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.remove('pre')));
        unread = 0;
        badge.hidden = true;
        root.classList.remove('peek');
        list.scrollTop = list.scrollHeight;
        if (loggedIn === null) checkLogin();
        if (loggedIn) setTimeout(() => input.focus(), 50);
      } else {
        panel.hidden = true;
      }
      try { localStorage.setItem('vsc-open', value ? '1' : '0'); } catch (error) { /* privémodus */ }
    }

    btn.addEventListener('click', () => setOpen(!open));
    root.querySelector('.vsc-close').addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && open) setOpen(false); });
    // Toetsen in het invoerveld mogen nooit de sneltoetsen van een spel activeren (spatie, pijltjes, enz.)
    for (const type of ['keydown', 'keyup', 'keypress']) panel.addEventListener(type, event => event.stopPropagation());

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text || sending || !loggedIn) return;
      sending = true;
      try {
        const res = await window.fetch('/api/chat/send', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) setLogin(false);
        if (data.ok) {
          input.value = '';
          if (data.notice) showNote(data.notice, true);
        } else {
          showNote(data.message || 'Versturen mislukt.');
        }
      } catch (error) {
        showNote('Versturen mislukt.');
      }
      sending = false;
      if (!input.disabled) input.focus();
    });

    if (liveSource) {
      liveSource.addEventListener('chat', event => {
        try { addMessage(JSON.parse(event.data), true); } catch (error) { /* kapot bericht */ }
      });
      // Na een herverbinding kunnen er berichten gemist zijn
      let opened = false;
      liveSource.addEventListener('open', () => {
        if (opened) loadHistory();
        opened = true;
      });
    }

    // In volledig scherm toont de browser alleen dat element (bijv. het Sterrenrad), dus de chat verhuist er tijdelijk in mee
    const followFullscreen = () => {
      const target = document.fullscreenElement || document.webkitFullscreenElement || document.body;
      if (root.parentNode !== target) target.append(root);
    };
    document.addEventListener('fullscreenchange', followFullscreen);
    document.addEventListener('webkitfullscreenchange', followFullscreen);

    loadHistory();
    checkLogin();
    let wasOpen = false;
    try { wasOpen = localStorage.getItem('vsc-open') === '1'; } catch (error) { /* privémodus */ }
    if (wasOpen && window.innerWidth > 640) setOpen(true);
  }

  if (document.body) initChat();
  else document.addEventListener('DOMContentLoaded', initChat);

  if (document.body) showFirefoxNotice();
  else document.addEventListener('DOMContentLoaded', showFirefoxNotice);
})();
