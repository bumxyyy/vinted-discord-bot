import Logger from "../utils/logger.js";
import { fetchCatalogItems } from "../api/fetchCatalogItems.js";
import { fetchItem } from "../api/fetchItem.js";

/**
 * Manage concurrency and fetching logic.
 */
const activePromises = new Set();
let consecutiveErrors = 0;
let rateLimitErrorsPerSecond = 0;

let step = 1;

let lastValidItemsPerSecond = 0;
let validItemsPerSecond = 0;

let lastRequestPerSecond = 0;
let requestPerSecond = 0;

let lastPublishedTime = Date.now();
let idTimeSinceLastPublication = 0;

let minFetchedRange = 0;
let maxFetchedRange = 0;

let currentID = 0;

let concurrency = 0;

function initializeConcurrency( concurrent_requests ) {
    concurrency = concurrent_requests
    computedConcurrency = concurrency;
}

/**
 * Find the highest item ID in the catalog.
 *
 * @param {string} cookie - Cookie for authentication.
 * @returns {Promise<{highestID: number}>}
 */
async function findHighestID(cookie) {
    const response = await fetchCatalogItems({ cookie, per_page: 1, order: 'newest_first' });

    // response is the executeWithDetailedHandling envelope: { success, code, items }
    const items = response?.items;

    if (!Array.isArray(items) || items.length === 0) {
        // Log what we actually got to help diagnose API shape changes
        const keys = response ? Object.keys(response).join(', ') : 'null';
        throw new Error(`findHighestID: no items in response (envelope keys: ${keys})`);
    }

    // Vinted uses 'id' in most responses; guard against 'item_id' variants
    const rawId = items[0].id ?? items[0].item_id;
    if (!rawId) {
        const itemKeys = Object.keys(items[0]).join(', ');
        throw new Error(`findHighestID: item has no id field (item keys: ${itemKeys})`);
    }

    const highestID = parseInt(rawId, 10);
    if (isNaN(highestID) || highestID <= 0) {
        throw new Error(`findHighestID: parsed ID is invalid: ${rawId}`);
    }

    return { highestID };
}

/**
 * Log current status at regular intervals.
 */
setInterval(() => {
    const totalRequests = requestPerSecond + rateLimitErrorsPerSecond;
    const requestSuccessRate = totalRequests ? ((requestPerSecond / totalRequests) * 100).toFixed(2) : 0;

    Logger.debug(`Requests per second: ${requestPerSecond}, Step: ${step}, Consecutive errors: ${consecutiveErrors}, Rate limit errors per second: ${rateLimitErrorsPerSecond}, Valid items per second: ${validItemsPerSecond}`);
    Logger.debug(`Active promises: ${activePromises.size}`);
    Logger.debug(`Current ID: ${currentID}, Last published time: ${lastPublishedTime}, ID time since last publication: ${idTimeSinceLastPublication}`);
    const numberOfItemBetweenRange = maxFetchedRange - minFetchedRange;
    Logger.debug(`minFetchedRange: ${minFetchedRange}, maxFetchedRange: ${maxFetchedRange}, numberOfItemBetweenRange: ${numberOfItemBetweenRange}`);
    Logger.debug(`Request success rate: ${requestSuccessRate}%`);
    Logger.debug(`Concurrency: ${computedConcurrency}`);

    rateLimitErrorsPerSecond = 0;

    lastValidItemsPerSecond = validItemsPerSecond;
    validItemsPerSecond = 0;

    lastRequestPerSecond = requestPerSecond;
    requestPerSecond = 0;

    minFetchedRange = 99999999999;
    maxFetchedRange = 0;
}, 1000);
/**
 * Adjust the concurrency dynamically based on errors and time since last publication.
 */
let computedConcurrency = 2;

setInterval(() => {
    //adjustConcurrency();
    adjustStep();
}, 10);

/**
 * Fetch items until the current item is reached automatically.
 *
 * This function fetches items until the current item is reached automatically.
 * It takes two parameters:
 * - cookie: a string representing the cookie for authentication.
 * - callback: a function to handle fetched items.
 *
 * @param {string} cookie - Cookie for authentication.
 * @param {function} callback - Callback function to handle fetched items.
 */
async function fetchUntilCurrentAutomatic(cookie, callback) {
    // Check if the cookie is provided
    if (!cookie) {
        throw new Error("Cookie is required.");
    }

    // Check if there are more than 3 rate limit errors per second
    /*if (rateLimitErrorsPerSecond > 3) {
        // Delay the function execution by 3 seconds
        await delay(3000);
        return;
    }*/

    while ( activePromises.size < computedConcurrency ) {
        // Calculate the ID for the next item to fetch
        const id = currentID + step;
        currentID = id;

        // Launch the fetch for the calculated ID
        launchFetch(id, cookie, callback);
    }

    // Wait for the first promise in the set to resolve
    await Promise.race(activePromises);

    // Wait for the Promise to resolve
    await Promise.resolve();
}

/**
 * Adjust the fetching step based on time since last publication and consecutive errors.
 *
 * The step is adjusted based on the time since the last publication and the number of consecutive errors.
 * The step is changed gradually to avoid overwhelming the server with requests.
 * The step is also reduced if there are consecutive errors.
 */
function adjustStep() {
    // Calculate the time since the last publication
    const timeSinceLastPublication = Date.now() - lastPublishedTime;

    // Reduce the step if there are consecutive errors
    if (consecutiveErrors > 5) {
        step = -1;
        return;
    }

    // Set the initial step value
    if (step < 1) {
        step = 1;
    }

    // Adjust the step based on the time since last publication
    if (timeSinceLastPublication > 20000) {
        // If it's been longer than 20 seconds since the last publication, double the step and add 10
        step = Math.min(step * 2 + 10, 20);
    } else if (timeSinceLastPublication > 10000) {
        // If it's been longer than 10 seconds since the last publication, double the step and add 5
        step = 1 
    }
    
    // Ensure the step is a whole number
    step = Math.ceil(step);
}

/**
 * Launch a fetch operation for a specific item ID.
 *
 * @param {number} id - Item ID to fetch.
 * @param {string} cookie - Cookie for authentication.
 * @param {function} callback - Callback function to handle fetched items.
 * @returns {Promise<void>} - Promise resolving when fetch operation is complete.
 */
async function launchFetch(id, cookie, callback) {
    // Increment the count of requests per second
    requestPerSecond++;

    // Create a promise to fetch and handle the item
    const fetchPromise = fetchAndHandleItemSafe(cookie, id, callback);

    // Add the promise to the set of active promises
    activePromises.add(fetchPromise);

    // Wait for the promise to complete and remove it from the set of active promises
    await fetchPromise.finally(() => {
        activePromises.delete(fetchPromise);
    });
}

/**
 * Fetch and handle a specific item safely.
 *
 * @param {string} cookie - Cookie for authentication.
 * @param {number} itemID - Item ID to fetch.
 * @param {function} callback - Callback function to handle fetched items.
 * @returns {Promise<void>} - Promise resolving when item is handled.
 */
async function fetchAndHandleItemSafe(cookie, itemID, callback) {
    // Fetch the item with the given ID and cookie
    const response = await fetchItem({ cookie, item_id: itemID });

    // If the item was successfully fetched
    if (response.item) {
        // Call the callback function with the fetched item
        callback(response.item);

        // Increment the valid items per second counter
        validItemsPerSecond++;

        // If the item ID is greater than or equal to the ID time since last publication
        if (itemID >= idTimeSinceLastPublication) {
            // Update the ID time since last publication and the last published time
            idTimeSinceLastPublication = itemID;
            lastPublishedTime = new Date(response.item.updated_at_ts).getTime();
        }

        // Reset the consecutive errors counter
        consecutiveErrors -= 1;
        if (consecutiveErrors < 0) {
            consecutiveErrors = 0;
        }

        if (consecutiveErrors > 5) {
            consecutiveErrors = 6;
        }


        // Update the fetched item ID range
        updateFetchedRange(itemID);
    } 
    // If the item was not found (404 error)
    else if (response.code === 404) {
        // Increment the consecutive errors counter
        consecutiveErrors++;
    } 
    // If a rate limit error occurred (429 error)
    else if (response.code === 429) {
        // Increment the rate limit errors per second counter and log the error
        rateLimitErrorsPerSecond++;
        Logger.debug(`Rate limit error: ${rateLimitErrorsPerSecond}`);
    } else {
        consecutiveErrors++;
    }

    // Return a resolved promise
    return Promise.resolve();
}

/**
 * Update the fetched item ID range.
 *
 * @param {number} itemID - The ID of the item to update the range with.
 */
function updateFetchedRange(itemID) {
    /**
     * If the item ID is lower than the current minimum fetched range, update the minimum fetched range.
     */
    if (itemID < minFetchedRange) {
        minFetchedRange = itemID;
    }

    /**
     * If the item ID is higher than the current maximum fetched range, update the maximum fetched range.
     */
    if (itemID > maxFetchedRange) {
        maxFetchedRange = itemID;
    }
}

/**
 * Adjust the concurrency dynamically based on recent errors and successes.
 *
 * The computedConcurrency is adjusted based on the following criteria:
 * - If there have been more than 5 consecutive errors, the computedConcurrency is decreased by 1,
 *   with a minimum of 2.
 * - If there have been no valid items per second for the last 1 second and no valid items per second in
 *   the past, the computedConcurrency is decreased by 1, with a minimum of 2.
 * - If more than 6 seconds have passed since the last valid item was published, the computedConcurrency
 *   is increased by 1, with a maximum of the initial concurrency.
 * - If less than 1 second has passed since the last valid item was published, the computedConcurrency
 *   is decreased by 1, with a minimum of 2.
 */
/*function adjustConcurrency() {
    // Decrease computedConcurrency if there have been more than 5 consecutive errors
    if (consecutiveErrors > 5) {
        if (computedConcurrency > 10) {
            computedConcurrency = 10;
        }
        
        computedConcurrency = Math.max(computedConcurrency - 1, 2);
    } else {
        // Increase computedConcurrency if more than 6 seconds have passed since the last valid item was published
        const timeSinceLastPublication = Date.now() - lastPublishedTime;
        if (timeSinceLastPublication > 5000) {
            computedConcurrency = Math.min(computedConcurrency + 1, concurrency);
        }
        
        // Decrease computedConcurrency if less than 1 second has passed since the last valid item was published
        if (timeSinceLastPublication < 1500) {
            computedConcurrency = Math.max(computedConcurrency - 1, 2);
        }
    }

    // Decrease computedConcurrency if there have been no valid items per second for the last 1 second
    // and no valid items per second in the past
    if (lastValidItemsPerSecond === 0 && validItemsPerSecond === 0) {
        computedConcurrency = Math.max(computedConcurrency - 1, 2);
    }

    // Make sure computedConcurrency is not below 2
    computedConcurrency = Math.max(computedConcurrency, 2);
    // Make sure computedConcurrency is not above the initial concurrency
    computedConcurrency = Math.min(computedConcurrency, concurrency);
}*/


/**
 * Find the highest item ID, retrying up to MAX_ATTEMPTS times with backoff.
 * If all attempts fail, currentID is left at 0 so the monitoring loop can
 * start from the current moment rather than blocking the entire bot forever.
 *
 * @param {string} cookie - Cookie for authentication.
 * @returns {Promise<void>}
 */
async function findHighestIDUntilSuccessful(cookie) {
    const MAX_ATTEMPTS = 10;
    const RETRY_DELAY_MS = 3000;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const response = await findHighestID(cookie);

            if (response.highestID && response.highestID > 0) {
                currentID = response.highestID;
                Logger.info(`Highest item ID found: ${currentID} (attempt ${attempt}/${MAX_ATTEMPTS})`);
                return; // success
            }

            Logger.warn(`findHighestIDUntilSuccessful: attempt ${attempt}/${MAX_ATTEMPTS} — ID was 0 or missing.`);
        } catch (error) {
            Logger.error(`findHighestIDUntilSuccessful: attempt ${attempt}/${MAX_ATTEMPTS} failed — ${error.message}`);
        }

        if (attempt < MAX_ATTEMPTS) {
            Logger.debug(`Retrying highest ID in ${RETRY_DELAY_MS / 1000}s...`);
            await delay(RETRY_DELAY_MS);
        }
    }

    // Fallback: start from 0 so the monitoring loop isn't permanently blocked
    Logger.warn(`findHighestIDUntilSuccessful: all ${MAX_ATTEMPTS} attempts failed. Starting monitor from ID 0 (will pick up live items as they appear).`);
    currentID = 0;
}

/**
 * Delay execution for a specified duration.
 * @param {number} ms - Duration in milliseconds.
 * @returns {Promise<void>} - Promise resolving after the delay.
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const CatalogService = {
    initializeConcurrency,
    fetchUntilCurrentAutomatic,
    findHighestIDUntilSuccessful,
};

export default CatalogService;
