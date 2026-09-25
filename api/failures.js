/**
 * api/failures.js — the failure pipeline's HTTP surface.
 *
 * Two audiences, one endpoint, because they share the same table and the same
 * authentication shape:
 *
 *   POST { action: 'report', ... }   any signed-in user — the browser telling
 *                                    us something broke on their screen
 *   POST { action: 'list' }          administrators — the failures console
 *   POST { action: 'detail', id }    administrators — recent occurrences
 *   POST { action: 'update', id }    administrators — acknowledge / resolve
 *   POST { action: 'summary' }       administrators — counts for the nav badge
 *
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * ── Why reporting is authenticated ─────────────────────────────────────────
 *
 * An unauthenticated failure sink is a way to fill somebody's database and
 * their inbox: anyone who found the URL could post ten thousand distinct
 * fingerprints and either bury the real incidents or trigger an alert for each
 * one. Requiring a session means a flood has an account attached to it, and
 * the burst limit below is keyed on that account.
 *
 * ── Why reading is admin-only ──────────────────────────────────────────────
 *
 * Failure detail is operational information about the platform: which upstream
 * is down, which environment variable is unset, what a stack trace says. That
 * is for whoever runs the deployment, not for its customers.
 */

'use strict';

const { requireUser, requireAdmin } = require('./_lib/require-user.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { reportFailure, withFailureReporting } = require('./_lib/report-failure.js');

const STATUSES = ['open', 'acknowledged', 'resolved'];

function tableError(r) {
  if (r.status === 404) {
    return {
      error: 'The failure log is not installed yet. Run supabase-system-failures.sql ' +
             '(or supabase-install-all.sql) in the Supabase SQL editor.',
      code: 'not_installed',
    };
  }
  return { error: `The failure log could not be read (HTTP ${r.status}).` };
}

module.exports = withFailureReporting('api/failures', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const body = req.body || {};
  const action = body.action || 'report';

  /* ── report: any signed-in user ───────────────────────────────────────── */
  if (action === 'report') {
    const auth = await requireUser(req, res);
    if (!auth) return;

    // Generous, because a page that has genuinely broken may report several
    // things at once — but bounded, because this writes to the database and
    // can trigger email.
    if (rateLimited(req, res, { name: 'failures-report', max: 30, windowMs: 60 * 1000, auth })) return;

    const source  = String(body.source || '').trim();
    const message = String(body.message || '').trim();
    if (!source)  return res.status(400).json({ error: 'source is required' });
    if (!message) return res.status(400).json({ error: 'message is required' });

    // The browser does not get to choose how bad its own failure is, nor to
    // claim a kind that only a server path can produce. A client report is a
    // client error; severity is inferred from the message like any other.
    const result = await reportFailure({
      source: source.slice(0, 120),
      message: message.slice(0, 2000),
      kind: 'client_error',
      detail: body.detail && typeof body.detail === 'object' ? body.detail : {},
      userId: auth.userId,
    });

    return res.json({ ok: true, recorded: result.recorded });
  }

  /* ── everything else: administrators ──────────────────────────────────── */
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);

  try {
    if (action === 'summary') {
      const r = await sb('GET', '/system_failures?select=status,severity,self_healing&limit=1000');
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      const rows = r.data || [];
      const open = rows.filter(x => x.status === 'open');
      return res.json({
        ok: true,
        open: open.length,
        critical: open.filter(x => x.severity === 'critical').length,
        errors: open.filter(x => x.severity === 'error').length,
        // Split out so the badge does not shout about things that are expected
        // to clear by themselves.
        needsAPerson: open.filter(x => !x.self_healing).length,
        acknowledged: rows.filter(x => x.status === 'acknowledged').length,
        resolved: rows.filter(x => x.status === 'resolved').length,
      });
    }

    if (action === 'list') {
      const status = STATUSES.includes(body.status) ? body.status : null;
      const limit = Math.min(Math.max(parseInt(body.limit, 10) || 100, 1), 500);
      let path = '/system_failures?select=*';
      if (status) path += `&status=eq.${status}`;
      // Worst first, then most recent: a critical incident from this morning
      // should not be below a warning from a minute ago.
      path += `&order=severity.desc,last_seen.desc&limit=${limit}`;
      const r = await sb('GET', path);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      return res.json({ ok: true, failures: r.data || [] });
    }

    if (action === 'detail') {
      if (!isUuid(body.id)) return res.status(400).json({ error: 'id is not a valid id' });
      const [inc, events] = await Promise.all([
        sb('GET', `/system_failures?id=eq.${body.id}&limit=1`),
        sb('GET', `/system_failure_events?failure_id=eq.${body.id}&order=occurred_at.desc&limit=25`),
      ]);
      if (!inc.ok) return res.status(inc.status === 404 ? 503 : 500).json(tableError(inc));
      const failure = (inc.data || [])[0];
      if (!failure) return res.status(404).json({ error: 'No such incident.' });
      return res.json({ ok: true, failure, events: (events.ok && events.data) || [] });
    }

    if (action === 'update') {
      if (!isUuid(body.id)) return res.status(400).json({ error: 'id is not a valid id' });
      if (!STATUSES.includes(body.status)) {
        return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
      }
      const patch = { status: body.status };
      if (typeof body.note === 'string') patch.note = body.note.slice(0, 2000);
      if (body.status === 'resolved') {
        patch.resolved_at = new Date().toISOString();
        patch.resolved_by = admin.userId;
      } else {
        // Reopening or acknowledging clears a stale resolution, so the row
        // never claims to have been fixed at a time it was not.
        patch.resolved_at = null;
        patch.resolved_by = null;
      }
      const r = await sb('PATCH', `/system_failures?id=eq.${body.id}`, patch);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      return res.json({ ok: true, failure: (r.data || [])[0] || null });
    }

    return res.status(400).json({ error: `Unknown action "${action}".` });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Unexpected error.' });
  }
});
