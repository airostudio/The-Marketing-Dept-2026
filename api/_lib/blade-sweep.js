/**
 * api/_lib/blade-sweep.js — Blade's area sweep: search every town in a
 * county, state or country for each chosen trade, check each business's
 * website, keep the genuine opportunities, and (for Webese) write them into
 * the state's Outreach Tracker.
 *
 * The work is a queue of (town × trade) tasks in blade_sweep_tasks, worked
 * through a batch at a time by tick() — from the cron (api/cron-blade-sweeps.js)
 * or "run a batch now" — so a sweep of thousands of towns survives closed
 * tabs and function time limits. Each task is one or more paid Google Places
 * searches; a sweep stops itself at the search budget the person set.
 *
 * What counts as an opportunity is exactly what Blade already uses
 * (api/_lib/lead-scoring.js): no website, a template builder, or an outdated
 * site. Nothing is guessed: a business with an unreachable site is counted as
 * rejected, not written up as "no website".
 */

'use strict';

const { searchPlaces } = require('./places-search.js');
const { quickCheckWebsite } = require('./website-quickcheck.js');
const { opportunityRank, personalizedNote } = require('./lead-scoring.js');
const geonames = require('./geonames.js');
const tracker = require('./webese-tracker.js');
const { runWithConcurrency } = require('./blade-pipeline.js');

const QUALIFYING_MAX_RANK = 2;
const TOWN_RADIUS_M = 12000;          // bias each search around the town
const KEEP_WITHIN_KM = 20;            // and drop results clearly elsewhere
const SITE_CHECK_CONCURRENCY = 8;
const TASKS_PER_FETCH = 8;
const MAX_ATTEMPTS = 3;
const TASK_RESERVE_MS = 40000;        // never start a task with less time left than this
const MAX_TASKS_PER_SWEEP = 20000;

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

function km(a, b) {
  if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return null;
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Tasks for a set of towns: county by county (alphabetical), largest town first, every trade. */
function buildTasks(sweepId, towns, sectors, seqStart, where) {
  const sorted = towns.slice().sort((a, b) => (a.adminName2 || '').localeCompare(b.adminName2 || '') || (b.population - a.population) || a.name.localeCompare(b.name));
  const rows = []; let seq = seqStart;
  for (const t of sorted) for (const sector of sectors) {
    rows.push({
      sweep_id: sweepId, seq: seq++, state_name: t.adminName1 || where.stateName || null, state_code: t.adminCode1 || where.adminCode1 || null,
      county_name: t.adminName2 || where.countyName || null, county_code: t.adminCode2 || where.adminCode2 || null,
      place_name: t.name, place_geoname_id: t.geonameId || null, lat: t.lat, lng: t.lng, population: t.population || 0,
      sector, status: 'pending',
    });
  }
  return rows;
}

/**
 * Work out the towns for what was picked.
 * @returns {Promise<{towns: Array, frontier: Array, truncated: boolean}>}
 */
async function planRoot(root, { minPopulation = 0 } = {}, deps = {}) {
  const geo = deps.geo || geonames;
  if (root.level === 'towns') {
    const towns = (Array.isArray(root.towns) ? root.towns : []).slice(0, 2000).map(t => ({
      geonameId: Number(t.geonameId) || null, name: str(t.name, 120), adminCode1: str(t.adminCode1 || root.adminCode1, 20), adminName1: str(t.adminName1 || root.stateName, 120),
      adminCode2: str(t.adminCode2 || root.adminCode2, 20), adminName2: str(t.adminName2 || root.countyName, 120),
      population: Number(t.population) || 0, lat: Number.isFinite(Number(t.lat)) ? Number(t.lat) : null, lng: Number.isFinite(Number(t.lng)) ? Number(t.lng) : null,
    })).filter(t => t.name);
    return { towns, frontier: [], truncated: false };
  }
  if (root.level === 'county' || root.level === 'state') {
    const r = await geo.towns({ countryCode: root.countryCode, adminCode1: root.adminCode1, adminCode2: root.level === 'county' ? root.adminCode2 : undefined, minPopulation });
    return { towns: r.towns, frontier: [], truncated: r.truncated };
  }
  if (root.level === 'country') {
    const states = await geo.children(root.geonameId, 'state');
    return { towns: [], frontier: states.map(s => ({ adminCode1: s.adminCode1, stateName: s.name })), truncated: false };
  }
  throw new Error('Pick a country, state, county or towns to sweep.');
}

/** Search one town for one trade and audit what comes back. */
async function runTask(task, sweep, deps) {
  const search = deps.search || searchPlaces;
  const check = deps.quickCheck || quickCheckWebsite;
  const root = sweep.root || {};
  const textQuery = `${task.sector} in ${task.place_name}${task.state_name ? ', ' + task.state_name : ''}${root.countryName ? ', ' + root.countryName : ''}`;
  const candidates = []; const seen = new Set();
  let pageToken = null, searches = 0;
  const center = { lat: task.lat, lng: task.lng };
  for (let p = 0; p < sweep.pages_per_town; p++) {
    if (sweep.searches_used + searches >= sweep.max_searches) break;
    const page = await search(deps.placesKey, pageToken ? { pageToken } : { textQuery, locationBias: { lat: task.lat, lng: task.lng, radiusM: TOWN_RADIUS_M } });
    searches++;
    for (const place of page.results) {
      if (!place.placeId || !place.name || seen.has(place.placeId) || place.businessStatus === 'CLOSED_PERMANENTLY') continue;
      const d = km(center, place);
      if (d != null && d > KEEP_WITHIN_KM) continue;     // a business in another town is that town's
      seen.add(place.placeId); candidates.push(place);
    }
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  const audited = await runWithConcurrency(candidates, SITE_CHECK_CONCURRENCY, async (place) => {
    let siteStatus = 'no_website', sitePlatform = null, siteReasons = [];
    if (place.website) {
      try { const c = await check(place.website); siteStatus = c.status; sitePlatform = (c.signals && c.signals.platform) || null; siteReasons = c.reasons || []; }
      catch { siteStatus = 'check_failed'; }
    }
    const rank = opportunityRank({ siteStatus, sitePlatform });
    return { ...place, siteStatus, sitePlatform, siteReasons, rank, note: personalizedNote({ siteStatus, sitePlatform, siteReasons }) };
  });
  return { searches, audited, query: textQuery };
}

/**
 * One batch of a sweep. Claims the sweep's lock, works tasks until the time
 * budget or the search budget runs out, and records everything.
 * @param {Function} sb  (method, path, body) => {ok, status, data}
 * @param {object} sweepRow
 * @param {{budgetMs?:number, now?:Function, placesKey:string, search?, quickCheck?, geo?, trackerLib?, sheets?}} deps
 */
async function tick(sb, sweepRow, deps) {
  const now = deps.now || Date.now;
  const started = now();
  const budget = deps.budgetMs || 100000;
  const lockUntil = new Date(started + budget + 30000).toISOString();
  const nowIso = new Date(started).toISOString();
  // Only one batch per sweep at a time.
  const claim = await sb('PATCH', `/blade_sweeps?id=eq.${sweepRow.id}&status=eq.running&or=(lock_until.is.null,lock_until.lt.${encodeURIComponent(nowIso)})`, { lock_until: lockUntil });
  if (!claim.ok || !Array.isArray(claim.data) || !claim.data.length) return { ran: false, reason: 'busy_or_not_running' };
  let sweep = claim.data[0];
  sweep.searches_used = Number(sweep.searches_used) || 0;
  const tlib = deps.trackerLib || tracker;
  const totals = { searched: 0, discovered: 0, audited: 0, qualified: 0, written: 0, duplicates: 0, failedTasks: 0, ...(sweep.totals || {}) };
  const trackers = {};          // state → opened tracker, this batch only
  const trackerRefs = { ...(sweep.trackers || {}) };
  let tasksDone = 0, stopReason = null, statusNote = null, newStatus = 'running';
  const out = { ran: true, tasksDone: 0, written: 0 };

  const save = async (patch) => {
    const r = await sb('PATCH', `/blade_sweeps?id=eq.${sweep.id}`, patch);
    if (r.ok && r.data && r.data[0]) { sweep = r.data[0]; sweep.searches_used = Number(sweep.searches_used) || 0; }
  };

  try {
    while (now() - started < budget - TASK_RESERVE_MS) {
      if (sweep.searches_used >= sweep.max_searches) { newStatus = 'paused'; statusNote = `Stopped at the search budget (${sweep.max_searches} searches). Raise it to carry on.`; break; }

      let next = await sb('GET', `/blade_sweep_tasks?sweep_id=eq.${sweep.id}&status=eq.pending&order=seq.asc&limit=${TASKS_PER_FETCH}&select=*`);
      if (!next.ok) throw new Error(`Could not read the sweep's tasks (HTTP ${next.status}).`);
      if (!(next.data || []).length) {
        // Country sweeps expand one state at a time.
        const frontier = Array.isArray(sweep.frontier) ? sweep.frontier.slice() : [];
        if (!frontier.length) { newStatus = 'done'; statusNote = 'Every town has been searched.'; break; }
        const st = frontier.shift();
        const geo = deps.geo || geonames;
        const r = await geo.towns({ countryCode: sweep.root.countryCode, adminCode1: st.adminCode1, minPopulation: sweep.min_population });
        const last = await sb('GET', `/blade_sweep_tasks?sweep_id=eq.${sweep.id}&order=seq.desc&limit=1&select=seq`);
        const seq0 = ((last.ok && last.data && last.data[0] && last.data[0].seq) || 0) + 1;
        const rows = buildTasks(sweep.id, r.towns, sweep.sectors, seq0, { stateName: st.stateName, adminCode1: st.adminCode1 });
        if (rows.length) { const ins = await sb('POST', '/blade_sweep_tasks', rows); if (!ins.ok) throw new Error(`Could not queue ${st.stateName}'s towns (HTTP ${ins.status}).`); }
        await save({ frontier });
        continue;
      }

      for (const task of next.data) {
        if (now() - started >= budget - TASK_RESERVE_MS) break;
        if (sweep.searches_used >= sweep.max_searches) break;
        let result;
        try {
          result = await runTask(task, sweep, deps);
        } catch (e) {
          // Quota and outages leave the task to try again; a task that keeps failing is set aside.
          const attempts = (task.attempts || 0) + 1;
          await sb('PATCH', `/blade_sweep_tasks?id=eq.${task.id}`, attempts >= MAX_ATTEMPTS
            ? { status: 'failed', attempts, error: str(e.message, 300), done_at: new Date(now()).toISOString() }
            : { attempts, error: str(e.message, 300) });
          if (attempts >= MAX_ATTEMPTS) totals.failedTasks++;
          if (e.status === 429 || e.status === 403 || /quota|billing|API key/i.test(e.message)) { stopReason = `Google Places refused the search: ${str(e.message, 200)}`; break; }
          continue;
        }

        // Already found by an earlier town or sweep? It is not a new business.
        const ids = result.audited.map(a => a.placeId);
        let known = new Set();
        if (ids.length) {
          const k = await sb('GET', `/blade_sweep_leads?user_id=eq.${sweep.user_id}&place_id=in.(${ids.map(encodeURIComponent).join(',')})&select=place_id`);
          if (k.ok) known = new Set((k.data || []).map(x => x.place_id));
        }
        const fresh = result.audited.filter(a => !known.has(a.placeId));
        const qualified = fresh.filter(a => a.rank <= QUALIFYING_MAX_RANK);
        const where = { state: task.state_name || '', county: task.county_name || '', place: task.place_name, category: task.sector };
        const today = new Date(now()).toISOString().slice(0, 10);

        // Into the state's tracker (Webese), business columns only.
        let written = 0, duplicates = 0;
        const statusById = {};
        if (sweep.write_to_tracker && qualified.length && task.state_name) {
          try {
            if (!trackers[task.state_name]) {
              trackers[task.state_name] = await tlib.openTracker(task.state_name, { sheets: deps.sheets });
              trackerRefs[task.state_name] = trackers[task.state_name].ref;
            }
            const t = trackers[task.state_name];
            const life = String(Object.entries(t.campaign.fields).find(([k]) => /^lifecycle state$/i.test(k))?.[1] || '').toUpperCase();
            const before = t.prospects.length;
            const r = await tlib.writeBatch(t, qualified.map(lead => ({ lead, where })), {
              county: task.county_name, place: task.place_name, area: `${task.place_name}${task.county_name ? ', ' + task.county_name : ''}`,
              startCursor: `${task.county_name || ''}|${task.place_name}`,
              summary: `Blade: ${task.sector} in ${task.place_name}${task.county_name ? ', ' + task.county_name : ''}`,
              lifecycle: !life || life.replace(/[^A-Z]/g, '') === 'NOTSTARTED' ? 'ACTIVE_FIRST_PASS' : null,
              stats: { discovered: result.audited.length, audited: fresh.length, rejected: fresh.length - qualified.length, qualified: qualified.length },
            }, { sheets: deps.sheets, now: now() });
            written = r.written; duplicates = r.duplicates;
            const added = new Set(t.prospects.slice(before).map(v => v['Business Name']));
            qualified.forEach(q => { statusById[q.placeId] = added.has(q.name) ? 'written' : 'duplicate'; });
          } catch (e) {
            // The leads are still kept in Audema; the sweep pauses so a person can fix the sheet.
            newStatus = 'paused'; statusNote = `Could not write to the ${task.state_name} tracker: ${str(e.message, 300)}`;
            stopReason = statusNote;
          }
        }

        if (fresh.length) {
          const rows = fresh.map(a => {
            const v = tracker.rowValues(a, where, today);
            return {
              sweep_id: sweep.id, user_id: sweep.user_id, place_id: a.placeId, business_name: str(a.name, 200), sector: task.sector,
              state_name: task.state_name, county_name: task.county_name, place_name: task.place_name, address: str(a.address, 300),
              phone: str(a.phone, 40), website: str(a.website, 500), maps_url: str(a.mapsUrl, 500), review_count: a.reviewCount ?? null,
              site_status: a.siteStatus, site_platform: a.sitePlatform, qualified: a.rank <= QUALIFYING_MAX_RANK,
              offer_type: a.rank <= QUALIFYING_MAX_RANK ? v['Offer Type'] : null, opportunity_score: a.rank <= QUALIFYING_MAX_RANK ? Number(v['Opportunity Score']) : null,
              observation: str(v['Website Observation'], 300), tracker_status: statusById[a.placeId] || null,
            };
          });
          await sb('POST', '/blade_sweep_leads', rows);
        }

        await sb('PATCH', `/blade_sweep_tasks?id=eq.${task.id}`, {
          status: 'done', searches: result.searches, discovered: result.audited.length, qualified: qualified.length, written,
          attempts: (task.attempts || 0) + 1, error: null, done_at: new Date(now()).toISOString(),
        });
        Object.assign(totals, {
          searched: totals.searched + result.searches, discovered: totals.discovered + result.audited.length, audited: totals.audited + fresh.length,
          qualified: totals.qualified + qualified.length, written: totals.written + written, duplicates: totals.duplicates + duplicates,
        });
        await save({ searches_used: sweep.searches_used + result.searches, totals, trackers: trackerRefs });
        tasksDone++; out.written += written;
        if (stopReason) break;
      }
      if (stopReason) break;
    }
  } catch (e) {
    statusNote = `This batch stopped: ${str(e.message, 300)}. It will try again.`;
  }

  if (stopReason && newStatus === 'running') { newStatus = 'paused'; statusNote = stopReason; }
  const patch = { lock_until: null, last_tick_at: new Date(now()).toISOString(), totals, trackers: trackerRefs };
  if (newStatus !== 'running') { patch.status = newStatus; patch.status_note = statusNote; if (newStatus === 'done') patch.finished_at = new Date(now()).toISOString(); }
  else if (statusNote) patch.status_note = statusNote;
  await save(patch);
  out.tasksDone = tasksDone; out.status = newStatus; out.note = statusNote;
  return out;
}

module.exports = { planRoot, buildTasks, runTask, tick, km, QUALIFYING_MAX_RANK, KEEP_WITHIN_KM, MAX_TASKS_PER_SWEEP };
