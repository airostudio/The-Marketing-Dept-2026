/**
 * api/mission-nancy.js — keep Nancy's week of posts as a Scotty mission
 * artifact while the mission builds it.
 *
 * Nancy's research, copywriting and image rendering are separate slow calls
 * (api/nancy-*.js), driven one at a time from the browser (web/js/nancy-mission.js
 * for a mission, the Nancy page otherwise) so no single request carries more
 * than its own 60s. This endpoint is where the mission's result lives:
 *
 * POST { action: 'start', websiteUrl, language?, businessProfile, brand, strategy,
 *        projectId?, intelProfileId?, missionId? }
 *   Saves the finished research and opens a mission_artifacts row
 *   (kind 'nancy_week', status 'building') with no posts yet.
 * POST { action: 'addPost', artifactId, post, asset }
 *   Saves one day's copy and its rendered, HOSTED image. Safe to repeat for a
 *   day (a retry replaces it). The seventh post flips the artifact to
 *   'pending_approval'.
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Nothing is published or scheduled from here. Approving the finished week
 * (api/mission-artifacts.js) puts the posts in the Content Calendar as
 * approved, ready to be scheduled.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const writingLanguage = require('./_lib/writing-language.js');

const WEEK_DAYS = 7;
const MAX_RESEARCH_BYTES = 200 * 1024;

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
const longStr = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, max);   // captions keep their line breaks

function httpsUrl(v) {
  try { const u = new URL(String(v || '')); return u.protocol === 'https:' ? u.toString() : ''; } catch { return ''; }
}

/** Bound and shape one planned post. Returns {post} or {error}. */
function cleanPost(p) {
  const day = Number(p && p.day);
  if (!Number.isInteger(day) || day < 1 || day > WEEK_DAYS) return { error: `day must be a whole number from 1 to ${WEEK_DAYS}.` };
  const caption = longStr(p.caption, 2200);
  const headline = str(p.slide_headline, 120);
  if (!caption) return { error: `Day ${day} has no caption.` };
  if (!headline) return { error: `Day ${day} has no headline.` };
  const tags = (Array.isArray(p.hashtags) ? p.hashtags : []).map(t => str(t, 60).replace(/^#?/, '#').replace(/\s+/g, '')).filter(t => t.length > 1).slice(0, 30);
  return { post: {
    day, objective: str(p.objective, 200), content_pillar: str(p.content_pillar, 100), format: str(p.format, 40),
    hook: str(p.hook, 300), slide_headline: headline, caption, cta: str(p.cta, 200),
    visual_direction: str(p.visual_direction, 600), hashtags: tags,
    cta_url: httpsUrl(p.cta_url),
  } };
}

module.exports = withFailureReporting('api/mission-nancy', async function handler(req, res) {
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

  if (rateLimited(req, res, { name: 'mission-nancy', max: 60, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);
  const body = req.body || {};

  try {
    /* ── start ────────────────────────────────────────────────────────── */
    if (body.action === 'start') {
      const websiteUrl = httpsUrl(body.websiteUrl) || (() => { try { const u = new URL(String(body.websiteUrl || '')); return /^https?:$/.test(u.protocol) ? u.toString() : ''; } catch { return ''; } })();
      if (!websiteUrl) return res.status(400).json({ error: 'A website address is required for Nancy to learn the business from.', field: 'websiteUrl' });
      for (const k of ['businessProfile', 'brand', 'strategy']) {
        if (!body[k] || typeof body[k] !== 'object') return res.status(400).json({ error: `${k} (from Nancy's research) is required.` });
      }
      const research = { businessProfile: body.businessProfile, brand: body.brand, strategy: body.strategy };
      if (JSON.stringify(research).length > MAX_RESEARCH_BYTES) return res.status(413).json({ error: 'The research result is unexpectedly large.' });

      let intelProfileId = null;
      if (body.intelProfileId) {
        if (!isUuid(body.intelProfileId)) return res.status(400).json({ error: 'intelProfileId is not a valid id.' });
        const allowed = await canAccessRecord(supabaseUrl, serviceKey, caller.id,
          { user_id: null, intel_profile_id: body.intelProfileId }, { requireEdit: true });
        if (!allowed) return res.status(403).json({ error: 'You do not have edit access to that business profile.' });
        intelProfileId = body.intelProfileId;
      }
      // The Content Calendar only shows posts for the active business profile
      // or project. Without one, an approved week would land where nobody can
      // see it — so say so now, before anything is spent on images.
      let projectId = null;
      if (body.projectId) {
        if (!isUuid(body.projectId)) return res.status(400).json({ error: 'projectId is not a valid id.' });
        const pr = await sb('GET', `/projects?id=eq.${body.projectId}&user_id=eq.${caller.id}&select=id&limit=1`);
        if (pr.ok && pr.data && pr.data[0]) projectId = pr.data[0].id;
      }
      if (!intelProfileId && !projectId) {
        return res.status(409).json({ error: 'No business profile or project is selected, so the Content Calendar would have nowhere to show this week. Pick one first.', code: 'no_scope' });
      }

      const created = await sb('POST', '/mission_artifacts', {
        user_id: caller.id, intel_profile_id: intelProfileId,
        mission_id: body.missionId ? String(body.missionId).slice(0, 80) : null,
        agent_key: 'nancy', kind: 'nancy_week',
        title: `Instagram week — ${str(body.businessProfile.business_name, 80) || websiteUrl}`,
        payload: {
          params: { websiteUrl, language: writingLanguage.isSupported(body.language) ? body.language : '', projectId, platforms: ['Instagram'] },
          ...research, posts: [],
        },
        status: 'building',
      });
      if (!created.ok) return res.status(created.status === 404 ? 503 : 500).json(tableError(created));
      const artifact = created.data && created.data[0];
      return res.json({ ok: true, artifactId: artifact.id, status: artifact.status, remaining: WEEK_DAYS });
    }

    /* ── addPost ──────────────────────────────────────────────────────── */
    if (body.action === 'addPost') {
      if (!body.artifactId || !isUuid(body.artifactId)) return res.status(400).json({ error: 'artifactId is required.' });
      const r = await sb('GET', `/mission_artifacts?id=eq.${body.artifactId}&limit=1`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      const artifact = r.data && r.data[0];
      const allowed = artifact && artifact.kind === 'nancy_week'
        && await canAccessRecord(supabaseUrl, serviceKey, caller.id, artifact, { requireEdit: true });
      if (!allowed) return res.status(404).json({ error: 'Artifact not found.' });
      if (artifact.status !== 'building') return res.status(409).json({ error: `This week is already ${artifact.status.replace('_', ' ')} — it is no longer being built.` });

      const cleaned = cleanPost(body.post);
      if (cleaned.error) return res.status(400).json({ error: cleaned.error });
      // A post the Calendar can publish needs an image at a real address. A
      // picture that only exists in the browser cannot be saved here and
      // cannot be posted later, so refuse it now rather than approve a week
      // of posts that will fail on the platform.
      const imageUrl = httpsUrl(body.asset && body.asset.hostedUrl);
      if (!imageUrl) {
        return res.status(422).json({ error: `Day ${cleaned.post.day}'s image has no hosted address. Image hosting (R2) is not configured, so this week could not be posted.`, code: 'no_hosted_image' });
      }

      const payload = artifact.payload || {};
      const posts = (Array.isArray(payload.posts) ? payload.posts : []).filter(p => p.day !== cleaned.post.day);
      posts.push({
        ...cleaned.post, imageUrl,
        imageFormat: str(body.asset.format, 10), imageFallback: body.asset.fallbackReason ? str(body.asset.fallbackReason, 200) : null,
      });
      posts.sort((a, b) => a.day - b.day);

      const complete = posts.length >= WEEK_DAYS;
      // Conditional on nobody else having touched it, so two writers can't drop each other's day.
      const upd = await sb('PATCH', `/mission_artifacts?id=eq.${artifact.id}&updated_at=eq.${encodeURIComponent(artifact.updated_at)}`, {
        payload: { ...payload, posts }, status: complete ? 'pending_approval' : 'building', updated_at: new Date().toISOString(),
      });
      if (!upd.ok) return res.status(500).json({ error: 'Could not save the post.' });
      if (!Array.isArray(upd.data) || !upd.data.length) return res.status(409).json({ error: 'This week changed while saving — try that day again.', code: 'conflict' });
      return res.json({ ok: true, artifactId: artifact.id, status: complete ? 'pending_approval' : 'building', saved: posts.length, remaining: WEEK_DAYS - posts.length });
    }

    return res.status(400).json({ error: `Unknown action "${body.action}". Use 'start' or 'addPost'.` });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

module.exports.cleanPost = cleanPost;
