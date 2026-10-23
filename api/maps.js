export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { url: targetUrl } = req.query;
    if (!targetUrl) {
        return res.status(400).send('Missing url param');
    }

    const allowedDomains = [
        'nominatim.openstreetmap.org',
        'router.project-osrm.org'
    ];

    try {
        const u = new URL(targetUrl);
        if (!allowedDomains.includes(u.hostname)) {
            return res.status(403).send('Forbidden: Domain not allowed');
        }
    } catch (e) {
        return res.status(400).send('Invalid URL');
    }

    try {
        const upstream = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'ReKindle-Maps/1.0 (rekindle.ink)'
            }
        });

        const contentType = upstream.headers.get('content-type');
        if (contentType) res.setHeader('Content-Type', contentType);

        const data = await upstream.text();
        return res.status(upstream.status).send(data);
    } catch (err) {
        return res.status(502).send('Upstream fetch error');
    }
}
