const { EmbedBuilder } = require('discord.js');

// Lijst met .io games — random gekozen door /io
const IO_GAMES = [
  // Klassiek / survival
  'https://agar.io',
  'https://slither.io',
  'https://paper-io.com',
  'https://wormax.io',
  'https://littlebigsnake.com',
  'https://snake.io',
  'https://mope.io',
  'https://deeeep.io',
  'https://splix.io',
  'https://hole.io',
  // Dieren / slang-varianten
  'https://wormate.io',
  'https://snix.io',
  'https://florr.io',
  'https://taming.io',
  'https://evoworld.io',
  'https://evowars.io',
  'https://slimes.io',
  'https://snakeblast.io',
  'https://snowfight.io',
  'https://snowball.io',
  // Shooters
  'https://diep.io',
  'https://krunker.io',
  'https://shellshock.io',
  'https://voxiom.io',
  'https://survev.io',
  'https://kirka.io',
  'https://venge.io',
  'https://gats.io',
  'https://zombsroyale.io',
  'https://warbrokers.io',
  'https://ev.io',
  'https://ninjar.io',
  'https://warbot.io',
  'https://devast.io',
  'https://combatzone.io',
  'https://gobattle.io',
  'https://tankwars.io',
  'https://robostorm.io',
  'https://nitroclash.io',
  'https://waterguns.io',
  // Battle / arena
  'https://moomoo.io',
  'https://bonk.io',
  'https://zombs.io',
  'https://starve.io',
  'https://swordbattle.io',
  'https://territorial.io',
  'https://krew.io',
  'https://brutal.io',
  'https://vertix.io',
  'https://superhex.io',
  'https://massacre.io',
  'https://smashers.io',
  'https://smashkarts.io',
  'https://knifewar.io',
  'https://growwars.io',
  'https://skyfight.io',
  'https://wilds.io',
  'https://doomed.io',
  'https://foes.io',
  'https://bist.io',
  // Ruimte
  'https://starblast.io',
  'https://space.io',
  'https://spaceships.io',
  'https://mk48.io',
  'https://hyperfleet.io',
  'https://astroe.io',
  'https://exocraft.io',
  'https://kazap.io',
  'https://astrix.io',
  'https://booster.space',
  // Racen / party
  'https://flappyroyale.io',
  'https://astrorace.io',
  'https://speedboats.io',
  'https://curvefever.pro',
  'https://zlap.io',
  'https://bumpyball.io',
  'https://freethrow.io',
  'https://dodgeballs.io',
  'https://trains.io',
  'https://baseballbros.io',
  // Puzzel / bordspel
  'https://tetr.io',
  'https://cubes2048.io',
  'https://minesweeper.io',
  'https://connect4.io',
  'https://cardgames.io',
  'https://monopoly.io',
  'https://skribbl.io',
  'https://gartic.io',
  'https://drawbattle.io',
  'https://tictactoe.io',
  // Strategie / overig
  'https://generals.io',
  'https://tribals.io',
  'https://defly.io',
  'https://hexanaut.io',
  'https://bloxd.io',
  'https://powerline.io',
  'https://cursors.io',
  'https://gunbox.io',
  'https://catsvsdogs.io',
  'https://yohoho.io'
];

const ioCommands = [
  {
    name: 'io',
    description: 'Stuurt een random .io game'
  }
];

async function handleIoCommands(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== 'io') return false;

  const url = IO_GAMES[Math.floor(Math.random() * IO_GAMES.length)];

  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription(url)]
  });

  return true;
}

module.exports = {
  ioCommands,
  handleIoCommands,
  IO_GAMES
};
