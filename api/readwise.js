module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const slugPart = Array.isArray(req.query.slug) ? req.query.slug.join('/') : (req.query.slug || '');
        const urlObj = new URL(req.url, 'http://localhost');
        const subpath = slugPart ? '/' + slugPart : (urlObj.pathname.replace(/^\/api\/readwise/, '') || '');
        urlObj.searchParams.delete('slug');
        const targetUrl = 'https://rekindle-readwise.timjarnott.workers.dev' + (subpath || '/') + (urlObj.search ? urlObj.search : '');

        const headers = {
            'Origin': 'https://rekindle.ink',
            'Referer': 'https://rekindle.ink/',
            'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) KindleOS'
        };

        if (req.headers['content-type']) {
            headers['Content-Type'] = req.headers['content-type'];
        }
        if (req.headers['authorization']) {
            headers['Authorization'] = req.headers['authorization'];
        }

        const fetchOptions = {
            method: req.method,
            headers
        };

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            fetchOptions.body = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
        }

        const upstreamRes = await fetch(targetUrl, fetchOptions);
        const data = await upstreamRes.text();

        res.status(upstreamRes.status);
        const contentType = upstreamRes.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }
        return res.send(data);
    } catch (err) {
        return res.status(502).json({ error: 'Readwise gateway failed', details: err.message });
    }
}
