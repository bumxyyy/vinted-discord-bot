import { REST } from '@discordjs/rest';
import { Routes } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Logger from '../utils/logger.js';
import ConfigurationManager from '../utils/config_manager.js';
import crud from '../crud.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const commands = [];
const commandMap = new Map();
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'));

const command_id_channel = ConfigurationManager.getDiscordConfig.command_channel_id;

// Dynamic import and mapping of command modules
async function loadCommands() {
    commands.length = 0;
    commandMap.clear();
    for (const file of commandFiles) {
        const module = await import(`./commands/${file}`);
        if (module?.data) {
            const commandData = module.data.toJSON();
            commands.push(commandData);

            commandMap.set(commandData.name, module);
            const fileNameNoExt = file.replace(/\.js$/, '');
            commandMap.set(fileNameNoExt, module);
            commandMap.set(fileNameNoExt.replace(/_/g, '-'), module);
        }
    }
}

/**
 * Purges all global and guild-level slash commands to ensure a clean slate.
 */
export async function purgeCommands(client, discordConfig) {
    try {
        Logger.info('Purging all existing slash commands...');
        const rest = new REST({ version: '9' }).setToken(discordConfig.token);
        const guildId = discordConfig.guild_id || process.env.DISCORD_GUILD_ID;

        if (guildId) {
            await rest.put(
                Routes.applicationGuildCommands(discordConfig.client_id, guildId),
                { body: [] }
            ).catch(err => Logger.debug(`Guild command REST purge note: ${err.message}`));
        }

        await rest.put(
            Routes.applicationCommands(discordConfig.client_id),
            { body: [] }
        ).catch(err => Logger.debug(`Global command REST purge note: ${err.message}`));

        if (client) {
            if (client.application && client.application.commands) {
                await client.application.commands.set([]).catch(() => {});
            }
            if (guildId && client.guilds && client.guilds.cache.has(guildId)) {
                const guild = client.guilds.cache.get(guildId);
                if (guild && guild.commands) {
                    await guild.commands.set([]).catch(() => {});
                }
            }
        }
        Logger.info('Successfully purged existing slash commands.');
    } catch (error) {
        Logger.warn(`Warning during command purge: ${error.message}`);
    }
}

/**
 * Purges old commands and registers only active, valid commands without duplicates.
 */
export async function registerCommands(client, discordConfig) {
    await purgeCommands(client, discordConfig);
    await loadCommands();

    const rest = new REST({ version: '9' }).setToken(discordConfig.token);
    try {
        Logger.info('Registering active slash commands...');
        const guildId = discordConfig.guild_id || process.env.DISCORD_GUILD_ID;

        if (guildId) {
            // Register solely at Guild level for instant availability and zero command duplication
            await rest.put(
                Routes.applicationGuildCommands(discordConfig.client_id, guildId),
                { body: commands }
            );

            // Clear any lingering global commands to prevent double commands in Discord UI
            await rest.put(
                Routes.applicationCommands(discordConfig.client_id),
                { body: [] }
            ).catch(() => {});

            if (client && client.guilds && client.guilds.cache.has(guildId)) {
                const guild = client.guilds.cache.get(guildId);
                if (guild && guild.commands) {
                    await guild.commands.set(commands).catch(() => {});
                }
            }
        } else {
            // Register Globally if no specific Guild ID is configured
            await rest.put(
                Routes.applicationCommands(discordConfig.client_id),
                { body: commands }
            );
        }

        Logger.info('Commands refreshed successfully.');
    } catch (error) {
        Logger.error(`Error reloading commands: ${error.message}`);
    }
}

export async function handleCommands(interaction) {
    if (!interaction.isCommand()) return;

    Logger.info(`Received command: ${interaction.commandName}`);

    // Resolve command module from memory map
    const module = commandMap.get(interaction.commandName);
    if (!module) {
        await interaction.reply({ content: 'This command is deprecated and no longer available.', ephemeral: true }).catch(() => {});
        return;
    }

    const channel = interaction.channel;
    const isThread = channel ? (typeof channel.isThread === 'function' && channel.isThread()) : false;

    // Check if channel is registered in DB as a private/monitored VintedChannel
    const registeredChannel = await crud.getVintedChannelById(interaction.channelId).catch(() => null);
    const isMainCommandChannel = command_id_channel ? (interaction.channelId === command_id_channel) : true;

    // Allow execution in main command_id_channel, threads, or registered private channels
    if (!isMainCommandChannel && !isThread && !registeredChannel) {
        const channelMention = command_id_channel ? `<#${command_id_channel}>` : 'the main command channel';
        await interaction.reply({
            content: `This command is not allowed in this channel. Please use ${channelMention} or one of your private channels.`,
            ephemeral: true
        });
        return;
    }

    try {   
        await module.execute(interaction);
    } catch (error) {
        Logger.error('Error handling command:', error);

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
            }
        }
        catch (replyError) {
            Logger.error('Error replying to interaction:', replyError);
        }
    }
}
