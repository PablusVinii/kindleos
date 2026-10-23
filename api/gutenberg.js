const ALLOWED_HOSTS = ['gutenberg.org', 'www.gutenberg.org'];

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { url: targetUrl } = req.query;
    if (!targetUrl) {
        return res.status(400).json({ error: 'missing_url' });
    }

    let target;
    try {
        target = new URL(targetUrl);
    } catch (e) {
        return res.status(400).json({ error: 'invalid_url' });
    }

    if (!ALLOWED_HOSTS.includes(target.hostname)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    try {
        const response = await fetch(target.toString(), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ReKindle/1.0',
                'Accept': '*/*'
            }
        });

        const contentType = response.headers.get('content-type');
        if (contentType) res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');

        const data = await response.text();
        return res.status(response.status).send(data);
    } catch (err) {
        return res.status(502).json({ error: 'upstream_error', details: err.message });
    }
}
