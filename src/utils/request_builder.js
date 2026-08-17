import axios from 'axios';
import ProxyManager from './proxy_manager.js';
import Logger from './logger.js';
import ConfigurationManager from './config_manager.js';

const algorithm_settings = ConfigurationManager.getAlgorithmSetting;
const vinted_api_domain_extension = algorithm_settings.vinted_api_domain_extension;

/**
 * Fixed, self-consistent desktop Chrome 124 / Windows 10 header set.
 *
 * Key fixes vs. previous version:
 *  - Removed duplicate Sec-Ch-Ua-Mobile (was declared twice: ?0 then ?1 — the
 *    object silently overwrote the first, making every request appear as mobile).
 *  - Added Sec-Ch-Ua and Sec-Ch-Ua-Platform (required Client-Hint headers).
 *  - Fixed Accept-Language (was malformed 'fr=FR, en-US').
 *  - Added Referer so the request looks like an in-page XHR rather than a cold hit.
 *  - Hard-coded a single, matching User-Agent instead of using random-useragent,
 *    which could emit Chrome < 120 or non-Chrome families that break CH consistency.
 */
const DESKTOP_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE_HEADERS = {
    'User-Agent':              DESKTOP_USER_AGENT,
    'Accept':                  'application/json, text/plain, */*',
    'Accept-Encoding':         'gzip, deflate, br',
    'Accept-Language':         'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
    'Sec-Ch-Ua':               '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile':        '?0',
    'Sec-Ch-Ua-Platform':      '"Windows"',
    'Sec-Fetch-Dest':          'empty',
    'Sec-Fetch-Mode':          'cors',
    'Sec-Fetch-Site':          'same-origin',
    'Cache-Control':           'no-cache',
    'Connection':              'keep-alive',
    'DNT':                     '1',
    'Origin':                  `https://www.vinted.${vinted_api_domain_extension}`,
    'Referer':                 `https://www.vinted.${vinted_api_domain_extension}/`,
    'Priority':                'u=1, i',
};

class RequestBuilder {
    constructor(url, method = 'GET') {
        this.url = url;
        this.method = method.toUpperCase();
        this.headers = { ...BASE_HEADERS };
        this.proxy = null;
        this.timeout = 10000; // increased from 5000 ms to accommodate proxy latency
        this.params = {};
        this.data = null;

        return this;
    }

    // Set custom headers
    setHeaders(headers) {
        this.headers = { ...this.headers, ...headers };
        return this;
    }

    // Set proxy from proxy manager
    setProxy(proxy) {
        proxy = ProxyManager.getProxyAgent(proxy);
        this.proxy = proxy;
        return this;
    }

    // Set Next Proxy
    setNextProxy() {
        const proxy = ProxyManager.getNewProxy();
        if (proxy) {
            this.setProxy(proxy);
        }
        return this;
    }

    // Set request timeout
    setTimeout(timeout) {
        this.timeout = timeout;
        return this;
    }

    // Add URL parameters
    setParams(params) {
        this.params = { ...this.params, ...params };
        return this;
    }

    // Set request body data for POST/PUT/PATCH/DELETE requests
    setData(data) {
        this.data = data;
        return this;
    }

    // Change the HTTP method dynamically
    setMethod(method) {
        this.method = method.toUpperCase();
        return this;
    }

    setCookie(cookie) {
        this.headers['Cookie'] = cookie;
        return this;
    }

    // Build and send the request
    async send() {
        Logger.debug(`Sending ${this.method} request to ${this.url}`);

        const config = {
            method:   this.method,
            url:      this.url,
            headers:  this.headers,
            timeout:  this.timeout,
            params:   this.params,
            // Allow axios to resolve (not throw) for any status below 500.
            // This means 4xx responses (404, 403, 429, etc.) come back as
            // normal response objects instead of landing in the catch block.
            validateStatus: (status) => status < 500,
        };

        // Attach proxy agents when a proxy is configured
        if (this.proxy) {
            config.httpsAgent = this.proxy;
            config.httpAgent  = this.proxy;
        }

        // Include body data for mutating methods
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(this.method) && this.data) {
            config.data = this.data;
        }

        try {
            const response = await axios(config);
            response.success = response.status >= 200 && response.status < 300;
            return response;
        } catch (error) {
            // At this point axios only throws for network-level failures
            // (ECONNREFUSED, ETIMEDOUT, ECONNRESET, etc.) because validateStatus
            // already accepted all < 500 responses. So here we know the proxy
            // itself failed to connect — it is safe to temporarily remove it.

            const status  = error.response?.status;   // may be undefined for pure network errors
            const message = error.message || 'unknown network error';

            Logger.debug(`Network error on request to ${this.url}: ${message}${status ? ` (HTTP ${status})` : ''}`);

            // Only remove the proxy when the error is clearly a network / transport
            // failure (no response at all), not for an application-level error.
            if (this.proxy && !error.response) {
                ProxyManager.removeTemporarlyInvalidProxy(this.proxy);
            }

            throw error;
        }
    }
}

RequestBuilder.get  = (url) => new RequestBuilder(url, 'GET');
RequestBuilder.post = (url) => new RequestBuilder(url, 'POST');
RequestBuilder.put  = (url) => new RequestBuilder(url, 'PUT');

export default RequestBuilder;