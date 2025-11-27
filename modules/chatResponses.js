/**
 * Chat Responses Module
 * Automatische reacties op specifieke berichten
 */

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
  { trigger: 'is het hok open', response: 'Kijk naar mijn status! 👀', exactMatch: false },
  { trigger: 'hok', response: '🐔', exactMatch: true },
  { trigger: 'goedemorgen', response: 'Goedemorgen! ☀️', exactMatch: true },
  { trigger: 'goedenacht', response: 'Slaap lekker! 🌙', exactMatch: true },
  { trigger: 'doei', response: '👋', exactMatch: true },
  { trigger: 'SQL', response: '/̵͇̿̿/’̿’̿ ̿ ̿̿ ̿̿ ̿̿🃜🃚🃖🃁🂭🂺', exactMatch: true },
  { trigger: 'tom', response: 'https://tommyteleshopping.com/', exactMatch: false }
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
    if (trigger.exactMatch) {
      // Exacte match (hele bericht moet gelijk zijn)
      if (content === trigger.trigger.toLowerCase()) {
        await message.reply(trigger.response);
        return true;
      }
    } else {
      // Bevat match (trigger komt ergens in bericht voor)
      if (content.includes(trigger.trigger.toLowerCase())) {
        await message.reply(trigger.response);
        return true;
      }
    }
  }

  return false;
}

module.exports = {
  handleChatResponse,
  chatTriggers
};
