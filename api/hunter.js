module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = process.env.HUNTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'HUNTER_API_KEY not configured' });

    const { domain } = req.body || {};
    if (!domain) return res.status(400).json({ error: 'domain required' });

    // Strip protocol/path — Hunter needs bare domain
    const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./, '');

    try {
        const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(cleanDomain)}&api_key=${apiKey}&limit=10`;
        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: data.errors?.[0]?.details || 'Hunter API error' });
        }

        const emails = (data.data?.emails || []).map(e => ({
            email: e.value,
            confidence: e.confidence,
            type: e.type,
            firstName: e.first_name,
            lastName: e.last_name,
            position: e.position,
            sources: e.sources?.length || 0
        }));

        // Sort by confidence descending
        emails.sort((a, b) => b.confidence - a.confidence);

        return res.json({
            domain: data.data?.domain,
            organization: data.data?.organization,
            emails,
            total: data.meta?.results || emails.length
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};
