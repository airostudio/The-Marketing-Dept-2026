/**
 * api/cron-auto-publish.js — Autopilot: the missing piece from Phase H
 *
 * Triggered by Vercel Cron (see vercel.json's "crons" entry). Finds every
 * social_posts row across every user that's due — status='scheduled',
 * publish_status='queued', scheduled_at <= now — and publishes it through
 * the same adapters api/publish-social-post.js exposes to the manual
 * "Publish Now" button. This is what makes scheduling actually mean
 * something: today it only takes effect when a human clicks Publish Now.
 *
 * Runs with the Supabase service-role key (server-side only, mirroring the
 * existing pattern in api/ab-track.js / api/mcp.js / api/sso.js) because a
 * cron job has no logged-in user session to scope an RLS-protected request
 * to — it has to see every user's due posts in one query. The service key
 * is read from process.env and never touches the client, per the project's
 * standing rule.
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — data access
 *   CRON_SECRET — Vercel automatically sends `Authorization: Bearer
 *     <CRON_SECRET>` on its own scheduled invocations once this env var is
 *     set; requests without a matching header are rejected. This keeps an
 *     otherwise-public URL from being able to trigger real publishes.
 */

'use strict';

const { withFailureReporting } = require('./_lib/report-failure.js');
const { publishPost } = require('./publish-social-post.js');
const notify = require('./_lib/autopilot/notify.js');
const socialPublish = require('./_lib/social-publish.js');
const faults = require('./_lib/autopilot/faults.js');
const { load: loadConnection } = require('./_lib/autopilot/connections.js');

/**
 * Publish through the business's OWN signed-in account when it has one
 * (Connections → LinkedIn / Facebook / X). Returns the same shape as
 * publishPost, plus `retryInMs` for a hiccup worth trying again and
 * `connection` for a sign-in that was refused.
 */
async function publishWithConnection(sb3, conn, post, attempt) {
  let c;
  try {
    c = await loadConnection(sb3, conn.id);
    const out = await socialPublish.publishVia(sb3, c, post);
    await sb3('PATCH', `/connections?id=eq.${conn.id}`, { last_ok_at: new Date().toISOString() });
    return { success: true, status: 'published', platformPostId: out.platformPostId, url: out.url, note: out.note };
  } catch (e) {
    const { kind, retryAfterMs } = faults.classify(e);
    const d = faults.decide(kind, attempt, retryAfterMs);
    if (d.action === 'retry') return { success: false, status: 'retry', retryInMs: d.waitMs, error: faults.describe(kind, e) };
    if (d.action === 'ask_permission') return { success: false, status: 'not_connected', error: e.message, connection: { id: conn.id, label: conn.label, problem: faults.describe(kind, e) } };
    return { success: false, status: 'failed', error: e.message };
  }
}

const BATCH_LIMIT = 25;

async function sb(supabaseUrl, serviceKey, method, path, body) {
  const res = await fetch(`${supabaseUrl}/rest/v1${path}`, {
    method,
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

module.exports = withFailureReporting('api/cron-auto-publish', async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET is not configured — refusing to run an unauthenticated auto-publish sweep.' });
  }
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const nowIso = new Date().toISOString();
  const dueQuery = `/social_posts?status=eq.scheduled&publish_status=eq.queued&scheduled_at=lte.${encodeURIComponent(nowIso)}&order=scheduled_at.asc&limit=${BATCH_LIMIT}`;
  const due = await sb(supabaseUrl, serviceKey, 'GET', dueQuery);
  if (!due.ok) {
    return res.status(502).json({ error: 'Could not query due posts', detail: due.data });
  }

  const posts = due.data || [];
  const summary = { checked: posts.length, published: 0, publishing: 0, failed: 0, results: [] };

  for (const post of posts) {
    // Optimistic lock: flip to 'publishing' before the external call so a
    // second overlapping cron run (rare, but cron overlap does happen) won't
    // also pick this row up — it's no longer in the 'queued' state it needs.
    await sb(supabaseUrl, serviceKey, 'PATCH', `/social_posts?id=eq.${post.id}`, { publish_status: 'publishing' });

    const sb3 = (m, p, b) => sb(supabaseUrl, serviceKey, m, p, b);
    const conn = await socialPublish.findConnection(sb3, post).catch(() => null);
    const attempt = Number((post.metadata || {}).publish_attempts) || 0;
    const result = conn
      ? await publishWithConnection(sb3, conn, post, attempt)
      : await publishPost({
        platform: post.platform,
        headline: post.headline,
        body: post.body,
        cta: post.cta,
        hashtags: post.hashtags,
        imageUrl: post.image_url || '',
      });

    if (result.status === 'retry') {
      // A hiccup: back in the queue a little later, counted, so it can't loop forever.
      await sb3('PATCH', `/social_posts?id=eq.${post.id}`, { publish_status: 'queued', publish_error: result.error, scheduled_at: new Date(Date.now() + result.retryInMs).toISOString(), metadata: { ...(post.metadata || {}), publish_attempts: attempt + 1 } });
      summary.results.push({ id: post.id, platform: post.platform, status: 'retrying' });
      continue;
    }
    if (result.connection) {
      // The sign-in was refused: mark it, keep the post waiting, and ask the business to sign in again.
      await sb3('PATCH', `/connections?id=eq.${result.connection.id}`, { status: 'needs_attention', status_note: result.connection.problem, last_error_at: new Date().toISOString() });
      await sb3('PATCH', `/social_posts?id=eq.${post.id}`, { publish_status: 'not_connected', publish_error: result.error });
      await notify.signInNeeded(sb3, post, result.connection);
      summary.failed++;
      summary.results.push({ id: post.id, platform: post.platform, status: 'not_connected' });
      continue;
    }

    if (result.success && result.status === 'published') {
      await sb(supabaseUrl, serviceKey, 'PATCH', `/social_posts?id=eq.${post.id}`, {
        status: 'published',
        publish_status: 'published',
        publish_platform_post_id: result.platformPostId || null,
        published_at: new Date().toISOString(),
      });
      summary.published++;
    } else if (result.success && result.status === 'publishing') {
      // TikTok-style async accept — leave status='scheduled', just record
      // the platform's publish id. A future status-poll pass could resolve
      // this to 'published' once the platform confirms; not built yet.
      await sb(supabaseUrl, serviceKey, 'PATCH', `/social_posts?id=eq.${post.id}`, {
        publish_status: 'publishing',
        publish_platform_post_id: result.platformPostId || null,
      });
      summary.publishing++;
    } else {
      await sb(supabaseUrl, serviceKey, 'PATCH', `/social_posts?id=eq.${post.id}`, {
        publish_status: 'failed',
        publish_error: result.error || result.status,
      });
      await notify.postFailed((m, p, b) => sb(supabaseUrl, serviceKey, m, p, b), post, result);
      summary.failed++;
    }

    summary.results.push({ id: post.id, platform: post.platform, status: result.status });
  }

  return res.json(summary);
});
