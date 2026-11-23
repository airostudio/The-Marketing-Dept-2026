/**
 * api/_lib/social-publish.js — publish a post to the business's OWN social
 * account (a connection signed in through api/oauth.js), not Audema's.
 *
 *   providerFor(platform)       which connection a post's platform needs
 *   findConnection(sb, post)    that business's active connection, if any
 *   publishVia(sb, conn, post)  → { platformPostId, url }; throws faults with
 *                               .kind like the website connectors do
 *
 * Nothing is shortened or changed to make it fit: a post that is too long for
 * the network is refused with the reason, so the business fixes the words
 * rather than having them cut mid-sentence.
 */

'use strict';

const oauth = require('./oauth.js');

const PLATFORM_PROVIDER = { 'LinkedIn': 'linkedin', 'LinkedIn (Personal)': 'linkedin', 'Facebook': 'facebook', 'Meta/Facebook': 'facebook', 'Twitter/X': 'x', 'X': 'x' };
const LIMITS = { linkedin: 3000, facebook: 63206, x: 280 };
const FB = () => `https://graph.facebook.com/${process.env.FACEBOOK_GRAPH_VERSION || 'v21.0'}`;

function providerFor(platform) { return PLATFORM_PROVIDER[platform] || null; }

function compose(post) {
  let msg = post.body || post.headline || '';
  if (post.cta) msg += `\n\n${post.cta}`;
  const tags = (post.hashtags || []).map(h => String(h).replace(/^#+/, '')).filter(Boolean);
  if (tags.length) msg += `\n\n${tags.map(h => `#${h}`).join(' ')}`;
  return msg.trim();
}

/** The business's active connection for this post's network (same business scope as the post). */
async function findConnection(sb, post) {
  const provider = providerFor(post.platform);
  if (!provider) return null;
  const scope = post.intel_profile_id ? `intel_profile_id=eq.${post.intel_profile_id}`
    : post.project_id ? `project_id=eq.${post.project_id}`
    : `user_id=eq.${post.user_id}&intel_profile_id=is.null&project_id=is.null`;
  const r = await sb('GET', `/connections?${scope}&provider=eq.${provider}&status=neq.disconnected&select=*&order=created_at.desc&limit=1`);
  return (r.ok && r.data && r.data[0]) || null;
}

async function publishVia(sb, conn, post, deps = {}) {
  const secret = await oauth.fresh(sb, conn, deps);
  const text = compose(post);
  if (!text) throw oauth.fail('The post has no text.', 400, 'permanent');
  const limit = LIMITS[conn.provider];
  if (text.length > limit) throw oauth.fail(`The post is ${text.length} characters; ${conn.label.split(' — ')[0]} allows ${limit}. Shorten it in the Content Calendar and reschedule.`, 400, 'permanent');
  const image = /^https:\/\//i.test(post.image_url || post.imageUrl || '') ? (post.image_url || post.imageUrl) : null;

  if (conn.provider === 'linkedin') {
    const r = await oauth.http('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST', headers: { Authorization: `Bearer ${secret.accessToken}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
      body: JSON.stringify({ author: conn.config.authorUrn, lifecycleState: 'PUBLISHED', specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: 'NONE' } }, visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' } }),
    }, 'LinkedIn', deps);
    const id = r.id || null;
    return { platformPostId: id, url: id ? `https://www.linkedin.com/feed/update/${id}` : null, note: image ? 'Posted without the image (LinkedIn images aren\'t supported yet).' : null };
  }
  if (conn.provider === 'facebook') {
    const pageId = conn.config.pageId;
    const token = secret.pageTokens && secret.pageTokens[pageId];
    if (!token) throw Object.assign(oauth.fail('The chosen Facebook Page is no longer allowed. Sign in again and choose the Page.', 401, 'auth'), { connectionId: conn.id, connectionLabel: conn.label });
    const r = image
      ? await oauth.http(`${FB()}/${encodeURIComponent(pageId)}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: image, caption: text, access_token: token }) }, 'Facebook', deps)
      : await oauth.http(`${FB()}/${encodeURIComponent(pageId)}/feed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, access_token: token }) }, 'Facebook', deps);
    const id = r.post_id || r.id || null;
    return { platformPostId: id, url: id ? `https://www.facebook.com/${id}` : null, note: null };
  }
  if (conn.provider === 'x') {
    const r = await oauth.http('https://api.x.com/2/tweets', { method: 'POST', headers: { Authorization: `Bearer ${secret.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }, 'X', deps);
    const id = r.data && r.data.id;
    return { platformPostId: id || null, url: id ? `https://x.com/i/web/status/${id}` : null, note: image ? 'Posted without the image (X images aren\'t supported yet).' : null };
  }
  throw oauth.fail(`Publishing to ${conn.provider} isn't supported.`, 400, 'permanent');
}

module.exports = { providerFor, findConnection, publishVia, compose, LIMITS };
