import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createBaseEmbed, sendErrorEmbed, sendWaitingEmbed } from '../components/base_embeds.js';
import crud from '../../crud.js';
import Logger from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
    .setName('setup-webhook')
    .setDescription('Configura un webhook per notifiche ultra-veloci in un canale o thread.')
    .addChannelOption(option =>
        option.setName('target_channel')
            .setDescription('Il canale o thread per cui configurare il webhook (opzionale).')
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
        await sendWaitingEmbed(interaction, 'Configurazione del webhook in corso...');

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

        if (!targetChannel) {
            await sendErrorEmbed(interaction, `⚠️ Impossibile accedere al canale <#${channelId}>.`);
            return;
        }

        let vintedChannel = await crud.getVintedChannelById(channelId);
        if (!vintedChannel) {
            await sendErrorEmbed(interaction, `⚠️ <#${channelId}> non è un canale di monitoraggio Vinted valido.`);
            return;
        }

        const hasPermission = await canManageWebhook(interaction, vintedChannel);
        if (!hasPermission) {
            await sendErrorEmbed(interaction, `⚠️ Non hai i permessi per configurare il webhook per <#${channelId}>.`);
            return;
        }

        if (vintedChannel.webhookUrl) {
            const embed = await createBaseEmbed(
                interaction,
                'Webhook Già Configurato',
                `⚠️ <#${channelId}> ha già un webhook configurato!\nUsa \`/remove-webhook\` prima di crearne uno nuovo.`,
                0xFFA500
            );
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        // Webhooks are created on parent text channels if target is a thread
        let webhookHostChannel = targetChannel;
        if (targetChannel.isThread && targetChannel.isThread() && targetChannel.parentId) {
            const parentChannel = await interaction.guild.channels.fetch(targetChannel.parentId).catch(() => null);
            if (parentChannel && typeof parentChannel.createWebhook === 'function') {
                webhookHostChannel = parentChannel;
            }
        }

        if (!webhookHostChannel || typeof webhookHostChannel.createWebhook !== 'function') {
            await sendErrorEmbed(interaction, `⚠️ Impossibile creare un webhook per <#${channelId}>. Seleziona un canale di testo.`);
            return;
        }

        const avatarUrl = interaction.client.user ? interaction.client.user.displayAvatarURL() : undefined;
        const webhook = await webhookHostChannel.createWebhook({
            name: 'VintedAlert',
            avatar: avatarUrl,
            reason: 'Configurazione webhook notifiche Vinted'
        });

        await crud.setVintedChannelWebhookUrl(channelId, webhook.url);

        const embed = await createBaseEmbed(
            interaction,
            'Webhook Configurato',
            `✅ Webhook configurato con successo per <#${channelId}>!\nLe notifiche verranno inviate istantaneamente tramite webhook.`,
            0x00FF00
        );

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        Logger.error(`Error executing setup-webhook: ${error.message}`);
        await sendErrorEmbed(interaction, `Errore durante la configurazione del webhook: ${error.message}`);
    }
}
