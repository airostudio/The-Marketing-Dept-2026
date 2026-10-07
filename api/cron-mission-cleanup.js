/**
 * api/cron-mission-cleanup.js — the backend cleanup agent for Scotty
 * missions. Nothing in a mission retries itself forever or fixes itself
 * silently: this sweeps what missions have left behind, finds what went
 * wrong, and reports it so a person can handle it by hand.
 *
 * It looks for four things on mission_artifacts:
 *
 *   stalled        a list still 'building' long after anything touched it —
 *                  the browser tab that was driving it closed, or a lookup
 *                  kept failing. It can never become approvable on its own.
 *   import_failed  an approved list where some leads failed to save into the
 *                  audience. The approval stands; those named people are the
 *                  ones nobody has.
 *   lookup_errors  a finished list where some leads' contact lookups errored
 *                  (as opposed to "searched, nobody found") — a person may
 *                  want to retry those.
 *   needs_input    a Pat draft that failed its own review and so can never be
 *                  approved as it stands — it needs facts only a person has.
 *
 * It fixes nothing and deletes nothing. Each problem is (1) flagged on the
 * artifact itself (payload.attention, so the UI can show it) and (2) reported
 * through the app's failure reporting — the admin failures page and alert
 * email — once. A flag records the reason it was raised for, so the next
 * sweep doesn't report the same problem again; if the artifact has changed
 * since it was read, that flag is skipped and the next sweep re-checks it.
 *
 * Required env: CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');
const { withFailureReporting, reportFailure } = require('./_lib/report-failure.js');

const STALL_MS = 30 * 60 * 1000;           // untouched this long while 'building' = abandoned
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ARTIFACTS = 300;

/**
 * What, if anything, is wrong with one artifact.
 * @returns {{reason: string, kind: string, message: string, detail: object} | null}
 */
function assess(artifact, now) {
  const payload = artifact.payload || {};
  const leads = Array.isArray(payload.leads) ? payload.leads : [];
  const label = `"${artifact.title}" (${artifact.id})`;

  if (artifact.status === 'building') {
    const idleMs = now - new Date(artifact.updated_at || artifact.created_at).getTime();
    if (idleMs >= STALL_MS) {
      const isWeek = artifact.kind === 'nancy_week';
      const isSeo = artifact.kind === 'seo_plan';
      const posts = Array.isArray(payload.posts) ? payload.posts : [];
      const articlesDone = Array.isArray(payload.articles) ? payload.articles.length : 0;
      const seoTarget = payload.params?.articleTarget || 1;
      const remaining = isSeo ? Math.max(0, seoTarget - articlesDone) : isWeek ? Math.max(0, 7 - posts.length) : leads.filter(l => !l.enriched && !l.audited).length;
      return {
        reason: 'stalled', kind: 'upstream_timeout',
        message: `Mission list ${label} stalled while building: ${remaining} of ${isSeo ? seoTarget : isWeek ? 7 : leads.length} ${isSeo ? 'articles were never written' : isWeek ? 'days never got their post and image' : 'leads never finished their lookup or audit'}, and nothing has touched it for ${Math.round(idleMs / 60000)} minutes.`,
        detail: { artifactId: artifact.id, userId: artifact.user_id, remaining, total: isSeo ? seoTarget : isWeek ? 7 : leads.length },
      };
    }
    return null;
  }

  if (artifact.status === 'approved' && payload.approval && payload.approval.failed > 0) {
    return {
      reason: 'import_failed', kind: 'database_error',
      message: `Approved mission list ${label} handled ${payload.approval.imported ?? payload.approval.tagged ?? 0} leads but ${payload.approval.failed} failed to save into the audience and need handling by hand.`,
      detail: { artifactId: artifact.id, userId: artifact.user_id, failedLeads: payload.approval.failedLeads || [] },
    };
  }

  if (artifact.status === 'pending_approval' && artifact.kind === 'analytics_report') {
    const review = payload.review || {};
    if (review.approved === false) {
      return {
        reason: 'needs_input', kind: 'upstream_error',
        message: `Analytics report ${label} contains figures that are not in the account's data (${(review.unsupportedNumbers || []).slice(0, 5).join(', ')}) and cannot be approved. It needs to be re-run or rejected.`,
        detail: { artifactId: artifact.id, userId: artifact.user_id, unsupportedNumbers: review.unsupportedNumbers || [] },
      };
    }
    return null;
  }

  if (artifact.status === 'pending_approval' && artifact.kind === 'pat_campaign') {
    const review = payload.review || {};
    if (review.approved === false) {
      return {
        reason: 'needs_input', kind: 'upstream_error',
        message: `Pat's draft ${label} did not pass review and cannot be approved: ${(review.blockers || []).slice(0, 3).join('; ') || 'no reason recorded'}. It needs a person to supply the missing facts or reject it.`,
        detail: { artifactId: artifact.id, userId: artifact.user_id, blockers: review.blockers || [], questions: payload.questions || [] },
      };
    }
    return null;
  }

  if (artifact.status === 'pending_approval') {
    const errored = leads.filter(l => l.enrichError || l.auditError);
    if (errored.length) {
      return {
        reason: 'lookup_errors', kind: 'upstream_error',
        message: `Mission list ${label} is waiting for approval, but ${errored.length} of ${leads.length} leads had a lookup or website audit that errored (not "found nothing") and may be worth retrying.`,
        detail: { artifactId: artifact.id, userId: artifact.user_id, leads: errored.slice(0, 20).map(l => ({ name: l.name, error: l.enrichError || l.auditError })) },
      };
    }
  }
  return null;
}

/**
 * One sweep. Exported separately from the handler so it can be exercised
 * without HTTP.
 * @returns {Promise<{checked: number, flagged: Array, alreadyFlagged: number, skippedChanged: number}>}
 */
async function sweep({ sb, report = reportFailure, now = Date.now() }) {
  const since = new Date(now - LOOKBACK_MS).toISOString();
  const r = await sb('GET',
    `/mission_artifacts?status=in.(building,pending_approval,approved)&updated_at=gte.${encodeURIComponent(since)}&order=updated_at.desc&limit=${MAX_ARTIFACTS}`);
  if (!r.ok) throw new Error(`Could not read mission_artifacts (HTTP ${r.status}).`);

  const artifacts = r.data || [];
  const out = { checked: artifacts.length, flagged: [], alreadyFlagged: 0, skippedChanged: 0 };

  for (const a of artifacts) {
    const problem = assess(a, now);
    if (!problem) continue;
    if (a.payload && a.payload.attention && a.payload.attention.reason === problem.reason) { out.alreadyFlagged++; continue; }

    // Flag only if nobody changed the artifact since it was read — otherwise
    // this write would overwrite their newer payload.
    const flag = await sb('PATCH',
      `/mission_artifacts?id=eq.${a.id}&updated_at=eq.${encodeURIComponent(a.updated_at)}`,
      {
        payload: { ...(a.payload || {}), attention: { reason: problem.reason, message: problem.message, flaggedAt: new Date(now).toISOString() } },
        updated_at: new Date(now).toISOString(),
      });
    if (!flag.ok) throw new Error(`Could not flag artifact ${a.id} (HTTP ${flag.status}).`);
    if (!Array.isArray(flag.data) || !flag.data.length) { out.skippedChanged++; continue; }

    // Reported only once the flag is saved, so a failed write can't leave a
    // report that the next sweep would then duplicate.
    await report({
      source: 'api/cron-mission-cleanup', kind: problem.kind, severity: 'warning',
      message: problem.message, detail: problem.detail, userId: a.user_id,
    });
    out.flagged.push({ artifactId: a.id, reason: problem.reason });
  }
  return out;
}

module.exports = withFailureReporting('api/cron-mission-cleanup', async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET is not configured — refusing to run an unauthenticated cleanup sweep.' });
  }
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  try {
    const result = await sweep({ sb: (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b) });
    return res.json({ success: true, ...result, checkedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
});

module.exports.sweep = sweep;
module.exports.assess = assess;
