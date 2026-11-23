/**
 * Admin-editable settings and client workspaces: which key an agent gets
 * (the client's own → the platform's → Vercel), that concurrent requests never
 * see each other's, who may change what, and that values never leave the
 * server.
 *
 *   node tests/settings/run.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }
function mockModule(rel, exp) { const p = require.resolve(path.join(REPO, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const db = { app_settings: [], profiles: [], workspaces: [], admin_activity_log: [] };
let seq = 0; const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v));
function match(row, params) {
  for (const [k, v] of params) {
    if (['select', 'limit', 'order'].includes(k)) continue;
    const i = v.indexOf('.'); const op = v.slice(0, i), arg = v.slice(i + 1);
    const val = row[k];
    if (op === 'eq' && String(val) !== arg) return false;
    if (op === 'is' && arg === 'null' && val != null) return false;
    if (op === 'not' && arg === 'is.null' && val == null) return false;
  }
  return true;
}
const sbLog = [];
async function sb(method, p, body) {
  sbLog.push({ method, p });
  const [t, qs = ''] = p.slice(1).split('?');
  const rows = db[t]; if (!rows) return { ok: false, status: 404, data: null };
  const params = [...new URLSearchParams(qs)];
  if (method === 'POST') { const r = { id: uuid(), ...body, updated_at: new Date().toISOString() }; rows.push(r); return { ok: true, status: 201, data: [r] }; }
  const hit = rows.filter(r => match(r, params));
  if (method === 'PATCH') { hit.forEach(r => Object.assign(r, body)); return { ok: true, status: 200, data: hit }; }
  if (method === 'DELETE') { db[t] = rows.filter(r => !hit.includes(r)); return { ok: true, status: 204, data: null }; }
  return { ok: true, status: 200, data: hit };
}

const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001', OWNER = 'aaaaaaaa-0000-4000-8000-000000000002', MEMBER = 'aaaaaaaa-0000-4000-8000-000000000003', LONER = 'aaaaaaaa-0000-4000-8000-000000000004';
const WS = 'bbbbbbbb-0000-4000-8000-000000000001';
let caller = null;
const roleOf = { [ADMIN]: 'super_admin' };
mockModule('api/_lib/supabase-rest.js', { sbRest: async (u, k, m, p, b) => sb(m, p, b), isUuid });
mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
mockModule('api/_lib/require-user.js', { requireUser: async (req, res) => (caller ? { userId: caller, profile: { role: roleOf[caller] || 'user' }, email: 'x@example.com' } : (res.status(401).json({ error: 'Sign in' }), null)) });
mockModule('api/_lib/audit-log.js', { recordAdminAction: async (o) => { db.admin_activity_log.push(o); return true; }, ACTIONS: {} });
function mkRes() { return { statusCode: 200, headers: {}, body: null, headersSent: false, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; this.headersSent = true; return this; }, end() { return this; } }; }

(async () => {
  Object.assign(process.env, { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'svc', CONNECTIONS_ENCRYPTION_KEY: 'k'.repeat(48), ANTHROPIC_API_KEY: 'env-anthropic', RESEND_FROM_EMAIL: 'env@example.com' });
  delete process.env.VERCEL; delete process.env.APP_SETTINGS_DB;
  const settings = require(path.join(REPO, 'api/_lib/settings.js'));
  const box = require(path.join(REPO, 'api/_lib/secret-box.js'));
  db.workspaces.push({ id: WS, name: 'Bright Agency', owner_id: OWNER });
  db.profiles.push({ id: ADMIN, workspace_id: null, workspace_role: 'member' }, { id: OWNER, workspace_id: WS, workspace_role: 'owner' }, { id: MEMBER, workspace_id: WS, workspace_role: 'member' }, { id: LONER, workspace_id: null, workspace_role: 'member' });
  const put = (scope, key, value, workspace_id = null) => db.app_settings.push({ id: uuid(), scope, workspace_id, key, value_enc: box.seal(value), hint: '…' + value.slice(-4) });
  put('platform', 'ANTHROPIC_API_KEY', 'platform-anthropic');
  put('platform', 'RESEND_API_KEY', 'platform-resend');
  put('workspace', 'ANTHROPIC_API_KEY', 'bright-anthropic', WS);
  put('workspace', 'FAILURE_ALERT_EMAILS', 'sneaky@bright.example', WS);
  put('platform', 'SUPABASE_URL', 'https://evil.example');

  console.log('\n──── off (not on Vercel): a pass-through ────');
  check('outside Vercel and without APP_SETTINGS_DB, nothing is looked up', (await settings.runAs(OWNER, async () => process.env.ANTHROPIC_API_KEY)) === 'env-anthropic' && !sbLog.length);

  console.log('\n──── which key an agent gets ────');
  process.env.APP_SETTINGS_DB = 'on';
  check('a client\'s own key wins', (await settings.runAs(MEMBER, async () => process.env.ANTHROPIC_API_KEY)) === 'bright-anthropic');
  check('…falling back to the platform\'s for what it hasn\'t set', (await settings.runAs(MEMBER, async () => process.env.RESEND_API_KEY)) === 'platform-resend');
  check('…and to Vercel for what neither has set', (await settings.runAs(MEMBER, async () => process.env.RESEND_FROM_EMAIL)) === 'env@example.com');
  check('someone in no client gets the platform\'s', (await settings.runAs(LONER, async () => process.env.ANTHROPIC_API_KEY)) === 'platform-anthropic');
  check('outside any request or job: Vercel only', process.env.ANTHROPIC_API_KEY === 'env-anthropic');
  check('infrastructure keys can never be overridden from the database', (await settings.runAs(MEMBER, async () => process.env.SUPABASE_URL)) === 'https://db.example');
  check('a client can\'t override a platform-only setting', (await settings.runAs(MEMBER, async () => process.env.FAILURE_ALERT_EMAILS)) !== 'sneaky@bright.example');
  delete process.env.RESEND_API_KEY;
  check('`in` sees a key that only the database has', (await settings.runAs(MEMBER, async () => 'RESEND_API_KEY' in process.env)) === true && !('RESEND_API_KEY' in process.env));
  const both = await Promise.all([
    settings.runAs(MEMBER, async () => { await new Promise(r => setTimeout(r, 20)); return process.env.ANTHROPIC_API_KEY; }),
    settings.runAs(LONER, async () => { await new Promise(r => setTimeout(r, 5)); return process.env.ANTHROPIC_API_KEY; }),
  ]);
  check('two requests at the same time never see each other\'s keys', both[0] === 'bright-anthropic' && both[1] === 'platform-anthropic');
  const attached = await settings.runAs(null, async () => { const before = process.env.ANTHROPIC_API_KEY; await settings.attachUser(OWNER); return [before, process.env.ANTHROPIC_API_KEY]; });
  check('a public page can switch to its owner\'s client once it knows who that is', attached[0] === 'platform-anthropic' && attached[1] === 'bright-anthropic');
  const n0 = sbLog.length;
  await settings.runAs(MEMBER, async () => process.env.ANTHROPIC_API_KEY);
  check('settings are cached briefly (no database read per request)', sbLog.length === n0);
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';

  console.log('\n──── every API request runs as its caller\'s client ────');
  const { withFailureReporting } = require(path.join(REPO, 'api/_lib/report-failure.js'));
  const realFetch = global.fetch;
  global.fetch = async (url, init) => ({ ok: init.headers.Authorization === 'Bearer member-token-0123456789abc', json: async () => ({ id: MEMBER }) });
  const h = withFailureReporting('test', async (req, res) => res.json({ key: process.env.ANTHROPIC_API_KEY }));
  let res = mkRes(); await h({ method: 'POST', headers: { authorization: 'Bearer member-token-0123456789abc' }, body: {} }, res);
  check('a signed-in member\'s request uses their client\'s key', res.body.key === 'bright-anthropic');
  res = mkRes(); await h({ method: 'POST', headers: { authorization: 'Bearer forged-token-0123456789abc' }, body: {} }, res);
  check('a token Supabase doesn\'t accept gets platform settings only (a forged token can\'t borrow a client\'s keys)', res.body.key === 'platform-anthropic');
  res = mkRes(); await h({ method: 'GET', headers: {}, body: {} }, res);
  check('no sign-in: platform settings', res.body.key === 'platform-anthropic');
  global.fetch = realFetch;
  const oauth = require(path.join(REPO, 'api/_lib/oauth.js'));
  delete process.env.X_CLIENT_ID; delete process.env.X_CLIENT_SECRET;
  put('workspace', 'X_CLIENT_ID', 'bright-x', WS); put('workspace', 'X_CLIENT_SECRET', 'bright-x-secret', WS);
  settings.invalidate();
  check('a client\'s own sign-in app is used for its businesses (and only theirs)', (await settings.runAs(MEMBER, async () => oauth.isConfigured('x'))) === true && (await settings.runAs(LONER, async () => oauth.isConfigured('x'))) === false);

  console.log('\n──── the admin API ────');
  const api = require(path.join(REPO, 'api/admin-settings.js'));
  const call = async (who, body) => { caller = who; const r = mkRes(); await api({ method: 'POST', headers: {}, body }, r); return r; };
  let r = await call(MEMBER, { action: 'get' });
  check('a non-admin can\'t see the platform settings', r.statusCode === 403);
  r = await call(ADMIN, { action: 'get' });
  const anth = r.body.items.find(i => i.key === 'ANTHROPIC_API_KEY');
  check('an admin sees every setting, where it comes from, and only the last four characters', r.statusCode === 200 && anth.source === 'platform' && anth.hint === '…opic' && !JSON.stringify(r.body).includes('platform-anthropic') && r.body.items.some(i => i.key === 'LINKEDIN_CLIENT_SECRET'));
  check('infrastructure keys aren\'t offered at all', !r.body.items.some(i => /SUPABASE|CRON_SECRET|CONNECTIONS_ENCRYPTION_KEY|STRIPE/.test(i.key)));
  r = await call(ADMIN, { action: 'set', key: 'PERPLEXITY_API_KEY', value: 'pplx-1234567890abcd' });
  const stored = db.app_settings.find(x => x.key === 'PERPLEXITY_API_KEY');
  check('saving stores it encrypted, with a hint, and never echoes it', r.statusCode === 200 && stored.scope === 'platform' && !stored.value_enc.includes('pplx') && box.open(stored.value_enc) === 'pplx-1234567890abcd' && stored.hint === '…abcd' && !JSON.stringify(r.body).includes('pplx-1234567890abcd'));
  check('…and it\'s recorded in the admin activity log', db.admin_activity_log.some(a => a.action === 'setting_changed' && a.details.key === 'PERPLEXITY_API_KEY'));
  r = await call(ADMIN, { action: 'set', key: 'SUPABASE_SERVICE_ROLE_KEY', value: 'x' });
  check('a key outside the list can\'t be saved', r.statusCode === 400);
  r = await call(ADMIN, { action: 'set', key: 'GOOGLE_SERVICE_ACCOUNT_JSON', value: '{not json' });
  check('a service account that isn\'t JSON is refused', r.statusCode === 400);
  r = await call(ADMIN, { action: 'set', key: 'R2_PUBLIC_BASE_URL', value: 'http://insecure.example' });
  check('addresses must be https', r.statusCode === 400);
  r = await call(ADMIN, { action: 'set', key: 'PERPLEXITY_API_KEY', value: '' });
  check('clearing removes it (falls back to the next source)', r.statusCode === 200 && !db.app_settings.some(x => x.key === 'PERPLEXITY_API_KEY'));

  r = await call(OWNER, { action: 'get', workspaceId: WS });
  const ownA = r.body.items.find(i => i.key === 'ANTHROPIC_API_KEY'), platR = r.body.items.find(i => i.key === 'RESEND_API_KEY');
  check('a client owner sees their own settings; platform secrets show as "platform default" without even a hint', r.statusCode === 200 && ownA.source === 'workspace' && ownA.own && platR.source === 'platform' && platR.hint === null && !r.body.items.some(i => i.platformOnly));
  r = await call(OWNER, { action: 'set', workspaceId: WS, key: 'RESEND_FROM_EMAIL', value: 'hello@bright.example' });
  check('…and can set their own', r.statusCode === 200 && db.app_settings.some(x => x.scope === 'workspace' && x.workspace_id === WS && x.key === 'RESEND_FROM_EMAIL'));
  r = await call(OWNER, { action: 'set', workspaceId: WS, key: 'FAILURE_ALERT_EMAILS', value: 'x@y.z' });
  check('…but not a platform-only one', r.statusCode === 400);
  r = await call(OWNER, { action: 'set', key: 'ANTHROPIC_API_KEY', value: 'hijack' });
  check('…and never the platform defaults', r.statusCode === 403 && box.open(db.app_settings.find(x => x.scope === 'platform' && x.key === 'ANTHROPIC_API_KEY').value_enc) === 'platform-anthropic');
  r = await call(MEMBER, { action: 'set', workspaceId: WS, key: 'ANTHROPIC_API_KEY', value: 'x' });
  check('a member (not the owner) can\'t change the client\'s settings', r.statusCode === 403);
  r = await call(OWNER, { action: 'get', workspaceId: 'bbbbbbbb-0000-4000-8000-000000000099' });
  check('an owner can\'t open another client\'s settings', r.statusCode === 403);
  check('saved changes take effect straight away on this server', (await settings.runAs(MEMBER, async () => process.env.RESEND_FROM_EMAIL)) === 'hello@bright.example');

  r = await call(OWNER, { action: 'workspaces' });
  check('only platform admins manage clients', r.statusCode === 403);
  r = await call(ADMIN, { action: 'createWorkspace', name: 'Coastal Co', ownerId: LONER });
  const coastal = db.workspaces.find(w => w.name === 'Coastal Co');
  check('an admin adds a client with an owner', r.statusCode === 200 && coastal && db.profiles.find(p => p.id === LONER).workspace_id === coastal.id && db.profiles.find(p => p.id === LONER).workspace_role === 'owner');
  r = await call(ADMIN, { action: 'workspaces' });
  check('the client list shows users and own settings per client', r.body.workspaces.find(w => w.id === WS).members === 2 && r.body.workspaces.find(w => w.id === WS).ownSettings >= 3);
  r = await call(ADMIN, { action: 'assign', userId: MEMBER, workspaceId: coastal.id, role: 'member' });
  check('moving a user to another client changes which keys they get', r.statusCode === 200 && (await settings.runAs(MEMBER, async () => process.env.ANTHROPIC_API_KEY)) === 'platform-anthropic');
  r = await call(ADMIN, { action: 'deleteWorkspace', workspaceId: WS });
  check('deleting a client keeps its users (on platform settings)', r.statusCode === 200 && db.profiles.find(p => p.id === OWNER).workspace_id === null && !db.workspaces.some(w => w.id === WS));
  r = await call(OWNER, { action: 'me' });
  check('"me" says whether someone manages a client', r.statusCode === 200 && r.body.workspace === null && r.body.isPlatformAdmin === false);

  console.log('\n──── wiring and pages ────');
  check('autopilot jobs run as their owner\'s client', /settings\.runAs\(job\.user_id/.test(read('api/_lib/autopilot/runner.js')));
  check('scheduled posts, email flows, sweeps, competitor watch, scorecards and sign-ins use the owner\'s client', ['api/cron-auto-publish.js', 'api/cron-email-flows.js', 'api/cron-blade-sweeps.js', 'api/scorecard-public.js', 'api/oauth.js'].every(f => /settings\.attachUser\(/.test(read(f))) && /settings\.runAs\(w\.user_id/.test(read('api/cron-competitor-watch.js')));
  const sql = read('supabase-workspaces.sql');
  check('the tables have row-level security on and no browser policies', /ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY/.test(sql) && /ALTER TABLE workspaces\s+ENABLE ROW LEVEL SECURITY/.test(sql) && !/CREATE POLICY/i.test(sql) && read('supabase-install-all.sql').includes('CREATE TABLE IF NOT EXISTS app_settings'));
  const page = read('web/admin/settings.html'), editor = read('web/js/settings-editor.js'), users = read('web/admin/users.html');
  check('admin Settings page: admin-only gate, clients, and the shared editor', /profile\.role !== 'admin'/.test(page) && page.includes('/js/settings-editor.js') && page.includes("action: 'createWorkspace'"));
  check('the editor never puts a secret into the page (password fields, hints only), and escapes everything', /type="\$\{it\.secret \? 'password' : 'text'\}"/.test(editor) && /value="\$\{it\.own && !it\.secret \? esc\(it\.hint/.test(editor) && !/\$\{it\.(label|help|key|group)\}/.test(editor));
  check('Users page: assign each user to a client and role', users.includes('id="edit-workspace"') && users.includes("action: 'assign'") && users.includes('id="client-filter"'));
  check('client owners have their own settings page; the existing Settings page is untouched', read('web/client-settings.html').includes("workspaceRole === 'owner'") && read('web/settings.html').includes('settings-nav-item'));
  check('every admin page links to Settings', ['activity', 'dashboard', 'failures', 'grants', 'sales-intel', 'support', 'users'].every(f => read(`web/admin/${f}.html`).includes('href="/admin/settings.html"')));

  console.log(`\n${failures ? `${failures} FAILED` : 'All passed'}`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
