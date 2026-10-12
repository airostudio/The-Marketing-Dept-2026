/**
 * api/scorecards.js — build, publish and read results for scorecards and
 * waitlists (the business owner's side; visitors use api/scorecard-public.js).
 *
 * POST { action, ... }  Header: Authorization: Bearer <the caller's Supabase access token>
 *   list                                  → the caller's scorecards with response counts
 *   get      { id }                       → definition + what would stop it publishing
 *   draft    { kind, topic, audience?, businessName, businessContext?, language? }
 *                                         → a Claude-drafted definition to edit (not saved)
 *   save     { id?, definition, slug?, intelProfileId?, projectId? }
 *                                         → creates or updates; the slug is fixed once published
 *   publish  { id }                       → goes live at /s/<slug>; makes the segments
 *                                           flows follow up with (one per scorecard, one per result)
 *   close    { id } / reopen { id }       → stop / resume taking answers
 *   delete   { id }                       → drafts only; a published one is closed instead
 *   results  { id }                       → totals and answer breakdowns (counts, nothing estimated)
 *   compare  { group }                    → waitlists in one comparison group, side by side
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. ANTHROPIC_API_KEY for draft.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord, accessibleProfileIds, ownedOrSharedFilter } = require('./_lib/profile-access.js');
const sc = require('./_lib/scorecard.js');
const { draftScorecard } = require('./_lib/scorecard-draft.js');
const writingLanguage = require('./_lib/writing-language.js');

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const MAX_RESPONSES_READ = 5000;

function tableError(r) {
  return r.status === 404
    ? { code: 'not_installed', error: 'Scorecards are not installed. Run supabase-scorecards.sql in the Supabase SQL editor.' }
    : { code: 'db_error', error: `Database error (HTTP ${r.status}).` };
}

function summary(row, counts) {
  const c = counts || {};
  return {
    id: row.id, slug: row.slug, kind: row.kind, status: row.status, title: row.title, group: row.comparison_group || null,
    publishedAt: row.published_at, createdAt: row.created_at, updatedAt: row.updated_at,
    responses: c.responses || 0, consented: c.consented || 0,
  };
}

module.exports = withFailureReporting('api/scorecards', async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization header.' });
  const caller = await getCallerFromToken(supabaseUrl, serviceKey, accessToken);
  if (!caller?.id) return res.status(401).json({ error: 'Invalid or expired session.' });

  const body = req.body || {};
  // Drafting is a paid model call; everything else is a database read or write.
  if (rateLimited(req, res, body.action === 'draft'
    ? { name: 'scorecards-draft', max: 5, windowMs: 60 * 1000, auth: { userId: caller.id } }
    : { name: 'scorecards', max: 60, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);

  async function loadCard(id, requireEdit) {
    if (!isUuid(id)) return { http: 400, err: { error: 'id is not a valid id.' } };
    const r = await sb('GET', `/scorecards?id=eq.${id}&select=*&limit=1`);
    if (!r.ok) return { http: r.status === 404 ? 503 : 500, err: tableError(r) };
    const row = r.data && r.data[0];
    if (!row || !(await canAccessRecord(supabaseUrl, serviceKey, caller.id, row, { requireEdit }))) return { http: 404, err: { error: 'Scorecard not found.' } };
    return { row };
  }

  async function readResponses(cardId) {
    const r = await sb('GET', `/scorecard_responses?scorecard_id=eq.${cardId}&select=email,first_name,answers,percent,band_key,source,campaign,consented,position,created_at&order=created_at.desc&limit=${MAX_RESPONSES_READ}`);
    return r.ok ? (r.data || []) : null;
  }

  try {
    if (body.action === 'list') {
      const ids = await accessibleProfileIds(supabaseUrl, serviceKey, caller.id);
      const r = await sb('GET', `/scorecards?${ownedOrSharedFilter(caller.id, ids)}&select=*&order=created_at.desc&limit=200`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      const rows = r.data || [];
      const counts = {};
      if (rows.length) {
        const cr = await sb('GET', `/scorecard_responses?scorecard_id=in.(${rows.map(x => x.id).join(',')})&select=scorecard_id,consented&limit=50000`);
        for (const x of (cr.ok ? cr.data : []) || []) {
          const c = counts[x.scorecard_id] || (counts[x.scorecard_id] = { responses: 0, consented: 0 });
          c.responses++; if (x.consented) c.consented++;
        }
      }
      return res.json({ ok: true, scorecards: rows.map(x => summary(x, counts[x.id])) });
    }

    if (body.action === 'get') {
      const { row, http, err } = await loadCard(body.id, false);
      if (err) return res.status(http).json(err);
      const { def, problems } = sc.normalize(row.definition);
      return res.json({ ok: true, scorecard: { ...summary(row), definition: def, problems } });
    }

    if (body.action === 'draft') {
      if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured, so Scotty cannot draft this.' });
      const kind = sc.KINDS.includes(body.kind) ? body.kind : 'scorecard';
      const topic = str(body.topic, 400);
      const businessName = str(body.businessName, 120);
      if (!topic) return res.status(400).json({ error: kind === 'waitlist' ? 'Describe the idea people are joining the waitlist for.' : 'What should the scorecard assess? e.g. "How well is your website winning customers?"', field: 'topic' });
      if (!businessName) return res.status(400).json({ error: 'Add the business name in your Business Brain first — visitors need to know who is asking.', field: 'businessName' });
      try {
        const d = await draftScorecard({
          kind, topic, audience: str(body.audience, 300), businessName,
          businessContext: String(body.businessContext || '').slice(0, 12000),
          language: writingLanguage.isSupported(body.language) ? body.language : '',
        });
        return res.json({ ok: true, ...d });
      } catch (e) {
        return res.status(502).json({ error: `Scotty could not draft it: ${e.message}` });
      }
    }

    if (body.action === 'save') {
      const { def, problems } = sc.normalize(body.definition);
      if (body.id) {
        const { row, http, err } = await loadCard(body.id, true);
        if (err) return res.status(http).json(err);
        if (row.kind !== def.kind) return res.status(409).json({ error: 'A scorecard cannot be turned into a waitlist (or back) once made. Create a new one instead.' });
        // A live page must stay publishable after every edit.
        if (row.status === 'live' && problems.length) return res.status(422).json({ error: 'This is live, so the change cannot leave it broken.', problems });
        const up = await sb('PATCH', `/scorecards?id=eq.${row.id}`, { definition: def, title: def.title, comparison_group: def.group || null, updated_at: new Date().toISOString() });
        if (!up.ok) return res.status(500).json(tableError(up));
        return res.json({ ok: true, scorecard: { ...summary(up.data[0]), definition: def, problems } });
      }

      // A new one: where it belongs, and its public address.
      let intelProfileId = null, projectId = null;
      if (body.intelProfileId) {
        if (!isUuid(body.intelProfileId)) return res.status(400).json({ error: 'intelProfileId is not a valid id.' });
        if (!(await canAccessRecord(supabaseUrl, serviceKey, caller.id, { user_id: null, intel_profile_id: body.intelProfileId }, { requireEdit: true }))) return res.status(403).json({ error: 'You do not have edit access to that business profile.' });
        intelProfileId = body.intelProfileId;
      }
      if (body.projectId) {
        if (!isUuid(body.projectId)) return res.status(400).json({ error: 'projectId is not a valid id.' });
        const pr = await sb('GET', `/projects?id=eq.${body.projectId}&user_id=eq.${caller.id}&select=id&limit=1`);
        if (pr.ok && pr.data && pr.data[0]) projectId = pr.data[0].id;
      }
      if (!intelProfileId && !projectId) return res.status(409).json({ error: 'No business profile or project is selected, so contacts from this scorecard would have nowhere to go. Pick one first.', code: 'no_scope' });

      const base = sc.slugify(body.slug || def.title);
      if (!base || base.length < 3) return res.status(400).json({ error: 'Give it a title (or a link name) of at least 3 letters.', field: 'slug' });
      let slug = null;
      for (let n = 0; n < 20 && !slug; n++) {
        const tryS = n ? `${base.slice(0, 55)}-${n + 1}` : base;
        const ex = await sb('GET', `/scorecards?slug=eq.${tryS}&select=id&limit=1`);
        if (!ex.ok) return res.status(ex.status === 404 ? 503 : 500).json(tableError(ex));
        if (!(ex.data || []).length) slug = tryS;
      }
      if (!slug) return res.status(409).json({ error: 'That link name is taken. Try another.', field: 'slug' });

      // The owner of an existing profile's records is the profile's owner, so
      // contacts land in the same audience whoever on the team builds it.
      let ownerId = caller.id;
      if (intelProfileId) {
        const p = await sb('GET', `/intelligence_profiles?id=eq.${intelProfileId}&select=owner_id&limit=1`);
        if (p.ok && p.data && p.data[0] && p.data[0].owner_id) ownerId = p.data[0].owner_id;
      }
      const made = await sb('POST', '/scorecards', {
        user_id: ownerId, intel_profile_id: intelProfileId, project_id: intelProfileId ? null : projectId,
        slug, kind: def.kind, status: 'draft', title: def.title, definition: def, comparison_group: def.group || null,
      });
      if (!made.ok || !made.data || !made.data[0]) return res.status(made.status === 404 ? 503 : 500).json(tableError(made));
      return res.json({ ok: true, scorecard: { ...summary(made.data[0]), definition: def, problems } });
    }

    if (body.action === 'publish') {
      const { row, http, err } = await loadCard(body.id, true);
      if (err) return res.status(http).json(err);
      const { def, problems } = sc.normalize(row.definition);
      if (problems.length) return res.status(422).json({ error: 'Fix these before publishing.', problems });

      // Segments, so an email flow ("When someone joins segment…") can follow up.
      const segIds = { ...(row.segment_ids || {}) };
      const scope = { intel_profile_id: row.intel_profile_id || null, project_id: row.intel_profile_id ? null : (row.project_id || null) };
      const want = [{ key: 'all', name: `${def.kind === 'waitlist' ? 'Waitlist' : 'Scorecard'}: ${def.title}`, tags: [`scorecard:${sc.tagPart(row.slug)}`] }];
      for (const b of def.bands) want.push({ key: b.key, name: `Scorecard: ${def.title} — ${b.title}`, tags: [`scorecard:${sc.tagPart(row.slug)}:${b.key}`] });
      const failedSegments = [];
      for (const w of want) {
        if (segIds[w.key]) continue;
        const s = await sb('POST', '/segments', {
          user_id: row.user_id, ...scope, name: w.name.slice(0, 120),
          description: `People who opted in on ${def.kind === 'waitlist' ? 'the waitlist' : 'the scorecard'} at /s/${row.slug}${w.key === 'all' ? '' : ` and scored "${w.name.split(' — ').pop()}"`}.`,
          member_mode: 'dynamic', filter_rules: { tagsAll: w.tags, status: 'subscribed' },
        });
        if (s.ok && s.data && s.data[0]) segIds[w.key] = s.data[0].id; else failedSegments.push(w.name);
      }
      const now = new Date().toISOString();
      const up = await sb('PATCH', `/scorecards?id=eq.${row.id}`, { status: 'live', published_at: row.published_at || now, segment_ids: segIds, definition: def, updated_at: now });
      if (!up.ok) return res.status(500).json(tableError(up));
      return res.json({ ok: true, scorecard: summary(up.data[0]), path: `/s/${row.slug}`, segments: Object.keys(segIds).length, failedSegments });
    }

    if (body.action === 'close' || body.action === 'reopen') {
      const { row, http, err } = await loadCard(body.id, true);
      if (err) return res.status(http).json(err);
      if (body.action === 'reopen' && !row.published_at) return res.status(409).json({ error: 'This has never been published. Publish it instead.' });
      const up = await sb('PATCH', `/scorecards?id=eq.${row.id}`, { status: body.action === 'close' ? 'closed' : 'live', updated_at: new Date().toISOString() });
      if (!up.ok) return res.status(500).json(tableError(up));
      return res.json({ ok: true, scorecard: summary(up.data[0]) });
    }

    if (body.action === 'delete') {
      const { row, http, err } = await loadCard(body.id, true);
      if (err) return res.status(http).json(err);
      // Its link may already be in emails and posts, and its answers belong to the business.
      if (row.published_at) return res.status(409).json({ error: 'This has been published, so it is kept with its answers. Close it instead.' });
      const del = await sb('DELETE', `/scorecards?id=eq.${row.id}&status=eq.draft`);
      if (!del.ok) return res.status(500).json(tableError(del));
      return res.json({ ok: true });
    }

    if (body.action === 'results') {
      const { row, http, err } = await loadCard(body.id, false);
      if (err) return res.status(http).json(err);
      const rows = await readResponses(row.id);
      if (!rows) return res.status(500).json({ error: 'Could not read the responses.' });
      const { def } = sc.normalize(row.definition);
      return res.json({
        ok: true, scorecard: summary(row), totals: sc.summarize(def, rows), capped: rows.length >= MAX_RESPONSES_READ,
        recent: rows.slice(0, 50).map(r => ({ email: r.email, firstName: r.first_name, percent: r.percent, band: r.band_key, source: r.source, campaign: r.campaign, consented: r.consented, position: r.position, at: r.created_at })),
      });
    }

    if (body.action === 'compare') {
      const group = str(body.group, 60);
      if (!group) return res.status(400).json({ error: 'Which comparison group?', field: 'group' });
      const ids = await accessibleProfileIds(supabaseUrl, serviceKey, caller.id);
      const r = await sb('GET', `/scorecards?${ownedOrSharedFilter(caller.id, ids)}&comparison_group=eq.${encodeURIComponent(group)}&select=*&order=created_at.asc&limit=10`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      const out = [];
      for (const row of r.data || []) {
        const rows = await readResponses(row.id);
        const { def } = sc.normalize(row.definition);
        out.push({ ...summary(row), totals: rows ? sc.summarize(def, rows) : null });
      }
      return res.json({ ok: true, group, items: out });
    }

    return res.status(400).json({ error: `Unknown action "${body.action}".` });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});
