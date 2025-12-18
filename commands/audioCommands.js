const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');

const AUDIO_DIR = path.join(__dirname, '..', 'audio');

// Store active connections per guild
const activeConnections = new Map();
const activePlayers = new Map();

/**
 * Get list of available audio files
 */
function getAudioFiles() {
  try {
    if (!fs.existsSync(AUDIO_DIR)) {
      fs.mkdirSync(AUDIO_DIR, { recursive: true });
      return [];
    }

    const files = fs.readdirSync(AUDIO_DIR)
      .filter(file => file.endsWith('.mp3'))
      .map(file => file.replace('.mp3', ''));
    
    return files;
  } catch (error) {
    console.error('Fout bij laden audio bestanden:', error);
    return [];
  }
}

/**
 * Clean up voice connection and player
 */
function cleanupConnection(guildId) {
  const connection = activeConnections.get(guildId);
  const player = activePlayers.get(guildId);

  if (player) {
    player.stop();
    activePlayers.delete(guildId);
  }

  if (connection) {
    connection.destroy();
    activeConnections.delete(guildId);
  }
}

// Audio slash commands
const audioCommands = [
  {
    name: 'audio',
    description: 'Lijst van beschikbare audio bestanden'
  },
  {
    name: 'audioplay',
    description: 'Speel een audio bestand af in je voice channel',
    options: [
      {
        name: 'bestand',
        description: 'Welk audio bestand wil je afspelen?',
        type: 3, // STRING
        required: true,
        autocomplete: true
      }
    ]
  },
  {
    name: 'audiostop',
    description: 'Stop het afspelen van audio en verlaat het voice channel'
  }
];

/**
 * Handle autocomplete for audio files
 */
async function handleAudioAutocomplete(interaction) {
  const focusedValue = interaction.options.getFocused().toLowerCase();
  const audioFiles = getAudioFiles();
  
  const filtered = audioFiles
    .filter(file => file.toLowerCase().includes(focusedValue))
    .slice(0, 25) // Discord limiet
    .map(file => ({ name: file, value: file }));

  await interaction.respond(filtered);
}

/**
 * Handle audio commands
 */
async function handleAudioCommands(interaction, client) {
  const { commandName } = interaction;

  // Handle autocomplete
  if (interaction.isAutocomplete()) {
    if (commandName === 'audioplay') {
      await handleAudioAutocomplete(interaction);
    }
    return true;
  }

  if (commandName === 'audio') {
    try {
      const audioFiles = getAudioFiles();

      if (audioFiles.length === 0) {
        await interaction.reply({
          content: '❌ Geen audio bestanden gevonden. Plaats .mp3 bestanden in de `audio/` folder.',
          flags: 64
        });
        return true;
      }

      const fileList = audioFiles.map(file => `• ${file}`).join('\n');
      await interaction.reply({
        content: `🎵 **Beschikbare audio bestanden:**\n\n${fileList}\n\nGebruik \`/audioplay <bestand>\` om af te spelen.`,
        flags: 64
      });
    } catch (error) {
      console.error('Fout bij tonen audio lijst:', error);
      await interaction.reply({
        content: '❌ Er is een fout opgetreden bij het laden van de audio bestanden.',
        flags: 64
      });
    }
    return true;
  }

  if (commandName === 'audioplay') {
    try {
      const fileName = interaction.options.getString('bestand');
      const filePath = path.join(AUDIO_DIR, `${fileName}.mp3`);

      // Check if user is in voice channel
      const member = interaction.member;
      const voiceChannel = member.voice.channel;

      if (!voiceChannel) {
        await interaction.reply({
          content: '❌ Je moet eerst in een voice channel zitten!',
          flags: 64
        });
        return true;
      }

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        await interaction.reply({
          content: `❌ Audio bestand "${fileName}" niet gevonden. Gebruik \`/audio\` voor een lijst van beschikbare bestanden.`,
          flags: 64
        });
        return true;
      }

      // Defer reply
      await interaction.deferReply({ flags: 64 });

      // Clean up existing connection if any
      cleanupConnection(interaction.guildId);

      // Join voice channel
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator
      });

      activeConnections.set(interaction.guildId, connection);

      // Wait for connection to be ready
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      } catch (error) {
        console.error('Fout bij verbinden met voice channel:', error);
        cleanupConnection(interaction.guildId);
        await interaction.editReply({
          content: '❌ Kon niet verbinden met het voice channel.'
        });
        return true;
      }

      // Create audio player with better settings
      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play
        }
      });
      const resource = createAudioResource(filePath, {
        inlineVolume: true
      });
      
      // Set volume to prevent clipping
      resource.volume.setVolume(0.8);

      activePlayers.set(interaction.guildId, player);

      // Handle player events
      player.on(AudioPlayerStatus.Playing, () => {
        console.log(`🎵 Nu aan het spelen: ${fileName}`);
      });

      player.on(AudioPlayerStatus.Idle, () => {
        console.log(`🎵 Klaar met afspelen: ${fileName}`);
        // Auto disconnect after playing
        setTimeout(() => {
          cleanupConnection(interaction.guildId);
        }, 1000);
      });

      player.on('error', error => {
        console.error('Audio player error:', error);
        cleanupConnection(interaction.guildId);
      });

      // Subscribe connection to player
      connection.subscribe(player);

      // Play audio
      player.play(resource);

      await interaction.editReply({
        content: `🎵 Nu aan het afspelen: **${fileName}**`
      });

    } catch (error) {
      console.error('Fout bij afspelen audio:', error);
      cleanupConnection(interaction.guildId);
      
      if (interaction.deferred) {
        await interaction.editReply({
          content: '❌ Er is een fout opgetreden bij het afspelen van de audio.'
        });
      } else {
        await interaction.reply({
          content: '❌ Er is een fout opgetreden bij het afspelen van de audio.',
          flags: 64
        });
      }
    }
    return true;
  }

  if (commandName === 'audiostop') {
    try {
      const connection = activeConnections.get(interaction.guildId);
      const player = activePlayers.get(interaction.guildId);

      if (!connection && !player) {
        await interaction.reply({
          content: '❌ Er speelt momenteel geen audio af.',
          flags: 64
        });
        return true;
      }

      cleanupConnection(interaction.guildId);

      await interaction.reply({
        content: '⏹️ Audio gestopt en voice channel verlaten.',
        flags: 64
      });

    } catch (error) {
      console.error('Fout bij stoppen audio:', error);
      await interaction.reply({
        content: '❌ Er is een fout opgetreden bij het stoppen van de audio.',
        flags: 64
      });
    }
    return true;
  }

  return false;
}

module.exports = {
  audioCommands,
  handleAudioCommands
};
