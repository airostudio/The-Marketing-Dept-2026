/**
 * api/oauth.js — connect a business's LinkedIn, Facebook Page, X or Google
 * Search Console by signing in (api/_lib/oauth.js has the networks).
 *
 *   POST { action: 'start', provider, intelProfileId?|projectId?, connectionId? }
 *        Header: Authorization: Bearer <Supabase access token>
 *        → { url } to send the browser to the network's consent screen
 *   GET  ?code=…&state=…   (the network sends the browser back here)
 *        → saves the connection, carries on any work that was waiting for it,
 *          and returns the browser to /connections.html with the outcome.
 *
 * Register <APP_BASE_URL>/api/oauth as the redirect URI with each network.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const box = require('./_lib/secret-box.js');
const oauth = require('./_lib/oauth.js');
const scope = require('./_lib/autopilot/scope.js');
const activity = require('./_lib/autopilot/activity.js');

function baseUrl(req) {
  const env = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  if (env) return env;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `https://${host}` : '';
}

function back(res, params) {
  res.statusCode = 302;
  res.setHeader('Location', `/connections.html?${new URLSearchParams(params).toString()}`);
  res.setHeader('Cache-Control', 'no-store');
  return res.end();
}

module.exports = withFailureReporting('api/oauth', async function handler(req, res) {
  const sb = (m, p, b) => sbRest(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, m, p, b);
  const redirectUri = `${baseUrl(req)}/api/oauth`;

  /* ── The network sends the browser back ── */
  if (req.method === 'GET') {
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const st = q.state ? oauth.openState(String(q.state)) : null;
    if (!st) return back(res, { oauth_error: 'That sign-in link expired or was not started here. Start again from Connections.' });
    if (q.error) return back(res, { oauth_error: q.error === 'access_denied' || q.error === 'user_cancelled_authorize' ? 'Sign-in was cancelled. Nothing was connected.' : `The sign-in didn't finish: ${String(q.error_description || q.error).slice(0, 200)}` });
    const p = oauth.PROVIDERS[st.provider];
    if (!p || !q.code) return back(res, { oauth_error: 'The sign-in didn\'t return a code. Try again.' });
    let v;
    try { v = await p.finish({ code: String(q.code), redirectUri, verifier: st.verifier, now: Date.now(), hint: st.siteUrl }); }
    catch (e) { return back(res, { oauth_error: e.message.slice(0, 300) }); }
    const row = { provider: st.provider, label: v.label, site_url: v.siteUrl, config: v.config || {}, secret_enc: box.seal(v.secret || {}), status: 'active', status_note: null, last_ok_at: new Date().toISOString() };
    let saved;
    if (st.connectionId) saved = await sb('PATCH', `/connections?id=eq.${st.connectionId}&provider=eq.${st.provider}`, row);
    if (!saved || !saved.ok || !(saved.data || []).length) {
      // Signing in to the same account again updates its connection rather than adding a twin.
      const scopeQ = st.intel_profile_id ? `intel_profile_id=eq.${st.intel_profile_id}` : `project_id=eq.${st.project_id}`;
      const same = await sb('GET', `/connections?${scopeQ}&provider=eq.${st.provider}&label=eq.${encodeURIComponent(v.label)}&select=id&limit=1`);
      const existing = same.ok && same.data && same.data[0];
      saved = existing ? await sb('PATCH', `/connections?id=eq.${existing.id}`, row)
        : await sb('POST', '/connections', { user_id: st.ownerId, intel_profile_id: st.intel_profile_id || null, project_id: st.project_id || null, ...row });
    }
    const conn = saved.ok && saved.data && saved.data[0];
    if (!conn) return back(res, { oauth_error: saved.status === 404 ? 'Autopilot is not installed (run supabase-autopilot.sql).' : 'The connection could not be saved.' });
    // Work and requests that were waiting for this sign-in carry on.
    let resumed = 0;
    const waiting = await sb('GET', `/agent_jobs?user_id=eq.${conn.user_id}&status=eq.waiting_permission&select=id,state&limit=50`);
    for (const j of (waiting.ok && waiting.data) || []) {
      if (j.state && j.state.waitingFor === conn.id) {
        const u = await sb('PATCH', `/agent_jobs?id=eq.${j.id}&status=eq.waiting_permission`, { status: 'queued', run_at: new Date().toISOString(), step_attempts: 0 });
        if (u.ok && (u.data || []).length) resumed++;
      }
    }
    await sb('PATCH', `/activity_events?user_id=eq.${conn.user_id}&kind=eq.needs_permission&resolved_at=is.null&action->>connectionId=eq.${conn.id}`, { resolved_at: new Date().toISOString() });
    await sb('PATCH', `/activity_events?user_id=eq.${conn.user_id}&kind=eq.needs_permission&resolved_at=is.null&action->>provider=eq.${conn.provider}`, { resolved_at: new Date().toISOString() });
    if (p.kind === 'social') {
      // Posts that were waiting for this network go back in the queue.
      const sc = conn.intel_profile_id ? `intel_profile_id=eq.${conn.intel_profile_id}` : conn.project_id ? `project_id=eq.${conn.project_id}` : `user_id=eq.${conn.user_id}`;
      await sb('PATCH', `/social_posts?${sc}&status=eq.scheduled&publish_status=in.(not_connected,failed)&platform=in.(${p.platforms.map(x => `"${x}"`).join(',')})`, { publish_status: 'queued', publish_error: null });
    }
    await activity.record(sb, { user_id: conn.user_id, intel_profile_id: conn.intel_profile_id, project_id: conn.project_id, kind: 'info', title: `${conn.label} connected`, body: resumed ? `${resumed} piece${resumed === 1 ? '' : 's'} of waiting work picked up where ${resumed === 1 ? 'it' : 'they'} stopped.` : '' });
    return back(res, { connected: conn.label });
  }

  /* ── A signed-in user starts connecting ── */
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireUser(req, res);
  if (!auth) return;
  if (rateLimited(req, res, { name: 'oauth', max: 20, windowMs: 60 * 1000, auth })) return;
  const body = req.body || {};
  if (body.action !== 'start') return res.status(400).json({ error: `Unknown action "${body.action}".` });
  const p = oauth.PROVIDERS[body.provider];
  if (!p) return res.status(400).json({ error: `Unknown account type "${body.provider}".` });
  if (!oauth.isConfigured(body.provider)) return res.status(503).json({ code: 'not_configured', error: `Connecting ${p.label} isn't set up on this Audema yet (${p.env.join(', ')} missing).` });
  if (!box.isConfigured()) return res.status(503).json({ code: 'not_configured', error: box.NOT_CONFIGURED });
  if (!redirectUri.startsWith('https://') && !/^http:\/\/localhost[:/]/.test(redirectUri)) return res.status(503).json({ error: 'APP_BASE_URL is not set, so the sign-in has nowhere safe to return to.' });

  let s;
  let connectionId = null;
  if (body.connectionId) {
    if (!isUuid(body.connectionId)) return res.status(400).json({ error: 'connectionId is not a valid id.' });
    const c = await sb('GET', `/connections?id=eq.${body.connectionId}&select=*&limit=1`);
    const row = c.ok && c.data && c.data[0];
    if (!row || row.provider !== body.provider || !(await canAccessRecord(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, auth.user.id, row, { requireEdit: true }))) return res.status(404).json({ error: 'Connection not found.' });
    s = { ownerId: row.user_id, intel_profile_id: row.intel_profile_id, project_id: row.project_id };
    connectionId = row.id;
  } else {
    s = await scope.scopeFor(auth.user.id, body);
    if (s.err) return res.status(s.err.http).json(s.err);
  }
  // For Search Console, the business's own site picks the matching property.
  let siteUrl = null;
  if (body.provider === 'gsc') {
    const f = s.intel_profile_id ? `intel_profile_id=eq.${s.intel_profile_id}` : `project_id=eq.${s.project_id}`;
    const w = await sb('GET', `/connections?${f}&provider=in.(wordpress,webflow,shopify,wix,godaddy)&status=eq.active&select=site_url&limit=1`);
    siteUrl = (w.ok && w.data && w.data[0] && w.data[0].site_url) || null;
  }
  const pk = p.pkce ? oauth.pkcePair() : {};
  const state = oauth.sealState({ provider: body.provider, ownerId: s.ownerId, intel_profile_id: s.intel_profile_id || null, project_id: s.project_id || null, connectionId, verifier: pk.verifier || null, siteUrl });
  return res.json({ ok: true, url: p.authUrl({ state, redirectUri, challenge: pk.challenge }) });
});
