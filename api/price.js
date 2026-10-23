const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36";
const SYMBOL_RE = /^[A-Za-z0-9.^=-]{1,16}$/;

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { symbol = '', interval = '60m', range = '1d' } = req.query;
    const cleanSymbol = symbol.trim();

    if (!cleanSymbol || !SYMBOL_RE.test(cleanSymbol)) {
        return res.status(400).json({ error: 'Valid symbol required' });
    }

    const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
    for (const host of hosts) {
        try {
            const target = `https://${host}/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
            const response = await fetch(target, {
                headers: { 'User-Agent': UA, 'Accept': 'application/json' }
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
