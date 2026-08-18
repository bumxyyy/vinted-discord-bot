import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import Logger from '../utils/logger.js';
import ConfigurationManager from '../utils/config_manager.js';
import ProxyManager from '../utils/proxy_manager.js';

class VintedScraper {
    constructor() {
        this.domain = ConfigurationManager.getAlgorithmSetting.vinted_api_domain_extension || 'it';
        this.jar = new CookieJar();
        this.client = axios.create({
            validateStatus: (status) => status < 500,
            timeout: 10000,
        });
        this.csrfToken = null;
        this.anonId = null;
        this.isWarmedUp = false;
        this.lastWarmupTime = 0;
        this.currentProxy = null;
    }

    /**
     * Set domain dynamically if needed.
     */
    setDomain(domain) {
        if (domain) {
            this.domain = domain;
        }
    }

    /**
     * Get a proxy agent for axios requests.
     */
    getProxyAgent() {
        const proxy = ProxyManager.getNewProxy();
        if (proxy) {
            this.currentProxy = proxy;
            return ProxyManager.getProxyAgent(proxy);
        }
        return null;
    }

    /**
     * Attach cookies from CookieJar to request config.
     */
    async attachCookiesToRequest(url, headers) {
        try {
            const cookieString = await this.jar.getCookieString(url);
            if (cookieString) {
                headers['Cookie'] = cookieString;
            }
        } catch (error) {
            Logger.debug(`Failed to attach cookies for ${url}: ${error.message}`);
        }
    }

    /**
     * Extract and save Set-Cookie headers from response to CookieJar.
     */
    async saveResponseCookies(url, response) {
        try {
            const setCookie = response.headers?.['set-cookie'];
            if (setCookie) {
                const cookieList = Array.isArray(setCookie) ? setCookie : [setCookie];
                for (const cookieStr of cookieList) {
                    await this.jar.setCookie(cookieStr, url);
                }
            }
        } catch (error) {
            Logger.debug(`Failed to save cookies for ${url}: ${error.message}`);
        }
    }

    /**
     * Perform HTML warmup request to fetch homepage, CSRF token, and anon_id cookie.
     */
    async warmUp() {
        const url = `https://www.vinted.${this.domain}/`;
        const headers = {
            'Upgrade-Insecure-Requests': '1',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-User': '?1',
            'Sec-Fetch-Dest': 'document',
            'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
            'Priority': 'u=0, i'
        };

        await this.attachCookiesToRequest(url, headers);

        const agent = this.getProxyAgent();
        const requestConfig = {
            method: 'GET',
            url,
            headers,
            ...(agent ? { httpsAgent: agent, httpAgent: agent } : {})
        };

        try {
            const response = await this.client(requestConfig);
            await this.saveResponseCookies(url, response);

            if (response.status >= 400) {
                Logger.error(`Warmup failed with HTTP status ${response.status}`);
            }

            const html = typeof response.data === 'string' ? response.data : '';

            // Extract CSRF Token via regex fallbacks
            const csrfMatch = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/) ||
                              html.match(/"csrfToken"\s*:\s*"([^"]+)"/) ||
                              html.match(/<meta\s+content="([^"]+)"\s+name="csrf-token"/) ||
                              html.match(/CSRF_TOKEN\\?":\s*\\?"([^"\\]+)/) ||
                              html.match(/"csrf_token"\s*:\s*"([^"]+)"/);

            if (csrfMatch && csrfMatch[1]) {
                this.csrfToken = csrfMatch[1];
            }

            // Extract anon_id from CookieJar
            const cookies = await this.jar.getCookies(url);
            const anonCookie = cookies.find(c => c.key === 'anon_id');
            if (anonCookie) {
                this.anonId = anonCookie.value;
            }

            this.isWarmedUp = true;
            this.lastWarmupTime = Date.now();
            Logger.info(`Warmed up Vinted session (CSRF: ${this.csrfToken ? 'Found' : 'Missing'}, AnonId: ${this.anonId ? 'Found' : 'Missing'})`);
            return true;
        } catch (error) {
            Logger.error(`Error during Vinted session warmup: ${error.message}`);
            if (this.currentProxy) {
                ProxyManager.removeTemporarlyInvalidProxy(this.currentProxy);
            }
            throw error;
        }
    }

    /**
     * Ensure session is warmed up before making API requests.
     */
    async ensureWarmedUp() {
        const now = Date.now();
        const TEN_MINUTES_MS = 10 * 60 * 1000;
        if (!this.isWarmedUp || !this.csrfToken || (now - this.lastWarmupTime > TEN_MINUTES_MS)) {
            await this.warmUp();
        }
    }

    /**
     * Construct default desktop Vinted API headers.
     */
    getApiHeaders() {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Sec-Ch-Ua': '"Google Chrome";v="146", "Chromium";v="146", "Not_A Brand";v="24"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"macOS"',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': `https://www.vinted.${this.domain}/`,
            'Origin': `https://www.vinted.${this.domain}`,
            'X-Platform': 'web',
            'X-Portal': 'it',
            'X-Debug-Info': 'v4',
            'X-Local-Time': Date.now().toString(),
            'Locale': 'it-IT'
        };

        if (this.csrfToken) {
            headers['X-Csrf-Token'] = this.csrfToken;
        }
        if (this.anonId) {
            headers['X-Anon-Id'] = this.anonId;
        }

        return headers;
    }

    /**
     * Build URL query parameters string for catalog search API.
     */
    buildCatalogQueryParams(params = {}) {
        const searchParams = new URLSearchParams();

        searchParams.append('order', params.order || 'newest_first');
        searchParams.append('per_page', (params.per_page || 20).toString());

        if (params.search_text && String(params.search_text).trim()) {
            searchParams.append('search_text', String(params.search_text).trim());
        }

        if (params.page && parseInt(params.page, 10) > 1) {
            searchParams.append('page', params.page.toString());
        }

        if (params.price_from !== undefined && params.price_from !== null) {
            searchParams.append('price_from', params.price_from.toString());
        }

        if (params.price_to !== undefined && params.price_to !== null) {
            searchParams.append('price_to', params.price_to.toString());
        }

        const arrayKeys = [
            { paramName: 'catalog_ids', queryKey: 'catalog_ids[]' },
            { paramName: 'catalog', queryKey: 'catalog_ids[]' },
            { paramName: 'catalog[]', queryKey: 'catalog_ids[]' },
            { paramName: 'catalog_ids[]', queryKey: 'catalog_ids[]' },
            { paramName: 'brand_ids', queryKey: 'brand_ids[]' },
            { paramName: 'brand_ids[]', queryKey: 'brand_ids[]' },
            { paramName: 'video_game_platform_ids', queryKey: 'video_game_platform_ids[]' },
            { paramName: 'video_game_platform_ids[]', queryKey: 'video_game_platform_ids[]' },
            { paramName: 'size_ids', queryKey: 'size_ids[]' },
            { paramName: 'size_ids[]', queryKey: 'size_ids[]' },
            { paramName: 'color_ids', queryKey: 'color_ids[]' },
            { paramName: 'color_ids[]', queryKey: 'color_ids[]' },
            { paramName: 'status_ids', queryKey: 'status_ids[]' },
            { paramName: 'status_ids[]', queryKey: 'status_ids[]' },
            { paramName: 'material_ids', queryKey: 'material_ids[]' },
            { paramName: 'material_ids[]', queryKey: 'material_ids[]' }
        ];

        const processedKeys = new Set();

        for (const { paramName, queryKey } of arrayKeys) {
            const val = params[paramName];
            if (val && !processedKeys.has(queryKey)) {
                const list = Array.isArray(val) ? val : [val];
                for (const item of list) {
                    if (item !== undefined && item !== null && item !== '') {
                        searchParams.append(queryKey, item.toString());
                    }
                }
                if (list.length > 0) {
                    processedKeys.add(queryKey);
                }
            }
        }

        // Forward any extra raw parameters from channel searchParams
        if (params.rawSearchParams instanceof URLSearchParams) {
            for (const [key, value] of params.rawSearchParams.entries()) {
                if (['order', 'per_page', 'page', 'price_from', 'price_to', 'search_text', '_'].includes(key)) continue;
                let targetKey = key;
                if (key === 'catalog[]' || key === 'catalog_ids') targetKey = 'catalog_ids[]';
                const existingValues = searchParams.getAll(targetKey);
                if (!existingValues.includes(value)) {
                    searchParams.append(targetKey, value);
                }
            }
        }

        searchParams.append('_', Date.now().toString());
        return searchParams.toString();
    }

    /**
     * Fetch items from catalog API with automatic 401/403 session re-warmup flow.
     */
    async fetchCatalogItems(params = {}) {
        await this.ensureWarmedUp();

        const domain = params.domain || this.domain || 'fr';
        const queryString = this.buildCatalogQueryParams(params);
        const url = `https://www.vinted.${domain}/api/v2/catalog/items?${queryString}`;

        return await this.executeApiRequestWithRecovery(url);
    }

    /**
     * Fetch specific item by ID.
     */
    async fetchItem(itemId) {
        await this.ensureWarmedUp();
        const url = `https://www.vinted.${this.domain}/api/v2/items/${itemId}?_=${Date.now()}`;
        return await this.executeApiRequestWithRecovery(url);
    }

    /**
     * Fetch user profile details by ID.
     */
    async fetchUser(userId, domain = null) {
        await this.ensureWarmedUp();
        const targetDomain = domain || this.domain || 'it';
        const url = `https://www.vinted.${targetDomain}/api/v2/users/${userId}?_=${Date.now()}`;
        return await this.executeApiRequestWithRecovery(url);
    }

    /**
     * Fetch catalog initializers / category roots.
     */
    async fetchCatalogInitializers() {
        await this.ensureWarmedUp();
        const url = `https://www.vinted.${this.domain}/api/v2/catalog/initializers?_=${Date.now()}`;
        return await this.executeApiRequestWithRecovery(url);
    }

    /**
     * Assembles all current session cookies from tough-cookie jar into a string.
     */
    async getCookieString() {
        await this.ensureWarmedUp();
        const cookies = await this.jar.getCookies(`https://www.vinted.${this.domain}`);
        return cookies.map(c => `${c.key}=${c.value}`).join('; ');
    }

    /**
     * Execute API request with 401/403 session recovery flow.
     */
    async executeApiRequestWithRecovery(url, method = 'GET', data = null) {
        let attempt = 0;
        while (attempt < 2) {
            attempt++;
            const agent = this.getProxyAgent();
            const headers = this.getApiHeaders();
            await this.attachCookiesToRequest(url, headers);

            const config = {
                method,
                url,
                headers,
                ...(agent ? { httpsAgent: agent, httpAgent: agent } : {}),
                ...(data ? { data } : {})
            };

            try {
                const response = await this.client(config);
                await this.saveResponseCookies(url, response);

                if (response.status === 402) {
                    Logger.error(`[PROXY ERROR] Proxy returned HTTP 402 Payment Required (proxy bandwidth/account expired). Removing proxy.`);
                    if (this.currentProxy) {
                        ProxyManager.removeProxy(this.currentProxy);
                        this.currentProxy = null;
                    }
                }

                if (response.status === 401 || response.status === 403) {
                    Logger.warn(`[WARN]: Received ${response.status} from Vinted for ${url}. Re-warming session...`);
                    this.isWarmedUp = false;
                    this.csrfToken = null;
                    this.anonId = null;
                    await this.warmUp();

                    if (attempt < 2) {
                        continue; // Retry once after re-warming
                    }
                }

                return {
                    success: response.status >= 200 && response.status < 300,
                    status: response.status,
                    data: response.data
                };
            } catch (error) {
                Logger.error(`Request to ${url} failed with error: ${error.message}`);
                if (this.currentProxy && !error.response) {
                    ProxyManager.removeTemporarlyInvalidProxy(this.currentProxy);
                }
                throw error;
            }
        }
    }
}

// Export singleton instance as default scraper
const vintedScraper = new VintedScraper();
export default vintedScraper;
export { VintedScraper };
