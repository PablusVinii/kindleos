module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const urlObj = new URL(req.url, 'http://localhost');
    const targetUrl = urlObj.searchParams.get('url');

    if (!targetUrl) {
        return res.status(400).send('Missing url parameter');
    }

    try {
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': req.headers['accept'] || '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Origin': 'https://rekindle.ink',
                'Referer': 'https://rekindle.ink/'
            }
        });

        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        const buffer = await response.arrayBuffer();
        return res.status(response.status).send(Buffer.from(buffer));
    } catch (e) {
        return res.status(500).send('Proxy error: ' + e.message);
    }
}
