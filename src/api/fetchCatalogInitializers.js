import { executeWithDetailedHandling } from "../helpers/execute_helper.js";
import { NotFoundError } from "../helpers/execute_helper.js";
import Logger from "../utils/logger.js";
import vintedScraper from "../services/vinted_scraper.js";

/**
 * Fetch all catalog categories from Vinted using VintedScraper.
 *
 * @returns {Promise<Object>}
 */
export async function fetchCatalogInitializer() {
    return await executeWithDetailedHandling(async () => {
        const response = await vintedScraper.fetchCatalogInitializers();

        if (!response.success) {
            throw new NotFoundError(`Catalog initializers returned HTTP ${response.status}.`);
        }

        const raw = response.data;

        if (raw && typeof raw === 'object') {
            Logger.debug(`fetchCatalogInitializer response keys: ${Object.keys(raw).join(', ')}`);
        } else {
            Logger.warn(`fetchCatalogInitializer: unexpected response body type: ${typeof raw}`);
        }

        const payload = raw?.dtos ?? raw;

        if (!payload) {
            throw new NotFoundError('Catalog initializers response contained no usable data.');
        }

        return { data: payload };
    });
}