export class Proxy {
    /**
     * @param {string} ip       - Proxy hostname or IP address.
     * @param {string|number} port
     * @param {string} username
     * @param {string} password
     * @param {string} [method='http'] - Protocol scheme: 'http', 'https', 'socks5', etc.
     */
    constructor(ip, port, username, password, method = 'http') {
        this.ip       = ip;
        this.port     = port;
        this.username = username;
        this.password = password;
        this.method   = method;
    }

    /**
     * Returns a proxy URL string suitable for HttpsProxyAgent / SocksProxyAgent.
     * Credentials are percent-encoded so special characters (@ : / etc.) don't
     * corrupt the URL structure.
     * Example: http://user:pass@p.webshare.io:80
     */
    getProxyString() {
        if (!this.username && !this.password) {
            return `${this.method}://${this.ip}:${this.port}`;
        }
        const user = encodeURIComponent(this.username);
        const pass = encodeURIComponent(this.password);
        return `${this.method}://${user}:${pass}@${this.ip}:${this.port}`;
    }

}

export async function listProxies(apiKey, timeout = 10000) {
    if (!apiKey) {
        throw new Error("API key is required.");
    }

    const baseUrl = 'https://proxy.webshare.io/api/v2/proxy/list/';
    let allProxies = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
        const url = new URL(baseUrl);
        url.searchParams.append('mode', 'direct');
        url.searchParams.append('page_size', '100');
        url.searchParams.append('page', page);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const req = await fetch(url.href, {
                method: "GET",
                headers: {
                    Authorization: "Token " + apiKey,
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!req.ok) {
                throw new Error(`HTTP error! status: ${req.status}`);
            }

            const res = await req.json();

            const proxies = res.results.map((proxy) =>
                new Proxy(proxy.proxy_address, proxy.port, proxy.username, proxy.password)
            );

            allProxies = allProxies.concat(proxies);

            totalPages = Math.ceil(res.count / 100);
            page++;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Request timed out');
            }
            throw error;
        }
    }

    return allProxies;
}
