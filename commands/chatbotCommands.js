const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { resetConversation, getConversationStats } = require('../modules/chatbot');

// =====================================================
// COMMAND DEFINITIONS
// =====================================================

const chatbotCommands = [
    new SlashCommandBuilder()
        .setName('chatbot')
        .setDescription('Chatbot beheer commando\'s (admin only)')
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset de huidige conversatie en start opnieuw')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('Toon statistieken van de huidige conversatie')
        )
];

// =====================================================
// COMMAND HANDLERS
// =====================================================

async function handleChatbotCommands(interaction, client, config) {
    if (interaction.commandName !== 'chatbot') {
        return false;
    }

    // Check admin permissions
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Je hebt geen permissie om dit commando te gebruiken.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    const subcommand = interaction.options.getSubcommand();

    try {
        if (subcommand === 'reset') {
            await handleReset(interaction, client, config);
        } else if (subcommand === 'stats') {
            await handleStats(interaction, config);
        }
    } catch (error) {
        console.error('[CHATBOT COMMANDS] Error:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Fout')
            .setDescription('Er ging iets mis bij het uitvoeren van het commando.')
            .setColor('#FF0000')
            .setTimestamp();

        if (interaction.deferred) {
            await interaction.editReply({ embeds: [errorEmbed] });
        } else if (interaction.replied) {
            await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
    }

    return true;
}

// =====================================================
// SUBCOMMAND HANDLERS
// =====================================================

async function handleReset(interaction, client, config) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channelId = config.CHATBOT_CHANNEL_ID;
    const success = resetConversation(channelId);

    const embed = new EmbedBuilder()
        .setTimestamp()
        .setColor(success ? '#00FF00' : '#FFA500');

    if (success) {
        embed
            .setTitle('✅ Conversatie gereset')
            .setDescription('De chatbot conversatie is gereset. De volgende berichten starten een nieuwe conversatie.');
    } else {
        embed
            .setTitle('ℹ️ Geen actieve conversatie')
            .setDescription('Er was geen actieve conversatie om te resetten.');
    }

    await interaction.editReply({ embeds: [embed] });

    // Log action
    const logChannel = await client.channels.fetch(config.LOG_CHANNEL_ID).catch(() => null);
    if (logChannel) {
        const logEmbed = new EmbedBuilder()
            .setTitle('🤖 Chatbot Conversatie Reset')
            .addFields(
                { name: 'Admin', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                { name: 'Status', value: success ? 'Gereset' : 'Geen actieve conversatie', inline: true }
            )
            .setColor('#0099ff')
            .setTimestamp();

        await logChannel.send({ embeds: [logEmbed] }).catch(err => 
            console.error('[CHATBOT COMMANDS] Kon niet loggen:', err)
        );
    }
}

async function handleStats(interaction, config) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channelId = config.CHATBOT_CHANNEL_ID;
    const stats = getConversationStats(channelId);

    const embed = new EmbedBuilder()
        .setTimestamp()
        .setColor('#0099ff');

    if (!stats) {
        embed
            .setTitle('ℹ️ Geen actieve conversatie')
            .setDescription('Er is momenteel geen actieve chatbot conversatie.');
    } else {
        const rl = stats.rateLimiterStatus;
        
        embed
            .setTitle('📊 Chatbot Statistieken')
            .setDescription(`**Conversatie ID:** ${stats.conversationId}`)
            .addFields(
                { 
                    name: '💬 Berichten', 
                    value: `${stats.messageCount} berichten`, 
                    inline: true 
                },
                { 
                    name: '🎯 Tokens', 
                    value: `${stats.totalTokens} tokens`, 
                    inline: true 
                },
                { 
                    name: '⏱️ Leeftijd', 
                    value: `${stats.ageMinutes} minuten`, 
                    inline: true 
                },
                { 
                    name: '🕐 Laatste bericht', 
                    value: `${stats.lastMessageMinutes} min geleden`, 
                    inline: true 
                },
                { 
                    name: '🔄 Requests/min', 
                    value: `${rl.requestsPerMinute}/${rl.limits.REQUESTS_PER_MINUTE}`, 
                    inline: true 
                },
                { 
                    name: '🔄 Requests/dag', 
                    value: `${rl.requestsPerDay}/${rl.limits.REQUESTS_PER_DAY}`, 
                    inline: true 
                },
                { 
                    name: '🎫 Tokens/min', 
                    value: `${rl.tokensPerMinute}/${rl.limits.TOKENS_PER_MINUTE}`, 
                    inline: true 
                },
                { 
                    name: '🎫 Tokens/dag', 
                    value: `${rl.tokensPerDay}/${rl.limits.TOKENS_PER_DAY}`, 
                    inline: true 
                }
            );

        // Add warning if approaching limits
        const warnings = [];
        if (stats.totalTokens > 5000) {
            warnings.push('⚠️ Conversatie nadert token limiet (6000)');
        }
        if (rl.requestsPerMinute > 25) {
            warnings.push('⚠️ Requests per minuut hoog');
        }
        if (rl.tokensPerMinute > 6000) {
            warnings.push('⚠️ Tokens per minuut hoog');
        }

        if (warnings.length > 0) {
            embed.addFields({
                name: '⚠️ Waarschuwingen',
                value: warnings.join('\n'),
                inline: false
            });
        }
    }

    await interaction.editReply({ embeds: [embed] });
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
    chatbotCommands,
    handleChatbotCommands
};
