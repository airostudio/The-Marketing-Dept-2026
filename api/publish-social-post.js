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
 * Facebook, LinkedIn, X, Instagram, and TikTok all have real, working
 * adapter code — every one of them still honestly reports 'not_connected'
 * today because no platform app has been registered/approved yet. That's
 * the standing state of the product until a developer app + OAuth flow
 * exists for each platform; nothing here is a stub waiting to be written,
 * it's real code waiting for credentials. Instagram and TikTok additionally
 * require a real hosted imageUrl (not a data: URI) — see
 * api/render-social-image.js's optional Supabase Storage upload. The point
 * of building this now, per the standing security rule for this project, is
 * that:
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

// ── Instagram — two-step Graph API media flow ───────────────────────────────
// Instagram's publish API is genuinely a different shape from Facebook's: it
// requires a hosted image (no data: URIs — Meta's servers fetch the URL
// themselves) and a create-container-then-publish sequence rather than one
// call. Both steps are real here; the only thing standing between this and
// a live post is a Business/Creator Instagram account tied to a reviewed
// Meta app, an IG_USER_ID, and an access token with instagram_content_publish.
async function publishInstagram(post) {
  const igUserId = process.env.INSTAGRAM_USER_ID;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
  if (!igUserId || !accessToken) return missingEnvResult(['INSTAGRAM_USER_ID', 'INSTAGRAM_ACCESS_TOKEN (or META_PAGE_ACCESS_TOKEN)']);
  if (!post.imageUrl || post.imageUrl.startsWith('data:')) {
    return { success: false, status: 'failed', error: 'Instagram requires a real hosted image URL — a data: URI cannot be fetched by Meta\'s servers. Render the creative with SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY configured so it gets a hostedUrl.' };
  }

  const caption = composeMessage(post);

  const createRes = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(igUserId)}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: post.imageUrl, caption, access_token: accessToken }),
    signal: AbortSignal.timeout(20000),
  });
  const createData = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !createData.id) {
    return { success: false, status: 'failed', error: createData.error?.message || `Instagram media container error ${createRes.status}` };
  }

  const publishRes = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(igUserId)}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: createData.id, access_token: accessToken }),
    signal: AbortSignal.timeout(20000),
  });
  const publishData = await publishRes.json().catch(() => ({}));
  if (!publishRes.ok || !publishData.id) {
    return { success: false, status: 'failed', error: publishData.error?.message || `Instagram publish error ${publishRes.status}` };
  }

  // Best-effort permalink lookup — the numeric media id alone isn't a usable URL.
  let url;
  try {
    const permalinkRes = await fetch(`https://graph.facebook.com/v19.0/${publishData.id}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`, { signal: AbortSignal.timeout(10000) });
    const permalinkData = await permalinkRes.json().catch(() => ({}));
    url = permalinkData.permalink;
  } catch { /* non-fatal — the post is already live either way */ }

  return { success: true, status: 'published', platformPostId: publishData.id, url };
}

// ── TikTok — Content Posting API, direct photo post ─────────────────────────
// TikTok's Content Posting API only accepts media it can pull from a public
// URL (same constraint as Instagram), and the "init" call queues the post
// for async processing rather than publishing it inline — so a successful
// response here means "TikTok accepted it," not "it's live yet." Requires a
// TikTok app that has passed the Content Posting API's per-app review before
// any of this will actually authenticate.
async function publishTikTok(post) {
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
  if (!accessToken) return missingEnvResult(['TIKTOK_ACCESS_TOKEN']);
  if (!post.imageUrl || post.imageUrl.startsWith('data:')) {
    return { success: false, status: 'failed', error: 'TikTok requires a real hosted image URL for a photo post (PULL_FROM_URL) — a data: URI cannot be fetched by TikTok. Render the creative with SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY configured so it gets a hostedUrl.' };
  }

  const title = (post.headline || post.body || '').slice(0, 90);
  const description = composeMessage(post).slice(0, 4000);

  const res = await fetch('https://open.tiktokapis.com/v2/post/publish/content/init/', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      post_info: { title, description, privacy_level: 'PUBLIC_TO_EVERYONE', disable_comment: false },
      source_info: { source: 'PULL_FROM_URL', photo_images: [post.imageUrl], photo_cover_index: 0 },
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO',
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.error && data.error.code && data.error.code !== 'ok')) {
    return { success: false, status: 'failed', error: data.error?.message || `TikTok API error ${res.status}` };
  }

  // 'publishing', not 'published' — init only queues it; TikTok processes
  // async and there's no webhook here to confirm it went fully live.
  return { success: true, status: 'publishing', platformPostId: data.data?.publish_id };
}

// ── Ad-buying platforms and video-first channels this endpoint doesn't cover.
//    Honest "not yet built" rather than a silent no-op or a fabricated success.
function notSupported(platform, reason) {
  return async () => ({ success: false, status: 'not_supported', error: `${platform} publishing isn't built yet: ${reason}` });
}

const ADAPTERS = {
  'Facebook': publishFacebook,
  'Meta/Facebook': publishFacebook,
  'LinkedIn': publishLinkedIn,
  'Twitter/X': publishTwitter,
  'Instagram': publishInstagram,
  'TikTok': publishTikTok,
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

/**
 * Publish one post through its platform adapter. Shared by the HTTP handler
 * below and by api/cron-auto-publish.js (which requires this file directly
 * to reuse the exact same adapters rather than duplicating them).
 */
async function publishPost({ platform, headline = '', body = '', cta = '', hashtags = [], imageUrl = '' }) {
  const adapter = ADAPTERS[platform];
  if (!adapter) {
    return { success: false, status: 'not_supported', error: `No publish adapter for platform "${platform}".` };
  }
  try {
    return await adapter({ headline, body, cta, hashtags, imageUrl });
  } catch (err) {
    return { success: false, status: 'failed', error: err.message };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { platform, headline = '', body = '', cta = '', hashtags = [], imageUrl = '' } = req.body || {};
  if (!platform) return res.status(400).json({ error: 'platform is required' });
  if (!body && !headline) return res.status(400).json({ error: 'body or headline is required' });

  const result = await publishPost({ platform, headline, body, cta, hashtags, imageUrl });
  return res.json(result);
};

module.exports.publishPost = publishPost;
module.exports.ADAPTERS = ADAPTERS;
