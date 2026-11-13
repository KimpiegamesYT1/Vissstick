/**
 * Verbindingsbewaking voor de casino-pagina's (Rocket, Blackjack, Plinko, Slots, Daily spin).
 *
 * Als de server even weg is (bot herstart, internet weg, proxy geeft 502/503/504) verschijnt er een popup die
 * zelf opnieuw verbinding probeert te maken. Is de server terug, dan wordt de pagina herladen zodat alles
 * (saldo, lopende rondes) weer klopt met de server.
 *
 * Werkt door fetch en EventSource te omwikkelen, dus de pagina's zelf hoeven niets te doen: dit script moet
 * alleen vóór het eigen script van de pagina geladen worden.
 *
 * Daarnaast krijgen Firefox-gebruikers max. 1x per week een melding linksonder dat een Chromium-browser beter presteert.
 */
(() => {
  'use strict';

  const PROBE_URL = '/api/me';
  const STREAM_GRACE_MS = 3000;   // zo lang mag een live-verbinding weg zijn voor we gaan controleren
  const RETRY_MIN_MS = 2000;
  const RETRY_MAX_MS = 8000;
  const HEARTBEAT_MS = 15000;
  const DOWN_STATUS = new Set([502, 503, 504]);

  const nativeFetch = window.fetch.bind(window);
  let down = false;
  let checking = false;
  let attempts = 0;
  let retryTimer = null;
  let countdownTimer = null;
  let nextRetryAt = 0;
  let ui = null;

  // =====================================================
  // CONTROLEREN
  // =====================================================
  async function serverReachable() {
    try {
      const res = await nativeFetch(`${PROBE_URL}?t=${Date.now()}`, { credentials: 'same-origin', cache: 'no-store' });
      return !DOWN_STATUS.has(res.status) && res.status < 500;
    } catch (error) {
      return false;
    }
  }

  // Eén mislukt verzoek is nog geen storing: eerst zelf controleren
  async function suspect() {
    if (down || checking) return;
    checking = true;
    const ok = navigator.onLine !== false && await serverReachable();
    checking = false;
    if (!ok) goDown();
  }

  function goDown() {
    if (down) return;
    down = true;
    attempts = 0;
    show();
    scheduleRetry(RETRY_MIN_MS);
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
    const ok = navigator.onLine !== false && await serverReachable();
    if (ok) {
      recovered();
      return;
    }
    scheduleRetry(Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 1.5 ** attempts));
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
        let timer = null;
        this.addEventListener('error', () => {
          if (this.readyState === NativeEventSource.OPEN || timer) return;
          timer = setTimeout(() => {
            timer = null;
            if (this.readyState !== NativeEventSource.OPEN) suspect();
          }, STREAM_GRACE_MS);
        });
        this.addEventListener('open', () => { clearTimeout(timer); timer = null; });
      }
    }
    window.EventSource = WatchedEventSource;
  }

  // Pagina's zonder live-verbinding merken een storing anders pas bij de volgende klik
  setInterval(() => {
    if (!down && !checking && !document.hidden) suspect();
  }, HEARTBEAT_MS);

  window.addEventListener('offline', () => goDown());
  window.addEventListener('online', () => { if (down) retry(); });

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
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

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
        <div class="vsc-icon">${ICON}</div>
        <h2 class="vsc-title"></h2>
        <p class="vsc-text"></p>
        <p class="vsc-safe">Je punten zijn veilig. Inzetten van spellen die door een herstart zijn afgebroken, worden automatisch teruggestort.</p>
        <div class="vsc-status"><span class="vsc-spin" hidden></span><span class="vsc-msg"></span></div>
        <button class="vsc-btn" type="button">Nu opnieuw proberen</button>
      </div>`;
    document.body.append(ov);
    ui = {
      ov,
      box: ov.querySelector('.vsc-box'),
      title: ov.querySelector('.vsc-title'),
      text: ov.querySelector('.vsc-text'),
      spin: ov.querySelector('.vsc-spin'),
      msg: ov.querySelector('.vsc-msg'),
      button: ov.querySelector('.vsc-btn')
    };
    ui.button.addEventListener('click', () => retry());
  }

  function show() {
    if (!ui) build();
    const offline = navigator.onLine === false;
    ui.box.classList.remove('ok');
    ui.title.textContent = offline ? 'Geen internetverbinding' : 'Verbinding met de server kwijt';
    ui.text.textContent = offline
      ? 'Je apparaat is offline. Zodra je weer internet hebt, gaan we verder.'
      : 'De server is even niet bereikbaar, waarschijnlijk wordt de bot herstart. We proberen het automatisch opnieuw.';
    ui.button.hidden = false;
    ui.ov.hidden = false;
    requestAnimationFrame(() => ui.ov.classList.add('show'));
    clearInterval(countdownTimer);
    countdownTimer = setInterval(tickCountdown, 250);
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

  if (document.body) showFirefoxNotice();
  else document.addEventListener('DOMContentLoaded', showFirefoxNotice);
})();
