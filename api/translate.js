module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const urlObj = new URL(req.url, 'http://localhost');
        const targetUrl = 'https://rekindle-translate.timjarnott.workers.dev' + urlObj.search;
        const options = {
            method: req.method,
            headers: {
                'Origin': 'https://rekindle.ink',
                'Referer': 'https://rekindle.ink/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        };
        if (req.method === 'POST') {
            options.headers['Content-Type'] = 'application/json';
            options.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        }
        const response = await fetch(targetUrl, options);
        const data = await response.text();
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
        return res.status(response.status).send(data);
    } catch (e) {
        return res.status(500).json({ error: 'translate_relay_error', message: e.message });
    }
}
