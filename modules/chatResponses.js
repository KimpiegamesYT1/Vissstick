/**
 * Chat Responses Module
 * Automatische reacties op specifieke berichten
 */

// Lijst met chat triggers en responses
const chatTriggers = [
  {
    trigger: 'wat',
    response: 'patat',
    exactMatch: true
  },
  {
    trigger: 'wie',
    response: 'kiwi',
    exactMatch: true
  }
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
