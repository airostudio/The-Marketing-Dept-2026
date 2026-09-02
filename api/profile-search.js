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
    // Explicitly asks about a website (and to check social bios for one) —
    // this is what actually catches the "no website" claim being wrong: a
    // business with only a Facebook page almost always still lists a real
    // website link in that page's About/bio section, which a generic
    // "find social profiles" query wouldn't surface or extract.
    const query = `Find the real business website, contact information, and social media profiles for the business "${name}"${locationStr ? ` in ${locationStr}` : ''}. Specifically: does this business have its own website? If not immediately obvious, check the About/bio section of their Facebook, Instagram, or LinkedIn page for a website link — many small businesses list their real site there even without a prominent standalone web presence. Include email addresses, LinkedIn company page, Facebook business page, Instagram, Twitter/X, and any other public profiles.`;

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

    // Domains that are never the business's own website — social platforms,
    // review/directory sites, and general reference sites Perplexity often
    // cites. Anything else surviving this filter is a plausible real site.
    const NOT_A_WEBSITE_DOMAINS = [
        'facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
        'tiktok.com', 'youtube.com', 'pinterest.com',
        'yelp.com', 'yellowpages.com', 'yell.com', 'tripadvisor.com', 'foursquare.com',
        'google.com', 'maps.google.com', 'bing.com',
        'wikipedia.org', 'perplexity.ai', 'crunchbase.com', 'glassdoor.com', 'indeed.com',
        'bbb.org', 'angi.com', 'thumbtack.com', 'nextdoor.com', 'apple.com',
    ];

    function hostOf(u) {
        try { return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
    }

    /**
     * Two passes, most-trustworthy first:
     *  1. An explicit "website is X" / "site: X" mention in the answer text
     *     — usually means Perplexity actually read it off a bio/About
     *     section, which is exactly the Facebook-bio case this exists for.
     *  2. The first citation URL that isn't a social/directory/reference
     *     domain — weaker signal (citations are sources for the whole
     *     answer, not necessarily "this is their site"), so flagged as
     *     'estimate' rather than 'real'.
     */
    function extractWebsite(answerText, citationList) {
        const mentionRe = /(?:website|site|web address)(?:\s+is|\s*:|\s+at)?\s+(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9-]*\.[a-z]{2,}(?:\.[a-z]{2,})?(?:\/[^\s,)"']*)?)/i;
        const mentionMatch = answerText.match(mentionRe);
        if (mentionMatch) {
            const candidate = mentionMatch[1];
            const domain = hostOf(candidate);
            if (domain && !NOT_A_WEBSITE_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
                return { website: `https://${candidate.replace(/[.,)]+$/, '')}`, websiteSource: 'real' };
            }
        }
        for (const c of (citationList || [])) {
            const url = typeof c === 'string' ? c : c.url;
            if (!url) continue;
            const domain = hostOf(url);
            if (domain && !NOT_A_WEBSITE_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
                return { website: `https://${domain}`, websiteSource: 'estimate' };
            }
        }
        return { website: null, websiteSource: null };
    }

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

        // Extract a real business website — separate from the social
        // profiles above, and the whole point of the query change: a "no
        // website" claim made elsewhere in this app is only ever as good
        // as whether anyone actually checked, and this is that check.
        const { website, websiteSource } = extractWebsite(text, citations);

        return res.json({ emails, socials, website, websiteSource });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};
