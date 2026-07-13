/**
 * api/publish-social-post.js — Publish-adapter architecture (Phase H)
 *
 * POST {
 *   platform:   string,           // 'LinkedIn' | 'Facebook' | 'Meta/Facebook' | 'Twitter/X' | 'Instagram' | 'TikTok' | ...
 *   headline?:  string,
 *   body:       string,           // the actual post copy to publish
 *   cta?:       string,
 *   hashtags?:  string[],
 *   imageUrl?:  string,           // data URI or hosted URL of a rendered creative
 * }
 *
 * Returns: {
 *   success: boolean,
 *   status:  'published' | 'not_connected' | 'not_supported' | 'failed',
 *   platformPostId?: string,
 *   url?:            string,
 *   error?:          string,
 * }
 *
 * This is the one clean seam every platform's publish call goes through.
 * Today, every adapter honestly reports 'not_connected' or 'not_supported'
 * because no platform app has been registered/approved yet — that's the
 * standing state of the product until a developer app + OAuth flow exists
 * for each platform. The point of building this now, per the standing
 * security rule for this project, is that:
 *
 *   ALL API keys/tokens live exclusively in Vercel environment variables.
 *   Nothing credential-related is ever stored or referenced client-side.
 *
 * So the client only ever sends post *content* here — never a token, never
 * a page/account id. When real OAuth credentials are added to Vercel later,
 * publishing goes live with zero client-side changes and no architecture
 * rework: just fill in the env vars this file already reads.
 */

'use strict';

function missingEnvResult(varNames) {
  return {
    success: false,
    status: 'not_connected',
    error: `Not connected — missing Vercel env var(s): ${varNames.join(', ')}. Configure the platform's developer app and add these to publish for real.`,
  };
}

// ── Meta / Facebook Page feed post ──────────────────────────────────────────
async function publishFacebook(post) {
  const pageId = process.env.META_PAGE_ID;
  const accessToken = process.env.META_PAGE_ACCESS_TOKEN;
  if (!pageId || !accessToken) return missingEnvResult(['META_PAGE_ID', 'META_PAGE_ACCESS_TOKEN']);

  const message = composeMessage(post);
  const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, access_token: accessToken }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, status: 'failed', error: data.error?.message || `Facebook API error ${res.status}` };

  return { success: true, status: 'published', platformPostId: data.id, url: data.id ? `https://facebook.com/${data.id}` : undefined };
}

// ── LinkedIn UGC Post (organization share) ──────────────────────────────────
async function publishLinkedIn(post) {
  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgUrn = process.env.LINKEDIN_ORGANIZATION_URN; // e.g. "urn:li:organization:12345678"
  if (!accessToken || !orgUrn) return missingEnvResult(['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_ORGANIZATION_URN']);

  const message = composeMessage(post);
  const body = {
    author: orgUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: message },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };

  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, status: 'failed', error: data.message || `LinkedIn API error ${res.status}` };

  const postId = res.headers.get('x-restli-id') || data.id;
  return { success: true, status: 'published', platformPostId: postId, url: postId ? `https://www.linkedin.com/feed/update/${postId}` : undefined };
}

// ── X (Twitter) v2 tweet creation ────────────────────────────────────────────
async function publishTwitter(post) {
  const accessToken = process.env.TWITTER_USER_ACCESS_TOKEN;
  if (!accessToken) return missingEnvResult(['TWITTER_USER_ACCESS_TOKEN']);

  const message = composeMessage(post).slice(0, 280);
  const res = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, status: 'failed', error: data.detail || data.title || `X API error ${res.status}` };

  const id = data.data?.id;
  return { success: true, status: 'published', platformPostId: id, url: id ? `https://x.com/i/web/status/${id}` : undefined };
}

// ── Platforms that require a multi-step media upload flow and/or app review
//    Meta/TikTok have not granted yet. Honest "not yet built" rather than a
//    silent no-op or a fabricated success. ─────────────────────────────────
function notSupported(platform, reason) {
  return async () => ({ success: false, status: 'not_supported', error: `${platform} publishing isn't built yet: ${reason}` });
}

const ADAPTERS = {
  'Facebook': publishFacebook,
  'Meta/Facebook': publishFacebook,
  'LinkedIn': publishLinkedIn,
  'Twitter/X': publishTwitter,
  'Instagram': notSupported('Instagram', 'requires a two-step container/publish media flow and a Business/Creator account linked via Meta app review'),
  'TikTok': notSupported('TikTok', 'requires TikTok Content Posting API approval, which is a per-app review process'),
  'Google Search': notSupported('Google Search ads', 'ad publishing goes through Google Ads API campaign structures, not a single post — out of scope for organic/social publish'),
  'Google Display': notSupported('Google Display ads', 'ad publishing goes through Google Ads API campaign structures, not a single post — out of scope for organic/social publish'),
  'YouTube': notSupported('YouTube', 'community posts require a video/channel context this endpoint does not have'),
};

function composeMessage(post) {
  let msg = post.body || post.headline || '';
  if (post.cta) msg += `\n\n${post.cta}`;
  if (post.hashtags && post.hashtags.length) msg += `\n\n${post.hashtags.map(h => `#${h}`).join(' ')}`;
  return msg.trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { platform, headline = '', body = '', cta = '', hashtags = [] } = req.body || {};
  if (!platform) return res.status(400).json({ error: 'platform is required' });
  if (!body && !headline) return res.status(400).json({ error: 'body or headline is required' });

  const adapter = ADAPTERS[platform];
  if (!adapter) {
    return res.json({ success: false, status: 'not_supported', error: `No publish adapter for platform "${platform}".` });
  }

  try {
    const result = await adapter({ headline, body, cta, hashtags });
    return res.json(result);
  } catch (err) {
    return res.json({ success: false, status: 'failed', error: err.message });
  }
};
