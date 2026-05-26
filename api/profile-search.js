module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'PERPLEXITY_API_KEY not configured' });

    const { name, city, country } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });

    const locationStr = [city, country].filter(Boolean).join(', ');
    const query = `Find contact information and social media profiles for the business "${name}"${locationStr ? ` in ${locationStr}` : ''}. Include email addresses, LinkedIn company page, Facebook business page, Instagram, Twitter/X, and any other public profiles.`;

    const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const NOISE_DOMAINS = [
        'sentry.io', 'wixpress.com', 'squarespace.com', 'shopify.com',
        'example.com', 'domain.com', 'yourdomain.com', 'yourcompany.com',
        'email.com', 'wordpress.com', 'cloudflare.com', 'google.com',
        'amazonaws.com', 'jquery.com', 'schema.org', 'w3.org', 'perplexity.ai',
    ];
    const SOCIAL_PATTERNS = {
        linkedin:  /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9\-_%]+/,
        facebook:  /(?:https?:\/\/)?(?:www\.)?(?:facebook|fb)\.com\/(?!sharer|share|dialog|plugins)[a-zA-Z0-9.\-_]+/,
        twitter:   /(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/(?!share|intent)[a-zA-Z0-9_]+/,
        instagram: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+/,
        tiktok:    /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@[a-zA-Z0-9._]+/,
        youtube:   /(?:https?:\/\/)?(?:www\.)?youtube\.com\/(?:channel|c|@)[a-zA-Z0-9\-_]+/,
    };
    const GENERIC_PREFIXES = ['contact', 'info', 'hello', 'hi', 'sales', 'enquiries', 'enquiry', 'support', 'admin', 'office', 'mail'];

    try {
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'sonar',
                messages: [{ role: 'user', content: query }],
                max_tokens: 1024,
                return_citations: true,
            }),
            signal: AbortSignal.timeout(20000),
        });

        if (!response.ok) return res.json({ emails: [], socials: {} });

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        const citations = data.citations || [];

        // Build a combined text blob: response + all citation URLs/titles
        const citationText = citations.map(c =>
            typeof c === 'string' ? c : `${c.url || ''} ${c.title || ''}`
        ).join(' ');
        const fullText = text + ' ' + citationText;

        // Extract emails
        const emailSet = new Set();
        for (const email of (fullText.match(EMAIL_RE) || [])) {
            const lower = email.toLowerCase();
            const domain = lower.split('@')[1] || '';
            if (!NOISE_DOMAINS.some(n => domain.includes(n)) && domain.includes('.')) {
                emailSet.add(lower);
            }
        }

        const emails = [...emailSet].sort((a, b) => {
            const ap = a.split('@')[0];
            const bp = b.split('@')[0];
            return (GENERIC_PREFIXES.some(p => ap.startsWith(p)) ? 0 : 1)
                 - (GENERIC_PREFIXES.some(p => bp.startsWith(p)) ? 0 : 1);
        }).slice(0, 5);

        // Extract social profiles
        const socials = {};
        for (const [key, pattern] of Object.entries(SOCIAL_PATTERNS)) {
            const match = fullText.match(pattern);
            if (match) {
                let url = match[0];
                if (!url.startsWith('http')) url = `https://${url}`;
                if (!url.includes('/sharer') && !url.includes('/share?') && !url.includes('/intent/')) {
                    socials[key] = url;
                }
            }
        }

        return res.json({ emails, socials });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};
