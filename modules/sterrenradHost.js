/**
 * Sterrenrad host: Max Nova, de presentator van de show.
 * Teksten per moment in de show. {naam} wordt ingevuld met vars; een regel die net gezegd is wordt
 * een tijdje overgeslagen, zodat Max niet in herhaling valt.
 *
 * Stemmingen (mood) bepalen het gezicht op de website: happy, hype, tense, shock, sad, wink, cool.
 */

const crypto = require('crypto');

const LINES = {
  idle: {
    mood: 'wink',
    lines: [
      'Het is stil in de ruimte... té stil. Wie legt de eerste fiche?',
      'Mijn rad staat te trillen van ongeduld. Eén fiche en we vliegen!',
      'Welkom aan boord van het Sterrenrad! Leg een fiche om de ronde te starten.',
      'Ik heb net mijn glitterjasje gestreken. Nu nog spelers...',
      'Weet je wat het mooiste geluid van het heelal is? Een rad dat begint te draaien.',
      'Maanmunt, meteorenmuur, sterrenjacht, wormgat... ze liggen allemaal op de loer.',
      'Ik heb 54 vakken en nul spelers. Dat moet beter kunnen!',
      'Hallo? Is daar iemand? Ik hoor fiches rammelen in jullie zakken.',
      'Psst. Kometen kunnen je inzet tot wel 50 keer laten stijgen. Zeg het tegen niemand.',
      'Ik ben Max Nova, jullie gastheer vanavond. En vannacht. En eigenlijk altijd.',
      'Het rad is gesmeerd, de kometen zijn getankt. Waar blijven jullie?',
      'Even een systeemcheck... rad: ja. Lampjes: ja. Spelers: nee. Probleem gevonden!',
      'In een ver sterrenstelsel heeft iemand ooit 10.000 punten gewonnen. Misschien ben jij de volgende.',
      'Ik loop hier gewoon een rondje over het podium. Niks aan de hand. Leg maar een fiche.',
      'Tip van de host: de bonusvakken zijn zeldzaam, maar o zo lekker.',
      'Ik draai op koffie en jullie enthousiasme. De koffie is op, dus nu jullie!',
      'De sterren staan vandaag gunstig. Zegt mijn horoscoop-module tenminste.',
      'Ik tel tot drie en dan draait er nog steeds niks, want niemand heeft ingezet. Eén... twee...',
      'Munt gepoetst, meteoren gevangen, lasers geladen, wormgat zoemt. Jij nog?',
      'Mijn favoriete getal? Tien. Mijn favoriete bonus? Allemaal.',
      'Kom maar binnen, de ruimte is groot genoeg voor iedereen.',
      'Het rad wil draaien. Ik wil praten. Jij wilt winnen. Iedereen blij!'
    ]
  },
  open: {
    mood: 'hype',
    lines: [
      '{naam} opent de ronde! Fiches op tafel, mensen, we hebben 15 seconden!',
      'Daar gaan we! {naam} trapt af. Wie volgt?',
      'Hoppa, {naam} legt de eerste fiche. De klok tikt!',
      'Motoren aan! {naam} heeft de ronde gestart.',
      '{naam} kon niet langer wachten. Ik ook niet! Inzetten maar!',
      'Ronde geopend door {naam}. Kom op, de rest van de bemanning!',
      'Eerste fiche van {naam}. De ruimte warmt op!',
      'En {naam} is de durfal van deze ronde! Wie durft er nog meer?'
    ]
  },
  join: {
    mood: 'happy',
    lines: [
      'Welkom aan boord, {naam}!',
      '{naam} stapt in. Gordels om!',
      'Hé {naam}! Goed je te zien in deze sector.',
      'Daar is {naam}! Het wordt druk op het dek.',
      '{naam} doet ook mee. De spanning stijgt!',
      'Ik zie het, ik zie het: {naam} heeft ingezet!',
      'Nog een astronaut erbij: {naam}!',
      '{naam} meldt zich. Nu wordt het pas echt leuk.',
      'Kijk eens wie we daar hebben: {naam}!',
      '{naam} sluit aan bij de missie. Succes!'
    ]
  },
  bigBet: {
    mood: 'shock',
    lines: [
      'Wauw, {naam} gaat all-in met {bedrag} punten!',
      '{bedrag} punten van {naam}! Dat noem ik vertrouwen.',
      'Mijn hart slaat over: {naam} zet {bedrag} in!',
      '{naam} speelt niet voor de kleintjes. {bedrag} punten op tafel!',
      'Grote vis aan de lijn! {naam} met {bedrag} punten.',
      'Dat is een flinke stapel, {naam}. {bedrag} punten!'
    ]
  },
  bonusBet: {
    mood: 'wink',
    lines: [
      '{naam} gokt op de {bonus}. Ambitieus!',
      'Ah, {naam} mikt op de {bonus}. Goede smaak.',
      '{naam} heeft een fiche op de {bonus}. Ik voel iets aankomen...',
      'De {bonus}? Gedurfd, {naam}. Heel gedurfd.'
    ]
  },
  hype: {
    mood: 'hype',
    lines: [
      'Fiches op tafel! Het rad wacht op niemand!',
      'Wie gaat er voor de tien? Vier vakken, tien keer je inzet!',
      'Denk aan de kometen: één komeet kan alles veranderen!',
      'Nog even tijd om in te zetten. Twijfel niet te lang!',
      'Eén, twee, vijf of tien? Of durf je een bonus aan?',
      'Het wormgat zoemt al zachtjes achter me...',
      'De meteorenmuur staat te glimmen. Wie durft?',
      'Ik ruik een bonus. Of is dat de raketbrandstof?',
      'De één valt het vaakst, maar de tien betaalt het meest. Kiezen maar!',
      'Spreid je fiches of ga voor één vak. Jij bent de kapitein!',
      'Ik heb het rad net nog geijkt. Alles eerlijk, alles spannend!',
      'Wie wordt de held van deze ronde?',
      'Kom op, kom op! De sterren draaien niet vanzelf!',
      'Een bonus zit eraan te komen. Zegt mijn onderbuik. En die heeft altijd gelijk. Bijna altijd.',
      'Elke fiche is een ticket naar de sterren!',
      'De tafel ziet er prachtig uit. Nog meer kleur graag!'
    ]
  },
  lastCall: {
    mood: 'tense',
    lines: [
      'Laatste kans! Nog een paar seconden!',
      'Snel, snel! De deuren gaan dicht!',
      'Nu of nooit! Laatste fiches!',
      'Vijf... vier... wie twijfelt verliest!',
      'De lancering komt eraan. Laatste oproep!',
      'Laatste oproep voor alle passagiers naar het Sterrenrad!',
      'Bijna te laat! Leg je fiches nu!',
      'Tik tak, tik tak. De klok is niet jouw vriend!'
    ]
  },
  closed: {
    mood: 'cool',
    lines: [
      'Geen inzetten meer! Daar komen de kometen...',
      'De luiken zijn dicht. Kijk omhoog!',
      'Inzetten gesloten. Tijd voor wat sterrenstof!',
      'Rien ne va plus, zoals ze op Mars zeggen. Kometen, jullie zijn aan de beurt!',
      'Klaar is Kees, of hoe die astronaut ook heette. Kometenregen!',
      'Fiches liggen vast. En nu... het hemelgewelf beslist!',
      'Dicht is dicht! Houd de lucht in de gaten.',
      'Alle systemen go! Eerst de kometen, dan het rad.'
    ]
  },
  noComets: {
    mood: 'sad',
    lines: [
      'Hmm, de kometen zijn vandaag verlegen.'
    ]
  },
  comet: {
    mood: 'happy',
    lines: [
      'Inslag! {x} op {vak}!',
      'Een komeet landt op {vak}: {x}!',
      'Boem! {vak} krijgt {x}!',
      '{vak} is geraakt! {x} erbovenop!',
      'Daar is hij: {x} op {vak}!',
      'Kijk die staart! {x} op {vak}.',
      'Sterrenstof op {vak}: {x}!',
      '{vak} glimt nu met {x}.'
    ]
  },
  cometBig: {
    mood: 'shock',
    lines: [
      'WAT?! {x} op {vak}!! Dit is geen komeet, dit is een meteoor!',
      'Hou je vast: {x} op {vak}!',
      'Ik val bijna van het podium: {vak} met {x}!',
      '{x}!! Op {vak}! Wie heeft daar een fiche liggen?!',
      'Een reuzenkomeet! {vak} is nu {x} waard!',
      'Dit gebeurt maar zelden: {x} op {vak}!'
    ]
  },
  spinning: {
    mood: 'hype',
    lines: [
      'Daar gaat het rad!',
      'Draaien maar! Kom op, Sterrenrad!',
      'Iedereen vasthouden, hier komt de draai!',
      'Wiiiiieeee! Kijk hem gaan!',
      'Het rad zoeft door de ruimte!',
      'De lampjes knipperen, het rad draait. Dit is mijn favoriete moment!',
      'Ronde en ronde en ronde... waar stopt hij?',
      'Ik heb er een goed gevoel over. Echt waar. Dit keer wel.',
      'Volle kracht vooruit!',
      'Spinnen maar! Niet kijken als je zenuwachtig bent. Of juist wel!',
      'En... GO!',
      'Kijk die vaart! Het rad heeft er zin in.'
    ]
  },
  slowing: {
    mood: 'tense',
    lines: [
      'Hij gaat langzamer... langzamer...',
      'Bijna... bijna...',
      'Spannend, spannend!',
      'Komt hij op een bonus? Nee? Ja? Nee?',
      'Ik durf niet te kijken. Vertel me straks maar hoe het afliep.',
      'Tik... tik... tik...',
      'Nog één vakje? Of twee?',
      'Hou je adem in!'
    ]
  },
  number1: {
    mood: 'happy',
    lines: [
      'Het is een 1! De betrouwbare oude 1.',
      'Eén! Niet spectaculair, wel winst voor de 1-spelers.',
      'Uno! Een! One! De 1 valt weer.',
      'Daar is de 1. Klein maar fijn.',
      'De 1! Wie daar op stond: verdubbeld!',
      'Eenvoudig maar effectief: de 1.'
    ]
  },
  number2: {
    mood: 'happy',
    lines: [
      'Twee! Driedubbel terug voor de 2-spelers!',
      'Het is een 2! Niet slecht, helemaal niet slecht.',
      'De 2 valt! Twee keer winst plus je inzet terug.',
      'Twee! Twee vrolijke sterren op een rij.',
      'Daar staat de 2. Gefeliciteerd, 2-fans!'
    ]
  },
  number5: {
    mood: 'hype',
    lines: [
      'VIJF! Dat begint ergens op te lijken!',
      'De 5! Vijf keer winst, high five!',
      'Hoppa, de 5! Geef me een high five door het scherm!',
      'Het is een 5! Mooie draai!',
      'Vijf! De 5-spelers mogen dansen!'
    ]
  },
  number10: {
    mood: 'shock',
    lines: [
      'TIEN!! Het zeldzame tiental!',
      'De 10! Tien keer winst! Hoe dan!',
      'Het rad stopt op de 10! Jackpot-gevoel!',
      'TIEN! Ik moet even zitten. Iemand een stoel?',
      'Daar is de 10! Wie heeft die gepakt?!'
    ]
  },
  cometHit: {
    mood: 'shock',
    lines: [
      'En er ligt een komeet op! {x} extra!',
      'Mét komeet! Alles keer {x}!',
      'Dubbel feest: de komeet van {x} telt mee!',
      'Precies op het komeetvak! {x}!',
      'De komeet betaalt uit: {x}!'
    ]
  },
  winners: {
    mood: 'happy',
    lines: [
      '{naam} pakt {bedrag} punten!',
      'Proficiat {naam}: {bedrag} punten erbij!',
      '{naam} cashet {bedrag}! Lekker!',
      'Kassa voor {naam}: {bedrag} punten!',
      '{bedrag} punten richting {naam}. Goed gespeeld!',
      '{naam} vliegt naar huis met {bedrag} punten.'
    ]
  },
  manyWinners: {
    mood: 'happy',
    lines: [
      '{n} winnaars deze ronde! {naam} wint het meest: {bedrag}.',
      'Feest voor {n} spelers! Topscoorder {naam} met {bedrag}.',
      'Wat een ronde: {n} winnaars, met {naam} bovenaan ({bedrag}).'
    ]
  },
  bigWin: {
    mood: 'shock',
    lines: [
      'MEGA-WINST! {naam} pakt {bedrag} punten!',
      'Hou je vast aan je ruimtepak: {naam} wint {bedrag}!',
      'Dit gaat de geschiedenisboeken in: {bedrag} voor {naam}!',
      '{naam}, jij legende! {bedrag} punten!',
      'Iemand moet de bank bellen: {naam} wint {bedrag}!'
    ]
  },
  nobody: {
    mood: 'sad',
    lines: [
      'Niemand stond erop. Het rad is soms gemeen.',
      'Oei, geen winnaars. Volgende keer beter!',
      'De bank wint deze. Maar de nacht is nog jong!',
      'Helaas pindakaas, zoals we in de Melkweg zeggen.',
      'Geen prijs deze keer. Het rad is je niks verschuldigd... maar misschien volgende ronde wel!',
      'Pech in de ruimte. Opnieuw proberen?'
    ]
  },
  streak: {
    mood: 'wink',
    lines: [
      'Al {n} keer op rij een {vak}! Wat is hier aan de hand?',
      '{n} keer {vak} achter elkaar. Het rad heeft een favoriet!',
      'Weer {vak}! Dat is {n} op rij. Toeval? Ja. Maar toch!'
    ]
  },
  drought: {
    mood: 'tense',
    lines: [
      'Al {n} rondes geen bonus... dat kan niet lang meer duren.',
      '{n} draaien zonder bonus. De spanning loopt op!',
      'De bonussen houden zich al {n} rondes schuil. Wie durft?'
    ]
  },

  // ===== BONUS: algemeen =====
  bonusHit: {
    mood: 'shock',
    lines: [
      'BONUS! Het is de {bonus}!',
      'JAAAA! We gaan naar de {bonus}!',
      'Alarm! Alarm! Bonusalarm! De {bonus}!',
      'Het rad kiest de {bonus}! Iedereen naar de lanceerplaats!',
      'Dit is waar we voor leven: de {bonus}!',
      'Riemen vast, we vliegen naar de {bonus}!'
    ]
  },
  bonusEmpty: {
    mood: 'sad',
    lines: [
      'Niemand zit in de {bonus}... we kijken toch even, voor de show!',
      'Een lege {bonus}! Zonde! Laten we zien wat je had kunnen winnen.',
      'De {bonus} zonder spelers. Dat doet pijn. Kijk mee!'
    ]
  },

  nextRound: {
    mood: 'wink',
    lines: [
      'Volgende ronde komt eraan. Fiches klaar?',
      'Even ademhalen... en dan gaan we weer!',
      'Wie durft de volgende ronde te openen?',
      'Het rad koelt even af. Jij ook?',
      'Nog een rondje? Natuurlijk nog een rondje!',
      'Leg je fiche en we vliegen weer!',
      'De show gaat door! Wie opent?',
      'Mijn stem houdt het nog uren vol. Jij ook?'
    ]
  },

  // ===== MAANMUNT =====
  coinIntro: {
    mood: 'hype',
    lines: [
      'Welkom bij de MAANMUNT! Rood of blauw, het lot beslist!',
      'Tijd voor de MAANMUNT! Eén worp, twee kanten, alles kan!',
      'De MAANMUNT! Ik heb hem net gepoetst met sterrenstof.',
      'Kop of munt? Nee: ROOD of BLAUW! Welkom bij de Maanmunt!',
      'Gewichtloos gooien, dat is pas kunst. Hier komt de MAANMUNT!'
    ]
  },
  coinReveal: {
    mood: 'happy',
    lines: [
      'Rood is {rood}, blauw is {blauw}! Kom op, blauw! Of nee, rood!',
      'Op tafel: rood {rood} en blauw {blauw}. Waar gaan we heen?',
      'De kanten zijn geladen: {rood} op rood, {blauw} op blauw!',
      'Rood {rood} tegen blauw {blauw}. Wat een duel!'
    ]
  },
  coinFlip: {
    mood: 'tense',
    lines: [
      'Daar gaat hij... de lucht in!',
      'Opgooien! Kijk hem draaien!',
      'Hoger, hoger! Zonder zwaartekracht kan dit even duren...',
      'Flip! Iedereen stil!',
      'De munt tolt door de ruimte!'
    ]
  },
  coinResult: {
    mood: 'shock',
    lines: [
      'Het is {kant}! {x} voor iedereen!',
      '{kant} wint! Dat is {x}!',
      'De munt kiest {kant}: {x}!',
      'En het wordt... {kant}! {x}, mensen!'
    ]
  },

  // ===== METEORENMUUR =====
  meteorIntro: {
    mood: 'hype',
    lines: [
      'De METEORENMUUR! Ik laat een gloeiende meteoor vallen. Waar komt hij uit?',
      'Welkom bij de METEORENMUUR! Pinnen, vakken en twee DUBBEL-vakken!',
      'Tijd voor de METEORENMUUR! Hopelijk raak ik een DUBBEL...',
      'Ik heb een meteoor gevangen. Nu laat ik hem vallen. Klaar?'
    ]
  },
  meteorDrop: {
    mood: 'tense',
    lines: [
      'Loslaten in drie, twee, één... DAAR GAAT HIJ!',
      'Meteoor los!',
      'Kijk hem stuiteren!',
      'Vallen maar, kleine meteoor!'
    ]
  },
  meteorFalling: {
    mood: 'tense',
    lines: [
      'Links! Nee, rechts!',
      'Tik, tik, tik tegen de pinnen...',
      'Waar gaat hij heen?!',
      'Bijna beneden!',
      'Kom op, naar de grote vakken!',
      'Hij twijfelt! Ik ook!'
    ]
  },
  meteorDouble: {
    mood: 'shock',
    lines: [
      'DUBBEL! Alle vakken ×2! Nog een keer!',
      'DUBBEL!! Alles verdubbelt en ik mag opnieuw!',
      'Ja ja JA! DUBBEL! Nu staat alles op ×{n}!',
      'Dubbelfeest! Weer een meteoor erin!'
    ]
  },
  meteorResult: {
    mood: 'shock',
    lines: [
      'Geland op {x}!',
      'De meteoor kiest {x}! Lekker!',
      'Inslag in het vak van {x}!',
      '{x}! Wat een val!'
    ]
  },

  // ===== STERRENJACHT =====
  huntIntro: {
    mood: 'hype',
    lines: [
      'STERRENJACHT! 108 doelen, allemaal met een verborgen prijs!',
      'Pak je laserkanon! Welkom bij de STERRENJACHT!',
      'Richten, schieten, winnen! Dit is de STERRENJACHT!',
      'Achter elk symbool zit een multiplier. Jij kiest welke je raakt!'
    ]
  },
  huntPick: {
    mood: 'wink',
    lines: [
      'Richt op een doel! Klik op het symbool dat je wilt raken.',
      'Kies je doel! Iedereen schiet op zijn eigen doel.',
      'Gevoel of strategie? Klik een doel aan!',
      'Mik maar! Een planeet? Een ufo? Jij kiest!'
    ]
  },
  huntHurry: {
    mood: 'tense',
    lines: [
      'Nog vier seconden! Kies snel!',
      'Wie niet kiest, schiet ik willekeurig voor!',
      'Laatste kans om te richten!'
    ]
  },
  huntFire: {
    mood: 'hype',
    lines: [
      'VUUR!',
      'Schieten maar! Kijk wat erachter zat!',
      'PIEW PIEW! Daar gaan de lasers!',
      'Alle kanonnen tegelijk: VUUR!'
    ]
  },
  huntResult: {
    mood: 'shock',
    lines: [
      'Beste schot: {naam} met {x}!',
      '{naam} raakt de roos: {x}!',
      'Scherpschutter {naam} pakt {x}!',
      'Wat een schot van {naam}: {x}!'
    ]
  },
  huntMissed: {
    mood: 'sad',
    lines: [
      'Er zat zelfs {x} tussen! Niemand die erop schoot...',
      'Zonde: de grootste prijs was {x}.'
    ]
  },

  // ===== WORMGAT =====
  wormIntro: {
    mood: 'shock',
    lines: [
      'HET WORMGAT! Kom mee door het portaal!',
      'Dit is het moment! Het WORMGAT gaat open!',
      'Grootste bonus van het heelal: het WORMGAT! Tot 20.000×!',
      'Ik voel de zwaartekracht trekken... WORMGAT!'
    ]
  },
  wormPortal: {
    mood: 'hype',
    lines: [
      'We vliegen erdoorheen! Hou je vast!',
      'Woooosh! Welkom aan de andere kant!',
      'Kijk dat reuzenrad! Groter dan een planeet!',
      'We zijn er! Het reuzenrad wacht op ons.'
    ]
  },
  wormPick: {
    mood: 'wink',
    lines: [
      'Kies je wijzer: GROEN, BLAUW of GEEL!',
      'Drie wijzers, drie kansen. Welke kleur is jouw geluk?',
      'Groen, blauw of geel? Kies snel!',
      'Elke wijzer krijgt zijn eigen prijs. Kies verstandig!'
    ]
  },
  wormSpin: {
    mood: 'hype',
    lines: [
      'DRAAIEN! Het reuzenrad komt in beweging!',
      'Daar gaat hij! Kijk die vakken voorbij vliegen!',
      'Het grootste rad van het heelal draait!',
      'Spin it! Volle kracht!'
    ]
  },
  wormDouble: {
    mood: 'shock',
    lines: [
      'DUBBEL! Alles keer twee en we draaien OPNIEUW!',
      'DUBBEL!! Nog een draai, met dubbele prijzen!',
      'Ja! Een DUBBEL! Het wordt alleen maar groter!'
    ]
  },
  wormTriple: {
    mood: 'shock',
    lines: [
      'TRIPEL!!! Alles keer DRIE! Ik ontplof bijna!',
      'TRIPEL! Dit is waanzin! Nog een draai!',
      'DRIE KEER ZOVEEL! Opnieuw draaien!'
    ]
  },
  wormResult: {
    mood: 'shock',
    lines: [
      'Het wormgat sluit! Hoogste prijs: {x}!',
      'Klaar! De beste wijzer pakt {x}!',
      'Wat een reis! Topprijs: {x}!'
    ]
  },
  wormHuge: {
    mood: 'shock',
    lines: [
      '{x}!!! DIT IS HISTORISCH!',
      'IK GELOOF MIJN SENSOREN NIET: {x}!',
      '{x}! Iemand moet dit filmen!'
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
  return { text: fill(choice.text, vars), mood: group.mood };
}

module.exports = { line, LINES };
