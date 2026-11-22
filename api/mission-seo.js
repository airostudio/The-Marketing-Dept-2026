/**
 * api/mission-seo.js — keep the SEO agent's content plan as a Scotty mission
 * artifact while the mission builds it.
 *
 * The research (site analysis, competitor search, topic proposal, real search
 * volumes) and each article are separate slow calls (api/seo-*.js), driven one
 * at a time from the browser (web/js/seo-mission.js) so none shares another's
 * time limit. This endpoint is where the mission's result lives:
 *
 * POST { action: 'start', websiteUrl, profile, competitors?, crossCompetitorGaps?, topics,
 *        articleTarget?, language?, projectId?, intelProfileId?, missionId? }
 *   Saves the finished research and opens a mission_artifacts row
 *   (kind 'seo_plan', status 'building') with no articles yet.
 * POST { action: 'addArticle', artifactId, topicIndex, article }
 *   Saves one written article against one of the proposed topics. Safe to
 *   repeat for a topic (a retry replaces it). The last article flips the
 *   artifact to 'pending_approval'.
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Nothing is published anywhere. Approving the finished plan
 * (api/mission-artifacts.js) saves it into the SEO Content Engine — the run,
 * its topics and the drafted articles — where it can be read, edited and
 * published by hand.
 *
 * Search volume is only ever labelled 'real' when a number came with it.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const writingLanguage = require('./_lib/writing-language.js');

const MAX_TOPICS = 12;
const MAX_ARTICLES = 3;
const MAX_RESEARCH_BYTES = 200 * 1024;
const MAX_SCHEMA_BYTES = 20 * 1024;

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

function tableError(res) {
  if (res.status === 404) return { code: 'not_installed', error: 'Mission artifacts are not installed. Run supabase-mission-artifacts.sql in the Supabase SQL editor.' };
  return { code: 'db_error', error: `Database error (HTTP ${res.status}).` };
}

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const int = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(0, Math.round(Number(v))) : null);

/** Bound a proposed topic. 'real' survives only if a search volume number came with it. */
function cleanTopic(t) {
  const topic = str(t && t.topic, 200);
  if (!topic) return null;
  const volume = int(t.search_volume);
  const real = t.data_source === 'real' && volume !== null;
  return {
    topic, target_keyword: str(t.target_keyword, 120),
    search_volume: real ? volume : null, difficulty: real ? int(t.difficulty) : null,
    est_search_volume: str(t.est_search_volume, 40), est_difficulty: str(t.est_difficulty, 40),
    data_source: real ? 'real' : 'estimate',
    rationale: str(t.rationale, 400), content_pillar: str(t.content_pillar, 80),
  };
}

function cleanSlug(v, fallback) {
  const s = String(v || fallback || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return s || 'article';
}

module.exports = withFailureReporting('api/mission-seo', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization header.' });
  const caller = await getCallerFromToken(supabaseUrl, serviceKey, accessToken);
  if (!caller?.id) return res.status(401).json({ error: 'Invalid or expired session.' });

  if (rateLimited(req, res, { name: 'mission-seo', max: 30, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);
  const body = req.body || {};

  try {
    /* ── start ────────────────────────────────────────────────────────── */
    if (body.action === 'start') {
      let websiteUrl = '';
      try { const u = new URL(String(body.websiteUrl || '')); if (/^https?:$/.test(u.protocol)) websiteUrl = u.toString(); } catch { /* blank = refused below */ }
      if (!websiteUrl) return res.status(400).json({ error: 'A website address is required for the SEO plan.', field: 'websiteUrl' });
      if (!body.profile || typeof body.profile !== 'object' || !body.profile.business_summary) {
        return res.status(400).json({ error: "The site analysis (the business profile) is required." });
      }
      const topics = (Array.isArray(body.topics) ? body.topics : []).map(cleanTopic).filter(Boolean).slice(0, MAX_TOPICS);
      if (!topics.length) return res.status(400).json({ error: 'No usable topics came back from the keyword research.' });
      const competitors = Array.isArray(body.competitors) ? body.competitors.slice(0, 10) : [];
      const gaps = Array.isArray(body.crossCompetitorGaps) ? body.crossCompetitorGaps.slice(0, 15) : [];
      const research = { profile: body.profile, competitors, crossCompetitorGaps: gaps };
      if (JSON.stringify(research).length > MAX_RESEARCH_BYTES) return res.status(413).json({ error: 'The research result is unexpectedly large.' });

      let intelProfileId = null;
      if (body.intelProfileId) {
        if (!isUuid(body.intelProfileId)) return res.status(400).json({ error: 'intelProfileId is not a valid id.' });
        const allowed = await canAccessRecord(supabaseUrl, serviceKey, caller.id,
          { user_id: null, intel_profile_id: body.intelProfileId }, { requireEdit: true });
        if (!allowed) return res.status(403).json({ error: 'You do not have edit access to that business profile.' });
        intelProfileId = body.intelProfileId;
      }
      let projectId = null;
      if (body.projectId) {
        if (!isUuid(body.projectId)) return res.status(400).json({ error: 'projectId is not a valid id.' });
        const pr = await sb('GET', `/projects?id=eq.${body.projectId}&user_id=eq.${caller.id}&select=id&limit=1`);
        if (pr.ok && pr.data && pr.data[0]) projectId = pr.data[0].id;
      }
      // The SEO Content Engine lists runs for the active profile or project.
      if (!intelProfileId && !projectId) {
        return res.status(409).json({ error: 'No business profile or project is selected, so the SEO Content Engine would have nowhere to show this plan. Pick one first.', code: 'no_scope' });
      }

      const articleTarget = Math.max(1, Math.min(MAX_ARTICLES, topics.length, parseInt(body.articleTarget, 10) || 2));
      const created = await sb('POST', '/mission_artifacts', {
        user_id: caller.id, intel_profile_id: intelProfileId,
        mission_id: body.missionId ? String(body.missionId).slice(0, 80) : null,
        agent_key: 'seo', kind: 'seo_plan',
        title: `SEO plan — ${str(body.profile.business_name || body.profile.business_summary, 60)}`,
        payload: {
          params: { websiteUrl, articleTarget, language: writingLanguage.isSupported(body.language) ? body.language : '', projectId },
          ...research, topics, articles: [],
        },
        status: 'building',
      });
      if (!created.ok) return res.status(created.status === 404 ? 503 : 500).json(tableError(created));
      const artifact = created.data && created.data[0];
      return res.json({ ok: true, artifactId: artifact.id, status: 'building', topics, articleTarget, remaining: articleTarget });
    }

    /* ── addArticle ───────────────────────────────────────────────────── */
    if (body.action === 'addArticle') {
      if (!body.artifactId || !isUuid(body.artifactId)) return res.status(400).json({ error: 'artifactId is required.' });
      const r = await sb('GET', `/mission_artifacts?id=eq.${body.artifactId}&limit=1`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      const artifact = r.data && r.data[0];
      const allowed = artifact && artifact.kind === 'seo_plan'
        && await canAccessRecord(supabaseUrl, serviceKey, caller.id, artifact, { requireEdit: true });
      if (!allowed) return res.status(404).json({ error: 'Artifact not found.' });
      if (artifact.status !== 'building') return res.status(409).json({ error: `This plan is already ${artifact.status.replace('_', ' ')} — it is no longer being built.` });

      const payload = artifact.payload || {};
      const topics = Array.isArray(payload.topics) ? payload.topics : [];
      const idx = Number(body.topicIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= topics.length) return res.status(400).json({ error: 'topicIndex does not match a proposed topic.' });

      const a = body.article || {};
      const md = String(a.body_markdown || '').replace(/\r\n?/g, '\n').trim().slice(0, 60000);
      const title = str(a.title, 200);
      if (!md || !title) return res.status(400).json({ error: 'The article has no title or no body.' });
      let schema = null;
      if (a.schema_markup && typeof a.schema_markup === 'object' && JSON.stringify(a.schema_markup).length <= MAX_SCHEMA_BYTES) schema = a.schema_markup;

      const articles = (Array.isArray(payload.articles) ? payload.articles : []).filter(x => x.topicIndex !== idx);
      articles.push({
        topicIndex: idx, title, meta_description: str(a.meta_description, 320), slug: cleanSlug(a.slug, title),
        target_keyword: topics[idx].target_keyword, body_markdown: md, schema_markup: schema,
        word_count: md.split(/\s+/).filter(Boolean).length,
        internal_link_suggestions: (Array.isArray(a.internal_link_suggestions) ? a.internal_link_suggestions : []).map(x => str(x, 200)).filter(Boolean).slice(0, 5),
      });
      articles.sort((x, y) => x.topicIndex - y.topicIndex);

      const target = payload.params?.articleTarget || 1;
      const complete = articles.length >= target;
      const upd = await sb('PATCH', `/mission_artifacts?id=eq.${artifact.id}&updated_at=eq.${encodeURIComponent(artifact.updated_at)}`, {
        payload: { ...payload, articles }, status: complete ? 'pending_approval' : 'building', updated_at: new Date().toISOString(),
      });
      if (!upd.ok) return res.status(500).json({ error: 'Could not save the article.' });
      if (!Array.isArray(upd.data) || !upd.data.length) return res.status(409).json({ error: 'This plan changed while saving — try that article again.', code: 'conflict' });
      return res.json({ ok: true, artifactId: artifact.id, status: complete ? 'pending_approval' : 'building', saved: articles.length, remaining: Math.max(0, target - articles.length) });
    }

    return res.status(400).json({ error: `Unknown action "${body.action}". Use 'start' or 'addArticle'.` });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

module.exports.cleanTopic = cleanTopic;
