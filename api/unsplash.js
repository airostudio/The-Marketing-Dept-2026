module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!apiKey) return res.status(500).json({ error: 'UNSPLASH_ACCESS_KEY not configured' });

    const { query, count = 1 } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query required' });

    try {
        const r = await fetch(
            `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${Math.min(count, 5)}&orientation=landscape`,
            {
                headers: { 'Authorization': `Client-ID ${apiKey}` },
                signal: AbortSignal.timeout(8000)
            }
        );
        if (!r.ok) return res.status(r.status).json({ error: 'Unsplash API error' });
        const data = await r.json();
        const photos = (data.results || []).map(p => ({
            url: p.urls.regular,
            thumb: p.urls.thumb,
            credit: `Photo by ${p.user.name} on Unsplash`,
            link: p.links.html
        }));
        return res.json({ photos });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};
