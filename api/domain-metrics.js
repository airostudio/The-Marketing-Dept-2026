module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { domain } = req.body || {};
    if (!domain) return res.status(400).json({ error: 'domain required' });

    const cleanDomain = domain
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .replace(/^www\./, '')
        .toLowerCase();

    // Try Ahrefs Domain Rating (v3)
    const ahrefsKey = process.env.AHREFS_API_KEY;
    if (ahrefsKey) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const url = `https://api.ahrefs.com/v3/site-explorer/domain-rating?target=${encodeURIComponent(cleanDomain)}&date=${today}&mode=domain`;
            const r = await fetch(url, {
                headers: { Authorization: `Bearer ${ahrefsKey}` },
                signal: AbortSignal.timeout(8000)
            });
            if (r.ok) {
                const data = await r.json();
                const dr = data.domain?.domain_rating;
                if (typeof dr === 'number') {
                    return res.json({
                        domain: cleanDomain,
                        domainRating: Math.round(dr),
                        backlinks: data.domain?.backlinks || null,
                        refDomains: data.domain?.refdomains || null,
                        provider: 'ahrefs'
                    });
                }
            }
        } catch (e) {
            // fall through to next provider
        }
    }

    // Try Moz Domain Authority (v2 API)
    const mozKey = process.env.MOZ_API_KEY;
    const mozId = process.env.MOZ_ACCESS_ID;
    if (mozKey && mozId) {
        try {
            const auth = Buffer.from(`${mozId}:${mozKey}`).toString('base64');
            const r = await fetch('https://lsapi.seomoz.com/v2/url_metrics', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Basic ${auth}`
                },
                body: JSON.stringify({ targets: [`https://${cleanDomain}`] }),
                signal: AbortSignal.timeout(8000)
            });
            if (r.ok) {
                const data = await r.json();
                const da = data.results?.[0]?.domain_authority;
                if (typeof da === 'number') {
                    return res.json({
                        domain: cleanDomain,
                        domainRating: Math.round(da),
                        spamScore: data.results?.[0]?.spam_score || null,
                        provider: 'moz'
                    });
                }
            }
        } catch (e) {
            // fall through
        }
    }

    // Try DataForSEO backlinks summary
    const dfsLogin = process.env.DATAFORSEO_LOGIN;
    const dfsPass  = process.env.DATAFORSEO_PASSWORD;
    if (dfsLogin && dfsPass) {
        try {
            const auth = Buffer.from(`${dfsLogin}:${dfsPass}`).toString('base64');
            const r = await fetch('https://api.dataforseo.com/v3/backlinks/summary/live', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
                body: JSON.stringify([{ target: cleanDomain, include_subdomains: true, limit: 1 }]),
                signal: AbortSignal.timeout(10000),
            });
            if (r.ok) {
                const data = await r.json();
                const item = data.tasks?.[0]?.result?.[0];
                if (item) {
                    return res.json({
                        domain: cleanDomain,
                        domainRating: item.rank != null ? Math.round(item.rank) : null,
                        backlinks:    item.backlinks   || null,
                        refDomains:   item.referring_domains || null,
                        provider:     'dataforseo',
                    });
                }
            }
        } catch (e) {
            // fall through
        }
    }

    // No SEO API keys configured
    return res.json({
        domain: cleanDomain,
        domainRating: null,
        provider: 'none',
        message: 'Add DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD to Vercel environment variables to enable live domain metrics.',
    });
};
