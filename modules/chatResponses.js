/**
 * Chat Responses Module
 * Automatische reacties op specifieke berichten
 */

const path = require('path');
const fs = require('fs');

const sixtySevenGifs = [
  'https://media0.giphy.com/media/v1.Y2lkPTZjMDliOTUyYWY0emlrOGRvOThieTF5Z2JnZnllYXV3a3Z0eWlocjVhbWpodzlpYSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/TKa7fQzChHylCQ89to/giphy.gif',
  'https://media.tenor.com/6COMq6z3l5oAAAAM/bosnov-67.gif',
  'https://media.tenor.com/R_SeKejTinEAAAAM/shaquille-o%27neal-shaq.gif',
  'https://media3.giphy.com/media/v1.Y2lkPTZjMDliOTUyMDIzOG5iejVkaml4ZDl6Y201a2NrN3FjbHYzZm4yMm4ydmh6a212MyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/08uBcURaMq6vA93TGc/200.gif',
  'https://media4.giphy.com/media/v1.Y2lkPTZjMDliOTUyMmt1dDJobWlrMDk3bmszank5dHF3bjJ2YWI5Zm44OXVnaGJkcWgxdyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/dYtbmkLlAxoLumhGqv/giphy.gif'
];

// Lijst met chat triggers en responses
const chatTriggers = [
  // Bestaande klassiekers
  { trigger: 'wat', response: 'patat', exactMatch: true },
  { trigger: 'wie', response: 'kiwi', exactMatch: true },
  { trigger: 'waarom', response: 'daarom', exactMatch: true },
  { trigger: 'wanneer', response: 'ooit', exactMatch: true },
  { trigger: 'hoe', response: 'zo', exactMatch: true },
  { trigger: 'waar', response: 'daar', exactMatch: true },
  { trigger: '69', response: 'nice', exactMatch: true },
  { trigger: '67', responses: sixtySevenGifs, exactMatch: false },
  { trigger: '6 7', responses: sixtySevenGifs, exactMatch: false },
  { trigger: 'is het hok open', response: 'Kijk naar mijn status! 👀', exactMatch: false },
  { trigger: 'hok', response: '🐔', exactMatch: true },
  { trigger: 'goedemorgen', response: 'Goedemorgen! ☀️', exactMatch: true },
  { trigger: 'goedenacht', response: 'Slaap lekker! 🌙', exactMatch: true },
  { trigger: 'doei', response: '👋', exactMatch: true },
  { trigger: 'AI', response: 'AI AI THE POWER OF AI', exactMatch: true },
  { trigger: 'SQL', response: '/̵͇̿̿/’̿’̿ ̿ ̿̿ ̿̿ ̿̿', exactMatch: true },
  { trigger: 'uitval', response: 'https://preview.redd.it/memes-about-turning-40-or-getting-old-v0-yeejlvcgh3yb1.png?width=480&format=png&auto=webp&s=5189e5668d3fc3ab5202beea691cbb304bdd593e', exactMatch: true },
  { trigger: 'trein', response: 'https://images-ext-1.discordapp.net/external/mJhIRgTYXq2slTclvT6ZBliWpdJPl6XgN-qiHFFe65s/https/media.tenor.com/seghh0Qr0NIAAAPo/funny-iliketrains.mp4', exactMatch: true },
  { trigger: 'luigi', response: 'https://static.wikia.nocookie.net/thefakegees/images/8/88/Lowigi.png/revision/latest?cb=20141031022916', exactMatch: true },
  { trigger: 'mario', response: 'https://i.etsystatic.com/9001376/r/il/80e3dd/1265604857/il_794xN.1265604857_omj8.jpg', exactMatch: true },
  { trigger: 'wifi', response: 'https://www.youtube.com/watch?v=FfUBYBuSog8', exactMatch: true },
  { trigger: 'tom', response: 'https://tommyteleshopping.com/', exactMatch: true },
  { trigger: 'nick', response: 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fwww.thedailymeal.com%2Fimg%2Fgallery%2F10-things-you-didnt-know-about-snickers%2FGettyImages-511842692_1_.jpg&f=1&nofb=1&ipt=6b558055cad825634767e54c191dc6d9f482e7f08f6868394eabae024b4146d1', exactMatch: true },
  { trigger: 'stijn', response: 'Stijn Barendse, faalt steeds in de theorie!', exactMatch: true, audioFile: 'AI stijn.mp3' }
];

/**
 * Check of een bericht een trigger bevat en stuur response
 * @param {Message} message - Discord message object
 * @returns {boolean} - True als een response is gestuurd
 */
async function handleChatResponse(message) {
  // Negeer bot berichten
  if (message.author.bot) return false;

  const content = message.content.toLowerCase().trim();

  for (const trigger of chatTriggers) {
    let shouldRespond = false;

    if (trigger.exactMatch) {
      // Exacte match (hele bericht moet gelijk zijn)
      if (content === trigger.trigger.toLowerCase()) {
        shouldRespond = true;
      }
    } else {
      // Bevat match (trigger komt ergens in bericht voor)
      if (content.includes(trigger.trigger.toLowerCase())) {
        shouldRespond = true;
      }
    }

    if (shouldRespond) {
      const response = Array.isArray(trigger.responses) && trigger.responses.length > 0
        ? trigger.responses[Math.floor(Math.random() * trigger.responses.length)]
        : trigger.response;

      // Check of er een audio bestand moet worden gestuurd
      if (trigger.audioFile) {
        const audioPath = path.join(__dirname, '..', 'audio', trigger.audioFile);
        
        if (fs.existsSync(audioPath)) {
          await message.reply({
            content: response,
            files: [{
              attachment: audioPath,
              name: trigger.audioFile
            }]
          });
        } else {
          // Als bestand niet bestaat, stuur alleen de tekst
          await message.reply(response);
        }
      } else {
        // Normale response zonder bestand
        await message.reply(response);
      }
      return true;
    }
  }

  return false;
}

module.exports = {
  handleChatResponse,
  chatTriggers
};
