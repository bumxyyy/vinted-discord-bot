import 'dotenv/config';
import fs from 'fs';
import { Client, GatewayIntentBits } from 'discord.js';
import ProxyManager from './src/utils/proxy_manager.js';
import vintedScraper from './src/services/vinted_scraper.js';
import { VintedItem } from './src/entities/vinted_item.js';
import { createVintedItemEmbed, createVintedItemActionRow } from './src/bot/components/item_embed.js';
import ConfigurationManager from './src/utils/config_manager.js';

console.log('=== TEST SCRAPER DIAGNOSTIC SCRIPT ===\n');

async function runTest() {
    // 1. Load Environment & Proxy Test
    console.log('[STEP 1] Environment & Proxy Test...');
    try {
        await ProxyManager.init();
        const activeProxy = ProxyManager.getNewProxy();
        if (activeProxy) {
            console.log(`[PROXY INFO] Using Proxy: ${activeProxy.getProxyString()}`);
        } else {
            console.log('[PROXY INFO] No proxy loaded from proxies.txt / Webshare. Proceeding direct.');
        }
    } catch (err) {
        console.error('[PROXY ERROR] Error initializing proxy:', err.message, err.stack);
    }

    // 2. Vinted Session & Scraping Test
    console.log('\n[STEP 2] Vinted Session Warmup & Scraping Test...');
    let scrapedItem = null;
    try {
        console.log('[VINTED TEST] Warming up Vinted session...');
        await vintedScraper.warmUp();
        console.log(`[VINTED TEST] CSRF Token: ${vintedScraper.csrfToken ? 'Found (' + vintedScraper.csrfToken.slice(0, 10) + '...)' : 'MISSING'}`);
        console.log(`[VINTED TEST] Anon ID: ${vintedScraper.anonId ? 'Found (' + vintedScraper.anonId + ')' : 'MISSING'}`);

        console.log('[VINTED TEST] Fetching catalog items (per_page: 3)...');
        const response = await vintedScraper.fetchCatalogItems({ per_page: 3, order: 'newest_first' });
        
        console.log(`[VINTED TEST] Response Status: ${response.status}`);
        const items = response?.data?.items || response?.data?.data || (Array.isArray(response?.data) ? response.data : []);
        console.log(`[VINTED TEST] Total items returned: ${items.length}`);

        if (items.length > 0) {
            scrapedItem = new VintedItem(items[0]);
            console.log('\n--- FIRST ITEM PARSED ---');
            console.log(`ID:       ${scrapedItem.id}`);
            console.log(`Title:    ${scrapedItem.title}`);
            console.log(`Price:    ${scrapedItem.priceNumeric} ${scrapedItem.currency}`);
            console.log(`Brand:    ${scrapedItem.brand}`);
            console.log(`Size:     ${scrapedItem.size}`);
            console.log(`URL:      ${scrapedItem.url}`);
            console.log('-------------------------\n');
        } else {
            console.warn('[VINTED TEST WARNING] No items returned in catalog response.');
        }
    } catch (err) {
        console.error('[VINTED TEST ERROR] Error scraping Vinted catalog:', err.message, err.stack);
    }

    // 3. Discord Direct Message Test
    console.log('\n[STEP 3] Discord Direct Message Delivery Test...');
    const discordConfig = ConfigurationManager.getDiscordConfig;
    const token = process.env.DISCORD_TOKEN || discordConfig.token;
    const channelId = process.env.DISCORD_COMMAND_CHANNEL_ID || discordConfig.command_channel_id || discordConfig.thread_channel_id;

    if (!token || token.startsWith('YOUR_DISCORD_')) {
        console.warn('\n[DISCORD DIAGNOSTIC NOTICE] DISCORD_TOKEN is not configured in .env (currently "YOUR_DISCORD_TOKEN").');
        console.warn('[DISCORD DIAGNOSTIC NOTICE] To test Discord message sending locally, update DISCORD_TOKEN and DISCORD_COMMAND_CHANNEL_ID in .env.');
        console.log('\n=== DIAGNOSTIC TEST COMPLETED ===');
        process.exit(0);
    }

    if (!channelId) {
        console.error('[DISCORD ERROR] Command/Target Channel ID is missing.');
        process.exit(1);
    }

    console.log(`[DISCORD TEST] Connecting to Discord (Target Channel: ${channelId})...`);

    const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
    });

    client.once('ready', async () => {
        console.log(`[DISCORD TEST] Logged in as ${client.user.tag}`);
        try {
            const channel = await client.channels.fetch(channelId);
            if (!channel) {
                throw new Error(`Channel ${channelId} could not be resolved.`);
            }

            console.log(`[DISCORD TEST] Channel resolved: #${channel.name || channelId}`);

            if (scrapedItem) {
                const domain = scrapedItem.url?.match(/vinted\.(.*?)\//)?.[1] || 'it';
                const { embed, photosEmbeds } = await createVintedItemEmbed(scrapedItem, domain);
                const actionRow = await createVintedItemActionRow(scrapedItem, domain);

                console.log('[DISCORD TEST] Sending test item embed...');
                await channel.send({
                    content: '🧪 **Local Test Diagnostic Message**',
                    embeds: [embed, ...photosEmbeds],
                    components: [actionRow]
                });
                console.log('[DISCORD TEST SUCCESS] Test embed successfully posted to Discord!');
            } else {
                console.log('[DISCORD TEST] Sending test ping message...');
                await channel.send('🧪 **Local Test Diagnostic Message** (No scraped item available)');
                console.log('[DISCORD TEST SUCCESS] Test ping message posted to Discord!');
            }

            console.log('\n=== DIAGNOSTIC TEST COMPLETED SUCCESSFULLY ===');
            process.exit(0);
        } catch (err) {
            console.error('[DISCORD TEST ERROR] Failed sending message to Discord:', err.message, err.stack);
            process.exit(1);
        }
    });

    try {
        await client.login(token);
    } catch (err) {
        console.error('[DISCORD LOGIN ERROR] Failed to login to Discord:', err.message, err.stack);
        process.exit(1);
    }
}

runTest();
