/**
 * api/scout-data.js
 * DataForSEO-powered competitive SEO data for the SCOUT agent.
 *
 * POST { domains: ["hubspot.com", "salesforce.com"], locationCode?: 2840, languageCode?: "en" }
 *
 * For each domain returns:
 *   - rank / backlinks / referring_domains  (backlinks/summary/live)
 *   - top 10 organic keywords by traffic value  (dataforseo_labs/ranked_keywords/live)
 *
 * All results are returned together so SCOUT can inject them verbatim into
 * the Claude prompt for grounded, data-backed competitive analysis.
 *
 * Requires: DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD in Vercel env vars.
 */

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
const rateBuckets = new Map();

function getClientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
    return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
    const now = Date.now();
    let b = rateBuckets.get(ip);
    if (!b || now - b.windowStart > RATE_LIMIT_WINDOW_MS) {
        b = { windowStart: now, count: 0 };
        rateBuckets.set(ip, b);
    }
    b.count++;
    return b.count <= RATE_LIMIT_MAX;
}

function cleanDomain(raw) {
    return (raw || '')
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .replace(/^www\./, '')
        .toLowerCase()
        .trim();
}

function dfsAuth(login, pass) {
    return `Basic ${Buffer.from(`${login}:${pass}`).toString('base64')}`;
}

async function fetchBacklinksSummary(domains, auth) {
    const body = domains.map(d => ({ target: d, include_subdomains: true, limit: 1 }));
    const r = await fetch('https://api.dataforseo.com/v3/backlinks/summary/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`DataForSEO backlinks error ${r.status}`);
    const data = await r.json();

    const results = {};
    (data.tasks || []).forEach(task => {
        const item = task.result?.[0];
        if (!item) return;
        const domain = item.target || task.data?.target;
        if (domain) {
            results[domain] = {
                rank:            item.rank          ?? null,
                backlinks:       item.backlinks      ?? null,
                refDomains:      item.referring_domains ?? null,
                spamScore:       item.backlinks_spam_score ?? null,
            };
        }
    });
    return results;
}

async function fetchRankedKeywords(domains, auth, locationCode, languageCode) {
    const body = domains.map(d => ({
        target:        d,
        language_code: languageCode,
        location_code: locationCode,
        limit:         10,
        order_by:      ['etv,desc'],  // sort by estimated traffic value
    }));
    const r = await fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`DataForSEO ranked keywords error ${r.status}`);
    const data = await r.json();

    const results = {};
    (data.tasks || []).forEach(task => {
        const domain = task.data?.target;
        if (!domain) return;
        const items = task.result?.[0]?.items || [];
        results[domain] = items.map(item => ({
            keyword:    item.keyword_data?.keyword || '',
            position:   item.ranked_serp_element?.serp_item?.rank_group ?? null,
            searchVol:  item.keyword_data?.keyword_info?.search_volume ?? null,
            cpc:        item.keyword_data?.keyword_info?.cpc ?? null,
            difficulty: item.keyword_data?.keyword_properties?.keyword_difficulty ?? null,
        })).filter(k => k.keyword);
    });
    return results;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const ip = getClientIp(req);
    if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: 'Rate limit exceeded. Please wait before retrying.' });
    }

    const login = process.env.DATAFORSEO_LOGIN;
    const pass  = process.env.DATAFORSEO_PASSWORD;
    if (!login || !pass) {
        return res.status(503).json({
            error: 'DataForSEO not configured',
            message: 'Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to your Vercel environment variables.',
        });
    }

    const body = req.body || {};
    const rawDomains    = Array.isArray(body.domains) ? body.domains : [];
    const locationCode  = typeof body.locationCode  === 'number' ? body.locationCode  : 2840;  // US
    const languageCode  = typeof body.languageCode  === 'string' ? body.languageCode  : 'en';

    const domains = [...new Set(rawDomains.map(cleanDomain).filter(Boolean))].slice(0, 5);
    if (!domains.length) {
        return res.status(400).json({ error: 'domains array is required (max 5)' });
    }

    const auth = dfsAuth(login, pass);

    // Run both requests in parallel; if one fails, return partial data
    const [backlinksResult, keywordsResult] = await Promise.allSettled([
        fetchBacklinksSummary(domains, auth),
        fetchRankedKeywords(domains, auth, locationCode, languageCode),
    ]);

    const backlinks = backlinksResult.status === 'fulfilled' ? backlinksResult.value : {};
    const keywords  = keywordsResult.status  === 'fulfilled' ? keywordsResult.value  : {};

    // Merge into per-domain objects
    const metrics = {};
    domains.forEach(d => {
        metrics[d] = {
            domain:    d,
            backlinks: backlinks[d] || null,
            keywords:  keywords[d]  || [],
        };
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
        metrics,
        provider:   'dataforseo',
        errors: {
            backlinks: backlinksResult.status === 'rejected' ? backlinksResult.reason?.message : null,
            keywords:  keywordsResult.status  === 'rejected' ? keywordsResult.reason?.message  : null,
        },
    });
};
