import { executeWithDetailedHandling } from "../helpers/execute_helper.js";
import Logger from "../utils/logger.js";
import ConfigurationManager from "../utils/config_manager.js";
import RequestBuilder from "../utils/request_builder.js";

const settings   = ConfigurationManager.getAlgorithmSetting;
const extension  = settings.vinted_api_domain_extension;

/**
 * Fetches the Vinted session cookie by performing a GET request to the
 * Vinted homepage and parsing all Set-Cookie headers from the response.
 *
 * Key fixes vs. previous version:
 *  - Collects ALL Set-Cookie values (not just 'access_token_web') and joins
 *    them into a single Cookie string. This covers both the access token JWT
 *    and any locale-specific session cookies (_vinted_fr_session, etc.).
 *  - Adds an explicit Referer header so the request looks like a real browser
 *    navigating to the homepage rather than a cold request.
 *  - Logs all received cookie names for easier debugging.
 *  - Throws a descriptive error when no cookies are returned so the retry
 *    loop in main.js handles the failure instead of proceeding with undefined.
 *
 * @returns {Promise<{cookie: string}>}
 * @throws {DetailedExecutionResultError}
 */
export async function fetchCookie() {
    return await executeWithDetailedHandling(async () => {
        const url = `https://www.vinted.${extension}`;

        const response = await RequestBuilder
            .get(url)
            .setNextProxy()
            // Make the request look like a browser navigating to the homepage
            .setHeaders({ 'Referer': url + '/' })
            .send();

        if (!response) {
            throw new Error('No response received from Vinted homepage.');
        }

        const statusCode = response.status;

        if (statusCode >= 400) {
            throw new Error(`Vinted homepage returned HTTP ${statusCode}. Cannot obtain session cookie.`);
        }

        const rawCookies = response.headers['set-cookie'];

        if (!rawCookies || rawCookies.length === 0) {
            throw new Error(`No Set-Cookie headers found in Vinted homepage response (HTTP ${statusCode}).`);
        }

        // Log the names of all cookies received for debugging
        const cookieNames = rawCookies.map(c => c.split('=')[0]);
        Logger.debug(`Received ${rawCookies.length} cookie(s) from Vinted: ${cookieNames.join(', ')}`);

        // Extract the key=value part of every cookie (drop path, domain, flags, etc.)
        // and join them into a single Cookie header string.
        const cookieString = rawCookies
            .map(c => c.split(';')[0].trim())
            .filter(c => c.includes('='))
            .join('; ');

        if (!cookieString) {
            throw new Error('All Set-Cookie headers were malformed — could not extract a valid cookie string.');
        }

        Logger.debug(`Session cookie assembled (${cookieString.length} chars)`);

        return { cookie: cookieString };
    });
}