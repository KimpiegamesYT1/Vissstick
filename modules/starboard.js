const { getDatabase } = require('../database');
const { EmbedBuilder } = require('discord.js');

// Configuratie
const STARBOARD_THRESHOLD = 3; // Minimaal 3 sterren
const STAR_EMOJI = '⭐'; // Reactie die we volgen

/**
 * Handle de toevoeging of verwijdering van een ster reactie
 * 
 * @param {import('discord.js').MessageReaction} reaction De Discord reactie
 * @param {string} userId De gebruiker ID die de reactie plaatst/verwijdert
 * @param {boolean} isAdding True bij ADD, False bij REMOVE
 * @param {import('discord.js').Client} client Discord client
 * @param {string} starboardChannelId ID van het starboard kanaal
 */
async function handleReactionChange(reaction, userId, isAdding, client, starboardChannelId) {
    if (!starboardChannelId) return;

    const message = reaction.message;
    
    // Bij partials even de reactie fetchen (om content en embeds te kunnen lezen)
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Fout bij fetchen starboard message:', error);
            return;
        }
    }

    // Controleer of het een ster is
    if (reaction.emoji.name !== STAR_EMOJI) return;

    const db = getDatabase();
    
    // === 1. Bepaal het originele Message ID ===
    let originalMessageId = message.id;
    let actualMessage = message;
    
    // Als het een bericht van onszelf (de bot) is:
    if (message.author.id === client.user.id) {
        // Is het ons starboard bericht?
        const existingStarboardEntry = db.prepare('SELECT original_message_id FROM starboard WHERE starboard_message_id = ?').get(message.id);
        if (existingStarboardEntry) {
            // Dit is inderdaad een starboard kopie! We redirecten de ID
            originalMessageId = existingStarboardEntry.original_message_id;
            
            // Probeer het GOEDE originele bericht te fetchen (voor buildStarboardEmbed etc)
            try {
                // Notitie: aangezien we content snapshotten hebben we message niet strikt nodig voor de update,
                // maar we houden message gelijk aan het origineel voor latere functies (als we de edit moeten doen)
                // Omdat we het origineel misschien niet meer kunnen fetchen, geven we het starboard message 
                // gewoon door aan de flow.
            } catch (e) {
                // Ignore
            }
        } else {
            // Het is een ander bot bericht (bijv. casino), negeer!
            return;
        }
    }

    // Als de gebruiker al een actieve stem heeft, telt alleen de eerste locatie.
    // Een extra ster op de andere locatie verwijderen we direct weer.
    if (isAdding && hasActiveVote(db, originalMessageId, userId)) {
        await removeDuplicateReaction(reaction, userId, originalMessageId);
        return;
    }

    // === 2. Registreer Stem (Upsert in starboard_votes voor Deduplicatie) ===
    registerVote(db, originalMessageId, userId, isAdding);
    
    // === 3. Haal De Unieke Actuele Sterren Telling Op ===
    const starCount = getStarCount(db, originalMessageId);
    
    // Log the action
    try {
        const userAction = isAdding ? 'toegevoegd' : 'verwijderd';
        const fetchedUser = await client.users.fetch(userId);
        console.log(`[Starboard] Gebruiker ${fetchedUser.username} heeft een ster ${userAction} bij bericht ${originalMessageId}. Totaal unieke sterren: ${starCount}`);
    } catch (e) {
        console.log(`[Starboard] Gebruiker ${userId} heeft een ster ${isAdding ? 'toegevoegd' : 'verwijderd'} bij bericht ${originalMessageId}. Totaal unieke sterren: ${starCount}`);
    }
    
    // === 4. Maak of Update Starboard Bericht ===
    await updateStarboardMessage(db, client, originalMessageId, message, starCount, starboardChannelId);
}

function hasActiveVote(db, originalMessageId, userId) {
    const existing = db
        .prepare('SELECT is_vote FROM starboard_votes WHERE original_message_id = ? AND user_id = ?')
        .get(originalMessageId, userId);

    return Boolean(existing && existing.is_vote === 1);
}

async function removeDuplicateReaction(reaction, userId, originalMessageId) {
    try {
        await reaction.users.remove(userId);
        console.log(`[Starboard] Dubbele ster verwijderd voor gebruiker ${userId} op bericht ${reaction.message.id} (origineel: ${originalMessageId}).`);
    } catch (error) {
        console.warn(`[Starboard] Kon dubbele ster niet verwijderen voor gebruiker ${userId} op bericht ${reaction.message.id}:`, error?.message || error);
    }
}

/**
 * Registreert een positieve of neutrale (verwijderde) stem voor deduplicatie
 */
function registerVote(db, originalMessageId, userId, isAdding) {
    const isVoteValue = isAdding ? 1 : 0;

    // Check of er al een entry bestaat voor deze gebruiker+bericht
    const existing = db.prepare('SELECT is_vote FROM starboard_votes WHERE original_message_id = ? AND user_id = ?').get(originalMessageId, userId);

    if (existing) {
        // Update als de status is gewijzigd (niet dubbel meetellen)
        if (existing.is_vote !== isVoteValue) {
            db.prepare('UPDATE starboard_votes SET is_vote = ?, voted_at = CURRENT_TIMESTAMP WHERE original_message_id = ? AND user_id = ?').run(isVoteValue, originalMessageId, userId);
        }
    } else if (isAdding) {
        // Nieuwe vote (alleen inserten we als het een toevoeging is, wegaantreksels op onbekende berichten negeren we)
        db.prepare('INSERT INTO starboard_votes (original_message_id, user_id, is_vote) VALUES (?, ?, ?)').run(originalMessageId, userId, isVoteValue);
    }
}

/**
 * Haalt uniek aantal votes op
 */
function getStarCount(db, originalMessageId) {
    const result = db.prepare('SELECT COUNT(DISTINCT user_id) as count FROM starboard_votes WHERE original_message_id = ? AND is_vote = 1').get(originalMessageId);
    return result ? result.count : 0;
}

/**
 * Update logic voor Starboard Kanaal (Plaats/Bewerk/Verwijder Embed)
 */
async function updateStarboardMessage(db, client, originalMessageId, message, starCount, starboardChannelId) {
    // Haal actuele db status op
    let entry = db.prepare('SELECT * FROM starboard WHERE original_message_id = ?').get(originalMessageId);

    // Als we nog geen entry hebben, maken we er vast een klaar in de base
    if (!entry && starCount > 0) {
        // Alleen de originele auteur/bericht kan als EERSTE een insert veroorzaken
        // Want het starboard embed bestaat dan nog niet!
        const attachmentUrl = message.attachments?.first() ? message.attachments.first().url : null;
        let cContent = message.content || "";

        db.prepare(`
            INSERT INTO starboard (original_message_id, channel_id, user_id, username, content, star_count) 
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(originalMessageId, message.channel.id, message.author.id, message.author.username, cContent, starCount);
        
        entry = db.prepare('SELECT * FROM starboard WHERE original_message_id = ?').get(originalMessageId);
        entry.guild_id = message.guildId; // Tijdelijke state voor de embed link
        entry.attachment_url = attachmentUrl; // Tijdelijk bewaren
    } else if (entry) {
        // Update altijd sowieso de star_count
        db.prepare('UPDATE starboard SET star_count = ? WHERE original_message_id = ?').run(starCount, originalMessageId);
        entry.star_count = starCount;
        
        // Cachen the base info (voor guildId en attachment URL)
        // Gebruik de bestaande state van dit current bericht als dit toevallig het origineel is, of skip guild_id (guild is vaak hetzelde)
        entry.guild_id = message.guildId; 
        if (message.id === originalMessageId && message.attachments) {
            entry.attachment_url = message.attachments.first() ? message.attachments.first().url : null;
        }
    }

    try {
        const starboardChannel = await client.channels.fetch(starboardChannelId);
        if (!starboardChannel) return;

        // Situatie 1: Minder dan threshold -> Kan verwijderd worden uit kanaal
        if (starCount < STARBOARD_THRESHOLD) {
            if (entry && entry.starboard_message_id) {
                // Haal de message er af
                try {
                    const sbMsg = await starboardChannel.messages.fetch(entry.starboard_message_id);
                    if (sbMsg) await sbMsg.delete();
                } catch (e) {
                    // Message wellicht al weg of onbereikbaar
                }
                // Zet message ID in DB op NULL i.p.v. record te verwijderen voor tracebility/history
                db.prepare('UPDATE starboard SET starboard_message_id = NULL WHERE original_message_id = ?').run(originalMessageId);
            }
            return;
        }

        // Situatie 2 & 3: We zijn boven threshold. we moeten embed builden
        let avatarUrl = null;
        try {
            const authorUser = await client.users.fetch(entry.user_id);
            if (authorUser) avatarUrl = authorUser.displayAvatarURL({ dynamic: true });
        } catch (err) {
            // Negeer als user niet gevonden kon worden
        }

        const embed = buildStarboardEmbed(entry, starCount, avatarUrl);
        const botMessageContent = `⭐ **${starCount}** | <#${entry.channel_id}>`;

        if (entry.starboard_message_id) {
            // Update bestaande
            try {
                const sbMsg = await starboardChannel.messages.fetch(entry.starboard_message_id);
                if (sbMsg) {
                    await sbMsg.edit({ content: botMessageContent, embeds: [embed] });
                } else {
                    // Kon hem niet vinden, maak een nieuwe
                    const nieuweMsg = await starboardChannel.send({ content: botMessageContent, embeds: [embed] });
                    db.prepare('UPDATE starboard SET starboard_message_id = ? WHERE original_message_id = ?').run(nieuweMsg.id, originalMessageId);
                    await nieuweMsg.react(STAR_EMOJI);
                }
            } catch (e) {
                // Kon message niet fetchen (miss handmatig verwijderd door admin?) > Maak nieuw
                const nieuweMsg = await starboardChannel.send({ content: botMessageContent, embeds: [embed] });
                db.prepare('UPDATE starboard SET starboard_message_id = ? WHERE original_message_id = ?').run(nieuweMsg.id, originalMessageId);
                await nieuweMsg.react(STAR_EMOJI);
            }
        } else {
            // Maak nieuwe post in starboard kanaal
            const nieuweMsg = await starboardChannel.send({ content: botMessageContent, embeds: [embed] });
            db.prepare('UPDATE starboard SET starboard_message_id = ? WHERE original_message_id = ?').run(nieuweMsg.id, originalMessageId);
            await nieuweMsg.react(STAR_EMOJI);
        }

    } catch (error) {
        console.error('Fout bij updaten starboard API (Permissions?):', error);
    }
}

/**
 * Genereer de unieke Starboard Layout Embed gebaseerd op database entry
 */
function buildStarboardEmbed(entry, starCount, avatarUrl) {
    const guildIdStr = entry.guild_id || '@me';
    const msgLink = `https://discord.com/channels/${guildIdStr}/${entry.channel_id}/${entry.original_message_id}`;

    const embed = new EmbedBuilder()
        .setColor('#FFD700') // Goud kleurig
        .setAuthor({ 
            name: entry.username || 'Onbekende Auteur',
            iconURL: avatarUrl || undefined // Komt in de linkerbovenhoek van de embed!
        });

    let descriptionText = entry.content && entry.content.length > 0 ? entry.content : '';
    // Voeg eronder subtiel de link naar het bericht toe ("Bron"), zodat het niet als los 'Field' wordt getoond
    if (descriptionText.length > 0) descriptionText += '\n\n';
    descriptionText += `[**Ga naar origineel bericht ↗**](${msgLink})`;

    embed.setDescription(descriptionText)
        .setFooter({ text: `Minimaal ${STARBOARD_THRESHOLD} sterren nodig om op de starboard te komen` })
        .setTimestamp(new Date(`${entry.starred_at} UTC`)); 

    // Als we nog een attachment url in tijdelijke entry state hebben
    if (entry.attachment_url) {
        embed.setImage(entry.attachment_url); // Zorgt ervoor dat de Daaronder "Afbeelding" correct inlaadt
    }

    return embed;
}

module.exports = {
    handleReactionChange
};