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
                // Native self-hosted chords extraction (no dependency on rate-limited upstream worker)
                const cmd = forwardSearchParams.get('cmd') || (req.query && req.query.cmd) || 'search';
                const q = forwardSearchParams.get('q') || (req.query && req.query.q) || '';
                const targetUrl = forwardSearchParams.get('url') || (req.query && req.query.url) || '';

                if (cmd === 'search') {
                    if (!q) return res.status(400).json({ error: 'No query provided' });
                    let results = [];

                    // 1. Try GuitareTab
                    try {
                        const gtSearchUrl = `https://www.guitaretab.com/fetch/?type=tab&query=${encodeURIComponent(q)}`;
                        const gtRes = await fetch(gtSearchUrl, { headers: { 'User-Agent': UA } });
                        if (gtRes.ok) {
                            const gtHtml = await gtRes.text();
                            const linkRegex = /<a[^>]+href=["'](\/[a-z0-9]\/[^"']+\/[^"']+\.html)["'][^>]*class=["']gt-link[^"']*gt-link--primary[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
                            let match;
                            while ((match = linkRegex.exec(gtHtml)) !== null) {
                                results.push({
                                    title: match[2].trim().replace(/<[^>]+>/g, ''),
                                    artist: 'Unknown',
                                    url: 'https://www.guitaretab.com' + match[1],
                                    source: 'GuitareTab'
                                });
                            }
                        }
                    } catch (e) {}

                    // 2. If no results (e.g. Brazilian artists like João Gomes, regional or rare tracks), search via DuckDuckGo
                    if (results.length === 0) {
                        try {
                            const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q + ' cifra')}`;
                            const ddgRes = await fetch(ddgUrl, {
                                method: 'POST',
                                headers: {
                                    'User-Agent': UA,
                                    'Content-Type': 'application/x-www-form-urlencoded'
                                },
                                body: `q=${encodeURIComponent(q + ' cifra')}`
                            });
                            if (ddgRes.ok) {
                                const ddgHtml = await ddgRes.text();
                                const linkRegex = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
                                let match;
                                while ((match = linkRegex.exec(ddgHtml)) !== null && results.length < 15) {
                                    let href = match[1];
                                    if (href.startsWith('//')) href = 'https:' + href;
                                    if (href.includes('uddg=')) {
                                        try {
                                            const u = new URL(href, 'https://duckduckgo.com').searchParams.get('uddg');
                                            if (u) href = u;
                                        } catch (_) {}
                                    }
                                    const title = match[2].replace(/<[^>]+>/g, '').trim();
                                    if (href.startsWith('http') && (href.includes('cifraclub') || href.includes('cifras') || href.includes('tab') || href.includes('chord'))) {
                                        results.push({
                                            title,
                                            artist: href.includes('cifraclub') ? 'Cifra Club' : 'Web Cifra',
                                            url: href,
                                            source: 'Web'
                                        });
                                    }
                                }
                            }
                        } catch (e) {}
                    }

                    return res.status(200).json(results);
                } else if (cmd === 'get') {
                    if (!targetUrl) return res.status(400).json({ error: 'No url provided' });
                    try {
                        const pageRes = await fetch(targetUrl, { headers: { 'User-Agent': UA } });
                        const pageHtml = await pageRes.text();
                        let content = '';

                        if (targetUrl.includes('guitaretab.com')) {
                            const match = pageHtml.match(/<section[^>]+class=["'][^"']*js-tab[^"']*["'][^>]*>([\s\S]*?)<\/section>/i) ||
                                          pageHtml.match(/<pre[^>]+class=["'][^"']*js-tab-content[^"']*["'][^>]*>([\s\S]*?)<\/pre>/i);
                            if (match) content = match[1];
                        } else {
                            const match = pageHtml.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
                            if (match) content = match[1];
                        }

                        if (content) {
                            content = content
                                .replace(/&lt;/g, '<')
                                .replace(/&gt;/g, '>')
                                .replace(/&amp;/g, '&')
                                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                                .replace(/<[^>]*>/g, '');
                        } else {
                            content = 'Não foi possível extrair a cifra diretamente desta página.';
                        }

                        return res.status(200).json({ content, source: targetUrl });
                    } catch (e) {
                        return res.status(500).json({ error: 'Failed to fetch tab', details: e.message });
                    }
                }
                return res.status(400).json({ error: 'Invalid command' });
            }

            case 'reader': {
                // Native self-hosted reader & search (no dependency on rate-limited rekindle-reader worker)
                const isSearch = subpath.includes('search') || forwardSearchParams.has('q') || (req.query && req.query.q);
                
                if (isSearch) {
                    const q = forwardSearchParams.get('q') || (req.query && req.query.q) || '';
                    if (!q) return res.status(400).json({ error: "Missing 'q' query parameter" });

                    try {
                        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
                        const response = await fetch(searchUrl, {
                            method: 'POST',
                            headers: {
                                'User-Agent': UA,
                                'Content-Type': 'application/x-www-form-urlencoded'
                            },
                            body: `q=${encodeURIComponent(q)}`
                        });

                        const html = await response.text();
                        const linkRegex = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
                        let match;
                        const results = [];
                        while ((match = linkRegex.exec(html)) !== null && results.length < 20) {
                            let href = match[1];
                            if (href.startsWith('//')) href = 'https:' + href;
                            if (href.includes('uddg=')) {
                                try {
                                    const u = new URL(href, 'https://duckduckgo.com').searchParams.get('uddg');
                                    if (u) href = u;
                                } catch (_) {}
                            }
                            if (!href.startsWith('http')) continue;
                            const title = match[2].replace(/<[^>]+>/g, '').trim();
                            if (results.some(r => r.url === href)) continue;
                            results.push({
                                title: title || href,
                                url: href,
                                snippet: ''
                            });
                        }

                        return res.status(200).json({ query: q, results });
                    } catch (e) {
                        return res.status(500).json({ error: 'Search failed', detail: e.message });
                    }
                } else {
                    // Article Readability extraction
                    const targetUrl = forwardSearchParams.get('url') || (req.query && req.query.url);
                    if (!targetUrl) return res.status(400).json({ error: "Missing 'url' query parameter" });

                    try {
                        const pageRes = await fetch(targetUrl, {
                            headers: {
                                'User-Agent': UA,
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                            }
                        });

                        const html = await pageRes.text();
                        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
                        const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : targetUrl;

                        let cleanHtml = html
                            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                            .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
                            .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
                            .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
                            .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');

                        const articleMatch = cleanHtml.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
                                             cleanHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
                                             cleanHtml.match(/<div[^>]+class=["'][^"']*(?:post-content|article-content|entry-content|content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

                        let content = articleMatch ? articleMatch[1] : '';
                        if (!content) {
                            const bodyMatch = cleanHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                            content = bodyMatch ? bodyMatch[1] : cleanHtml;
                        }

                        content = content
                            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                            .trim();

                        const textContent = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

                        return res.status(200).json({
                            title,
                            content: `<div class="page">${content.slice(0, 50000)}</div>`,
                            textContent: textContent.slice(0, 10000),
                            byline: null,
                            siteName: new URL(targetUrl).hostname,
                            excerpt: textContent.slice(0, 200)
                        });
                    } catch (e) {
                        return res.status(500).json({ error: 'Failed to extract article', detail: e.message });
                    }
                }
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
                // Generic fallback for any other rekindle worker (e.g. comics, etc.)
                const targetUrl = `https://rekindle-${route}.timjarnott.workers.dev` + (subpath || '') + forwardSearch;
                return await forwardTo(targetUrl);
            }
        }
    } catch (err) {
        return res.status(500).json({ error: 'Gateway failure', details: err.message });
    }
};
