/**
 * Website commando's
 * Rocket, Plinko, Slots, Roulette, Sterrenrad, Routegok, Afwassen, Fuiken, de dagelijkse spin en de blackjack tafel worden op de website gespeeld. Deze commando's geven een persoonlijke,
 * eenmalige inloglink waarmee je je Discord account aan de website koppelt.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const rocketAuth = require('../modules/rocketAuth');

const PAGES = {
  rocket: { path: '/rocket', label: 'Open Rocket', intro: '🚀 **Rocket** speel je op de website.' },
  spin: { path: '/spin', label: 'Draai aan het rad', intro: '🎡 Je **dagelijkse spin** staat op de website.' },
  daily: { path: '/spin', label: 'Draai aan het rad', intro: '🎡 Je **dagelijkse spin** staat op de website.' },
  tafel: { path: '/blackjack', label: 'Naar de tafel', intro: '🃏 De **blackjack tafel** staat op de website: speel met maximaal 7 spelers tegen de dealer.' },
  plinko: { path: '/plinko', label: 'Speel Plinko', intro: '🟡 **Plinko** speel je op de website: laat ballen vallen en win tot 1000x je inzet.' },
  slots: { path: '/slots', label: 'Speel Slots', intro: '🍒 **Slots** speel je op de website: een fruitautomaat met 10 niveaus, free spins, jackpots en tot 2500x je inzet.' },
  roulette: { path: '/roulette', label: 'Speel Roulette', intro: '🎯 **Roulette** speel je op de website: één gedeelde Europese roulettetafel, speel mee met de rest. Tot 35x je inzet.' },
  sterrenrad: { path: '/sterrenrad', label: 'Naar het Sterrenrad', intro: '🌌 Het **Sterrenrad** staat op de website: een gameshow in de ruimte met host Astro, kometen en vier bonusspellen. Speel mee met iedereen, tot 20.000x je inzet.' },
  routegok: { path: '/routegok', label: 'Naar Routegok', intro: '🗺️ **Routegok** staat op de website: een willekeurige route ergens op de wereld, met de auto, fiets of te voet. Raad hoeveel minuten hij duurt en in welk land hij ligt. Precies goed = JACKPOT (25x).' },
  fuik: { path: '/fuik', label: 'Naar de vijver', intro: '🎣 **Fuiken** staan op de website: zet je fuiken uit, haal ze elke 15 minuten op voor een paar punten. Wacht niet te lang, anders zwemt je vangst weg!' },
  afwassen: { path: '/afwas', label: 'Naar de keuken', intro: '🧽 **Afwassen** doe je op de website: heb je minder dan 50 punten, dan verdien je 10 punten per schoon bord.' }
};

async function handleWebCommands(interaction, client, config) {
  const page = PAGES[interaction.commandName];
  if (!page) return false;

  const webUrl = (config.ROCKET_WEB_URL || '').replace(/\/+$/, '');
  if (!webUrl) {
    await interaction.reply({ content: 'De website is nog niet ingesteld (`ROCKET_WEB_URL` in config.json).', flags: 64 });
    return true;
  }

  const link = rocketAuth.createLoginLink(webUrl, {
    id: interaction.user.id,
    username: interaction.user.username,
    avatar: interaction.user.displayAvatarURL({ extension: 'png', size: 64 })
  }, page.path);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel(page.label).setStyle(ButtonStyle.Link).setURL(link)
  );

  await interaction.reply({
    content: `${page.intro} Deze knop logt je in als **${interaction.user.username}**.\n` +
      'Deel hem niet: hij werkt één keer en is 10 minuten geldig. Daarna blijf je op dat apparaat ingelogd ' +
      `en kun je gewoon naar ${webUrl}${page.path} gaan.`,
    components: [row],
    flags: 64
  });
  return true;
}

const webCommands = [
  { name: 'rocket', description: 'Krijg je persoonlijke link naar Rocket op de website' },
  { name: 'spin', description: 'Draai aan het dagelijkse rad voor gratis punten' },
  { name: 'daily', description: 'Draai aan het dagelijkse rad voor gratis punten' },
  { name: 'tafel', description: 'Krijg je link naar de online blackjack tafel' },
  { name: 'plinko', description: 'Krijg je persoonlijke link naar Plinko op de website' },
  { name: 'slots', description: 'Krijg je persoonlijke link naar de fruitautomaat op de website' },
  { name: 'roulette', description: 'Krijg je link naar de gedeelde roulettetafel op de website' },
  { name: 'sterrenrad', description: 'Krijg je link naar de Sterrenrad gameshow op de website' },
  { name: 'routegok', description: 'Krijg je link naar Routegok: raad de reistijd van een route ergens op de wereld' },
  { name: 'fuik', description: 'Zet je fuiken uit en haal elk kwartier je vangst op voor punten' },
  { name: 'afwassen', description: 'Blut? Was borden af in de keuken voor punten (onder 50 punten)' }
];

module.exports = {
  webCommands,
  handleWebCommands
};
