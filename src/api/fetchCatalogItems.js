import { executeWithDetailedHandling } from "../helpers/execute_helper.js";
import RequestBuilder from "../utils/request_builder.js";
import ConfigurationManager from "../utils/config_manager.js";
import { NotFoundError } from "../helpers/execute_helper.js";
import Logger from "../utils/logger.js";

const extension = ConfigurationManager.getAlgorithmSetting.vinted_api_domain_extension;

/**
 * Fetch catalog items from Vinted.
 *
 * @param {Object} params
 * @param {string} params.cookie     - Session cookie string.
 * @param {number} [params.per_page=1]            - Items per page (1 is enough for highest-ID lookup).
 * @param {string} [params.order='newest_first']  - Sort order.
 * @returns {Promise<Object>} - { items: Array }
 */
export async function fetchCatalogItems({ cookie, per_page = 1, order = 'newest_first' }) {
    return await executeWithDetailedHandling(async () => {
        const url = `https://www.vinted.${extension}/api/v2/catalog/items?per_page=${per_page}&order=${order}`;

        const response = await RequestBuilder.get(url)
                        .setNextProxy()
                        .setCookie(cookie)
                        .send();

        if (!response.success) {
            // Log the exact HTTP status so 403/429/503 are immediately visible in logs
            Logger.error(`fetchCatalogItems: Vinted returned HTTP ${response.status} for catalog endpoint.`);
            throw new NotFoundError(`Catalog items request failed with HTTP ${response.status}.`);
        }

        // Handle both known response shapes:
        //   { items: [...] }  and  { data: { items: [...] } }
        const items =
            Array.isArray(response.data?.items) ? response.data.items :
            Array.isArray(response.data?.data)  ? response.data.data  :
            [];

        return { items };
    });
}
