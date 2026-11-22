/**
 * api/mission-video.js — run Video Studio for real, as a step of a Scotty
 * mission.
 *
 * POST { action: 'start', brief, aspectRatio?, duration?, resolution?, businessContext?,
 *        projectId?, intelProfileId?, missionId? }
 *   Writes a shot prompt from the brief (api/_lib/video-brief.js), checks it by
 *   code — no words or logos on screen, no figure the brief did not give, no
 *   real person — and starts ONE paid Seedance render (api/_lib/seedance.js,
 *   the same render Video Studio uses). Saves a mission_artifacts row (kind
 *   'video_clip', status 'building') that holds the render's task id, so the
 *   render is never lost if the browser closes. A missing brief is a question
 *   back before anything is spent; a prompt that still fails its checks after
 *   one rewrite renders nothing.
 *
 * POST { action: 'check', artifactId }
 *   Asks the provider where the render is. When it has finished, the file is
 *   copied into our own storage (or, if storage is not set up, the expiring
 *   link is kept and labelled as such) and the artifact moves to
 *   'pending_approval'. A failed render moves it to 'empty' with the reason.
 *   Safe to call again: a finished artifact just reports what it holds.
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Nothing is published or posted. Approving (api/mission-artifacts.js) adds
 * the clip to the Video Studio gallery, where it can be downloaded or put on a
 * post by hand.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY,
 * ARK_API_KEY (or SEEDANCE_API_KEY). Optional: R2_* to keep the finished file.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const seedance = require('./_lib/seedance.js');
const { writeShotPrompt } = require('./_lib/video-brief.js');

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const now = () => new Date().toISOString();

function tableError(r) {
  return r.status === 404
    ? { code: 'not_installed', error: 'Mission artifacts are not installed. Run supabase-mission-artifacts.sql in the Supabase SQL editor.' }
    : { code: 'db_error', error: `Database error (HTTP ${r.status}).` };
}

/** What the browser is told about an artifact, whatever state it is in. */
function describe(a) {
  const p = a.payload || {};
  const base = { artifactId: a.id, concept: p.concept || '', prompt: p.prompt || '', params: p.params || {} };
  if (a.status === 'building') return { ...base, status: 'rendering' };
  if (a.status === 'empty') return { ...base, status: 'failed', error: p.error || 'The render did not produce a video.' };
  return { ...base, status: 'ready', artifactStatus: a.status, video: p.video || null };
}

module.exports = withFailureReporting('api/mission-video', async function handler(req, res) {
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

  const body = req.body || {};
  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);

  /* ── where is the render? ─────────────────────────────────────────────── */
  if (body.action === 'check') {
    // Checking is cheap, but a finished render is downloaded and stored once.
    if (rateLimited(req, res, { name: 'mission-video-check', max: 30, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;
    if (!isUuid(body.artifactId)) return res.status(400).json({ error: 'artifactId is not a valid id.' });
    const r = await sb('GET', `/mission_artifacts?id=eq.${body.artifactId}&select=*&limit=1`);
    if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
    const a = r.data && r.data[0];
    const allowed = a && a.agent_key === 'video' && a.kind === 'video_clip'
      && await canAccessRecord(supabaseUrl, serviceKey, caller.id, a, { requireEdit: true });
    if (!allowed) return res.status(404).json({ error: 'Video not found.' });
    if (a.status !== 'building') return res.json({ ok: true, ...describe(a) });

    const taskId = a.payload && a.payload.taskId;
    if (!taskId) return res.json({ ok: true, ...describe(a), note: 'The render is still being started.' });

    let t;
    try {
      t = await seedance.getTask(taskId);
    } catch (e) {
      // The provider could not be asked; the render itself may be fine.
      return res.status(e.status && e.status < 600 ? e.status : 502).json({ error: `Could not check on the video: ${e.message}`, retryable: true });
    }

    if (t.status === 'pending' || t.status === 'processing') {
      // Touched so the stall sweep knows somebody is still watching.
      await sb('PATCH', `/mission_artifacts?id=eq.${a.id}&status=eq.building`, { updated_at: now() });
      return res.json({ ok: true, ...describe(a), providerStatus: t.status });
    }

    const payload = t.status === 'failed'
      ? { ...a.payload, error: str(t.error, 500) || 'Video generation failed.' }
      : { ...a.payload, video: { videoUrl: t.videoUrl, thumbnailUrl: t.thumbnailUrl || null, storage: t.storage, storageNote: t.storageNote || null, sourceUrl: t.sourceUrl || null, finishedAt: now() } };
    if (t.status === 'succeeded' && !t.videoUrl) {
      payload.error = 'The render finished but no video link came back.';
      delete payload.video;
    }
    const status = payload.video ? 'pending_approval' : 'empty';
    // Only one check gets to record the result.
    const upd = await sb('PATCH', `/mission_artifacts?id=eq.${a.id}&status=eq.building`, { status, payload, updated_at: now() });
    if (!upd.ok) return res.status(500).json({ error: 'The render finished but could not be recorded. Check again.' });
    if (!Array.isArray(upd.data) || !upd.data.length) {
      const again = await sb('GET', `/mission_artifacts?id=eq.${a.id}&select=*&limit=1`);
      const latest = again.ok && again.data && again.data[0];
      return res.json({ ok: true, ...describe(latest || { ...a, status, payload }) });
    }
    return res.json({ ok: true, ...describe(upd.data[0]) });
  }

  if (body.action !== 'start') return res.status(400).json({ error: `Unknown action "${body.action}". Use 'start' or 'check'.` });

  /* ── write the prompt and start the render ────────────────────────────── */
  // Each start is a model call plus a paid render.
  if (rateLimited(req, res, { name: 'mission-video', max: 3, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;

  const brief = str(body.brief, 800);
  if (!brief) {
    return res.json({ ok: true, status: 'needs_input', questions: [{ field: 'brief', question: 'What should the video show? Describe the scene in a sentence — for example "our barista pouring a latte in the morning light".' }] });
  }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured, so Video Studio cannot write the shot.' });
  if (!seedance.config()) return res.status(503).json({ error: seedance.NOT_CONFIGURED });

  const aspectRatio = seedance.ASPECT_RATIOS.has(body.aspectRatio) ? body.aspectRatio : '16:9';
  const resolution = seedance.RESOLUTIONS.has(body.resolution) ? body.resolution : '1080p';
  const duration = seedance.clampDuration(body.duration);

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
  // The Video Studio gallery only shows videos for the active profile or project.
  if (!intelProfileId && !projectId) {
    return res.status(409).json({ error: 'No business profile or project is selected, so the Video Studio gallery would have nowhere to keep this video. Pick one first.', code: 'no_scope' });
  }

  let shot;
  try {
    shot = await writeShotPrompt({ brief, business: String(body.businessContext || '').slice(0, 6000), aspectRatio, duration });
  } catch (e) {
    return res.status(502).json({ error: `Video Studio could not write the shot: ${e.message}` });
  }
  if (shot.problems.length) {
    // Nothing is rendered from a prompt that failed its checks — no money spent on it.
    return res.status(422).json({ error: 'The shot could not be written without putting words, a logo or an unsupported claim on screen, so nothing was rendered. Try rewording the brief.', problems: shot.problems, prompt: shot.prompt });
  }

  const params = { brief, aspectRatio, duration, resolution, projectId };
  // The row exists before the paid render starts, so its task id always has a home.
  const created = await sb('POST', '/mission_artifacts', {
    user_id: caller.id, intel_profile_id: intelProfileId,
    mission_id: body.missionId ? String(body.missionId).slice(0, 80) : null,
    agent_key: 'video', kind: 'video_clip',
    title: `Video — ${brief.slice(0, 80)}`,
    payload: { params, concept: shot.concept, prompt: shot.prompt, taskId: null },
    status: 'building',
  });
  if (!created.ok) return res.status(created.status === 404 ? 503 : 500).json(tableError(created));
  const artifact = created.data && created.data[0];

  let taskId;
  try {
    taskId = await seedance.createTask({ prompt: shot.prompt, mode: 'text-to-video', aspectRatio, duration, resolution });
  } catch (e) {
    await sb('PATCH', `/mission_artifacts?id=eq.${artifact.id}`, { status: 'empty', payload: { ...artifact.payload, error: str(e.message, 500) }, updated_at: now() });
    return res.status(e.status && e.status < 600 ? e.status : 502).json({ error: `The video render could not be started: ${e.message}`, artifactId: artifact.id });
  }

  const payload = { ...artifact.payload, taskId, startedAt: now() };
  const saved = await sb('PATCH', `/mission_artifacts?id=eq.${artifact.id}`, { payload, updated_at: now() });
  if (!saved.ok) {
    // The render is running and paid for; say where it is rather than losing it.
    return res.status(500).json({ error: `The render started (task ${taskId}) but could not be recorded on the mission.`, taskId });
  }
  return res.json({ ok: true, status: 'rendering', artifactId: artifact.id, concept: shot.concept, prompt: shot.prompt, params, rewritten: shot.rewritten });
});

module.exports.describe = describe;
