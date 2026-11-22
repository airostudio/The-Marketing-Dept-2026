/**
 * api/blade-sweeps.js — start and manage Blade area sweeps (every town in a
 * county, state or country × the chosen trades), see api/_lib/blade-sweep.js.
 *
 * POST { action, ... }   Header: Authorization: Bearer <Supabase access token>
 *   estimate { root, sectors, minPopulation?, pagesPerTown? }
 *            → towns, searches needed — nothing is saved or searched
 *   create   { name?, root, sectors, minPopulation?, pagesPerTown?, maxSearches,
 *              writeToTracker?, acknowledgeFleet?, intelProfileId?, projectId? }
 *   list | get { id } | leads { id, offset? }
 *   pause | resume | cancel { id } | budget { id, maxSearches }
 *   tick { id }   → run one batch now (about a minute) instead of waiting for the cron
 *
 * Writing into the Webese state trackers (writeToTracker) is limited to
 * administrators and the accounts in WEBESE_TRACKER_USER_IDS — the trackers
 * are Webese's, not every customer's. Trackers exist per US state, so it is
 * only offered for the United States.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_PLACES_API_KEY,
 * GEONAMES_USERNAME; GOOGLE_SERVICE_ACCOUNT_JSON for tracker writes.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { requireUser, callerOwnsScope } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const sweepLib = require('./_lib/blade-sweep.js');
const tracker = require('./_lib/webese-tracker.js');
const sheets = require('./_lib/google-sheets.js');

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const code = (v) => String(v == null ? '' : v).trim().slice(0, 20).replace(/[^A-Za-z0-9.-]/g, '');
const LEVELS = ['country', 'state', 'county', 'towns'];
const MAX_SECTORS = 8;
const MAX_SEARCHES_CEILING = 50000;

function canWriteTrackers(auth) {
  const role = auth.profile && auth.profile.role;
  if (role === 'admin' || role === 'super_admin') return true;
  const allowed = String(process.env.WEBESE_TRACKER_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(auth.user.id);
}

function cleanRoot(r) {
  const root = (r && typeof r === 'object') ? r : {};
  return {
    level: LEVELS.includes(root.level) ? root.level : null,
    geonameId: Number(root.geonameId) || null,
    countryCode: code(root.countryCode).toUpperCase(), countryName: str(root.countryName, 120),
    adminCode1: code(root.adminCode1), stateName: str(root.stateName, 120),
    adminCode2: code(root.adminCode2), countyName: str(root.countyName, 120),
    towns: root.level === 'towns' && Array.isArray(root.towns) ? root.towns.slice(0, 2000) : undefined,
  };
}
function rootProblem(root) {
  if (!root.level) return 'Pick what to sweep: a country, a state, a county or some towns.';
  if (!root.countryCode || !root.countryName) return 'Pick a country.';
  if (root.level === 'country' && !root.geonameId) return 'That country could not be identified. Pick it again.';
  if ((root.level === 'state' || root.level === 'county' || root.level === 'towns') && !root.adminCode1) return 'Pick a state or region.';
  if (root.level === 'county' && !root.adminCode2) return 'Pick a county or district.';
  if (root.level === 'towns' && !(root.towns || []).length) return 'Pick at least one town.';
  return '';
}
const describeRoot = (r) => [r.level === 'towns' ? `${(r.towns || []).length} town${(r.towns || []).length === 1 ? '' : 's'}` : null, r.countyName, r.stateName, r.countryName].filter(Boolean).join(', ');

module.exports = withFailureReporting('api/blade-sweeps', async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabaseUrl = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const auth = await requireUser(req, res);
  if (!auth) return;
  if (rateLimited(req, res, { name: 'blade-sweeps', max: 30, windowMs: 60 * 1000, auth })) return;
  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);
  const body = req.body || {};
  const uid = auth.user.id;

  const tableError = (r) => r.status === 404
    ? { code: 'not_installed', error: 'Blade sweeps are not installed. Run supabase-blade-sweeps.sql in the Supabase SQL editor.' }
    : { code: 'db_error', error: `Database error (HTTP ${r.status}).` };

  async function mine(id) {
    if (!isUuid(id)) return { http: 400, err: { error: 'id is not a valid id.' } };
    const r = await sb('GET', `/blade_sweeps?id=eq.${id}&user_id=eq.${uid}&select=*&limit=1`);
    if (!r.ok) return { http: r.status === 404 ? 503 : 500, err: tableError(r) };
    if (!r.data || !r.data[0]) return { http: 404, err: { error: 'Sweep not found.' } };
    return { row: r.data[0] };
  }

  function settings() {
    const sectors = [...new Set((Array.isArray(body.sectors) ? body.sectors : String(body.sectors || '').split(','))
      .map(s => str(s, 60)).filter(Boolean))].slice(0, MAX_SECTORS);
    return {
      sectors,
      minPopulation: Math.max(0, Math.min(1000000, parseInt(body.minPopulation, 10) || 0)),
      pagesPerTown: Math.max(1, Math.min(3, parseInt(body.pagesPerTown, 10) || 1)),
    };
  }

  try {
    if (body.action === 'estimate' || body.action === 'create') {
      const root = cleanRoot(body.root);
      const problem = rootProblem(root);
      if (problem) return res.status(400).json({ error: problem, field: 'root' });
      const s = settings();
      if (!s.sectors.length) return res.status(400).json({ error: 'Which trades should Blade look for? e.g. plumbers, roofers.', field: 'sectors' });
      if (root.level !== 'towns' && !process.env.GEONAMES_USERNAME) return res.status(503).json({ error: require('./_lib/geonames.js').NOT_CONFIGURED, code: 'not_configured' });

      let plan;
      try { plan = await sweepLib.planRoot(root, { minPopulation: s.minPopulation }); }
      catch (e) { return res.status(e.status && e.status < 600 ? e.status : 502).json({ error: e.message }); }
      const tasks = plan.towns.length * s.sectors.length;
      const estimate = {
        towns: plan.towns.length, statesToExpand: plan.frontier.length, sectors: s.sectors.length, tasks,
        maxSearchesNeeded: tasks * s.pagesPerTown, truncated: plan.truncated,
        sampleTowns: plan.towns.slice(0, 12).map(t => [t.name, t.adminName2].filter(Boolean).join(', ')),
        note: plan.frontier.length ? `A country-wide sweep lists each state's towns when it reaches that state, so the total is only known as it goes. The search budget caps the cost.` : null,
      };
      if (plan.truncated) estimate.warning = 'This area has more towns than can be listed at once. Raise the minimum population, or sweep it county by county.';
      if (tasks > sweepLib.MAX_TASKS_PER_SWEEP) return res.status(422).json({ error: `That is ${tasks} town × trade searches — more than one sweep can hold (${sweepLib.MAX_TASKS_PER_SWEEP}). Narrow the area, raise the minimum population, or use fewer trades.`, estimate });
      if (body.action === 'estimate') return res.json({ ok: true, estimate });

      // ── create ──
      if (!process.env.GOOGLE_PLACES_API_KEY) return res.status(503).json({ error: 'GOOGLE_PLACES_API_KEY is not configured, so Blade cannot search.' });
      const maxSearches = parseInt(body.maxSearches, 10);
      if (!Number.isInteger(maxSearches) || maxSearches < 1 || maxSearches > MAX_SEARCHES_CEILING) return res.status(400).json({ error: `Set a search budget between 1 and ${MAX_SEARCHES_CEILING}. Every search is a paid Google Places call.`, field: 'maxSearches' });
      if (!plan.towns.length && !plan.frontier.length) return res.status(422).json({ error: 'No towns were found there with that minimum population.' });

      const intelProfileId = isUuid(body.intelProfileId) ? body.intelProfileId : null;
      const projectId = !intelProfileId && isUuid(body.projectId) ? body.projectId : null;
      if ((intelProfileId || projectId) && !(await callerOwnsScope(uid, { intelProfileId, projectId }))) return res.status(403).json({ error: 'That business profile or project is not yours.' });

      let writeToTracker = body.writeToTracker === true;
      const trackers = {};
      if (writeToTracker) {
        if (!canWriteTrackers(auth)) return res.status(403).json({ error: 'Writing to the Webese Outreach trackers is limited to Webese administrators.', code: 'tracker_not_allowed' });
        if (root.countryCode !== 'US') return res.status(422).json({ error: 'Webese Outreach trackers exist per US state, so they can only be filled from a United States sweep.' });
        if (!sheets.credentials()) return res.status(503).json({ error: sheets.NOT_CONFIGURED, code: 'sheets_not_configured' });
        // Open the state's tracker now: a missing sheet or a Fleet still at work is better known before anything is spent.
        if (root.level !== 'country') {
          try {
            const t = await tracker.openTracker(root.stateName);
            trackers[root.stateName] = t.ref;
            const fleet = tracker.fleetActivity(t.history.rows);
            if (fleet.recent && body.acknowledgeFleet !== true) {
              return res.status(409).json({ code: 'fleet_recent', error: `The ChatGPT First-Pass Fleet worked the ${root.stateName} tracker recently (${fleet.last.slice(0, 10)}). Switch it off for ${root.stateName} so Blade and the Fleet don't both move the research cursor, then confirm.`, lastFleetRun: fleet.last });
            }
          } catch (e) { return res.status(e.code ? 409 : 502).json({ error: e.message, code: e.code || 'sheets_error' }); }
        }
      }

      const made = await sb('POST', '/blade_sweeps', {
        user_id: uid, intel_profile_id: intelProfileId, project_id: projectId,
        name: str(body.name, 120) || `${s.sectors.join(', ')} — ${describeRoot(root)}`.slice(0, 120),
        root: { ...root, towns: undefined, townCount: root.level === 'towns' ? plan.towns.length : undefined },
        frontier: plan.frontier, sectors: s.sectors, min_population: s.minPopulation, pages_per_town: s.pagesPerTown,
        max_searches: maxSearches, status: 'running', write_to_tracker: writeToTracker, trackers,
        totals: { tasks: tasks },
      });
      if (!made.ok || !made.data || !made.data[0]) return res.status(made.status === 404 ? 503 : 500).json(tableError(made));
      const sweep = made.data[0];
      const rows = sweepLib.buildTasks(sweep.id, plan.towns, s.sectors, 1, { stateName: root.stateName, adminCode1: root.adminCode1, countyName: root.countyName, adminCode2: root.adminCode2 });
      for (let i = 0; i < rows.length; i += 500) {
        const ins = await sb('POST', '/blade_sweep_tasks', rows.slice(i, i + 500));
        if (!ins.ok) {
          await sb('PATCH', `/blade_sweeps?id=eq.${sweep.id}`, { status: 'failed', status_note: 'The towns could not be queued.' });
          return res.status(500).json({ error: 'The towns could not be queued. Nothing was searched.' });
        }
      }
      return res.json({ ok: true, sweep, estimate });
    }

    if (body.action === 'list') {
      const r = await sb('GET', `/blade_sweeps?user_id=eq.${uid}&select=id,name,root,sectors,status,status_note,max_searches,searches_used,totals,write_to_tracker,trackers,last_tick_at,created_at,finished_at&order=created_at.desc&limit=50`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      return res.json({ ok: true, sweeps: r.data || [], canWriteTrackers: canWriteTrackers(auth), sheetsConfigured: !!sheets.credentials(), serviceAccount: canWriteTrackers(auth) ? sheets.serviceAccountEmail() : null });
    }

    if (body.action === 'get') {
      const { row, http, err } = await mine(body.id);
      if (err) return res.status(http).json(err);
      const t = await sb('GET', `/blade_sweep_tasks?sweep_id=eq.${row.id}&select=status&limit=20000`);
      const counts = { pending: 0, done: 0, failed: 0 };
      for (const x of (t.ok ? t.data : []) || []) counts[x.status] = (counts[x.status] || 0) + 1;
      const recent = await sb('GET', `/blade_sweep_tasks?sweep_id=eq.${row.id}&status=in.(done,failed)&select=county_name,place_name,sector,status,discovered,qualified,written,error,done_at&order=done_at.desc&limit=25`);
      const next = await sb('GET', `/blade_sweep_tasks?sweep_id=eq.${row.id}&status=eq.pending&select=county_name,place_name,sector&order=seq.asc&limit=1`);
      return res.json({ ok: true, sweep: row, counts, recent: (recent.ok && recent.data) || [], next: (next.ok && next.data && next.data[0]) || null });
    }

    if (body.action === 'leads') {
      const { row, http, err } = await mine(body.id);
      if (err) return res.status(http).json(err);
      const offset = Math.max(0, parseInt(body.offset, 10) || 0);
      const qualifiedOnly = body.all === true ? '' : '&qualified=eq.true';
      const r = await sb('GET', `/blade_sweep_leads?sweep_id=eq.${row.id}${qualifiedOnly}&select=*&order=discovered_at.asc&limit=500&offset=${offset}`);
      if (!r.ok) return res.status(500).json(tableError(r));
      return res.json({ ok: true, leads: r.data || [], offset, more: (r.data || []).length === 500 });
    }

    if (['pause', 'resume', 'cancel'].includes(body.action)) {
      const { row, http, err } = await mine(body.id);
      if (err) return res.status(http).json(err);
      if (row.status === 'done' || row.status === 'cancelled') return res.status(409).json({ error: `This sweep is ${row.status}.` });
      if (body.action === 'resume' && (Number(row.searches_used) || 0) >= row.max_searches) return res.status(409).json({ error: 'It is at its search budget. Raise the budget first.' });
      const status = body.action === 'pause' ? 'paused' : body.action === 'cancel' ? 'cancelled' : 'running';
      const r = await sb('PATCH', `/blade_sweeps?id=eq.${row.id}`, { status, status_note: body.action === 'resume' ? null : `${body.action === 'pause' ? 'Paused' : 'Cancelled'} by you.`, ...(status === 'cancelled' ? { finished_at: new Date().toISOString() } : {}) });
      return res.json({ ok: r.ok, sweep: r.data && r.data[0] });
    }

    if (body.action === 'budget') {
      const { row, http, err } = await mine(body.id);
      if (err) return res.status(http).json(err);
      const maxSearches = parseInt(body.maxSearches, 10);
      const used = Number(row.searches_used) || 0;
      if (!Number.isInteger(maxSearches) || maxSearches < Math.max(1, used) || maxSearches > MAX_SEARCHES_CEILING) return res.status(400).json({ error: `The budget must be between the searches already used (${used}) and ${MAX_SEARCHES_CEILING}.` });
      const r = await sb('PATCH', `/blade_sweeps?id=eq.${row.id}`, { max_searches: maxSearches });
      return res.json({ ok: r.ok, sweep: r.data && r.data[0] });
    }

    if (body.action === 'tick') {
      const { row, http, err } = await mine(body.id);
      if (err) return res.status(http).json(err);
      if (row.status !== 'running') return res.status(409).json({ error: `This sweep is ${row.status}.` });
      if (!process.env.GOOGLE_PLACES_API_KEY) return res.status(503).json({ error: 'GOOGLE_PLACES_API_KEY is not configured.' });
      const out = await sweepLib.tick(sb, row, { placesKey: process.env.GOOGLE_PLACES_API_KEY, budgetMs: 75000 });
      if (!out.ran) return res.status(409).json({ error: 'A batch for this sweep is already running. Give it a minute.' });
      return res.json({ ok: true, ...out });
    }

    return res.status(400).json({ error: `Unknown action "${body.action}".` });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
});

module.exports.canWriteTrackers = canWriteTrackers;
