/**
 * api/app-config.js
 * Serves public frontend configuration from Vercel environment variables.
 * Safe to expose: Supabase anon key is designed to be public.
 *
 * GET /api/app-config
 * Returns: { supabaseUrl, supabaseKey, configured }
 */

module.exports = function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
    const configured  = !!(supabaseUrl && supabaseKey);

    // Cache for 5 minutes — public keys don't change often
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ supabaseUrl, supabaseKey, configured });
};
