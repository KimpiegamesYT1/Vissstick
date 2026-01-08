const { spawn } = require('child_process');
const path = require('path');

const ADMIN_USER_ID = '617675043735863327'; // Floris

// Admin slash commands
const adminCommands = [
  {
    name: 'restart',
    description: '🔴 Restart de bot (alleen voor Floris)'
  }
];

/**
 * Handle admin commands
 */
async function handleAdminCommands(interaction, client) {
  const { commandName } = interaction;

  if (commandName === 'restart') {
    try {
      // Check if user is authorized
      if (interaction.user.id !== ADMIN_USER_ID) {
        await interaction.reply({
          content: '❌ Alleen Floris mag de bot restarten!',
          flags: 64 // Ephemeral
        });
        return true;
      }

      await interaction.reply({
        content: '🔄 Bot wordt herstart... Dit kan een paar seconden duren.',
        flags: 64
      });

      console.log(`🔄 Bot restart geïnitieerd door ${interaction.user.tag}`);

      // Give time for the message to be sent
      setTimeout(() => {
        // Find the startscript path
        const scriptPath = path.join(__dirname, '..', 'startscript');
        
        console.log('🔄 Bot stopt nu en startscript wordt uitgevoerd...');
        
        // Spawn the startscript as a detached process
        const child = spawn('bash', [scriptPath], {
          detached: true,
          stdio: 'ignore'
        });
        
        // Unref so parent can exit
        child.unref();
        
        // Exit the current process
        process.exit(0);
      }, 1000);

    } catch (error) {
      console.error('Fout bij restart:', error);
      
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: '❌ Er is een fout opgetreden bij het restarten van de bot.',
          flags: 64
        });
      } else {
        await interaction.reply({
          content: '❌ Er is een fout opgetreden bij het restarten van de bot.',
          flags: 64
        });
      }
    }
    return true;
  }

  return false;
}

module.exports = {
  adminCommands,
  handleAdminCommands
};
