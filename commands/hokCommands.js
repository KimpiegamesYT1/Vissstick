const hok = require('../modules/hok');
const { EmbedBuilder } = require('discord.js');

// Hok slash commands
const hokCommands = [
  {
    name: 'hokhistorie',
    description: 'Toont de geschiedenis van het hok voor een specifieke weekdag',
    options: [
      {
        name: 'dag',
        description: 'Welke dag wil je zien?',
        type: 3, // STRING
        required: true,
        choices: [
          { name: 'Maandag', value: '1' },
          { name: 'Dinsdag', value: '2' },
          { name: 'Woensdag', value: '3' },
          { name: 'Donderdag', value: '4' },
          { name: 'Vrijdag', value: '5' },
          { name: 'Zaterdag', value: '6' },
          { name: 'Zondag', value: '0' }
        ]
      }
    ]
  },
  {
    name: 'hokstatus',
    description: 'Toont de huidige status en statistieken van het hok'
  },
  {
    name: 'hokupdate',
    description: 'Update het hok status bericht (alleen voor administrators)'
  }
];

// Handle hok commands
async function handleHokCommands(interaction, client, config, hokState) {
  const { commandName } = interaction;
  const { API_URL, CHANNEL_ID, ROLE_ID } = config;

  if (commandName === 'hokhistorie') {
    try {
      const dayValue = interaction.options.getString('dag');
      const dayNumber = parseInt(dayValue);
      const dayNames = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
      const dayName = dayNames[dayNumber];
      
      const hokHistory = hok.getFilteredHokHistory(120); // 4 maanden, gefilterd op sessies >= 30 min
      
      if (Object.keys(hokHistory).length === 0) {
        await interaction.reply({ embeds: [
          new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('📊 Hok Geschiedenis')
            .setDescription('Nog geen data beschikbaar')
        ]});
        return true;
      }

      // Filter op de gekozen weekdag
      const filteredEntries = Object.entries(hokHistory)
        .filter(([date]) => new Date(date).getDay() === dayNumber)
        .sort((a, b) => new Date(b[0]) - new Date(a[0]));

      if (filteredEntries.length === 0) {
        await interaction.reply({ embeds: [
          new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle(`📊 Hok Geschiedenis - ${dayName}`)
            .setDescription(`Geen data beschikbaar voor ${dayName.toLowerCase()}en`)
        ]});
        return true;
      }

      // Bereken gewogen mediaan statistieken (gebruik centralized functie)
      const statistics = hok.getWeightedStatisticsForWeekday(dayNumber, 120);
      
      const formatMinutes = (mins) => {
        if (mins === null) return 'Geen data';
        const h = Math.floor(mins / 60);
        const m = Math.round(mins % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      };

      const medianOpening = formatMinutes(statistics.medianOpen);
      const medianClosing = formatMinutes(statistics.medianClose);

      // Bouw de geschiedenis lijst (laatste 8 weken)
      const historyLines = filteredEntries.slice(0, 8).map(([date, times]) => {
        const formattedDate = new Date(date).toLocaleDateString('nl-NL', { 
          day: 'numeric', 
          month: 'short'
        });
        
        const openTime = times.openTimes.length > 0 ? times.openTimes[0] : '-';
        const closeTime = times.closeTimes.length > 0 ? times.closeTimes[times.closeTimes.length - 1] : '-';
        
        return `\`${formattedDate}\` 📗 ${openTime} → 📕 ${closeTime}`;
      });

      const embed = new EmbedBuilder()
        .setColor(0x00AA00)
        .setTitle(`📊 Hok Geschiedenis - ${dayName}`)
        .addFields(
          { 
            name: '📈 Gewogen Mediaan (Recente data telt zwaarder)', 
            value: `📗 Opening: **${medianOpening}**\n📕 Sluiting: **${medianClosing}**\n📊 Gebaseerd op ${statistics.sampleCount} ${dayName.toLowerCase()}${statistics.sampleCount === 1 ? '' : 'en'}`,
            inline: false 
          },
          { 
            name: `📅 Laatste ${historyLines.length} ${dayName.toLowerCase()}en`, 
            value: historyLines.join('\n') || 'Geen data',
            inline: false 
          }
        )
        .setFooter({ text: 'Data van de laatste 4 maanden' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      return true;
    } catch (error) {
      console.error('Fout bij ophalen hok geschiedenis:', error);
      await interaction.reply({ embeds: [
        new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Fout')
          .setDescription('Fout bij ophalen van de geschiedenis')
      ]});
      return true;
    }
  }

  if (commandName === 'hokstatus') {
    try {
      const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
      const res = await fetch(API_URL);
      const data = await res.json();
      
      if (!data || !data.payload) {
        await interaction.reply({ embeds: [
          new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Fout')
            .setDescription('Kon status niet ophalen')
        ]});
        return true;
      }

      const isOpen = data.payload.open === 1;
      const prediction = hok.predictOpeningTime(isOpen);
      const predictionText = prediction 
        ? `${isOpen ? 'Sluit' : 'Opent'}${prediction.daysFromNow > 0 ? ' morgen' : ''} meestal rond ${prediction.time}`
        : '';

      const embed = new EmbedBuilder()
        .setColor(isOpen ? 0x00AA00 : 0xAA0000)
        .setTitle(`${isOpen ? '📗' : '📕'} Hok is ${isOpen ? 'OPEN' : 'DICHT'}`)
        .setDescription(predictionText || null);

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error("Fout bij ophalen status:", err);
      await interaction.reply({ embeds: [
        new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Fout')
          .setDescription('Fout bij ophalen van de status')
      ]});
    }
    return true;
  }

  if (commandName === 'hokupdate') {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ 
        embeds: [
          new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Geen toegang')
            .setDescription('Je hebt geen administrator rechten!')
        ],
        flags: 64 
      });
      return true;
    }

    // Defer the reply immediately to prevent timeout
    await interaction.deferReply({ flags: 64 });

    try {
      const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
      const res = await fetch(API_URL);
      const data = await res.json();
      
      if (!data || !data.payload) {
        await interaction.editReply({ 
          embeds: [
            new EmbedBuilder()
              .setColor(0xFF0000)
              .setTitle('❌ Fout')
              .setDescription('Kon status niet ophalen')
          ]
        });
        return true;
      }

      const isOpen = data.payload.open === 1;
      const channel = await client.channels.fetch(CHANNEL_ID);
      const { ActivityType } = require('discord.js');
      
      // Update bot status
      client.user.setActivity(
        isOpen ? 'Hok is open 📗' : 'Hok is dicht 📕',
        { type: ActivityType.Watching }
      );
      
      // Update channel name
      await channel.setName(isOpen ? "📗-hok-is-open" : "📕-hok-is-dicht");
      
      // Remove old message if exists
      if (hokState && hokState.lastMessage) {
        try {
          await hokState.lastMessage.delete();
        } catch (err) {
          console.error("Kon vorig bericht niet verwijderen:", err);
        }
      }

      // Bouw bericht via gedeelde functie (zelfde format als automatisch)
      const statusContent = hok.buildStatusMessage(isOpen, ROLE_ID);

      const message = await channel.send(statusContent);
      
      await message.react('🔔');
      
      if (hokState) {
        hokState.lastMessage = message;
        hokState.lastStatus = isOpen;
      }
      
      // Update database state (altijd timestamp updaten)
      hok.updateHokState(isOpen, message.id);

      await interaction.editReply({ 
        embeds: [
          new EmbedBuilder()
            .setColor(0x00AA00)
            .setTitle('✅ Succes')
            .setDescription('Hok status succesvol geüpdatet!')
        ]
      });
    } catch (err) {
      console.error("Fout bij updaten status:", err);
      await interaction.editReply({ 
        embeds: [
          new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Fout')
            .setDescription('Fout bij updaten van de status')
        ]
      });
    }
    return true;
  }

  return false;
}

module.exports = {
  hokCommands,
  handleHokCommands
};
