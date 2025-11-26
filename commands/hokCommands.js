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
      
      const hokHistory = hok.getAllHokHistory(120); // 4 maanden
      
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

      // Bereken statistieken
      const parseTime = (time) => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
      };
      
      const formatMinutes = (mins) => {
        const h = Math.floor(mins / 60);
        const m = Math.round(mins % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      };

      // Verzamel eerste openingen en laatste sluitingen
      const openingTimes = [];
      const closingTimes = [];
      
      filteredEntries.forEach(([, times]) => {
        if (times.openTimes.length > 0) {
          openingTimes.push(parseTime(times.openTimes[0])); // Eerste opening
        }
        if (times.closeTimes.length > 0) {
          closingTimes.push(parseTime(times.closeTimes[times.closeTimes.length - 1])); // Laatste sluiting
        }
      });

      // Bereken gemiddelden
      const avgOpening = openingTimes.length > 0 
        ? formatMinutes(openingTimes.reduce((a, b) => a + b, 0) / openingTimes.length)
        : 'Geen data';
      const avgClosing = closingTimes.length > 0
        ? formatMinutes(closingTimes.reduce((a, b) => a + b, 0) / closingTimes.length)
        : 'Geen data';

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
            name: '📈 Gemiddelden', 
            value: `📗 Opening: **${avgOpening}**\n📕 Sluiting: **${avgClosing}**\n📊 Gebaseerd op ${filteredEntries.length} ${dayName.toLowerCase()}${filteredEntries.length === 1 ? '' : 'en'}`,
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
      const hokHistory = hok.getAllHokHistory(120); // 4 maanden
      
      // Bereken statistieken per weekdag
      const dayNames = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
      const stats = {};
      
      // Initialiseer stats
      for (let i = 0; i < 7; i++) {
        stats[i] = { openings: [], closings: [], count: 0 };
      }
      
      // Verzamel data per weekdag
      Object.entries(hokHistory).forEach(([date, times]) => {
        const dayNum = new Date(date).getDay();
        stats[dayNum].count++;
        
        if (times.openTimes.length > 0) {
          const [h, m] = times.openTimes[0].split(':').map(Number);
          stats[dayNum].openings.push(h * 60 + m);
        }
        if (times.closeTimes.length > 0) {
          const lastClose = times.closeTimes[times.closeTimes.length - 1];
          const [h, m] = lastClose.split(':').map(Number);
          stats[dayNum].closings.push(h * 60 + m);
        }
      });
      
      // Format functie
      const formatMinutes = (mins) => {
        const h = Math.floor(mins / 60);
        const m = Math.round(mins % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      };
      
      // Bouw statistieken tabel
      const statsLines = [];
      for (let i = 1; i <= 6; i++) { // Ma-Za
        const s = stats[i];
        if (s.count === 0) {
          statsLines.push(`**${dayNames[i].substring(0, 2)}** | - | - | 0`);
        } else {
          const avgOpen = s.openings.length > 0 
            ? formatMinutes(s.openings.reduce((a, b) => a + b, 0) / s.openings.length)
            : '-';
          const avgClose = s.closings.length > 0
            ? formatMinutes(s.closings.reduce((a, b) => a + b, 0) / s.closings.length)
            : '-';
          statsLines.push(`**${dayNames[i].substring(0, 2)}** | ${avgOpen} | ${avgClose} | ${s.count}`);
        }
      }
      // Zondag
      const sun = stats[0];
      if (sun.count === 0) {
        statsLines.push(`**Zo** | - | - | 0`);
      } else {
        const avgOpen = sun.openings.length > 0 
          ? formatMinutes(sun.openings.reduce((a, b) => a + b, 0) / sun.openings.length)
          : '-';
        const avgClose = sun.closings.length > 0
          ? formatMinutes(sun.closings.reduce((a, b) => a + b, 0) / sun.closings.length)
          : '-';
        statsLines.push(`**Zo** | ${avgOpen} | ${avgClose} | ${sun.count}`);
      }
      
      // Vandaag info
      const today = new Date();
      const todayKey = today.toISOString().split('T')[0];
      const todayData = hokHistory[todayKey];
      let todayInfo = 'Geen data voor vandaag';
      
      if (todayData) {
        const openTime = todayData.openTimes.length > 0 ? todayData.openTimes[0] : '-';
        const closeTime = todayData.closeTimes.length > 0 ? todayData.closeTimes[todayData.closeTimes.length - 1] : '-';
        todayInfo = `📗 ${openTime} → 📕 ${closeTime}`;
      }
      
      // Voorspelling
      const predictedTime = hok.predictOpeningTime(isOpen);
      const predictionText = predictedTime 
        ? `${isOpen ? 'Sluit' : 'Opent'} meestal rond **${predictedTime}**`
        : 'Geen voorspelling beschikbaar';

      const embed = new EmbedBuilder()
        .setColor(isOpen ? 0x00AA00 : 0xAA0000)
        .setTitle(`${isOpen ? '📗' : '📕'} Hok is ${isOpen ? 'OPEN' : 'DICHT'}`)
        .setDescription(predictionText)
        .addFields(
          {
            name: '📊 Gemiddelden per dag',
            value: `\`Dag\` | \`Open\` | \`Dicht\` | \`#\`\n${statsLines.join('\n')}`,
            inline: false
          },
          {
            name: `📅 Vandaag (${dayNames[today.getDay()]})`,
            value: todayInfo,
            inline: false
          }
        )
        .setFooter({ text: 'Statistieken van de laatste 4 maanden' })
        .setTimestamp();

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

      // Send new message
      const predictedTime = hok.predictOpeningTime(isOpen);
      const predictionMsg = predictedTime ? ` (${isOpen ? 'Sluit' : 'Opent'} meestal rond ${predictedTime})` : '';

      const message = await channel.send(
        isOpen 
          ? `✅ Het <@&${ROLE_ID}> is nu **open**!${predictionMsg}` 
          : `❌ Het <@&${ROLE_ID}> is nu **dicht**!${predictionMsg}`
      );
      
      await message.react('🔔');
      
      if (hokState) {
        hokState.lastMessage = message;
        hokState.lastStatus = isOpen;
      }
      
      // Update database state
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
