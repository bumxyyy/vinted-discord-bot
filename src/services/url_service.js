import { URL } from 'url';
import Logger from '../utils/logger.js';
import { isSubcategory } from '../database.js';
import ConfigurationManager from '../utils/config_manager.js';
import Fuse from 'fuse.js';

const blacklisted_countries_codes = ConfigurationManager.getAlgorithmSetting.blacklisted_countries_codes || [];

export function parseVintedSearchParams(url) {
    try {
        const searchParams = {};
        const params = new URL(url).searchParams;
        const paramsKeys = [
            'search_text',
            'order',
            'catalog[]',
            'catalog_ids[]',
            'brand_ids[]',
            'video_game_platform_ids[]',
            'size_ids[]',
            'price_from',
            'price_to',
            'status_ids[]',
            'material_ids[]',
            'color_ids[]'
        ];

        for (const key of paramsKeys) {
            const isMultiple = key.endsWith('[]');
            const cleanKey = key.replace('[]', '');
            if (isMultiple) {
                const values = params.getAll(key);
                if (values && values.length > 0) {
                    searchParams[cleanKey] = searchParams[cleanKey] ? searchParams[cleanKey].concat(values) : values;
                }
            } else {
                searchParams[cleanKey] = params.get(key) || null;
            }
        }

        // Support catalog_ids alias for catalog
        if (searchParams.catalog_ids && !searchParams.catalog) {
            searchParams.catalog = searchParams.catalog_ids;
        }

        return searchParams;
    } catch (error) {
        Logger.error("Invalid URL provided: ", error.message);
        return null;
    }
}

/**
 * Checks if a Vinted item matches the given search parameters and country codes.
 */
function matchVintedItemToSearchParams(item, searchParams, bannedKeywords = [], countries_codes = [], channelId = 'unknown') {
    if (!item || !item.user) {
        return false;
    }

    // Catalog items from Vinted API (/api/v2/catalog/items) NEVER include user country data.
    // Force countryAllowed to true so listings are never discarded.
    let countryAllowed = true;

    const itemCountry = (
        item.user?.country_code || 
        item.user?.countryCode ||
        item.user?.country_iso_code || 
        item.country_code || 
        item.country_title || 
        ""
    ).toLowerCase().trim();

    // ONLY filter out if we have a KNOWN country AND it matches a blacklisted country
    if (itemCountry) {
        const blacklisted = (process.env.BLACKLISTED_COUNTRIES_CODES || "")
            .toLowerCase()
            .split(",")
            .map(s => s.trim())
            .filter(Boolean);

        if (blacklisted.length > 0 && blacklisted.includes(itemCountry)) {
            countryAllowed = false;
        }
    }

    const lowerCaseItem = {
        title: (item.title || '').toLowerCase(),
        description: (item.description || '').toLowerCase(),
        brand: (item.brand || '').toLowerCase()
    };

    const cleanBannedKeywords = (bannedKeywords || []).map(keyword => keyword.toLowerCase());
    const isBannedKeywordFree = !cleanBannedKeywords.some(keyword =>
        keyword && (lowerCaseItem.title.includes(keyword) || lowerCaseItem.description.includes(keyword))
    );

    let isSearchTextMatched = true;
    if (searchParams.search_text && searchParams.search_text.trim().length > 0) {
        const searchText = searchParams.search_text.toLowerCase().trim();
        const fuseOptions = {
            includeScore: true,
            threshold: 0.4,
            keys: ['title', 'description', 'brand']
        };
        const fuse = new Fuse([lowerCaseItem], fuseOptions);
        const result = fuse.search(searchText);
        isSearchTextMatched = result.length > 0 && result[0].score <= 0.4;
    }

    // 2. Catalog Check: Server-side API query already filtered catalog, default to true if item.catalogId is missing
    let isCatalogMatched = true;
    const catalogList = searchParams.catalog || searchParams.catalog_ids;
    if (Array.isArray(catalogList) && catalogList.length > 0) {
        if (item.catalogId) {
            const strId = String(item.catalogId);
            isCatalogMatched = catalogList.includes(strId) || catalogList.some(catId => isSubcategory(catId, item.catalogId));
        } else {
            isCatalogMatched = true;
        }
    }

    let isPriceFromMatched = true;
    if (searchParams.price_from !== null && searchParams.price_from !== undefined) {
        const priceFrom = parseFloat(searchParams.price_from);
        if (!isNaN(priceFrom)) {
            isPriceFromMatched = item.priceNumeric >= priceFrom;
        }
    }

    let isPriceToMatched = true;
    if (searchParams.price_to !== null && searchParams.price_to !== undefined) {
        const priceTo = parseFloat(searchParams.price_to);
        if (!isNaN(priceTo)) {
            isPriceToMatched = item.priceNumeric <= priceTo;
        }
    }

    const isPriceMatch = isPriceFromMatched && isPriceToMatched;

    let isBrandMatch = true;
    if (Array.isArray(searchParams.brand_ids) && searchParams.brand_ids.length > 0) {
        isBrandMatch = item.brandId && item.brandId !== 0 ? searchParams.brand_ids.includes(item.brandId.toString()) : true;
    }

    let isSizeMatch = true;
    if (Array.isArray(searchParams.size_ids) && searchParams.size_ids.length > 0) {
        isSizeMatch = item.sizeId && item.sizeId !== 0 ? searchParams.size_ids.includes(item.sizeId.toString()) : true;
    }

    let isStatusMatch = true;
    if (Array.isArray(searchParams.status_ids) && searchParams.status_ids.length > 0) {
        isStatusMatch = item.statusId && item.statusId !== 0 ? searchParams.status_ids.includes(item.statusId.toString()) : true;
    }

    let isPlatformMatch = true;
    if (Array.isArray(searchParams.video_game_platform_ids) && searchParams.video_game_platform_ids.length > 0) {
        isPlatformMatch = item.videoGamePlatformId && item.videoGamePlatformId !== 0
            ? searchParams.video_game_platform_ids.includes(item.videoGamePlatformId.toString())
            : true;
    }

    const overallVerdict =
        countryAllowed &&
        isBannedKeywordFree &&
        isSearchTextMatched &&
        isCatalogMatched &&
        isPriceMatch &&
        isBrandMatch &&
        isSizeMatch &&
        isStatusMatch &&
        isPlatformMatch;

    return overallVerdict;
}

export function filterItemsByUrl(items, url, bannedKeywords = [], countries_codes = [], channelId = 'unknown') {
    const searchParams = parseVintedSearchParams(url);
    if (!searchParams) return [];

    return items.filter(item => matchVintedItemToSearchParams(item, searchParams, bannedKeywords, countries_codes, channelId));
}
