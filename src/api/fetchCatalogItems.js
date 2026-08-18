import { executeWithDetailedHandling } from "../helpers/execute_helper.js";
import { NotFoundError } from "../helpers/execute_helper.js";
import Logger from "../utils/logger.js";
import vintedScraper from "../services/vinted_scraper.js";

/**
 * Fetch catalog items from Vinted using VintedScraper (Vintrack architecture).
 *
 * @param {Object} params - Query parameters for fetching catalog items.
 * @returns {Promise<Object>} - { items: Array }
 */
export async function fetchCatalogItems(params = {}) {
    return await executeWithDetailedHandling(async () => {
        const response = await vintedScraper.fetchCatalogItems(params);

        if (!response.success) {
            Logger.error(`fetchCatalogItems: Vinted returned HTTP ${response.status} for catalog endpoint.`);
            throw new NotFoundError(`Catalog items request failed with HTTP ${response.status}.`);
        }

        const items =
            Array.isArray(response.data?.items) ? response.data.items :
            Array.isArray(response.data?.data)  ? response.data.data  :
            [];

        return { items };
    });
}
