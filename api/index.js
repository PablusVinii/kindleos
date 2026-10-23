const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const YAHOO_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36";
const SYMBOL_RE = /^[A-Za-z0-9.^=-]{1,16}$/;

module.exports = async function handler(req, res) {
    // CORS configuration
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const urlObj = new URL(req.url || '/', 'http://localhost');

        // Extract route and subpath
        let pathSegments = [];
        if (req.query && req.query.path) {
            pathSegments = Array.isArray(req.query.path)
                ? req.query.path
                : String(req.query.path).split('/').filter(Boolean);
        }
        if (pathSegments.length === 0) {
            const cleanPath = urlObj.pathname.replace(/^\/api\/?/, '');
            if (cleanPath && cleanPath !== 'index.js' && cleanPath !== 'index') {
                pathSegments = cleanPath.split('/').filter(Boolean);
            }
        }

        const route = (pathSegments[0] || '').toLowerCase();
        const subpath = pathSegments.length > 1 ? '/' + pathSegments.slice(1).join('/') : '';

        // Clean query string (remove internal routing param 'path' if present)
        const forwardSearchParams = new URLSearchParams(urlObj.searchParams);
        forwardSearchParams.delete('path');
        const forwardSearch = forwardSearchParams.toString() ? '?' + forwardSearchParams.toString() : '';

        // Standard proxy headers spoofing rekindle.ink to satisfy upstream CORS
        const baseProxyHeaders = {
            'Origin': 'https://rekindle.ink',
            'Referer': 'https://rekindle.ink/',
            'User-Agent': req.headers['user-agent'] || UA
        };

        if (req.headers['content-type']) {
            baseProxyHeaders['Content-Type'] = req.headers['content-type'];
        }

        // Helper to forward request and stream response back
        async function forwardTo(targetUrl, customHeaders = {}) {
            const fetchOptions = {
                method: req.method,
                headers: Object.assign({}, baseProxyHeaders, customHeaders)
            };

            if (req.method !== 'GET' && req.method !== 'HEAD') {
                fetchOptions.body = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
            }

            const response = await fetch(targetUrl, fetchOptions);
            const contentType = response.headers.get('content-type');
            if (contentType) {
                res.setHeader('Content-Type', contentType);
            }

            if (contentType && (contentType.includes('json') || contentType.includes('text') || contentType.includes('xml') || contentType.includes('javascript'))) {
                const text = await response.text();
                return res.status(response.status).send(text);
            } else {
                const buffer = await response.arrayBuffer();
                return res.status(response.status).send(Buffer.from(buffer));
            }
        }

        // Routing dispatch
        switch (route) {
            case '':
            case 'health':
                return res.status(200).json({ status: 'ok', service: 'KindleOS Gateway', time: new Date().toISOString() });

            case 'akinator': {
                const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
                const response = await fetch('https://p01--akinator--lcgj9cjkcx8q.code.run', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Origin': 'https://rekindle.ink',
                        'Referer': 'https://rekindle.ink/',
                        'User-Agent': UA
                    },
                    body: body
                });
                const data = await response.text();
                res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
                return res.status(response.status).send(data);
            }

            case 'chords': {
                const targetUrl = 'https://chords.timjarnott.workers.dev' + (subpath || '') + forwardSearch;
                return await forwardTo(targetUrl);
            }

            case 'reader': {
                const targetUrl = 'https://rekindle-reader.timjarnott.workers.dev' + (subpath || '/') + forwardSearch;
                return await forwardTo(targetUrl);
            }

            case 'proxy': {
                const targetUrl = forwardSearchParams.get('url') || (req.query && req.query.url);
                if (!targetUrl) {
                    return res.status(400).send('Missing url parameter');
                }
                return await forwardTo(targetUrl, {
                    'Accept': req.headers['accept'] || '*/*',
                    'Accept-Language': 'en-US,en;q=0.9'
                });
            }

            case 'tmdb': {
                const targetUrl = 'https://rekindle-tmdb.timjarnott.workers.dev' + (subpath || '') + forwardSearch;
                return await forwardTo(targetUrl);
            }

            case 'translate': {
                const targetUrl = 'https://rekindle-translate.timjarnott.workers.dev' + (subpath || '') + forwardSearch;
                return await forwardTo(targetUrl);
            }

            case 'substack': {
                const targetUrl = 'https://rekindle-substack.timjarnott.workers.dev' + (subpath || '') + forwardSearch;
                return await forwardTo(targetUrl);
            }

            case 'moderate': {
                const targetUrl = 'https://rekindle-moderate.timjarnott.workers.dev' + (subpath || '') + forwardSearch;
                return await forwardTo(targetUrl);
            }

            case 'ocr': {
                const targetUrl = 'https://rekindle-ocr.timjarnott.workers.dev' + (subpath || '') + forwardSearch;
                return await forwardTo(targetUrl);
            }

            case 'oracle': {
                const targetUrl = 'https://rekindle-oracle.timjarnott.workers.dev' + (subpath || '') + forwardSearch;
                return await forwardTo(targetUrl);
            }

            case 'pinterest': {
                const targetUrl = 'https://rekindle-pinterest.timjarnott.workers.dev' + (subpath || '') + forwardSearch;
                return await forwardTo(targetUrl);
            }

            case 'readwise': {
                const targetUrl = 'https://rekindle-readwise.timjarnott.workers.dev' + (subpath || '') + forwardSearch;
                return await forwardTo(targetUrl);
            }

            case 'story': {
                const targetUrl = 'https://story.timjarnott.workers.dev' + (subpath || '') + forwardSearch;
                return await forwardTo(targetUrl);
            }

            case 'nrl-scores': {
                const targetUrl = 'https://rekindle-nrl.timjarnott.workers.dev' + (subpath || '') + forwardSearch;
                return await forwardTo(targetUrl);
            }

            case 'reddit': {
                const targetUrl = forwardSearchParams.get('url') || (req.query && req.query.url);
                if (!targetUrl) {
                    return res.status(400).send('Missing url param');
                }
                const response = await fetch(targetUrl, {
                    method: 'GET',
                    headers: {
                        'User-Agent': UA,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8,application/json',
                        'Accept-Language': 'en-US,en;q=0.9'
                    }
                });
                const contentType = response.headers.get('content-type');
                if (contentType) res.setHeader('Content-Type', contentType);
                const buffer = await response.arrayBuffer();
                return res.status(response.status).send(Buffer.from(buffer));
            }

            case 'price': {
                const symbol = forwardSearchParams.get('symbol') || (req.query && req.query.symbol) || '';
                const interval = forwardSearchParams.get('interval') || (req.query && req.query.interval) || '60m';
                const range = forwardSearchParams.get('range') || (req.query && req.query.range) || '1d';
                const cleanSymbol = symbol.trim();

                if (!cleanSymbol || !SYMBOL_RE.test(cleanSymbol)) {
                    return res.status(400).json({ error: 'Valid symbol required' });
                }

                const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
                for (const host of hosts) {
                    try {
                        const target = `https://${host}/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
                        const response = await fetch(target, {
                            headers: { 'User-Agent': YAHOO_UA, 'Accept': 'application/json' }
                        });
                        if (response.ok) {
                            const data = await response.json();
                            res.setHeader('Cache-Control', 'public, max-age=60');
                            return res.status(200).json(data);
                        }
                    } catch (e) {
                        // try next host
                    }
                }
                return res.status(502).json({ error: 'Failed to fetch financial data' });
            }

            case 'maps': {
                const targetUrl = forwardSearchParams.get('url') || (req.query && req.query.url);
                if (!targetUrl) {
                    return res.status(400).send('Missing url param');
                }
                const allowedDomains = ['nominatim.openstreetmap.org', 'router.project-osrm.org'];
                try {
                    const u = new URL(targetUrl);
                    if (!allowedDomains.includes(u.hostname)) {
                        return res.status(403).send('Forbidden: Domain not allowed');
                    }
                } catch (e) {
                    return res.status(400).send('Invalid URL');
                }
                const upstream = await fetch(targetUrl, {
                    headers: { 'User-Agent': 'ReKindle-Maps/1.0 (rekindle.ink)' }
                });
                const contentType = upstream.headers.get('content-type');
                if (contentType) res.setHeader('Content-Type', contentType);
                const data = await upstream.text();
                return res.status(upstream.status).send(data);
            }

            case 'gutenberg': {
                const targetUrl = forwardSearchParams.get('url') || (req.query && req.query.url);
                if (!targetUrl) {
                    return res.status(400).send('Missing url param');
                }
                return await forwardTo(targetUrl, {
                    'Accept': 'text/plain, text/html, application/epub+zip, */*'
                });
            }

            default: {
                // Generic fallback for any other rekindle worker (e.g. akinator, comics, etc.)
                const targetUrl = `https://rekindle-${route}.timjarnott.workers.dev` + (subpath || '') + forwardSearch;
                return await forwardTo(targetUrl);
            }
        }
    } catch (err) {
        return res.status(500).json({ error: 'Gateway failure', details: err.message });
    }
};
