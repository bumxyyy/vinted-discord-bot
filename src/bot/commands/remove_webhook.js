import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createBaseEmbed, sendErrorEmbed, sendWaitingEmbed } from '../components/base_embeds.js';
import crud from '../../crud.js';
import Logger from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
    .setName('remove-webhook')
    .setDescription('Rimuove il webhook dal canale specificato e ripristina i messaggi standard.')
    .addChannelOption(option =>
        option.setName('target_channel')
            .setDescription('Il canale o thread da cui rimuovere il webhook (opzionale).')
            .setRequired(false)
    );

async function canManageWebhook(interaction, vintedChannel) {
    // 1. Check Discord Native Administrator / Manage Webhooks permissions
    if (interaction.member?.permissions && typeof interaction.member.permissions.has === 'function') {
        if (
            interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
            interaction.member.permissions.has(PermissionFlagsBits.ManageWebhooks)
        ) {
            return true;
        }
    }

    // 2. Check Bot Admin Role
    if (await crud.isUserAdmin(interaction).catch(() => false)) {
        return true;
    }

    // 3. Check Channel Ownership in Database
    if (vintedChannel) {
        const userInDb = await crud.getUserByDiscordId(interaction.user.id).catch(() => null);
        if (userInDb && vintedChannel.user) {
            const channelUserDbId = String(vintedChannel.user._id || vintedChannel.user);
            const userDbId = String(userInDb._id);
            if (channelUserDbId === userDbId) {
                return true;
            }
        }
        if (vintedChannel.user?.discordId === interaction.user.id) {
            return true;
        }
    }

    return false;
}

export async function execute(interaction) {
    try {
        await sendWaitingEmbed(interaction, 'Rimozione del webhook in corso...');

        const rawOption = interaction.options.getChannel('target_channel');
        const channelId = rawOption ? rawOption.id : interaction.channelId;

        // Fetch full Discord channel instance
        let targetChannel = null;
        if (interaction.guild && interaction.guild.channels) {
            targetChannel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        }
        if (!targetChannel && interaction.client) {
            targetChannel = await interaction.client.channels.fetch(channelId).catch(() => null);
        }

        let vintedChannel = await crud.getVintedChannelById(channelId);
        if (!vintedChannel) {
            await sendErrorEmbed(interaction, `⚠️ <#${channelId}> non è un canale di monitoraggio Vinted valido.`);
            return;
        }

        const hasPermission = await canManageWebhook(interaction, vintedChannel);
        if (!hasPermission) {
            await sendErrorEmbed(interaction, `⚠️ Non hai i permessi per rimuovere il webhook da <#${channelId}>.`);
            return;
        }

        if (!vintedChannel.webhookUrl) {
            const embed = await createBaseEmbed(
                interaction,
                'Nessun Webhook',
                `⚠️ Nessun webhook configurato in <#${channelId}>.`,
                0xFFA500
            );
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        let webhookHostChannel = targetChannel;
        if (targetChannel && targetChannel.isThread && targetChannel.isThread() && targetChannel.parentId) {
            const parentChannel = await interaction.guild.channels.fetch(targetChannel.parentId).catch(() => null);
            if (parentChannel) webhookHostChannel = parentChannel;
        }

        // Try deleting webhook on Discord if it exists
        if (webhookHostChannel && typeof webhookHostChannel.fetchWebhooks === 'function') {
            try {
                const webhooks = await webhookHostChannel.fetchWebhooks();
                if (webhooks) {
                    const target = webhooks.find(w => w.url === vintedChannel.webhookUrl || w.name === 'VintedAlert');
                    if (target) {
                        await target.delete('Rimozione webhook da parte dell\'utente');
                    }
                }
            } catch (e) {
                Logger.debug(`Discord webhook delete warning: ${e.message}`);
            }
        }

        await crud.setVintedChannelWebhookUrl(channelId, null);

        const embed = await createBaseEmbed(
            interaction,
            'Webhook Rimosso',
            `🗑️ Webhook rimosso da <#${channelId}>. Il bot utilizzerà i messaggi standard.`,
            0x00FF00
        );

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        Logger.error(`Error executing remove-webhook: ${error.message}`);
        await sendErrorEmbed(interaction, `Errore durante la rimozione del webhook: ${error.message}`);
    }
}
