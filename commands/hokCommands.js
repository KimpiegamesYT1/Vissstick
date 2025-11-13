const hok = require('../modules/hok');

// Hok slash commands
const hokCommands = [
  {
    name: 'hokhistorie',
    description: 'Toont de openingstijden geschiedenis van het hok'
  },
  {
    name: 'hokstatus',
    description: 'Toont de huidige status van het hok'
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
      const hokHistory = hok.getAllHokHistory(56);
      
      console.log('DEBUG hokHistory keys:', Object.keys(hokHistory));
      console.log('DEBUG hokHistory length:', Object.keys(hokHistory).length);
      
      if (Object.keys(hokHistory).length === 0) {
        await interaction.reply('📊 Nog geen data beschikbaar');
        return true;
      }

    // Sorteer op datum (nieuwste eerst)
    const sortedEntries = Object.entries(hokHistory)
      .sort((a, b) => new Date(b[0]) - new Date(a[0]));

    // Functie om dag van de week te krijgen
    const getDayName = (dateStr) => {
      const days = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
      return days[new Date(dateStr).getDay()];
    };

    // Functie om totale open tijd te berekenen
    const calculateOpenDuration = (openTimes, closeTimes) => {
      if (openTimes.length === 0 || closeTimes.length === 0) return null;
      
      const parseTime = (time) => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
      };

      const firstOpen = parseTime(openTimes[0]);
      const lastClose = parseTime(closeTimes[closeTimes.length - 1]);
      const totalMinutes = lastClose - firstOpen;
      
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      
      return `${hours}u ${minutes}m`;
    };

    // Maak een mooie output per dag
    const stats = sortedEntries.map(([date, times]) => {
      const dayName = getDayName(date);
      const formattedDate = new Date(date).toLocaleDateString('nl-NL', { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
      });
      
      let output = `**${dayName} ${formattedDate}**\n`;
      
      // Toon openingstijden
      if (times.openTimes.length > 0) {
        if (times.openTimes.length === 1) {
          output += `📗 Geopend om **${times.openTimes[0]}**\n`;
        } else {
          output += `📗 Geopend: ${times.openTimes.join(', ')}\n`;
        }
      } else {
        output += `📗 Niet geopend\n`;
      }
      
      // Toon sluitingstijden
      if (times.closeTimes.length > 0) {
        if (times.closeTimes.length === 1) {
          output += `📕 Gesloten om **${times.closeTimes[0]}**\n`;
        } else {
          output += `📕 Gesloten: ${times.closeTimes.join(', ')}\n`;
        }
      } else {
        output += `📕 Nog niet gesloten\n`;
      }
      
      // Bereken en toon totale open tijd
      const duration = calculateOpenDuration(times.openTimes, times.closeTimes);
      if (duration) {
        output += `⏱️ Totaal open: **${duration}**`;
      }
      
      return output;
    }).join('\n\n');

    // Splits in meerdere berichten als het te lang is (Discord limiet is 2000 karakters)
    const maxLength = 1900;
    if (stats.length > maxLength) {
      const messages = [];
      const entries = stats.split('\n\n');
      let currentMessage = '📊 **Hok Geschiedenis**\n\n';
      
      for (const entry of entries) {
        if ((currentMessage + entry + '\n\n').length > maxLength) {
          messages.push(currentMessage);
          currentMessage = entry + '\n\n';
        } else {
          currentMessage += entry + '\n\n';
        }
      }
      if (currentMessage.trim()) {
        messages.push(currentMessage);
      }
      
      // Stuur eerste bericht als reply
      await interaction.reply(messages[0]);
      
      // Stuur rest als follow-ups
      for (let i = 1; i < messages.length; i++) {
        await interaction.followUp(messages[i]);
      }
    } else {
      await interaction.reply(`📊 **Hok Geschiedenis**\n\n${stats}`);
    }
    return true;
    } catch (error) {
      console.error('Fout bij ophalen hok geschiedenis:', error);
      await interaction.reply('❌ Fout bij ophalen van de geschiedenis');
      return true;
    }
  }

  if (commandName === 'hokstatus') {
    try {
      const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
      const res = await fetch(API_URL);
      const data = await res.json();
      
      if (!data || !data.payload) {
        await interaction.reply('❌ Kon status niet ophalen');
        return true;
      }

      const isOpen = data.payload.open === 1;
      const predictedTime = hok.predictOpeningTime(isOpen);
      const predictionMsg = predictedTime ? ` (${isOpen ? 'Sluit' : 'Opent'} meestal rond ${predictedTime})` : '';
      
      await interaction.reply(
        isOpen 
          ? `✅ Het hok is momenteel **open**!${predictionMsg}` 
          : `❌ Het hok is momenteel **dicht**!${predictionMsg}`
      );
    } catch (err) {
      console.error("Fout bij ophalen status:", err);
      await interaction.reply('❌ Fout bij ophalen van de status');
    }
    return true;
  }

  if (commandName === 'hokupdate') {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: '❌ Je hebt geen administrator rechten!', flags: 64 });
      return true;
    }

    // Defer the reply immediately to prevent timeout
    await interaction.deferReply({ ephemeral: true });

    try {
      const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
      const res = await fetch(API_URL);
      const data = await res.json();
      
      if (!data || !data.payload) {
        await interaction.editReply({ content: '❌ Kon status niet ophalen' });
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

      await interaction.editReply({ content: '✅ Hok status succesvol geüpdatet!' });
    } catch (err) {
      console.error("Fout bij updaten status:", err);
      await interaction.editReply({ content: '❌ Fout bij updaten van de status' });
    }
    return true;
  }

  return false;
}

module.exports = {
  hokCommands,
  handleHokCommands
};
