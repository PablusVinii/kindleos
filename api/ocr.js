export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const urlObj = new URL(req.url, 'http://localhost');
        const targetUrl = 'https://rekindle-ocr.timjarnott.workers.dev' + urlObj.search;

        const headers = {
            'Origin': 'https://rekindle.ink',
            'Referer': 'https://rekindle.ink/',
            'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) KindleOS'
        };

        if (req.headers['content-type']) {
            headers['Content-Type'] = req.headers['content-type'];
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
        return res.status(502).json({ error: 'OCR gateway failed', details: err.message });
    }
}
