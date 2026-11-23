/**
 * api/connections.js — a business connects its own accounts so agents can
 * act on them (publish to its website, …).
 *
 * POST { action, ... }   Header: Authorization: Bearer <Supabase access token>
 *   providers                           → what each platform needs, with how-to help
 *   list { intelProfileId?, projectId? } → connections (never the secrets)
 *   connect { provider, fields, intelProfileId?, projectId?, connectionId? }
 *       Checks the login really works and can publish BEFORE saving it,
 *       encrypts the secret, and — on a reconnect — restarts any agent work
 *       that was waiting for it and clears the request from the inbox.
 *   test { id } | disconnect { id }
 *   choose { id, value }                → which Facebook Page / Search Console site a sign-in uses
 * Sign-in connections (LinkedIn, Facebook, X, Search Console) start at api/oauth.js.
 *
 * Env: CONNECTIONS_ENCRYPTION_KEY (required to store secrets).
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const { PROVIDERS } = require('./_lib/cms.js');
const oauth = require('./_lib/oauth.js');
const box = require('./_lib/secret-box.js');
const { publicView, load } = require('./_lib/autopilot/connections.js');
const activity = require('./_lib/autopilot/activity.js');
const scope = require('./_lib/autopilot/scope.js');

module.exports = withFailureReporting('api/connections', async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireUser(req, res);
  if (!auth) return;
  if (rateLimited(req, res, { name: 'connections', max: 20, windowMs: 60 * 1000, auth })) return;
  const supabaseUrl = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);
  const uid = auth.userId;
  const body = req.body || {};
  const tableError = (r) => (r.status === 404 ? { code: 'not_installed', error: 'Autopilot is not installed. Run supabase-autopilot.sql in the Supabase SQL editor.' } : { code: 'db_error', error: `Database error (HTTP ${r.status}).` });

  const scopeFor = (b) => scope.scopeFor(uid, b);

  async function mine(id, requireEdit = true) {
    if (!isUuid(id)) return { http: 400, err: { error: 'id is not a valid id.' } };
    const r = await sb('GET', `/connections?id=eq.${id}&select=*&limit=1`);
    if (!r.ok) return { http: r.status === 404 ? 503 : 500, err: tableError(r) };
    const c = r.data && r.data[0];
    if (!c || !(await canAccessRecord(supabaseUrl, serviceKey, uid, c, { requireEdit }))) return { http: 404, err: { error: 'Connection not found.' } };
    return { row: c };
  }

  try {
    if (body.action === 'providers') {
      return res.json({
        ok: true, encryptionConfigured: box.isConfigured(),
        providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, needs: p.needs, help: p.help })),
        signIn: Object.entries(oauth.PROVIDERS).map(([id, p]) => ({ id, label: p.label, kind: p.kind, help: p.help, configured: oauth.isConfigured(id) })),
      });
    }

    if (body.action === 'list') {
      const s = await scopeFor(body);
      if (s.err) return res.status(s.err.http).json(s.err);
      const r = await sb('GET', `/connections?${s.filter}&status=neq.disconnected&select=*&order=created_at.desc`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      return res.json({ ok: true, connections: (r.data || []).map(publicView) });
    }

    if (body.action === 'connect') {
      const provider = PROVIDERS[body.provider];
      if (!provider) return res.status(400).json({ error: oauth.PROVIDERS[body.provider] ? `${oauth.PROVIDERS[body.provider].label} is connected by signing in, not with a key.` : `Unknown platform "${body.provider}".` });
      if (!box.isConfigured()) return res.status(503).json({ error: box.NOT_CONFIGURED, code: 'not_configured' });
      let existing = null, s;
      if (body.connectionId) {
        const m = await mine(body.connectionId);
        if (m.err) return res.status(m.http).json(m.err);
        existing = m.row;
        if (existing.provider !== body.provider) return res.status(400).json({ error: 'Reconnect with the same platform, or add a new connection.' });
        s = { ownerId: existing.user_id, intel_profile_id: existing.intel_profile_id, project_id: existing.project_id };
      } else {
        s = await scopeFor(body);
        if (s.err) return res.status(s.err.http).json(s.err);
      }
      let v;
      try { v = await provider.verify((body.fields && typeof body.fields === 'object') ? body.fields : {}); }
      catch (e) { return res.status(e.kind === 'auth' ? 401 : e.kind === 'transient' || e.kind === 'rate_limited' ? 502 : 400).json({ error: e.message, kind: e.kind }); }
      const row = { provider: body.provider, label: v.label, site_url: v.siteUrl, config: v.config || {}, secret_enc: box.seal(v.secret || {}), status: 'active', status_note: null, last_ok_at: new Date().toISOString() };
      let saved;
      if (existing) saved = await sb('PATCH', `/connections?id=eq.${existing.id}`, row);
      else saved = await sb('POST', '/connections', { user_id: s.ownerId, intel_profile_id: s.intel_profile_id, project_id: s.project_id, ...row });
      if (!saved.ok || !saved.data || !saved.data[0]) return res.status(saved.status === 404 ? 503 : 500).json(tableError(saved));
      const conn = saved.data[0];
      // Work that was waiting for this login carries on now.
      let resumed = 0;
      const waiting = await sb('GET', `/agent_jobs?user_id=eq.${conn.user_id}&status=eq.waiting_permission&select=id,state&limit=50`);
      for (const j of (waiting.ok && waiting.data) || []) {
        // Only work that was waiting for this very connection; work waiting for a
        // first connection resumes when its autopilot is given one.
        if (j.state && j.state.waitingFor === conn.id) {
          const u = await sb('PATCH', `/agent_jobs?id=eq.${j.id}&status=eq.waiting_permission`, { status: 'queued', run_at: new Date().toISOString(), step_attempts: 0 });
          if (u.ok && (u.data || []).length) resumed++;
        }
      }
      await sb('PATCH', `/activity_events?user_id=eq.${conn.user_id}&kind=eq.needs_permission&resolved_at=is.null&action->>connectionId=eq.${conn.id}`, { resolved_at: new Date().toISOString() });
      await sb('PATCH', `/autopilots?connection_id=eq.${conn.id}`, { paused_reason: null });
      if (existing || resumed) await activity.record(sb, { user_id: conn.user_id, intel_profile_id: conn.intel_profile_id, project_id: conn.project_id, kind: 'info', title: `${conn.label} ${existing ? 'reconnected' : 'connected'}`, body: resumed ? `${resumed} piece${resumed === 1 ? '' : 's'} of waiting work picked up where ${resumed === 1 ? 'it' : 'they'} stopped.` : '' });
      return res.json({ ok: true, connection: publicView(conn), resumed });
    }

    if (body.action === 'test') {
      const m = await mine(body.id, false);
      if (m.err) return res.status(m.http).json(m.err);
      try {
        const conn = await load(sb, m.row.id);
        if (oauth.PROVIDERS[conn.provider]) {
          const secret = await oauth.fresh(sb, conn);
          await oauth.PROVIDERS[conn.provider].ping(conn, secret);
          await sb('PATCH', `/connections?id=eq.${conn.id}`, { last_ok_at: new Date().toISOString() });
          return res.json({ ok: true, working: true, pagesSeen: null });
        }
        await PROVIDERS[conn.provider].ping(conn);
        const pages = await PROVIDERS[conn.provider].listPages(conn);
        await sb('PATCH', `/connections?id=eq.${conn.id}`, { last_ok_at: new Date().toISOString() });
        return res.json({ ok: true, working: true, pagesSeen: pages.length });
      } catch (e) {
        return res.json({ ok: true, working: false, error: e.message, kind: e.kind || null });
      }
    }

    if (body.action === 'choose') {
      // Which Facebook Page / Search Console site a sign-in is used for — only one it already has.
      const m = await mine(body.id);
      if (m.err) return res.status(m.http).json(m.err);
      const c = m.row, cfg = c.config || {};
      if (c.provider === 'facebook') {
        const page = (cfg.pages || []).find(p => p.id === String(body.value));
        if (!page) return res.status(400).json({ error: 'That Page is not one this sign-in can post to.' });
        const u = await sb('PATCH', `/connections?id=eq.${c.id}`, { config: { ...cfg, pageId: page.id, pageName: page.name }, label: `Facebook — ${page.name}`, site_url: `https://www.facebook.com/${page.id}` });
        return res.json({ ok: true, connection: publicView(u.data[0]) });
      }
      if (c.provider === 'gsc') {
        if (!(cfg.properties || []).includes(String(body.value))) return res.status(400).json({ error: 'That site is not in this Search Console account.' });
        const v = String(body.value);
        const u = await sb('PATCH', `/connections?id=eq.${c.id}`, { config: { ...cfg, property: v }, label: `Search Console — ${v.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/$/, '')}`, site_url: v.startsWith('sc-domain:') ? `https://${v.slice(10)}` : v });
        return res.json({ ok: true, connection: publicView(u.data[0]) });
      }
      return res.status(400).json({ error: 'Nothing to choose for this connection.' });
    }

    if (body.action === 'disconnect') {
      const m = await mine(body.id);
      if (m.err) return res.status(m.http).json(m.err);
      // The secret is wiped, not just hidden.
      await sb('PATCH', `/connections?id=eq.${m.row.id}`, { status: 'disconnected', secret_enc: null, status_note: 'Disconnected by you.' });
      await sb('PATCH', `/autopilots?connection_id=eq.${m.row.id}`, { connection_id: null });
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: `Unknown action "${body.action}".` });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
});
