module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url required' });

    let origin;
    try {
        const base = url.startsWith('http') ? url : `https://${url}`;
        origin = new URL(base).origin;
    } catch (e) {
        return res.status(400).json({ error: 'invalid url' });
    }

    const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

    // Domains that commonly produce false-positive emails in page source
    const NOISE_DOMAINS = [
        'sentry.io', 'wixpress.com', 'squarespace.com', 'shopify.com',
        'example.com', 'domain.com', 'yourdomain.com', 'yourcompany.com',
        'email.com', 'wordpress.com', 'cloudflare.com', 'google.com',
        'amazonaws.com', 'jquery.com', 'schema.org', 'w3.org',
    ];

    const SOCIAL_PATTERNS = {
        linkedin:  /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9\-_%]+/,
        facebook:  /(?:https?:\/\/)?(?:www\.)?(?:facebook|fb)\.com\/(?!sharer|share|dialog|plugins)[a-zA-Z0-9.\-_]+/,
        twitter:   /(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/(?!share|intent)[a-zA-Z0-9_]+/,
        instagram: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+/,
        tiktok:    /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@[a-zA-Z0-9._]+/,
        youtube:   /(?:https?:\/\/)?(?:www\.)?youtube\.com\/(?:channel|c|@)[a-zA-Z0-9\-_]+/,
    };

    const fetchPage = async (pageUrl) => {
        try {
            const r = await fetch(pageUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; business-contact-finder/1.0)',
                    'Accept': 'text/html,application/xhtml+xml',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                signal: AbortSignal.timeout(8000),
                redirect: 'follow',
            });
            if (!r.ok) return null;
            const ct = r.headers.get('content-type') || '';
            if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;
            // Cap at 500KB to avoid huge pages
            const text = await r.text();
            return text.substring(0, 512000);
        } catch {
            return null;
        }
    };

    const pagesToCheck = [
        origin,
        `${origin}/contact`,
        `${origin}/contact-us`,
        `${origin}/about`,
        `${origin}/about-us`,
        `${origin}/get-in-touch`,
    ];

    const pagesChecked = [];
    const emailSet = new Set();
    const socials = {};

    for (const pageUrl of pagesToCheck) {
        const html = await fetchPage(pageUrl);
        if (!html) continue;
        pagesChecked.push(pageUrl);

        // Extract emails
        const matches = html.match(EMAIL_RE) || [];
        for (const email of matches) {
            const lower = email.toLowerCase();
            const domain = lower.split('@')[1] || '';
            if (!NOISE_DOMAINS.some(n => domain.includes(n)) && domain.includes('.')) {
                emailSet.add(lower);
            }
        }

        // Also check mailto: hrefs (often cleaner than raw text)
        const mailtoRe = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
        let m;
        while ((m = mailtoRe.exec(html)) !== null) {
            const lower = m[1].toLowerCase();
            const domain = lower.split('@')[1] || '';
            if (!NOISE_DOMAINS.some(n => domain.includes(n))) {
                emailSet.add(lower);
            }
        }

        // Extract social profiles
        for (const [key, pattern] of Object.entries(SOCIAL_PATTERNS)) {
            if (!socials[key]) {
                const match = html.match(pattern);
                if (match) {
                    let profileUrl = match[0];
                    if (!profileUrl.startsWith('http')) profileUrl = `https://${profileUrl}`;
                    // Filter out generic/share URLs
                    if (!profileUrl.includes('/sharer') && !profileUrl.includes('/share?') && !profileUrl.includes('/intent/')) {
                        socials[key] = profileUrl;
                    }
                }
            }
        }

        // Stop early if we have both emails and all major socials
        const hasSocials = ['linkedin', 'facebook'].every(k => socials[k]);
        if (emailSet.size >= 3 && hasSocials) break;
    }

    // Rank emails: prefer generic contact/info/hello over personal-looking ones
    const GENERIC_PREFIXES = ['contact', 'info', 'hello', 'hi', 'sales', 'enquiries', 'enquiry', 'support', 'admin', 'office', 'mail'];
    const emails = [...emailSet].sort((a, b) => {
        const aPrefix = a.split('@')[0];
        const bPrefix = b.split('@')[0];
        const aGeneric = GENERIC_PREFIXES.some(p => aPrefix.startsWith(p)) ? 0 : 1;
        const bGeneric = GENERIC_PREFIXES.some(p => bPrefix.startsWith(p)) ? 0 : 1;
        return aGeneric - bGeneric;
    }).slice(0, 8);

    return res.json({ emails, socials, pagesChecked });
};
