import { SocksProxyAgent } from 'socks-proxy-agent';
import Logger from './logger.js';
import { listProxies, Proxy } from './proxies.js';
import ConfigurationManager from './config_manager.js';
import fs from 'fs';

const proxy_settings = ConfigurationManager.getProxiesConfig;

/**
 * Static class for managing proxy settings and making HTTP requests with SOCKS authentication.
 */
class ProxyManager {
    static proxyConfig = null;
    static proxies = [];
    static proxiesLoaded = false;
    static currentProxyIndex = 0;
    static proxiesOnCooldown = [];

    static async init(maxRetries = 99, retryDelay = 5000) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                if (proxy_settings.use_webshare) {
                    this.proxies = await listProxies(proxy_settings.webshare_api_key);
                    Logger.info(`Loaded ${this.proxies.length} proxies from Webshare.`);
                } else {
                    // Read the proxy file
                    const proxyFile = fs.readFileSync('proxies.txt', 'utf8');
                    const proxyLines = proxyFile.split('\n');

                    // Parse the proxy lines
                    for (const line of proxyLines) {
                        const parts = line.trim().split(':');
                        if (parts.length === 4) {
                            const proxy = new Proxy(parts[0], parts[1], parts[2], parts[3]);
                            this.proxies.push(proxy);
                        }
                    }
                    Logger.info(`Loaded ${this.proxies.length} proxies from file.`);
                }
                return;
            } catch (error) {
                Logger.error(`Attempt ${attempt + 1} failed to initialize proxies: ${error.message}`);
                if (attempt === maxRetries - 1) {
                    Logger.error('Failed to initialize proxies after maximum retries');
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }

    /**
     * Clears the proxy configuration.
     */
    static clearProxy() {
        this.proxyConfig = null;
    }

    /**
     * Returns the next proxy in round-robin order.
     * @returns {Proxy|undefined}
     */
    static getNewProxy() {
        if (this.proxies.length > 0) {
            this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
            const proxy = this.proxies[this.currentProxyIndex];
            return proxy;
        }

        Logger.error('No proxies available.');
        return undefined;
    }

    /**
     * Get a SocksProxyAgent for the given Proxy object.
     * @param {Proxy} proxy
     * @returns {SocksProxyAgent}
     */
    static getProxyAgent(proxy) {
        return new SocksProxyAgent(proxy.getProxyString());
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
