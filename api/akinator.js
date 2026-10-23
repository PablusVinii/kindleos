export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        const response = await fetch('https://p01--akinator--lcgj9cjkcx8q.code.run', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Origin': 'https://rekindle.ink',
                'Referer': 'https://rekindle.ink/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            body: body
        });
        const data = await response.text();
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
        return res.status(response.status).send(data);
    } catch (e) {
        return res.status(500).json({ error: 'akinator_relay_error', message: e.message });
    }
}
