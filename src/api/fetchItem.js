import { executeWithDetailedHandling } from "../helpers/execute_helper.js";
import vintedScraper from "../services/vinted_scraper.js";
import { NotFoundError, ForbiddenError, RateLimitError } from "../helpers/execute_helper.js";

/**
 * Handle errors during item fetching based on response code.
 * @param {number} code - Response code.
 * @throws {Error} - Corresponding error based on response code.
 */
function handleFetchItemError(code) {
    switch (code) {
        case 404:
            throw new NotFoundError("Item not found.");
        case 403:
            throw new ForbiddenError("Access forbidden.");
        case 429:
            throw new RateLimitError("Rate limit exceeded.");
        default:
            throw new Error(`Error fetching item (HTTP ${code}).`);
    }
}

/**
 * Fetch a specific item by ID from Vinted using VintedScraper.
 * @param {Object} params - Parameters for fetching an item.
 * @param {number} params.item_id - ID of the item to fetch.
 * @returns {Promise<Object>} - Promise resolving to the fetched item.
 */
export async function fetchItem({ item_id }) {
    return await executeWithDetailedHandling(async () => {
        const response = await vintedScraper.fetchItem(item_id);

        if (!response.success) {
            handleFetchItemError(response.status);
        }

        const item = response.data?.item || response.data;
        return { item };
    });
}