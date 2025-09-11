// installeer eerst met: npm install discord.js node-fetch
const { Client, GatewayIntentBits } = require("discord.js");
// Import fetch for Node.js 18+
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Config
const TOKEN = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; // Token wordt handmatig toegevoegd
const CHANNEL_ID = "1415602058274275361"; // Kanaal dat moet worden aangepast
const API_URL = "https://beheer.syntaxis.nl/api/ishethokalopen";
const ROLE_ID = "1415605138206232606";

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

let lastStatus = null;
let lastMessage = null;
let isInitialized = false;

// Check API functie
async function checkStatus() {
  try {
    const res = await fetch(API_URL);
    const data = await res.json();

    if (!data || !data.payload) return;

    const isOpen = data.payload.open === 1;
    const channel = await client.channels.fetch(CHANNEL_ID);

    if (!channel) return console.error("Kanaal niet gevonden!");

    // Bij eerste keer alleen status opslaan, geen bericht sturen
    if (!isInitialized) {
      lastStatus = isOpen;
      isInitialized = true;
      console.log("Initiële status opgehaald:", isOpen ? "open" : "dicht");
      return;
    }

    // Alleen iets doen als status is veranderd
    if (lastStatus !== isOpen) {
      lastStatus = isOpen;

      // Verwijder vorig bericht als het bestaat
      if (lastMessage) {
        try {
          await lastMessage.delete();
        } catch (err) {
          console.error("Kon vorig bericht niet verwijderen:", err);
        }
      }

      // Naam aanpassen
      await channel.setName(isOpen ? "📗-hok-is-open" : "📕-hok-is-dicht");

      // Nieuw bericht sturen
      const message = await channel.send(
        isOpen ? `✅ Het <@&${ROLE_ID}> is nu **open**!` : `❌ Het <@&${ROLE_ID}> is nu **dicht**!`
      );
      
      // Reactie toevoegen
      await message.react('🔔');
      lastMessage = message;

      console.log("Status gewijzigd:", isOpen ? "open" : "dicht");
    }
  } catch (err) {
    console.error("Fout bij ophalen API:", err);
  }
}

// Reactie handler
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  
  if (reaction.message.id === lastMessage?.id && reaction.emoji.name === '🔔') {
    try {
      const guild = reaction.message.guild;
      const member = await guild.members.fetch(user.id);
      const role = await guild.roles.fetch(ROLE_ID);
      
      if (role) {
        // Toggle role
        if (member.roles.cache.has(ROLE_ID)) {
          await member.roles.remove(role);
          await reaction.message.channel.send(`<@${user.id}> ontvangt niet langer notificaties!`).then(msg => {
            setTimeout(() => msg.delete(), 5000);
          });
        } else {
          await member.roles.add(role);
          await reaction.message.channel.send(`<@${user.id}> ontvangt nu notificaties!`).then(msg => {
            setTimeout(() => msg.delete(), 5000);
          });
        }
        // Remove user's reaction
        await reaction.users.remove(user.id);
      }
    } catch (err) {
      console.error("Fout bij toevoegen rol:", err);
    }
  }
});

// Start de bot
client.once("clientReady", () => {
  console.log(`Bot ingelogd als ${client.user.tag}`);
  checkStatus();
  setInterval(checkStatus, 60 * 1000); // elke minuut checken
});

client.login(TOKEN);
