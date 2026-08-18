import Logger from "../utils/logger.js";
import { fetchCatalogItems } from "../api/fetchCatalogItems.js";
import { fetchItem } from "../api/fetchItem.js";
import vintedScraper, { VintedScraper } from "./vinted_scraper.js";
import { VintedItem } from "../entities/vinted_item.js";
import { filterItemsByUrl, parseVintedSearchParams } from "./url_service.js";
import { Preference } from "../database.js";
import crud from "../crud.js";
import { createVintedItemEmbed, createVintedItemActionRow } from "../bot/components/item_embed.js";
import axios from "axios";

/**
 * High-Speed 2-Worker Staggered Pipeline State.
 */
let isMonitoringLoopRunning = false;
let discordClient = null;
let highestId = 0;
let currentID = 0;
const localSeen = new Set();
let isFirstScan = true;

const sellerCache = new Map();

// Independent VintedScraper instances per worker for isolated session/403 recovery
const worker1Scraper = new VintedScraper();
const worker2Scraper = new VintedScraper();

async function fetchSellerDetails(userId, domain = 'it', scraper = vintedScraper) {
    if (!userId) return null;
    if (sellerCache.has(userId)) {
        return sellerCache.get(userId);
    }
    try {
        const response = await scraper.fetchUser(userId, domain);
        if (response && response.success && response.data?.user) {
            const userData = response.data.user;
            sellerCache.set(userId, userData);
            if (sellerCache.size > 2000) {
                const oldestKeys = Array.from(sellerCache.keys()).slice(0, 500);
                for (const k of oldestKeys) sellerCache.delete(k);
            }
            return userData;
        }
    } catch (err) {
        Logger.debug(`[SELLER FETCH ERROR] Could not fetch user ${userId} on ${domain}: ${err.message}`);
    }
    return null;
}

function initializeConcurrency() {
    // Legacy stub for backwards compatibility
}

/**
 * Initialize highest ID directly from Vinted catalog API.
 */
async function initializeHighestID() {
    let attempt = 0;
    while (attempt < 2) {
        attempt++;
        try {
            const response = await vintedScraper.fetchCatalogItems({ order: 'newest_first', per_page: 1 });
            const items = response?.data?.items || response?.data?.data || (Array.isArray(response?.data) ? response.data : []);

            if (Array.isArray(items) && items.length > 0) {
                const rawId = items[0].id || items[0].item_id;
                if (rawId) {
                    highestId = parseInt(rawId, 10);
                    currentID = highestId;
                    return highestId;
                }
            }
        } catch (error) {
            Logger.warn(`initializeHighestID attempt ${attempt} failed: ${error.message}`);
        }

        if (attempt < 2) {
            await vintedScraper.warmUp().catch(() => {});
        }
    }
    return 0;
}

/**
 * Process single channel catalog query for a worker tick.
 */
async function processChannelQuery(vintedChannel, scraper) {
    try {
        const urlObj = new URL(vintedChannel.url);
        const rawSearchParams = urlObj.searchParams;
        const domain = urlObj.hostname.match(/vinted\.(.*?)$/)?.[1] || 'fr';

        const queryOptions = {
            domain,
            rawSearchParams,
            order: 'newest_first',
            per_page: 10,
            search_text: rawSearchParams.get('search_text') || undefined,
            price_from: rawSearchParams.get('price_from') || undefined,
            price_to: rawSearchParams.get('price_to') || undefined,
            catalog_ids: rawSearchParams.getAll('catalog_ids[]').concat(rawSearchParams.getAll('catalog[]')),
            brand_ids: rawSearchParams.getAll('brand_ids[]'),
            video_game_platform_ids: rawSearchParams.getAll('video_game_platform_ids[]'),
            size_ids: rawSearchParams.getAll('size_ids[]'),
            status_ids: rawSearchParams.getAll('status_ids[]'),
            color_ids: rawSearchParams.getAll('color_ids[]'),
            material_ids: rawSearchParams.getAll('material_ids[]')
        };

        const response = await scraper.fetchCatalogItems(queryOptions);
        const rawItems = response?.data?.items || response?.data?.data || (Array.isArray(response?.data) ? response.data : []);

        if (!Array.isArray(rawItems) || rawItems.length === 0) return;

        // Fast in-memory check
        const newestItemId = rawItems[0].id;
        if (localSeen.has(newestItemId) && !isFirstScan) {
            return;
        }

        const parsedItems = rawItems.map(raw => new VintedItem(raw)).filter(i => i && i.user);

        const matchingItems = filterItemsByUrl(
            parsedItems,
            vintedChannel.url,
            vintedChannel.bannedKeywords || [],
            vintedChannel.preferences?.get?.(Preference.Countries) || [],
            vintedChannel.channelId
        );

        for (const item of matchingItems) {
            const isNew = processDeduplication(item.id);
            if (!isNew) continue;

            if (item.id > highestId) {
                highestId = item.id;
                currentID = highestId;
            }

            console.log(`[MATCH FOUND] Item ${item.id} ("${item.title}") matched Channel ${vintedChannel.channelId}! Dispatching embed...`);

            const sellerId = item.user?.id || item.userId;
            const isSellerCached = sellerCache.has(sellerId);

            if (isSellerCached && item.user) {
                const cachedSeller = sellerCache.get(sellerId);
                item.user = { ...item.user, ...cachedSeller };
            }

            if (discordClient) {
                const { embed, photosEmbeds } = await createVintedItemEmbed(item, domain, vintedChannel);
                const actionRow = await createVintedItemActionRow(item, domain);

                const doMentionUser = vintedChannel.user && vintedChannel.preferences?.get?.(Preference.Mention);
                const mentionString = doMentionUser ? `<@${vintedChannel.user.discordId}> ` : '';

                const embedsPayload = [embed.toJSON(), ...photosEmbeds.map(p => p.toJSON())];
                const componentsPayload = [actionRow.toJSON()];

                let sentViaWebhook = false;

                // 1. Fast Webhook Dispatch (~40ms)
                if (vintedChannel.webhookUrl) {
                    try {
                        await axios.post(vintedChannel.webhookUrl, {
                            content: mentionString,
                            embeds: embedsPayload,
                            components: componentsPayload
                        });
                        sentViaWebhook = true;
                        console.log(`[DISCORD SUCCESS] Sent item to channel ${vintedChannel.channelId} via webhook`);
                    } catch (webhookErr) {
                        Logger.warn(`[WEBHOOK WARNING] Webhook post failed for channel ${vintedChannel.channelId} (${webhookErr.message}). Falling back to standard message.`);
                    }
                }

                // 2. Standard Channel Send Fallback
                if (!sentViaWebhook) {
                    try {
                        const channelObj = await discordClient.channels.fetch(vintedChannel.channelId);
                        if (channelObj && typeof channelObj.send === 'function') {
                            const sentMessage = await channelObj.send({
                                content: mentionString,
                                embeds: [embed, ...photosEmbeds],
                                components: [actionRow]
                            });
                            console.log(`[DISCORD SUCCESS] Sent item to channel ${vintedChannel.channelId}`);

                            if (!isSellerCached && sellerId && sentMessage) {
                                (async () => {
                                    const sellerData = await fetchSellerDetails(sellerId, domain, scraper);
                                    if (sellerData && item.user) {
                                        item.user = { ...item.user, ...sellerData };
                                        const { embed: updatedEmbed, photosEmbeds: updatedPhotos } = await createVintedItemEmbed(item, domain, vintedChannel);
                                        await sentMessage.edit({
                                            embeds: [updatedEmbed, ...updatedPhotos]
                                        }).catch(err => Logger.debug(`[DISCORD EDIT ERROR] Failed to edit message ${sentMessage.id}: ${err.message}`));
                                    }
                                })();
                            }
                        }
                    } catch (err) {
                        console.error(`[DISCORD ERROR] Could not fetch or send to Channel ${vintedChannel.channelId}:`, err.message);
                    }
                }
            }
        }
    } catch (channelErr) {
        console.error(`[POLLING ERROR] Failed query for channel ${vintedChannel.channelId}: ${channelErr.message}`);
    }
}

/**
 * Worker polling loop with staggered offset.
 */
async function runWorker(workerId, scraper, initialOffsetMs) {
    if (initialOffsetMs > 0) {
        await new Promise(resolve => setTimeout(resolve, initialOffsetMs));
    }

    while (isMonitoringLoopRunning) {
        try {
            const activeChannels = await crud.getAllMonitoredVintedChannels();
            if (activeChannels && activeChannels.length > 0) {
                for (const vintedChannel of activeChannels) {
                    await processChannelQuery(vintedChannel, scraper);
                }
            }
        } catch (err) {
            Logger.error(`[WORKER ${workerId} ERROR]: ${err.message}`);
        }

        // Each worker executes every 600ms; staggered by 300ms offset produces effective 300ms polling rate
        await new Promise(resolve => setTimeout(resolve, 600));
    }
}

/**
 * Explicitly trigger / ensure live background monitoring loop (2-Worker Staggered Pipeline).
 */
async function startMonitoring(client) {
    if (client) discordClient = client;

    if (isMonitoringLoopRunning) {
        return;
    }
    isMonitoringLoopRunning = true;
    console.log('[MONITOR] Starting continuous background polling (2-Worker Staggered Pipeline)...');

    if (highestId === 0) {
        await initializeHighestID();
    }

    if (isFirstScan) {
        isFirstScan = false;
    }

    // Launch Worker 1 (0ms offset) & Worker 2 (300ms offset)
    runWorker(1, worker1Scraper, 0);
    runWorker(2, worker2Scraper, 300);
}

/**
 * Deduplication helper.
 */
function processDeduplication(itemId) {
    if (isFirstScan) {
        localSeen.add(itemId);
        return false;
    }

    if (localSeen.has(itemId)) {
        return false;
    }

    localSeen.add(itemId);

    if (localSeen.size > 2000) {
        const toDelete = Array.from(localSeen).slice(0, 500);
        for (const id of toDelete) {
            localSeen.delete(id);
        }
    }

    return true;
}

async function findHighestID() {
    const id = await initializeHighestID();
    return { highestID: id };
}

function stopMonitoring() {
    isMonitoringLoopRunning = false;
    console.log('[MONITOR] Background polling workers stopped.');
}

const catalogService = {
    initializeConcurrency,
    findHighestID,
    startMonitoring,
    stopMonitoring,
    initializeHighestID
};

export default catalogService;
