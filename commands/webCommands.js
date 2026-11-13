/**
 * Website commando's
 * Rocket, Plinko, de dagelijkse spin en de blackjack tafel worden op de website gespeeld. Deze commando's geven een persoonlijke,
 * eenmalige inloglink waarmee je je Discord account aan de website koppelt.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const rocketAuth = require('../modules/rocketAuth');

const PAGES = {
  rocket: { path: '/rocket', label: 'Open Rocket', intro: '🚀 **Rocket** speel je op de website.' },
  spin: { path: '/spin', label: 'Draai aan het rad', intro: '🎡 Je **dagelijkse spin** staat op de website.' },
  daily: { path: '/spin', label: 'Draai aan het rad', intro: '🎡 Je **dagelijkse spin** staat op de website.' },
  tafel: { path: '/blackjack', label: 'Naar de tafel', intro: '🃏 De **blackjack tafel** staat op de website: speel met maximaal 7 spelers tegen de dealer.' },
  plinko: { path: '/plinko', label: 'Speel Plinko', intro: '🟡 **Plinko** speel je op de website: laat ballen vallen en win tot 1000x je inzet.' }
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
  { name: 'plinko', description: 'Krijg je persoonlijke link naar Plinko op de website' }
];

module.exports = {
  webCommands,
  handleWebCommands
};
