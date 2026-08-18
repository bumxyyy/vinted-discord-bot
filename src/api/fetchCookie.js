import { executeWithDetailedHandling } from "../helpers/execute_helper.js";
import Logger from "../utils/logger.js";
import vintedScraper from "../services/vinted_scraper.js";

/**
 * Ensures Vinted session warmup is completed and returns the cookie string.
 * Uses VintedScraper with Vintrack architecture.
 *
 * @returns {Promise<{cookie: string}>}
 * @throws {DetailedExecutionResultError}
 */
export async function fetchCookie() {
    return await executeWithDetailedHandling(async () => {
        await vintedScraper.ensureWarmedUp();
        const cookieString = await vintedScraper.getCookieString();

        if (!cookieString) {
            throw new Error("Failed to retrieve valid session cookie from VintedScraper.");
        }

        Logger.debug(`Session cookie obtained via VintedScraper (${cookieString.length} chars)`);
        return { cookie: cookieString };
    });
}