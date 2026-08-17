/**
 * api/cron-competitor-watch.js — daily competitor change detection for
 * Scout (Competitive Intel).
 *
 * Triggered by Vercel Cron (see vercel.json's "crons" entry). For every
 * active row in competitor_watches (across all users — a cron job has no
 * logged-in session to scope to, same pattern as api/cron-auto-publish.js
 * and api/cron-agent-audit.js), fetches the tracked URL, extracts the
 * <title>, meta description, and a hash of the visible page text, and
 * compares it to the most recent prior snapshot. Any difference gets
 * written to competitor_changes so Scout can show "this competitor's site
 * actually changed" instead of only ever answering on-demand questions.
 *
 * This is intentionally a lightweight signal, not a full DOM diff: no npm
 * dependencies are used anywhere in api/*.js in this project, so extraction
 * is regex-based against the raw HTML rather than a real parser. A changed
 * content hash means "the visible text on this page is different than last
 * time" — it doesn't say what changed. Good enough to prompt a human to go
 * look; not a substitute for reading the page.
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — data access
 *   CRON_SECRET — same bearer-token gate as the other cron jobs
 */

'use strict';

const crypto = require('crypto');
const { sbRest } = require('./_lib/supabase-rest.js');

const MAX_WATCHES_PER_RUN = 150; // keeps this inside Vercel's 60s function budget
const PER_FETCH_TIMEOUT_MS = 8000;
const FETCH_CONCURRENCY = 8;

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 500) : null;
}

function extractMetaDescription(html) {
  // Attributes can appear in either order: name="description" content="..." or content="..." name="description"
  let m = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  if (!m) m = html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 500) : null;
}

function contentHash(html) {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return crypto.createHash('sha256').update(stripped).digest('hex');
}

async function fetchSnapshot(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AudemaScoutBot/1.0; +https://audema.ai/bot)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(PER_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const html = await res.text();
    return {
      title: extractTitle(html),
      meta_description: extractMetaDescription(html),
      content_hash: contentHash(html),
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function processWatch(supabaseUrl, serviceKey, watch) {
  const snapshot = await fetchSnapshot(watch.url);

  // Most recent prior snapshot for this watch, if any.
  const prevRes = await sbRest(
    supabaseUrl, serviceKey, 'GET',
    `/competitor_snapshots?watch_id=eq.${watch.id}&order=fetched_at.desc&limit=1`
  );
  const prev = (prevRes.ok && Array.isArray(prevRes.data) && prevRes.data[0]) || null;

  await sbRest(supabaseUrl, serviceKey, 'POST', '/competitor_snapshots', {
    watch_id: watch.id,
    title: snapshot.title || null,
    meta_description: snapshot.meta_description || null,
    content_hash: snapshot.content_hash || null,
    error: snapshot.error || null,
  });

  if (snapshot.error || !prev) return { watchId: watch.id, changed: false };

  const changes = [];
  if (prev.title && snapshot.title && prev.title !== snapshot.title) {
    changes.push({ change_type: 'title', previous_value: prev.title, new_value: snapshot.title });
  }
  if (prev.meta_description && snapshot.meta_description && prev.meta_description !== snapshot.meta_description) {
    changes.push({ change_type: 'meta_description', previous_value: prev.meta_description, new_value: snapshot.meta_description });
  }
  if (prev.content_hash && snapshot.content_hash && prev.content_hash !== snapshot.content_hash) {
    changes.push({ change_type: 'content', previous_value: prev.content_hash, new_value: snapshot.content_hash });
  }

  for (const change of changes) {
    await sbRest(supabaseUrl, serviceKey, 'POST', '/competitor_changes', { watch_id: watch.id, ...change });
  }

  return { watchId: watch.id, changed: changes.length > 0, changeTypes: changes.map(c => c.change_type) };
}

// Simple concurrency-limited runner — external site fetches are slower/less
// predictable than internal API calls, so unlike cron-agent-audit.js's
// unlimited Promise.allSettled, this caps how many run at once.
async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let index = 0;
  async function next() {
    while (index < items.length) {
      const i = index++;
      results[i] = await worker(items[i]).catch(err => ({ error: err.message }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

module.exports = async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET is not configured — refusing to run an unauthenticated competitor-watch sweep.' });
  }
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const watchesRes = await sbRest(supabaseUrl, serviceKey, 'GET', `/competitor_watches?active=eq.true&order=created_at.asc&limit=${MAX_WATCHES_PER_RUN + 1}`);
  if (!watchesRes.ok) {
    return res.status(502).json({ error: 'Could not load competitor_watches.' });
  }
  const allWatches = watchesRes.data || [];
  const truncated = allWatches.length > MAX_WATCHES_PER_RUN;
  const watches = allWatches.slice(0, MAX_WATCHES_PER_RUN);

  const results = await runWithConcurrency(watches, FETCH_CONCURRENCY, (w) => processWatch(supabaseUrl, serviceKey, w));

  const changedCount = results.filter(r => r && r.changed).length;
  const errorCount = results.filter(r => r && r.error).length;

  return res.json({
    success: true,
    checked: watches.length,
    changed: changedCount,
    errors: errorCount,
    truncated, // if true, more active watches exist than this run could cover — raise MAX_WATCHES_PER_RUN or shard across more frequent runs
    checkedAt: new Date().toISOString(),
  });
};
