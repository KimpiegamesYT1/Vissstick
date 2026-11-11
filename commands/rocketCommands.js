/**
 * Rocket Discord Command
 * Rocket wordt op de website gespeeld. /rocket geeft een persoonlijke, eenmalige inloglink
 * waarmee je je Discord account aan de website koppelt.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const rocketAuth = require('../modules/rocketAuth');

async function handleRocketCommands(interaction, client, config) {
  if (interaction.commandName !== 'rocket') return false;

  const webUrl = (config.ROCKET_WEB_URL || '').replace(/\/+$/, '');
  if (!webUrl) {
    await interaction.reply({ content: 'De Rocket website is nog niet ingesteld (`ROCKET_WEB_URL` in config.json).', flags: 64 });
    return true;
  }

  const code = rocketAuth.createLoginCode({
    id: interaction.user.id,
    username: interaction.user.username,
    avatar: interaction.user.displayAvatarURL({ extension: 'png', size: 64 })
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Open Rocket')
      .setStyle(ButtonStyle.Link)
      .setURL(`${webUrl}/rocket/login?code=${code}`)
  );

  await interaction.reply({
    content: `🚀 **Rocket** speel je op de website. Deze knop logt je in als **${interaction.user.username}**.\n` +
      'Deel hem niet: hij werkt één keer en is 10 minuten geldig. Daarna blijf je op dat apparaat ingelogd ' +
      `en kun je gewoon naar ${webUrl}/rocket gaan.`,
    components: [row],
    flags: 64
  });
  return true;
}

const rocketCommands = [
  {
    name: 'rocket',
    description: 'Krijg je persoonlijke link naar de Rocket website'
  }
];

module.exports = {
  rocketCommands,
  handleRocketCommands
};
