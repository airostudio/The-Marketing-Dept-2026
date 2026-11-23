/**
 * api/admin-settings.js — the keys and options Audema's agents use, and the
 * clients (workspaces) Audema is sold to.
 *
 * POST { action, ... }   Header: Authorization: Bearer <Supabase access token>
 *
 * Settings (see api/_lib/settings.js for what each key does):
 *   get { workspaceId? }        → every setting with where its value comes from
 *                                 (client / platform / Vercel / not set) and, for a
 *                                 secret, only its last four characters
 *   set { workspaceId?, key, value }   value '' removes it (falls back to the next source)
 *
 * Clients (platform admins only):
 *   workspaces                  → list, with member counts
 *   createWorkspace { name, ownerId? } | renameWorkspace { workspaceId, name } | deleteWorkspace { workspaceId }
 *   assign { userId, workspaceId|null, role: 'owner'|'member' }
 *
 * Who may do what:
 *   platform admins (role admin / super_admin): everything
 *   a client's owner: get/set that client's own settings (never platform ones,
 *   never "platform only" keys), and see their own workspace
 *
 * Values are encrypted before they are stored and are never returned.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { recordAdminAction } = require('./_lib/audit-log.js');
const box = require('./_lib/secret-box.js');
const settings = require('./_lib/settings.js');

const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const isPlatformAdmin = (p) => !!p && (p.role === 'admin' || p.role === 'super_admin');
const hintOf = (v) => (v.length > 8 ? `…${v.slice(-4)}` : '…');

module.exports = withFailureReporting('api/admin-settings', async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireUser(req, res);
  if (!auth) return;
  if (rateLimited(req, res, { name: 'admin-settings', max: 60, windowMs: 60 * 1000, auth })) return;
  const sb = (m, p, b) => sbRest(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, m, p, b);
  const body = req.body || {};
  const uid = auth.userId;
  const admin = isPlatformAdmin(auth.profile);
  const notInstalled = { code: 'not_installed', error: 'Client settings are not installed. Run supabase-workspaces.sql in the Supabase SQL editor.' };

  const me = await sb('GET', `/profiles?id=eq.${uid}&select=workspace_id,workspace_role&limit=1`);
  if (!me.ok && me.status !== 404) return res.status(500).json({ error: `Database error (HTTP ${me.status}).` });
  const mine = (me.ok && me.data && me.data[0]) || {};

  /** May this caller manage the given scope? */
  function canManage(workspaceId) {
    if (admin) return true;
    return !!workspaceId && mine.workspace_id === workspaceId && mine.workspace_role === 'owner';
  }
  const audit = (action, details) => recordAdminAction({ req, adminId: uid, adminEmail: auth.email, action, details }).catch(() => {});

  try {
    if (body.action === 'get' || body.action === 'set') {
      const workspaceId = body.workspaceId || null;
      if (workspaceId && !isUuid(workspaceId)) return res.status(400).json({ error: 'workspaceId is not a valid id.' });
      if (!canManage(workspaceId)) return res.status(403).json({ error: workspaceId ? 'Only this client\'s owner or a platform admin can change its settings.' : 'Only platform admins can change the platform settings.' });

      if (body.action === 'set') {
        const c = settings.BY_KEY.get(body.key);
        if (!c) return res.status(400).json({ error: `"${str(body.key, 60)}" isn't a setting that can be changed here.` });
        if (workspaceId && c.platformOnly) return res.status(400).json({ error: `${c.label} is a platform setting; clients can't override it.` });
        const value = c.key === 'GOOGLE_SERVICE_ACCOUNT_JSON' ? String(body.value == null ? '' : body.value).trim().slice(0, 20000) : str(body.value, 4000);
        if (value && c.key === 'GOOGLE_SERVICE_ACCOUNT_JSON') { try { JSON.parse(value); } catch { return res.status(400).json({ error: 'That isn\'t valid JSON (paste the whole service account key file).' }); } }
        if (value && /URL$/.test(c.key) && !/^https:\/\//i.test(value)) return res.status(400).json({ error: `${c.label} must start with https://.` });
        const filter = workspaceId ? `scope=eq.workspace&workspace_id=eq.${workspaceId}&key=eq.${c.key}` : `scope=eq.platform&key=eq.${c.key}`;
        if (!value) {
          const d = await sb('DELETE', `/app_settings?${filter}`);
          if (!d.ok && d.status === 404) return res.status(503).json(notInstalled);
        } else {
          if (!box.isConfigured()) return res.status(503).json({ code: 'not_configured', error: box.NOT_CONFIGURED });
          const row = { value_enc: box.seal(value), hint: c.secret ? hintOf(value) : value.slice(0, 120), updated_by: uid };
          const ex = await sb('GET', `/app_settings?${filter}&select=id&limit=1`);
          if (!ex.ok) return res.status(ex.status === 404 ? 503 : 500).json(ex.status === 404 ? notInstalled : { error: `Database error (HTTP ${ex.status}).` });
          const w = ex.data && ex.data[0]
            ? await sb('PATCH', `/app_settings?id=eq.${ex.data[0].id}`, row)
            : await sb('POST', '/app_settings', { scope: workspaceId ? 'workspace' : 'platform', workspace_id: workspaceId, key: c.key, ...row });
          if (!w.ok) return res.status(500).json({ error: `Could not save (HTTP ${w.status}).` });
        }
        settings.invalidate();
        await audit('setting_changed', { key: c.key, scope: workspaceId ? 'workspace' : 'platform', workspaceId, cleared: !value });
      }

      const plat = await sb('GET', '/app_settings?scope=eq.platform&select=key,hint,updated_at&limit=500');
      if (!plat.ok) return res.status(plat.status === 404 ? 503 : 500).json(plat.status === 404 ? notInstalled : { error: `Database error (HTTP ${plat.status}).` });
      const ws = workspaceId ? await sb('GET', `/app_settings?scope=eq.workspace&workspace_id=eq.${workspaceId}&select=key,hint,updated_at&limit=500`) : { ok: true, data: [] };
      const pMap = new Map((plat.data || []).map(r => [r.key, r]));
      const wMap = new Map(((ws.ok && ws.data) || []).map(r => [r.key, r]));
      const envHas = (k) => { const v = process.env[k]; return typeof v === 'string' && v.length > 0; };
      const items = settings.CATALOG.filter(c => !(workspaceId && c.platformOnly)).map(c => {
        const w = wMap.get(c.key), p = pMap.get(c.key);
        // Platform defaults are shown to a client as "set by the platform" — never their value.
        const source = w ? 'workspace' : p ? 'platform' : envHas(c.key) ? 'env' : null;
        const hint = w ? w.hint : (p && (admin || !c.secret)) ? p.hint : null;
        return { key: c.key, label: c.label, group: c.group, help: c.help, secret: c.secret, platformOnly: c.platformOnly, source, hint: source === 'platform' && !admin && c.secret ? null : hint, own: !!(workspaceId ? w : p), updatedAt: (workspaceId ? w : p) ? (workspaceId ? w : p).updated_at : null };
      });
      return res.json({ ok: true, scope: workspaceId ? 'workspace' : 'platform', workspaceId, encryptionConfigured: box.isConfigured(), items, isPlatformAdmin: admin });
    }

    if (body.action === 'me') {
      let ws = null;
      if (mine.workspace_id) { const w = await sb('GET', `/workspaces?id=eq.${mine.workspace_id}&select=id,name&limit=1`); ws = w.ok && w.data && w.data[0] || null; }
      return res.json({ ok: true, isPlatformAdmin: admin, workspace: ws, workspaceRole: mine.workspace_role || null });
    }

    if (!admin) return res.status(403).json({ error: 'Only platform admins can manage clients.' });

    if (body.action === 'workspaces') {
      const w = await sb('GET', '/workspaces?select=id,name,owner_id,notes,created_at&order=name.asc&limit=500');
      if (!w.ok) return res.status(w.status === 404 ? 503 : 500).json(w.status === 404 ? notInstalled : { error: `Database error (HTTP ${w.status}).` });
      const members = await sb('GET', '/profiles?workspace_id=not.is.null&select=id,workspace_id,workspace_role&limit=5000');
      const counts = {};
      for (const m of (members.ok && members.data) || []) counts[m.workspace_id] = (counts[m.workspace_id] || 0) + 1;
      const own = await sb('GET', '/app_settings?scope=eq.workspace&select=workspace_id&limit=5000');
      const oc = {};
      for (const r of (own.ok && own.data) || []) oc[r.workspace_id] = (oc[r.workspace_id] || 0) + 1;
      return res.json({ ok: true, workspaces: (w.data || []).map(x => ({ id: x.id, name: x.name, ownerId: x.owner_id, notes: x.notes, createdAt: x.created_at, members: counts[x.id] || 0, ownSettings: oc[x.id] || 0 })) });
    }
    if (body.action === 'createWorkspace') {
      const name = str(body.name, 120);
      if (!name) return res.status(400).json({ error: 'Give the client a name.' });
      if (body.ownerId && !isUuid(body.ownerId)) return res.status(400).json({ error: 'ownerId is not a valid id.' });
      const w = await sb('POST', '/workspaces', { name, owner_id: body.ownerId || null, notes: str(body.notes, 500) || null });
      if (!w.ok || !w.data || !w.data[0]) return res.status(w.status === 404 ? 503 : 500).json(w.status === 404 ? notInstalled : { error: `Could not create (HTTP ${w.status}).` });
      if (body.ownerId) await sb('PATCH', `/profiles?id=eq.${body.ownerId}`, { workspace_id: w.data[0].id, workspace_role: 'owner' });
      settings.invalidate();
      await audit('workspace_created', { workspaceId: w.data[0].id, name });
      return res.json({ ok: true, workspace: w.data[0] });
    }
    if (body.action === 'renameWorkspace') {
      if (!isUuid(body.workspaceId)) return res.status(400).json({ error: 'workspaceId is not a valid id.' });
      const name = str(body.name, 120);
      if (!name) return res.status(400).json({ error: 'Give the client a name.' });
      await sb('PATCH', `/workspaces?id=eq.${body.workspaceId}`, { name });
      return res.json({ ok: true });
    }
    if (body.action === 'deleteWorkspace') {
      if (!isUuid(body.workspaceId)) return res.status(400).json({ error: 'workspaceId is not a valid id.' });
      // Members stay (falling back to the platform settings); the client's own keys are deleted with it.
      await sb('PATCH', `/profiles?workspace_id=eq.${body.workspaceId}`, { workspace_id: null, workspace_role: 'member' });
      await sb('DELETE', `/workspaces?id=eq.${body.workspaceId}`);
      settings.invalidate();
      await audit('workspace_deleted', { workspaceId: body.workspaceId });
      return res.json({ ok: true });
    }
    if (body.action === 'assign') {
      if (!isUuid(body.userId)) return res.status(400).json({ error: 'userId is not a valid id.' });
      if (body.workspaceId && !isUuid(body.workspaceId)) return res.status(400).json({ error: 'workspaceId is not a valid id.' });
      const role = body.role === 'owner' ? 'owner' : 'member';
      if (body.workspaceId) {
        const w = await sb('GET', `/workspaces?id=eq.${body.workspaceId}&select=id&limit=1`);
        if (!(w.ok && w.data && w.data[0])) return res.status(404).json({ error: 'That client was not found.' });
      }
      const u = await sb('PATCH', `/profiles?id=eq.${body.userId}`, { workspace_id: body.workspaceId || null, workspace_role: body.workspaceId ? role : 'member' });
      if (!u.ok || !(u.data || []).length) return res.status(404).json({ error: 'That user was not found.' });
      if (body.workspaceId && role === 'owner') await sb('PATCH', `/workspaces?id=eq.${body.workspaceId}`, { owner_id: body.userId });
      settings.invalidate();
      await audit('workspace_assigned', { userId: body.userId, workspaceId: body.workspaceId || null, role });
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: `Unknown action "${body.action}".` });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
});
