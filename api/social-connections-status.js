/**
 * api/social-connections-status.js
 *
 * Reports which social platforms actually have real publish credentials
 * configured in this deployment's environment variables — booleans only,
 * never the values themselves. Lets the client (Pat's Social Posting tab)
 * show honest "Connected" / "Not Connected" badges instead of silently
 * failing at publish time, matching the same env-var-gated pattern already
 * used by api/publish-social-post.js.
 *
 * GET /api/social-connections-status
 * Returns: { "Meta/Facebook": boolean, "LinkedIn": boolean, "Twitter/X": boolean, "Instagram": boolean, "TikTok": boolean }
 */

'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const connected = {
    'Meta/Facebook': !!(process.env.META_PAGE_ID && process.env.META_PAGE_ACCESS_TOKEN),
    'LinkedIn': !!(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_ORGANIZATION_URN),
    'Twitter/X': !!process.env.TWITTER_USER_ACCESS_TOKEN,
    'Instagram': !!(process.env.INSTAGRAM_USER_ID && (process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN)),
    'TikTok': !!process.env.TIKTOK_ACCESS_TOKEN,
  };
  // Facebook and Instagram share the same platform label used elsewhere in the app.
  connected['Facebook'] = connected['Meta/Facebook'];

  return res.json(connected);
};
