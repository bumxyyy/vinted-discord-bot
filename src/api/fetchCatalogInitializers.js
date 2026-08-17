import { executeWithDetailedHandling } from "../helpers/execute_helper.js";
import RequestBuilder from "../utils/request_builder.js";
import ConfigurationManager from "../utils/config_manager.js";
import { NotFoundError } from "../helpers/execute_helper.js";
import Logger from "../utils/logger.js";

const extension = ConfigurationManager.getAlgorithmSetting.vinted_api_domain_extension;

/**
 * Fetch all catalog categories from Vinted.
 *
 * The raw response from /api/v2/catalog/initializers looks like:
 *   { dtos: { catalogs: [...] } }
 * or in some locales:
 *   { dtos: [ { catalogs: [...] }, ... ] }
 *
 * We return the raw `response.data` object and let buildCategoryMapFromRoots
 * probe the exact shape — that way a future API change only needs one-side fix.
 *
 * @param {Object} params
 * @param {string} params.cookie - Session cookie.
 * @returns {Promise<Object>}
 */
export async function fetchCatalogInitializer({ cookie }) {
    return await executeWithDetailedHandling(async () => {
        const url = `https://www.vinted.${extension}/api/v2/catalog/initializers`;

        const response = await RequestBuilder.get(url)
                        .setNextProxy()
                        .setCookie(cookie)
                        .send();

        if (!response.success) {
            throw new NotFoundError(`Catalog initializers returned HTTP ${response.status}.`);
        }

        const raw = response.data;

        // Debug: log the top-level keys so we can see the exact shape in production
        if (raw && typeof raw === 'object') {
            Logger.debug(`fetchCatalogInitializer response keys: ${Object.keys(raw).join(', ')}`);
        } else {
            Logger.warn(`fetchCatalogInitializer: unexpected response body type: ${typeof raw}`);
        }

        // Prefer dtos if present, otherwise hand the whole body to the prober
        const payload = raw?.dtos ?? raw;

        if (!payload) {
            throw new NotFoundError('Catalog initializers response contained no usable data.');
        }

        // Return as { data: payload } so buildCategoryMapFromRoots receives
        // the object it probes (roots.data → payload).
        return { data: payload };
    });
}