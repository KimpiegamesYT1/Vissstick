/**
 * Sterrenrad host: Stella Nova, de presentatrice van de show.
 * Teksten per moment in de show. {naam} wordt ingevuld met vars; een regel die net gezegd is wordt
 * een tijdje overgeslagen, zodat Stella niet in herhaling valt.
 *
 * Stijl: een presentator die uitlegt wat er gebeurt, spelers bij naam noemt en spanning opbouwt.
 * Korte zinnen, zodat je ze in één keer kunt lezen.
 *
 * Stemmingen (mood) bepalen gezicht en gebaren op de website: happy, hype, tense, shock, sad, wink, cool, jackpot.
 */

const crypto = require('crypto');

const LINES = {
  idle: {
    mood: 'happy',
    lines: [
      'Welkom in het Sterrenrad! Leg een fiche om de volgende ronde te starten.',
      'Het rad staat klaar. Wie zet als eerste in?',
      'Kies een getal of een bonus. Je hebt 15 seconden zodra de ronde begint.',
      'De 1 valt het vaakst, de 10 betaalt het meest. Waar ga jij voor?',
      'Vier bonusspellen wachten: Maanmunt, Meteorenmuur, Sterrenjacht en het Wormgat.',
      'Voor elke draai vallen er kometen. Die maken je winst tot 50 keer zo groot.',
      'Het Wormgat staat maar één keer op het rad. Maar daar ligt wel 20.000× klaar.',
      'Leg je fiches en kijk mee. Iedereen speelt op hetzelfde rad.',
      'Nieuwe ronde? Eén fiche is genoeg om te beginnen.',
      'Tip: spreid je fiches over een getal en een bonus.',
      'De Maanmunt staat vier keer op het rad, de vaakst voorkomende bonus.',
      'Ik ben Stella Nova, en dit is het Sterrenrad. Zet je in?'
    ]
  },
  open: {
    mood: 'hype',
    lines: [
      '{naam} opent de ronde. Iedereen heeft 15 seconden om in te zetten!',
      'De ronde is open dankzij {naam}. Leg je fiches!',
      '{naam} trapt af. Vijftien seconden, mensen!',
      'Daar gaan we: {naam} zet als eerste in. Wie volgt?',
      'Nieuwe ronde, geopend door {naam}. De klok loopt.'
    ]
  },
  join: {
    mood: 'happy',
    lines: [
      'Welkom, {naam}!',
      '{naam} doet ook mee.',
      'Fijn dat je er bent, {naam}.',
      '{naam} heeft ingezet. Succes!',
      'Daar is {naam}. Goed je te zien.'
    ]
  },
  bigBet: {
    mood: 'shock',
    lines: [
      '{naam} zet {bedrag} punten in. Dat is een flinke inzet!',
      '{bedrag} punten van {naam}. Grote ronde!',
      'Wauw, {naam} gaat voor {bedrag} punten.',
      '{naam} legt {bedrag} punten op tafel. Spannend!'
    ]
  },
  bonusBet: {
    mood: 'wink',
    lines: [
      '{naam} heeft een fiche op {bonus}. Goede keuze.',
      '{naam} mikt op {bonus}.',
      '{naam} hoopt op {bonus}. Ik ook!',
      'Ik zie een fiche van {naam} op {bonus}.'
    ]
  },
  hype: {
    mood: 'happy',
    lines: [
      'Nog even tijd om in te zetten.',
      'Twijfel je? Een fiche op de 1 wint het vaakst.',
      'De 10 staat er maar vier keer op, maar betaalt tien keer je inzet.',
      'Zet op een bonus en je speelt mee als het rad erop stopt.',
      'Leg je fiches, straks komen de kometen.',
      'Je kunt meerdere vakken tegelijk kiezen.',
      'Rechtsklik op een vak haalt een fiche weg.',
      'Met "Herhaal" leg je dezelfde fiches als vorige ronde.'
    ]
  },
  lastCall: {
    mood: 'tense',
    lines: [
      'Laatste seconden! Leg je fiches nu.',
      'Nog vijf seconden om in te zetten!',
      'Snel, de inzet sluit bijna.',
      'Laatste kans voor deze ronde!'
    ]
  },
  closed: {
    mood: 'cool',
    lines: [
      'De inzet is gesloten. Kijk omhoog: daar komen de kometen!',
      'Niets gaat meer. Eerst de kometen, dan het rad.',
      'Inzetten gesloten. Welke vakken krijgen een komeet?',
      'Klaar! Laten we zien waar de kometen landen.'
    ]
  },
  noComets: {
    mood: 'sad',
    lines: ['Geen kometen deze keer.']
  },
  comet: {
    mood: 'happy',
    lines: [
      'Een komeet op {vak}: {x}!',
      '{vak} krijgt {x}.',
      'Raak! {x} op {vak}.',
      'Komeet op {vak}. Dat vak is nu {x} waard.'
    ]
  },
  cometBig: {
    mood: 'shock',
    lines: [
      'Een grote komeet! {x} op {vak}!',
      'Kijk dat: {vak} krijgt {x}!',
      '{x} op {vak}! Wie heeft daar een fiche liggen?',
      'Wat een inslag: {x} op {vak}!'
    ]
  },
  spinning: {
    mood: 'hype',
    lines: [
      'Daar gaat het rad!',
      'Het rad draait. Duimen maar!',
      'En... draaien!',
      'Het rad is los. Waar stopt hij?'
    ]
  },
  slowing: {
    mood: 'tense',
    lines: [
      'Hij gaat langzamer...',
      'Bijna stil...',
      'Nog een paar vakjes...',
      'Wordt het een bonus?'
    ]
  },
  number1: {
    mood: 'happy',
    lines: [
      'Het is een 1! Twee keer je inzet terug.',
      'De 1 valt. Winst voor iedereen op de 1.',
      'Een 1! Kleine winst, maar winst.',
      'Daar is de 1 weer.'
    ]
  },
  number2: {
    mood: 'happy',
    lines: [
      'Een 2! Drie keer je inzet terug.',
      'De 2 valt. Mooi voor de 2-spelers!',
      'Het rad kiest de 2.',
      'Twee! Goed gespeeld als je daar stond.'
    ]
  },
  number5: {
    mood: 'hype',
    lines: [
      'Een 5! Zes keer je inzet terug.',
      'De 5 valt. Dat telt lekker op!',
      'Vijf! Mooie winst voor wie erop stond.',
      'Het rad stopt op de 5.'
    ]
  },
  number10: {
    mood: 'shock',
    lines: [
      'De 10! Elf keer je inzet terug!',
      'Tien! De zeldzaamste van de getallen.',
      'Het is een 10! Wie heeft hem?',
      'De 10 valt. Grote winst voor de 10-spelers!'
    ]
  },
  cometHit: {
    mood: 'shock',
    lines: [
      'En er lag een komeet op: alles keer {x}!',
      'Met komeet! De winst gaat keer {x}.',
      'Precies op het komeetvak: {x} extra!',
      'De komeet telt mee: keer {x}!'
    ]
  },
  winners: {
    mood: 'happy',
    lines: [
      'Gefeliciteerd {naam}: {bedrag} punten!',
      '{naam} wint {bedrag} punten.',
      'Mooi gespeeld, {naam}. {bedrag} punten voor jou.',
      '{bedrag} punten gaan naar {naam}.'
    ]
  },
  manyWinners: {
    mood: 'happy',
    lines: [
      '{n} winnaars deze ronde! {naam} pakt het meest: {bedrag}.',
      'Feest voor {n} spelers. Topscore: {naam} met {bedrag}.',
      'Wat een ronde: {n} winnaars, met {naam} bovenaan.'
    ]
  },
  bigWin: {
    mood: 'shock',
    lines: [
      'Grote winst! {naam} pakt {bedrag} punten!',
      '{naam} wint {bedrag} punten. Wat een ronde!',
      'Ongelooflijk: {bedrag} punten voor {naam}!',
      'Dit is een topwinst: {naam} krijgt {bedrag}!'
    ]
  },
  // Jackpot: Stella gaat helemaal los (op de website: dansen, schreeuwen en saltos)
  jackpot: {
    mood: 'jackpot',
    lines: [
      'JAAAAA! JACKPOT! {naam} WINT {bedrag} PUNTEN!!!',
      'NEE NEE NEE! {naam}! {bedrag} PUNTEN! IK WORD GEK!',
      'AAAAH! {bedrag} PUNTEN VOOR {naam}! JACKPOOOT!',
      'WAT GEBEURT ER?! {naam} PAKT {bedrag} PUNTEN!!!'
    ]
  },
  jackpotScream: {
    mood: 'jackpot',
    lines: [
      'IK KAN NIET MEER! KIJK DAN! {bedrag}!!!',
      'DIT IS DE BESTE DAG VAN MIJN LEVEN!',
      'IEMAND HOUD ME VAST! JACKPOOOOT!',
      'SALTO VOOR {naam}! EN NOG EEN!',
      'HET RUIMTESTATION TRILT ERVAN!'
    ]
  },
  jackpotEnd: {
    mood: 'hype',
    lines: [
      'Pfoeh... {naam}, jij bent een legende.',
      'Oké, oké, ik ben er weer. Wat een ronde, {naam}!',
      '{naam}, die {bedrag} punten vergeet ik nooit meer.',
      'Ik moet even zitten. Gefeliciteerd, {naam}!'
    ]
  },
  nobody: {
    mood: 'sad',
    lines: [
      'Deze keer geen winnaars.',
      'Helaas, niemand stond op dat vak.',
      'Geen winst deze ronde. Volgende keer beter!',
      'Het rad was niet in een gulle bui.'
    ]
  },
  streak: {
    mood: 'wink',
    lines: [
      'Al {n} keer op rij {vak}!',
      '{vak} valt voor de {n}e keer achter elkaar.',
      '{n} keer {vak} op rij. Opvallend!'
    ]
  },
  drought: {
    mood: 'tense',
    lines: [
      'Al {n} rondes geen bonus. Die komt vast snel.',
      '{n} draaien zonder bonus. Wie gokt erop?',
      'De bonussen laten al {n} rondes op zich wachten.'
    ]
  },
  nextRound: {
    mood: 'happy',
    lines: [
      'Klaar voor de volgende ronde? Leg je fiches.',
      'Op naar de volgende draai!',
      'Nieuwe ronde, nieuwe kansen. Wie opent?',
      'Zet je weer in? Eén fiche start de ronde.'
    ]
  },

  // ===== BONUS: algemeen =====
  bonusHit: {
    mood: 'shock',
    lines: [
      'Bonus! We gaan naar {bonus}!',
      'Het rad kiest {bonus}!',
      'Daar is hij: {bonus}! Kom mee.',
      'Bonustijd! Op naar {bonus}.'
    ]
  },
  bonusEmpty: {
    mood: 'sad',
    lines: [
      'Niemand speelt mee in {bonus}. We kijken toch even.',
      'Geen fiches op {bonus}. Laten we zien wat het had opgeleverd.',
      'Jammer, niemand in {bonus}. Kijk mee voor de volgende keer.'
    ]
  },

  // ===== MAANMUNT =====
  coinIntro: {
    mood: 'hype',
    lines: [
      'Welkom bij de Maanmunt. Rood of blauw: één worp beslist.',
      'De Maanmunt! Beide kanten krijgen een multiplier, daarna gooi ik.',
      'Maanmunt! Kijk goed naar de twee kanten.'
    ]
  },
  coinReveal: {
    mood: 'happy',
    lines: [
      'Rood is {rood}, blauw is {blauw}.',
      'De kanten staan vast: rood {rood}, blauw {blauw}.',
      'Rood {rood} tegen blauw {blauw}. Waar valt hij?'
    ]
  },
  coinFlip: {
    mood: 'tense',
    lines: [
      'Daar gaat de munt!',
      'Opgooien... en kijk hem draaien.',
      'Hoog in de lucht. Rood of blauw?'
    ]
  },
  coinResult: {
    mood: 'shock',
    lines: [
      'Het is {kant}! Iedereen in de Maanmunt krijgt {x}.',
      '{kant} wint: {x}!',
      'De munt landt op {kant}. Dat is {x}!'
    ]
  },

  // ===== METEORENMUUR =====
  meteorIntro: {
    mood: 'hype',
    lines: [
      'Welkom bij de Meteorenmuur. Ik laat de meteoor vallen en de pinnen bepalen de prijs.',
      'De Meteorenmuur! Valt hij op DUBBEL, dan verdubbelt alles en gooi ik opnieuw.',
      'Meteorenmuur! Zestien vakken. Kijk naar de twee DUBBEL-vakken.'
    ]
  },
  meteorDrop: {
    mood: 'tense',
    lines: [
      'Ik laat los... nu!',
      'Daar gaat de meteoor.',
      'Meteoor los. Volg hem!'
    ]
  },
  meteorFalling: {
    mood: 'tense',
    lines: ['Waar gaat hij heen?']
  },
  meteorDouble: {
    mood: 'shock',
    lines: [
      'DUBBEL! Alle vakken keer twee, en ik gooi opnieuw!',
      'Dubbel! Alles staat nu op ×{n}. Nog een keer!',
      'Wat een geluk: DUBBEL! De meteoor mag nog een keer.'
    ]
  },
  meteorResult: {
    mood: 'shock',
    lines: [
      'Geland op {x}!',
      'De meteoor kiest {x}.',
      '{x} voor iedereen in de Meteorenmuur!'
    ]
  },

  // ===== STERRENJACHT =====
  huntIntro: {
    mood: 'hype',
    lines: [
      'Welkom bij de Sterrenjacht. Achter elk symbool zit een multiplier.',
      'Sterrenjacht! Iedereen kiest zijn eigen doel.',
      'Pak het kanon: 108 doelen, elk met een verborgen prijs.'
    ]
  },
  huntPick: {
    mood: 'wink',
    lines: [
      'Kies je doel! Klik op een symbool.',
      'Waar wil je op schieten? Klik een doel aan.',
      'Je hebt even de tijd. Kies een symbool.'
    ]
  },
  huntHurry: {
    mood: 'tense',
    lines: [
      'Nog een paar seconden! Wie niet kiest, krijgt een willekeurig doel.',
      'Snel, kies je doel!'
    ]
  },
  huntFire: {
    mood: 'hype',
    lines: [
      'Vuur!',
      'Schieten! Kijk wat erachter zat.',
      'Alle kanonnen tegelijk: vuur!'
    ]
  },
  huntResult: {
    mood: 'shock',
    lines: [
      'Beste schot: {naam} met {x}!',
      '{naam} raakt {x}. Mooi gemikt!',
      'Topscore in de Sterrenjacht: {naam} met {x}.'
    ]
  },
  huntMissed: {
    mood: 'sad',
    lines: [
      'Er zat zelfs {x} tussen!',
      'De hoogste prijs was {x}. Volgende keer!'
    ]
  },

  // ===== WORMGAT =====
  wormIntro: {
    mood: 'shock',
    lines: [
      'Het Wormgat! Kom mee door het portaal.',
      'Dit is de grootste bonus: het Wormgat. Tot 20.000×!',
      'Het portaal gaat open. We gaan naar het Wormgat!'
    ]
  },
  wormPortal: {
    mood: 'hype',
    lines: [
      'Welkom aan de andere kant. Kijk dat reuzenrad!',
      'We zijn er. Drie wijzers, één enorm rad.',
      'Dit is het reuzenrad van het Wormgat.'
    ]
  },
  wormPick: {
    mood: 'wink',
    lines: [
      'Kies je wijzer: groen, blauw of geel.',
      'Elke wijzer krijgt zijn eigen prijs. Welke kies jij?',
      'Groen, blauw of geel? Je hebt even de tijd.'
    ]
  },
  wormSpin: {
    mood: 'hype',
    lines: [
      'Het reuzenrad draait!',
      'Daar gaat hij. Kijk naar je wijzer!',
      'Draaien maar!'
    ]
  },
  wormDouble: {
    mood: 'shock',
    lines: [
      'DUBBEL! Die wijzer gaat keer twee en we draaien opnieuw.',
      'Dubbel! Nog een draai met dubbele prijzen.'
    ]
  },
  wormTriple: {
    mood: 'shock',
    lines: [
      'TRIPEL! Keer drie en nog een draai!',
      'Tripel! Dit kan heel groot worden.'
    ]
  },
  wormResult: {
    mood: 'shock',
    lines: [
      'Klaar! De hoogste wijzer pakt {x}.',
      'Het rad staat stil. Topprijs: {x}!',
      'Wat een reis. De beste wijzer: {x}.'
    ]
  },
  wormHuge: {
    mood: 'shock',
    lines: [
      '{x}! Dit is een enorme winst!',
      'Ongelooflijk: {x}!',
      '{x}! Dit vergeten we niet snel.'
    ]
  }
};

const RECENT_SIZE = 40;
const recent = [];

function fill(text, vars) {
  return text.replace(/\{(\w+)\}/g, (match, key) => (vars && vars[key] !== undefined ? String(vars[key]) : match));
}

/**
 * Kies een regel uit een categorie (niet een die net gezegd is)
 * @returns {{text: string, mood: string}}
 */
function line(category, vars) {
  const group = LINES[category];
  if (!group) return { text: '', mood: 'happy' };
  const options = group.lines
    .map((text, index) => ({ text, key: `${category}:${index}` }))
    .filter(o => !recent.includes(o.key));
  const pool = options.length ? options : group.lines.map((text, index) => ({ text, key: `${category}:${index}` }));
  const choice = pool[crypto.randomInt(0, pool.length)];
  recent.push(choice.key);
  if (recent.length > RECENT_SIZE) recent.shift();
  const text = fill(choice.text, vars);
  return { text: text.charAt(0).toUpperCase() + text.slice(1), mood: group.mood };
}

module.exports = { line, LINES };
