/**
 * Online blackjack tafel (website)
 * Eén gedeelde tafel met 7 stoelen en een wachtrij. De server is de baas: schoen, kaarten, timing en uitbetalingen.
 * De browser (web/blackjack.html) speelt alleen de animaties af op basis van de spelstatus.
 *
 * Regels (gangbare casino-regels):
 * - 6 decks, nieuwe schoen zodra de snijkaart (~75%) voorbij is
 * - Dealer staat op alle 17's (ook soft 17), dealer kijkt bij aas/tien open naar blackjack
 * - Blackjack betaalt 3:2, verzekering betaalt 2:1
 * - Verdubbelen op elke eerste twee kaarten, ook na splitsen
 * - Splitsen tot 4 handen (gelijke waarde), gesplitste azen krijgen één kaart, 21 na splitsen is geen blackjack
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const casino = require('./casino');

const SEATS = 7;
const DECKS = 6;
const PENETRATION = 0.75;
const MIN_BET = 10;
const MAX_BET = 500;
const MAX_HANDS_PER_SEAT = 4;
const IDLE_ROUNDS_BEFORE_STANDUP = 3;
const AWAY_GRACE_MS = 20000;        // pagina dicht (of verbinding weg): na 20s automatisch opstaan
const IDLE_STANDUP_MS = 120000;     // 2 minuten aan tafel zonder inzet terwijl er niet gespeeld wordt

// Tijden (ms), afgestemd op het tempo van een echte tafel
const TIMING = {
  betting: 10000,       // vaste inzettijd vanaf de eerste inzet (wordt nooit ingekort of herstart)
  shuffle: 3500,
  deal: 700,            // tussen kaarten bij het delen
  insurance: 9000,
  peek: 1300,
  decision: 15000,      // bedenktijd per hand
  afterAction: 450,
  dealerReveal: 1100,
  dealerDraw: 1000,
  settle: 4500,
  collect: 1300
};

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const events = new EventEmitter();

const table = {
  seats: Array(SEATS).fill(null),
  queue: [],
  shoe: [],
  shoePos: 0,
  cutIndex: 0,
  shoeId: 0,
  roundId: 0,
  phase: 'idle',
  phaseEndsAt: 0,
  dealer: [],
  hands: [],
  activeHandId: null,
  insuranceOpen: false,
  message: null,
  loopRunning: false
};

let decisionWaiter = null;
let bettingTimer = null;

// =====================================================
// KAARTEN
// =====================================================

function cardValue(rank) {
  if (rank === 'A') return 11;
  if (['K', 'Q', 'J', '10'].includes(rank)) return 10;
  return Number(rank);
}

/**
 * Totaal van een hand; soft = er telt een aas als 11
 */
function handTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.hidden) continue;
    total += cardValue(card.rank);
    if (card.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

function isBlackjack(cards) {
  return cards.length === 2 && handTotal(cards).total === 21;
}

function newShoe() {
  const cards = [];
  for (let d = 0; d < DECKS; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push({ rank, suit });
    }
  }
  // Fisher-Yates met crypto
  for (let i = cards.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  table.shoeId++;
  table.shoe = cards.map((c, i) => ({ ...c, id: `${table.shoeId}-${i}` }));
  table.shoePos = 1; // eerste kaart wordt "verbrand"
  // Snijkaart een beetje willekeurig rond 75%
  table.cutIndex = Math.floor(cards.length * (PENETRATION - 0.03 + Math.random() * 0.06));
}

function drawCard(hidden = false) {
  if (table.shoePos >= table.shoe.length) newShoe();
  const card = { ...table.shoe[table.shoePos++] };
  if (hidden) card.hidden = true;
  return card;
}

// =====================================================
// HULP
// =====================================================

function sleep(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function emit() {
  events.emit('update');
}

function say(text) {
  table.message = { text, at: Date.now() };
}

function seatOf(userId) {
  return table.seats.findIndex(s => s && s.userId === userId);
}

function handsOfSeat(seat) {
  return table.hands.filter(h => h.seat === seat);
}

function activeHand() {
  return table.hands.find(h => h.id === table.activeHandId) || null;
}

function fail(message) {
  return { ok: false, message };
}

// =====================================================
// PUBLIEKE STATUS
// =====================================================

function publicCard(card) {
  return card.hidden ? { id: card.id, hidden: true } : { id: card.id, rank: card.rank, suit: card.suit };
}

function getPublicState() {
  const dealerVisible = handTotal(table.dealer);
  return {
    serverNow: Date.now(),
    config: {
      seats: SEATS, decks: DECKS, minBet: MIN_BET, maxBet: MAX_BET,
      decisionMs: TIMING.decision, bettingMs: TIMING.betting, insuranceMs: TIMING.insurance
    },
    phase: table.phase,
    phaseEndsAt: table.phaseEndsAt,
    roundId: table.roundId,
    shoe: { remaining: table.shoe.length - table.shoePos, total: table.shoe.length, cut: table.shoe.length - table.cutIndex },
    dealer: {
      cards: table.dealer.map(publicCard),
      total: dealerVisible.total,
      soft: dealerVisible.soft,
      blackjack: table.dealer.length === 2 && !table.dealer.some(c => c.hidden) && isBlackjack(table.dealer)
    },
    seats: table.seats.map((s, index) => s && {
      index,
      userId: s.userId,
      username: s.username,
      avatar: s.avatar,
      bet: s.bet,
      lastBet: s.lastBet,
      balance: casino.getUserBalance(s.userId),
      insurance: s.insurance,
      insuranceDecided: s.insuranceDecided,
      leaving: s.leaving,
      streak: s.streak
    }),
    hands: table.hands.map(h => {
      const { total, soft } = handTotal(h.cards);
      return {
        id: h.id, seat: h.seat, cards: h.cards.map(publicCard), bet: h.bet, doubled: h.doubled,
        fromSplit: h.fromSplit, splitAces: h.splitAces, total, soft, status: h.status, result: h.result, payout: h.payout
      };
    }),
    activeHandId: table.activeHandId,
    awaitingDecision: Boolean(decisionWaiter),
    allowed: decisionWaiter && activeHand() ? allowedActions(activeHand()) : null,
    queue: table.queue.map(q => ({ userId: q.userId, username: q.username, avatar: q.avatar })),
    message: table.message
  };
}

// =====================================================
// STOELEN & WACHTRIJ
// =====================================================

function fillSeatsFromQueue() {
  for (let i = 0; i < SEATS && table.queue.length > 0; i++) {
    if (table.seats[i]) continue;
    const next = table.queue.shift();
    table.seats[i] = newSeat(next);
  }
}

function newSeat(user) {
  return {
    userId: user.id || user.userId, username: user.username, avatar: user.avatar,
    bet: 0, lastBet: 0, idleRounds: 0, idleSince: Date.now(), leaving: false, insurance: 0, insuranceDecided: false, streak: 0
  };
}

// =====================================================
// AANWEZIGHEID
// Wie de tafelpagina sluit, blijft anders voor altijd zitten (zonder inzetten start er nooit een ronde)
// =====================================================

const presence = new Map(); // userId -> { count, goneSince }

function presenceOf(userId) {
  if (!presence.has(userId)) presence.set(userId, { count: 0, goneSince: Date.now() });
  return presence.get(userId);
}

/**
 * Een browser opent de live verbinding van de tafel
 */
function connect(userId) {
  const p = presenceOf(userId);
  p.count++;
  p.goneSince = null;
}

/**
 * Een browser sluit de live verbinding
 */
function disconnect(userId) {
  const p = presenceOf(userId);
  p.count = Math.max(0, p.count - 1);
  if (p.count === 0) p.goneSince = Date.now();
}

function isAway(userId, now) {
  const p = presenceOf(userId);
  return p.count === 0 && now - p.goneSince > AWAY_GRACE_MS;
}

function sweepAbsent() {
  const now = Date.now();
  const inRound = table.phase !== 'idle' && table.phase !== 'betting';
  let changed = false;

  const before = table.queue.length;
  table.queue = table.queue.filter(q => !isAway(q.userId, now));
  if (table.queue.length !== before) changed = true;

  table.seats.forEach((seat, index) => {
    if (!seat) return;
    const away = isAway(seat.userId, now);
    const idle = !inRound && seat.bet === 0 && now - seat.idleSince > IDLE_STANDUP_MS;
    if (!away && !idle) return;
    if (inRound && handsOfSeat(index).length > 0) {
      // Midden in een ronde: hand past automatisch, opstaan na de ronde
      if (!seat.leaving) { seat.leaving = true; changed = true; }
      return;
    }
    removeSeat(index);
    changed = true;
  });

  if (changed) {
    checkBettingState();
    emit();
  }
}
setInterval(sweepAbsent, 5000).unref();

function sit(user, seatIndex) {
  if (seatOf(user.id) !== -1) return fail('Je zit al aan tafel.');
  if (table.queue.some(q => q.userId === user.id)) return fail('Je staat al in de wachtrij.');
  casino.getOrCreateUser(user.id, user.username);

  const freeSeat = table.seats.findIndex(s => !s);
  if (freeSeat === -1) {
    table.queue.push({ userId: user.id, username: user.username, avatar: user.avatar });
    emit();
    return { ok: true, message: `De tafel is vol. Je staat in de wachtrij op plek ${table.queue.length}.` };
  }

  const index = Number.isInteger(seatIndex) && seatIndex >= 0 && seatIndex < SEATS && !table.seats[seatIndex] ? seatIndex : freeSeat;
  table.seats[index] = newSeat(user);
  emit();
  return { ok: true, message: `Je zit op stoel ${index + 1}.${table.phase === 'idle' || table.phase === 'betting' ? ' Zet in om mee te spelen.' : ' Je speelt mee vanaf de volgende ronde.'}` };
}

function removeSeat(index) {
  const seat = table.seats[index];
  if (!seat) return;
  if (seat.bet > 0) casino.addBalance(seat.userId, seat.username, seat.bet, 'Blackjack tafel: inzet terug');
  table.seats[index] = null;
  fillSeatsFromQueue();
}

function standUp(user) {
  const queueIndex = table.queue.findIndex(q => q.userId === user.id);
  if (queueIndex !== -1) {
    table.queue.splice(queueIndex, 1);
    emit();
    return { ok: true, message: 'Je staat niet meer in de wachtrij.' };
  }
  const index = seatOf(user.id);
  if (index === -1) return fail('Je zit niet aan tafel.');

  const inRound = table.phase !== 'idle' && table.phase !== 'betting';
  if (inRound && handsOfSeat(index).length > 0) {
    table.seats[index].leaving = true;
    emit();
    return { ok: true, message: 'Je staat op na deze ronde.' };
  }
  removeSeat(index);
  checkBettingState();
  emit();
  return { ok: true, message: 'Je bent opgestaan.' };
}

// =====================================================
// INZETTEN
// =====================================================

function placeBet(user, amountInput) {
  const index = seatOf(user.id);
  if (index === -1) return fail('Ga eerst aan tafel zitten.');
  if (table.phase !== 'idle' && table.phase !== 'betting') return fail('Inzetten kan pas weer na deze ronde.');

  const seat = table.seats[index];
  const amount = Math.floor(Number(amountInput));
  if (!Number.isFinite(amount) || amount < 0) return fail('Ongeldige inzet.');
  if (amount !== 0 && (amount < MIN_BET || amount > MAX_BET)) return fail(`De inzet moet tussen ${MIN_BET} en ${MAX_BET} punten liggen.`);

  const difference = amount - seat.bet;
  if (difference > 0) {
    const balance = casino.getUserBalance(user.id);
    if (balance < difference) return fail(`Niet genoeg punten: je wilt ${amount} inzetten, maar je hebt er nog ${balance + seat.bet}.`);
    casino.subtractBalance(user.id, difference);
  } else if (difference < 0) {
    casino.addBalance(user.id, user.username, -difference, 'Blackjack tafel: inzet verlaagd');
  }
  seat.bet = amount;
  seat.leaving = false;
  seat.idleSince = Date.now();
  checkBettingState();
  emit();
  return { ok: true, message: amount ? `Inzet: ${amount} punten.` : 'Inzet weggehaald.' };
}

/**
 * Start of verkort de inzet-timer afhankelijk van wie er heeft ingezet
 */
function checkBettingState() {
  if (table.phase !== 'idle' && table.phase !== 'betting') return;
  const seated = table.seats.filter(Boolean);
  const betting = seated.filter(s => s.bet > 0);

  // Een lopende aftelling blijft gewoon doorlopen, ook als iemand zijn inzet weghaalt
  // (zonder inzetten gaat de tafel na afloop vanzelf terug naar wachten)
  if (table.phase === 'betting' || betting.length === 0) return;
  const now = Date.now();
  table.phase = 'betting';
  table.phaseEndsAt = now + TIMING.betting;
  clearTimeout(bettingTimer);
  bettingTimer = setTimeout(() => runRound().catch(err => console.error('Blackjack ronde fout:', err)), TIMING.betting);
}

// =====================================================
// RONDE
// =====================================================

async function runRound() {
  if (table.loopRunning || table.phase !== 'betting') return;
  table.loopRunning = true;
  try {
    await playRound();
  } catch (error) {
    console.error('Blackjack: fout tijdens ronde, inzetten worden teruggestort', error);
    refundRound();
  } finally {
    table.loopRunning = false;
    table.hands = [];
    table.dealer = [];
    table.activeHandId = null;
    table.phase = 'idle';
    table.phaseEndsAt = 0;
    for (let i = 0; i < SEATS; i++) {
      if (table.seats[i] && table.seats[i].leaving) removeSeat(i);
      else if (table.seats[i]) table.seats[i].idleSince = Date.now();
    }
    fillSeatsFromQueue();
    checkBettingState();
    emit();
  }
}

function refundRound() {
  for (const hand of table.hands) {
    if (hand.result) continue;
    const seat = table.seats[hand.seat];
    if (seat) casino.addBalance(seat.userId, seat.username, hand.bet, 'Blackjack tafel: terugbetaling');
  }
}

async function phase(name, ms, message) {
  table.phase = name;
  table.phaseEndsAt = ms ? Date.now() + ms : 0;
  if (message !== undefined) say(message);
  emit();
  if (ms) await sleep(ms);
}

async function playRound() {
  clearTimeout(bettingTimer);
  table.roundId++;
  table.message = null;

  // Inzetten vastzetten
  table.hands = [];
  table.seats.forEach((seat, index) => {
    if (!seat) return;
    seat.insurance = 0;
    seat.insuranceDecided = false;
    if (seat.bet > 0) {
      table.hands.push({ id: `${table.roundId}-${index}-0`, seat: index, cards: [], bet: seat.bet, doubled: false, fromSplit: false, splitAces: false, status: 'waiting', result: null, payout: 0 });
      seat.lastBet = seat.bet;
      seat.bet = 0;
      seat.idleRounds = 0;
    } else {
      seat.idleRounds++;
      if (seat.idleRounds >= IDLE_ROUNDS_BEFORE_STANDUP) seat.leaving = true;
    }
  });
  if (table.hands.length === 0) return;

  // Nieuwe schoen als de snijkaart voorbij is
  if (table.shoe.length === 0 || table.shoePos >= table.cutIndex) {
    newShoe();
    await phase('shuffle', TIMING.shuffle, 'De kaarten worden geschud');
  }

  // Delen: rondje kaarten, dealer open, rondje kaarten, dealer dicht
  await phase('dealing', 0, null);
  for (let pass = 0; pass < 2; pass++) {
    for (const hand of table.hands) {
      hand.cards.push(drawCard());
      emit();
      await sleep(TIMING.deal);
    }
    table.dealer.push(drawCard(pass === 1));
    emit();
    await sleep(TIMING.deal);
  }
  for (const hand of table.hands) {
    hand.status = isBlackjack(hand.cards) ? 'blackjack' : 'waiting';
  }

  const up = table.dealer[0];
  const hole = table.dealer[1];
  const dealerHasBlackjack = cardValue(up.rank) + cardValue(hole.rank) === 21;

  // Verzekering bij een aas
  if (up.rank === 'A') {
    table.insuranceOpen = true;
    await waitForInsurance();
    table.insuranceOpen = false;
  }

  // Dealer kijkt bij aas of tien
  if (up.rank === 'A' || cardValue(up.rank) === 10) {
    await phase('peek', TIMING.peek, 'Dealer controleert op blackjack');
    if (dealerHasBlackjack) {
      delete hole.hidden;
      say('Dealer heeft blackjack!');
      payInsurance(true);
      emit();
      await sleep(TIMING.dealerReveal);
      await settle();
      return;
    }
    if (up.rank === 'A') {
      payInsurance(false);
      say('Geen blackjack, het spel gaat door');
    } else {
      say(null);
    }
    emit();
  }

  // Spelers aan de beurt, van stoel 1 tot 7
  await phase('playing', 0);
  for (let i = 0; i < table.hands.length; i++) {
    const hand = table.hands[i];
    if (hand.status === 'blackjack') continue;
    await playHand(hand);
  }
  table.activeHandId = null;

  // Dealer
  await phase('dealer', 0, null);
  delete hole.hidden;
  emit();
  await sleep(TIMING.dealerReveal);

  const liveHands = table.hands.filter(h => h.status === 'stand' || h.status === 'doubled');
  if (liveHands.length > 0) {
    while (handTotal(table.dealer).total < 17) {
      table.dealer.push(drawCard());
      emit();
      await sleep(TIMING.dealerDraw);
    }
  }
  const dealerTotal = handTotal(table.dealer).total;
  say(dealerTotal > 21 ? `Dealer gaat over 21 (${dealerTotal})!` : `Dealer heeft ${dealerTotal}`);
  await settle();
}

async function playHand(hand) {
  table.activeHandId = hand.id;
  hand.status = 'playing';

  // Tweede kaart voor een gesplitste hand
  if (hand.cards.length === 1) {
    emit();
    await sleep(TIMING.deal * 0.6);
    hand.cards.push(drawCard());
    emit();
    await sleep(TIMING.deal);
    if (hand.splitAces) {
      hand.status = 'stand';
      return;
    }
  }

  while (hand.status === 'playing') {
    if (handTotal(hand.cards).total >= 21) {
      hand.status = handTotal(hand.cards).total > 21 ? 'bust' : 'stand';
      break;
    }
    const seat = table.seats[hand.seat];
    const action = seat && !seat.leaving ? await waitForDecision(hand) : 'stand';
    await applyAction(hand, action);
  }
  emit();
  await sleep(TIMING.afterAction);
}

function waitForDecision(hand) {
  table.phaseEndsAt = Date.now() + TIMING.decision;
  const decision = new Promise(resolve => {
    const timer = setTimeout(() => {
      decisionWaiter = null;
      resolve('stand');
    }, TIMING.decision);
    decisionWaiter = { handId: hand.id, resolve: action => { clearTimeout(timer); decisionWaiter = null; resolve(action); } };
  });
  emit();
  return decision;
}

async function applyAction(hand, action) {
  const seat = table.seats[hand.seat];
  if (action === 'stand') {
    hand.status = 'stand';
    return;
  }
  if (action === 'hit') {
    hand.cards.push(drawCard());
    emit();
    await sleep(TIMING.deal);
    const { total } = handTotal(hand.cards);
    if (total > 21) hand.status = 'bust';
    else if (total === 21) hand.status = 'stand';
    return;
  }
  if (action === 'double') {
    casino.subtractBalance(seat.userId, hand.bet);
    hand.bet *= 2;
    hand.doubled = true;
    emit();
    await sleep(TIMING.afterAction);
    hand.cards.push(drawCard());
    emit();
    await sleep(TIMING.deal);
    hand.status = handTotal(hand.cards).total > 21 ? 'bust' : 'doubled';
    return;
  }
  if (action === 'split') {
    casino.subtractBalance(seat.userId, hand.bet);
    const aces = hand.cards[0].rank === 'A';
    const second = hand.cards.pop();
    const index = table.hands.indexOf(hand);
    const splitCount = handsOfSeat(hand.seat).length;
    const newHand = {
      id: `${table.roundId}-${hand.seat}-${splitCount}`, seat: hand.seat, cards: [second], bet: hand.bet,
      doubled: false, fromSplit: true, splitAces: aces, status: 'waiting', result: null, payout: 0
    };
    hand.fromSplit = true;
    hand.splitAces = aces;
    table.hands.splice(index + 1, 0, newHand);
    emit();
    await sleep(TIMING.deal * 0.8);
    hand.cards.push(drawCard());
    emit();
    await sleep(TIMING.deal);
    if (aces) hand.status = 'stand';
  }
}

/**
 * Welke acties mag deze hand nu doen?
 */
function allowedActions(hand) {
  const seat = table.seats[hand.seat];
  const balance = seat ? casino.getUserBalance(seat.userId) : 0;
  const twoCards = hand.cards.length === 2;
  const pair = twoCards && cardValue(hand.cards[0].rank) === cardValue(hand.cards[1].rank);
  return {
    hit: true,
    stand: true,
    double: twoCards && balance >= hand.bet,
    split: pair && !(hand.splitAces) && handsOfSeat(hand.seat).length < MAX_HANDS_PER_SEAT && balance >= hand.bet
  };
}

function act(user, action) {
  if (!['hit', 'stand', 'double', 'split'].includes(action)) return fail('Onbekende actie.');
  const hand = activeHand();
  if (table.phase !== 'playing' || !hand || hand.status !== 'playing') return fail('Je bent niet aan de beurt.');
  const seat = table.seats[hand.seat];
  if (!seat || seat.userId !== user.id) return fail('Je bent niet aan de beurt.');
  if (!decisionWaiter || decisionWaiter.handId !== hand.id) return fail('Even wachten…');

  const allowed = allowedActions(hand);
  if (!allowed[action]) {
    if (action === 'double') return fail(hand.cards.length !== 2 ? 'Verdubbelen kan alleen op je eerste twee kaarten.' : 'Niet genoeg punten om te verdubbelen.');
    if (action === 'split') return fail('Splitsen kan alleen met twee kaarten van dezelfde waarde (max 4 handen, genoeg punten).');
  }
  decisionWaiter.resolve(action);
  return { ok: true, message: null };
}

// =====================================================
// VERZEKERING
// =====================================================

async function waitForInsurance() {
  table.phase = 'insurance';
  table.phaseEndsAt = Date.now() + TIMING.insurance;
  say('Verzekering? Dealer toont een aas');
  emit();
  const deadline = table.phaseEndsAt;
  while (Date.now() < deadline) {
    const undecided = table.hands.some(h => {
      const seat = table.seats[h.seat];
      return seat && !seat.insuranceDecided && !seat.leaving;
    });
    if (!undecided) break;
    await sleep(200);
  }
}

function insurance(user, take) {
  if (table.phase !== 'insurance') return fail('Verzekering kan nu niet.');
  const index = seatOf(user.id);
  const hand = table.hands.find(h => h.seat === index);
  if (index === -1 || !hand) return fail('Je speelt deze ronde niet mee.');
  const seat = table.seats[index];
  if (seat.insuranceDecided) return fail('Je hebt al gekozen.');

  if (take) {
    const cost = Math.floor(hand.bet / 2);
    if (casino.getUserBalance(user.id) < cost) return fail('Niet genoeg punten voor de verzekering.');
    casino.subtractBalance(user.id, cost);
    seat.insurance = cost;
  }
  seat.insuranceDecided = true;
  emit();
  return { ok: true, message: take ? `Verzekerd voor ${seat.insurance} punten.` : 'Geen verzekering.' };
}

function payInsurance(dealerBlackjack) {
  for (const seat of table.seats) {
    if (!seat || !seat.insurance) continue;
    if (dealerBlackjack) {
      casino.addBalance(seat.userId, seat.username, seat.insurance * 3, 'Blackjack tafel: verzekering');
    }
  }
}

// =====================================================
// UITBETALEN
// =====================================================

async function settle() {
  const dealer = handTotal(table.dealer).total;
  const dealerBlackjack = isBlackjack(table.dealer);

  for (const hand of table.hands) {
    const { total } = handTotal(hand.cards);
    const natural = hand.status === 'blackjack' && !hand.fromSplit;
    let result;
    if (natural && !dealerBlackjack) result = 'blackjack';
    else if (natural && dealerBlackjack) result = 'push';
    else if (dealerBlackjack) result = 'lose';
    else if (total > 21) result = 'lose';
    else if (dealer > 21 || total > dealer) result = 'win';
    else if (total === dealer) result = 'push';
    else result = 'lose';

    hand.result = result;
    hand.payout = result === 'blackjack' ? hand.bet + Math.floor(hand.bet * 1.5)
      : result === 'win' ? hand.bet * 2
      : result === 'push' ? hand.bet
      : 0;
    if (hand.status === 'playing' || hand.status === 'waiting') hand.status = 'stand';

    const seat = table.seats[hand.seat];
    if (seat && hand.payout > 0) {
      casino.addBalance(seat.userId, seat.username, hand.payout, `Blackjack tafel: ${result}`);
    }
  }
  updateStreaks();
  await phase('settle', TIMING.settle);
  await phase('collect', TIMING.collect);
}

/**
 * Winstreeks per speler: winst telt op, push laat de reeks staan, verlies zet hem op 0
 */
function updateStreaks() {
  let best = null;
  table.seats.forEach((seat, index) => {
    const hands = handsOfSeat(index);
    if (!seat || hands.length === 0) return;
    const net = hands.reduce((sum, h) => sum + h.payout - h.bet, 0);
    if (net > 0) seat.streak++;
    else if (net < 0) seat.streak = 0;
    if (net > 0 && seat.streak >= 3 && (!best || seat.streak > best.streak)) best = seat;
  });
  if (best) say(`${best.username} wint ${best.streak} keer op rij!`);
}

module.exports = {
  events,
  getPublicState,
  sit,
  standUp,
  placeBet,
  act,
  insurance,
  connect,
  disconnect,
  // Voor tests / simulatie
  _internals: { handTotal, isBlackjack, cardValue, newShoe, TIMING, table }
};
