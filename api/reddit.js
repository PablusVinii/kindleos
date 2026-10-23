export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const urlObj = new URL(req.url, 'http://localhost');
    const targetUrl = urlObj.searchParams.get('url');
    if (!targetUrl) {
        return res.status(400).send('Missing url param');
    }

    try {
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8,application/json',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        const contentType = response.headers.get('content-type');
        if (contentType) res.setHeader('Content-Type', contentType);
        const buffer = await response.arrayBuffer();
        return res.status(response.status).send(Buffer.from(buffer));
    } catch (e) {
        return res.status(500).send('Reddit fetch failed: ' + e.message);
    }
}
