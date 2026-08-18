import { HttpsProxyAgent } from 'https-proxy-agent';
import Logger from './logger.js';
import { listProxies, Proxy } from './proxies.js';
import ConfigurationManager from './config_manager.js';
import fs from 'fs';

const proxy_settings = ConfigurationManager.getProxiesConfig;

/**
 * Static class for managing proxy settings and making HTTP/HTTPS requests through an HTTP proxy.
 */
class ProxyManager {
    static proxyConfig = null;
    static proxies = [];
    static proxiesLoaded = false;
    static currentProxyIndex = 0;
    static proxiesOnCooldown = [];

    static async init(maxRetries = 3, retryDelay = 2000) {
        const useWebshareEnv = process.env.USE_WEBSHARE;
        const isExplicitlyDisabled = useWebshareEnv === "0" || useWebshareEnv === 0;
        const apiKey = proxy_settings.webshare_api_key || process.env.WEBSHARE_API_KEY;
        const isApiKeyValid = apiKey && !apiKey.includes("YOUR_API_KEY");

        const shouldFetchWebshare = !isExplicitlyDisabled && proxy_settings.use_webshare && isApiKeyValid;

        if (shouldFetchWebshare) {
            try {
                this.proxies = await listProxies(apiKey);
                Logger.info(`Loaded ${this.proxies.length} proxies from Webshare.`);
                return;
            } catch (webshareErr) {
                Logger.warn(`Webshare API failed (${webshareErr.message}). Falling back to proxies.txt file...`);
            }
        }

        // Read proxies strictly from proxies.txt in root folder
        if (fs.existsSync('proxies.txt')) {
            const proxyFile = fs.readFileSync('proxies.txt', 'utf8');
            const rawLines = proxyFile.split(/\r?\n/);

            this.proxies = [];
            for (const rawLine of rawLines) {
                const line = rawLine.trim();
                if (!line || line.startsWith('#')) continue;

                if (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('socks5://')) {
                    try {
                        const parsedUrl = new URL(line);
                        const proxy = new Proxy(
                            parsedUrl.hostname,
                            parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                            decodeURIComponent(parsedUrl.username || ''),
                            decodeURIComponent(parsedUrl.password || ''),
                            parsedUrl.protocol.replace(':', '')
                        );
                        this.proxies.push(proxy);
                    } catch (e) {
                        Logger.warn(`Invalid proxy URL line ignored: "${line}"`);
                    }
                    continue;
                }

                const parts = line.split(':');
                if (parts.length === 4 && parts[0] && parts[1]) {
                    const proxy = new Proxy(parts[0], parts[1], parts[2], parts[3]);
                    this.proxies.push(proxy);
                } else if (parts.length === 2 && parts[0] && parts[1]) {
                    const proxy = new Proxy(parts[0], parts[1], '', '');
                    this.proxies.push(proxy);
                } else {
                    Logger.warn(`Unrecognized proxy format line ignored: "${line}"`);
                }
            }
            Logger.info(`Loaded ${this.proxies.length} proxies from proxies.txt`);
            return;
        } else {
            Logger.warn('proxies.txt not found. No proxies loaded.');
            return;
        }
    }

    /**
     * Clears the proxy configuration.
     */
    static clearProxy() {
        this.proxyConfig = null;
    }

    /**
     * Returns the next proxy (supports single rotating line and multi-line round-robin).
     * @returns {Proxy|undefined}
     */
    static getNewProxy() {
        if (this.proxies.length === 0) {
            Logger.error('No proxies available.');
            return undefined;
        }

        if (this.proxies.length === 1) {
            return this.proxies[0];
        }

        this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
        const proxy = this.proxies[this.currentProxyIndex];
        return proxy;
    }

    /**
     * Get an HttpsProxyAgent for the given Proxy object.
     * Works for both HTTP and HTTPS targets via an HTTP CONNECT tunnel.
     * @param {Proxy} proxy
     * @returns {HttpsProxyAgent}
     */
    static getProxyAgent(proxy) {
        return new HttpsProxyAgent(proxy.getProxyString());
    }

    /**
     * Permanently remove a proxy from the active list.
     * When only 1 proxy is loaded (e.g. a single rotating endpoint), the proxy
     * is NOT removed — removing it would drain the pool and stall all scraping.
     * @param {Proxy} proxy
     */
    static removeProxy(proxy) {
        if (this.proxies.length <= 1) {
            Logger.warn('removeProxy: only 1 proxy in pool — skipping removal to preserve scraping capability.');
            return;
        }
        this.proxies = this.proxies.filter(p => p !== proxy);
    }

    /**
     * Temporarily remove a proxy from the active list and restore it after a
     * cooldown period.
     *
     * Single-proxy guard: if this is the only proxy in the pool (e.g. a single
     * rotating endpoint like Webshare p.webshare.io), do NOT remove it.
     * Removing the sole proxy empties the pool, which stalls every subsequent
     * scraping cycle until the cooldown expires — and the cycle would repeat
     * on the very next error.
     *
     * @param {Proxy} proxy
     * @param {number} [timeout=60000] - Cooldown duration in ms before the proxy is re-added.
     */
    static removeTemporarlyInvalidProxy(proxy, timeout = 60000) {
        if (this.proxies.length <= 1) {
            Logger.warn(
                'removeTemporarlyInvalidProxy: only 1 proxy in pool — skipping cooldown removal ' +
                'to preserve scraping capability. The proxy will be retried on the next request.'
            );
            return;
        }

        this.proxiesOnCooldown.push(proxy);
        this.proxies = this.proxies.filter(p => p !== proxy);

        Logger.debug(`Proxy placed on ${timeout / 1000}s cooldown. Active proxies: ${this.proxies.length}`);

        setTimeout(() => {
            this.proxies.push(proxy);
            this.proxiesOnCooldown = this.proxiesOnCooldown.filter(p => p !== proxy);
            Logger.debug(`Proxy restored from cooldown. Active proxies: ${this.proxies.length}`);
        }, timeout);
    }
}

export default ProxyManager;
