import { URL } from 'url';
import Logger from '../utils/logger.js';
import { isSubcategory } from '../database.js';
import ConfigurationManager from '../utils/config_manager.js';
import Fuse from 'fuse.js'; // Import Fuse.js

const blacklisted_countries_codes = ConfigurationManager.getAlgorithmSetting.blacklisted_countries_codes;

function parseVintedSearchParams(url) {
    try {
        const searchParams = {};
        const params = new URL(url).searchParams;
        const paramsKeys = ['search_text', 'order', 'catalog[]', 'brand_ids[]', 'video_game_platform_ids[]', 'size_ids[]', 'price_from', 'price_to', 'status_ids[]', 'material_ids[]', 'color_ids[]'];
        for (const key of paramsKeys) {
            const isMultiple = key.endsWith('[]');
            if (isMultiple) {
                searchParams[key.replace('[]', '')] = params.getAll(key) || null;
            } else {
                searchParams[key] = params.get(key) || null;
            }
        }
        return searchParams;
    } catch (error) {
        Logger.error("Invalid URL provided: ", error.message);
        return null;
    }
}

/**
 * Checks if a Vinted item matches the given search parameters and country codes, using fuzzy search.
 *
 * @param {Object} item - The Vinted item to check.
 * @param {Object} searchParams - The search parameters to match against the item.
 * @param {Array} [countries_codes=[]] - The country codes to check against the item's user country code.
 * @return {boolean} Returns true if the item matches all the search parameters and country codes, false otherwise.
 */
function matchVintedItemToSearchParams(item, searchParams, bannedKeywords, countries_codes = []) {

    // item.user can be null when the Vinted API omits the seller (e.g. deleted account)
    if (!item.user) {
        return false;
    }

    // Check blacklisted countries
    if (blacklisted_countries_codes.includes(item.user.countryCode)) {
        return false;
    }

    // Check country codes
    if (countries_codes.length && !countries_codes.includes(item.user.countryCode)) {
        return false;
    }

    const lowerCaseItem = {
        title: item.title.toLowerCase(),
        description: item.description.toLowerCase(),
        brand: item.brand.toLowerCase()
    };

    // make sure the bannedKeywords is an array of lowercase strings
    bannedKeywords = bannedKeywords.map(keyword => keyword.toLowerCase());

    // check for banned keywords in the title and description
    if (bannedKeywords.some(keyword => lowerCaseItem.title.includes(keyword) || lowerCaseItem.description.includes(keyword))) {
        return false;
    }

    // Fuzzy search options
    const fuseOptions = {
        includeScore: true,
        threshold: 0.4,  // Adjust this value for fuzzy tolerance (lower is stricter, higher is more lenient)
        keys: ['title', 'description', 'brand']
    };

    // sanitize the search text
    if (searchParams.search_text && searchParams.search_text.length > 0 && searchParams.search_text !== " ") {
        const searchText = searchParams.search_text.toLowerCase();
        const fuse = new Fuse([lowerCaseItem], fuseOptions);
        const result = fuse.search(searchText);

        // If no result or score is too low, return false
        if (!result.length || result[0].score > 0.4) { // You can adjust the score threshold based on your needs
            return false;
        }
    }

    // Check catalog IDs — guard against null/undefined (parser returns null when param is absent)
    if (Array.isArray(searchParams.catalog) && searchParams.catalog.length > 0) {
        if (!searchParams.catalog.some(catalogId => isSubcategory(catalogId, item.catalogId))) {
            return false;
        }
    }

    if (searchParams.price_from && item.priceNumeric < searchParams.price_from) {
        return false;
    }

    if (searchParams.price_to && item.priceNumeric > searchParams.price_to) {
        return false;
    }

    // Check other parameters
    const searchParamsMap = new Map([
        ['brand_ids', 'brandId'],
        ['video_game_platform_ids', 'videoGamePlatformId'],
        ['size_ids', 'sizeId'],
        ['status_ids', 'statusId'],
        ['material_ids', 'material'],
        ['color_ids', 'colorId'],
    ].map(([key, value]) => [key, item[value]]));

    for (const [key, value] of searchParamsMap) {
        const param = searchParams[key];
        // Skip if the search URL didn't include this filter
        if (!Array.isArray(param) || param.length === 0) continue;
        // Skip if the item itself has no value for this field (null/undefined)
        if (value == null) continue;
        if (!param.includes(value.toString())) {
            return false;
        }
    }

    // If all criteria are met, return true
    return true;
}

export function filterItemsByUrl(items, url, bannedKeywords, countries_codes = []) {
    const searchParams = parseVintedSearchParams(url);
    if (!searchParams) return [];

    return items.filter(item => matchVintedItemToSearchParams(item, searchParams, bannedKeywords, countries_codes));
}
