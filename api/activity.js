/**
 * api/activity.js — the "What happened" inbox.
 *
 * POST { action, ... }   Header: Authorization: Bearer <Supabase access token>
 *   list { intelProfileId?|projectId?, onlyOpen? } → events, newest first, and how many need you
 *   read { ids }                                  → mark as read
 *   dismiss { id }                                → resolve an info/failed item
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const scope = require('./_lib/autopilot/scope.js');

function view(e) {
  return { id: e.id, kind: e.kind, agent: e.agent, title: e.title, body: e.body, action: e.action, details: e.details, read: !!e.read_at, resolved: !!e.resolved_at, createdAt: e.created_at, jobId: e.job_id };
}

module.exports = withFailureReporting('api/activity', async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireUser(req, res);
  if (!auth) return;
  if (rateLimited(req, res, { name: 'activity', max: 60, windowMs: 60 * 1000, auth })) return;
  const sb = (m, p, b) => sbRest(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, m, p, b);
  const body = req.body || {};
  const uid = auth.user.id;

  try {
    if (body.action === 'list') {
      const s = await scope.scopeFor(uid, body, { requireEdit: false });
      if (s.err) return res.status(s.err.http).json(s.err);
      const open = body.onlyOpen ? '&resolved_at=is.null' : '';
      // The business's events, plus the caller's own that aren't tied to any business (e.g. a competitor watch).
      const [col, cond] = s.filter.split('=');
      const r = await sb('GET', `/activity_events?or=(${col}.${cond},and(user_id.eq.${uid},intel_profile_id.is.null,project_id.is.null))${open}&select=*&order=created_at.desc&limit=100`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(r.status === 404 ? { code: 'not_installed', error: 'Autopilot is not installed. Run supabase-autopilot.sql in the Supabase SQL editor.' } : { error: `Database error (HTTP ${r.status}).` });
      const events = (r.data || []).map(view);
      return res.json({ ok: true, events, needsYou: events.filter(e => !e.resolved && (e.kind === 'needs_approval' || e.kind === 'needs_permission')).length, unread: events.filter(e => !e.read).length });
    }
    if (body.action === 'read' || body.action === 'dismiss') {
      const ids = (body.action === 'read' ? (Array.isArray(body.ids) ? body.ids : []) : [body.id]).filter(isUuid).slice(0, 100);
      if (!ids.length) return res.status(400).json({ error: 'Which items?' });
      const r = await sb('GET', `/activity_events?id=in.(${ids.join(',')})&select=id,user_id,intel_profile_id,project_id,kind`);
      const allowed = [];
      for (const e of (r.ok && r.data) || []) if (await scope.canAct(uid, e, false)) allowed.push(e);
      // A request for approval or a login is answered by doing it, not by dismissing it.
      const targets = body.action === 'dismiss' ? allowed.filter(e => e.kind !== 'needs_approval' && e.kind !== 'needs_permission') : allowed;
      if (targets.length) await sb('PATCH', `/activity_events?id=in.(${targets.map(e => e.id).join(',')})`, body.action === 'read' ? { read_at: new Date().toISOString() } : { resolved_at: new Date().toISOString(), read_at: new Date().toISOString() });
      return res.json({ ok: true, updated: targets.length });
    }
    return res.status(400).json({ error: `Unknown action "${body.action}".` });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
});
