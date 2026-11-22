/**
 * video-mission.js — runs Video Studio's real render as a Scotty mission step.
 *
 * One call writes and checks the shot and starts ONE paid render
 * (api/mission-video.js, action 'start'); the render takes minutes, so this
 * then asks where it is every few seconds (action 'check') until it finishes,
 * fails, or this stops watching. Stopping watching is not failure: the render
 * keeps going on the provider's side and its task id is on the mission, so
 * running the step again picks it up instead of paying for a second render.
 *
 * Nothing is posted or published. Approving adds the clip to the Video Studio
 * gallery.
 */
(function (root) {
  'use strict';

  const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
  const RESOLUTIONS = ['720p', '1080p'];
  const MIN_DURATION = 2, MAX_DURATION = 12, DEFAULT_DURATION = 5;
  const CHECK_EVERY_MS = 10000;
  const MAX_CHECKS = 42;                 // ~7 minutes of watching per run

  const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

  function sanitizeParams(p) {
    const src = (p && typeof p === 'object') ? p : {};
    const d = parseInt(src.duration, 10);
    return {
      brief: clean(src.brief, 800),
      aspectRatio: ASPECTS.includes(src.aspectRatio) ? src.aspectRatio : '16:9',
      duration: Number.isFinite(d) ? Math.max(MIN_DURATION, Math.min(MAX_DURATION, d)) : DEFAULT_DURATION,
      resolution: RESOLUTIONS.includes(src.resolution) ? src.resolution : '1080p',
    };
  }

  /** The frame a platform shows full-size. Only used to pick a default the person can change. */
  function aspectForPlatform(text) {
    const t = String(text || '').toLowerCase();
    if (/tiktok|reel|short|stor(y|ies)|vertical/.test(t)) return '9:16';
    if (/square|instagram feed|feed post/.test(t)) return '1:1';
    return '16:9';
  }

  function describeParams(params) {
    return `Render one ${params.duration}-second ${params.aspectRatio} video clip: ${params.brief || '[what the video should show]'}`;
  }

  function missingInputs(params) {
    return sanitizeParams(params).brief ? [] : ['what the video should show'];
  }

  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  /**
   * @param {object} task  { params: {brief, aspectRatio, duration, resolution} }
   * @param {object} opts  { authHeaders, intelProfileId, projectId, missionId, businessContext, onStatus, fetchImpl, sleep, maxChecks, intervalMs }
   * @returns {Promise<{artifactId, status:'ready'|'failed'|'rendering', concept, prompt, params, video?, error?}>}
   */
  async function runVideo(task, opts) {
    const o = opts || {};
    const doFetch = o.fetchImpl || ((...a) => fetch(...a));
    const sleep = o.sleep || wait;
    const params = sanitizeParams(task.params);
    const missing = missingInputs(params);
    if (missing.length) throw new Error(`Video Studio needs ${missing.join(' and ')} before it can render.`);

    async function post(body) {
      const res = await doFetch('/api/mission-video', { method: 'POST', headers: await o.authHeaders(), body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      return { res, data };
    }

    const state = task._videoState || null;
    if (state && state.status !== 'rendering') return state;

    if (!state) {
      if (o.onStatus) o.onStatus('Writing the shot and checking it…');
      const { res, data } = await post({
        action: 'start', ...params, businessContext: o.businessContext || '',
        projectId: o.projectId || undefined, intelProfileId: o.intelProfileId || undefined, missionId: o.missionId || undefined,
      });
      if (!res.ok) {
        const problems = data && Array.isArray(data.problems) && data.problems.length ? ` (${data.problems.join(' ')})` : '';
        throw new Error(((data && data.error) || `Video Studio request failed (HTTP ${res.status})`) + problems);
      }
      if (data.status === 'needs_input') throw new Error(`Video Studio needs more from you: ${(data.questions || []).map(q => q.question).join(' ')}`);
      task._videoState = { artifactId: data.artifactId, status: 'rendering', concept: data.concept || '', prompt: data.prompt || '', params: data.params || params };
    }

    const st = task._videoState;
    const maxChecks = o.maxChecks || MAX_CHECKS;
    const every = o.intervalMs || CHECK_EVERY_MS;
    let transient = 0;
    for (let i = 0; i < maxChecks; i++) {
      if (o.onStatus) o.onStatus(i === 0 ? 'Rendering the video — this usually takes a few minutes…' : `Still rendering… (${Math.round((i * every) / 1000)}s)`);
      await sleep(i === 0 ? Math.min(every, 3000) : every);
      const { res, data } = await post({ action: 'check', artifactId: st.artifactId });
      if (!res.ok) {
        // The provider not answering once says nothing about the render itself.
        if (data && data.retryable && ++transient < 4) continue;
        throw new Error((data && data.error) || `Could not check on the video (HTTP ${res.status})`);
      }
      transient = 0;
      if (data.status === 'ready') {
        Object.assign(st, { status: 'ready', video: data.video, concept: data.concept || st.concept, prompt: data.prompt || st.prompt });
        return st;
      }
      if (data.status === 'failed') {
        Object.assign(st, { status: 'failed', error: data.error || 'The render did not produce a video.' });
        return st;
      }
    }
    // Still rendering: not a failure, and running the step again resumes it.
    return st;
  }

  function describeResult(r) {
    if (r.status === 'failed') return `**Video Studio tried to render the clip for real, but the render failed:** ${r.error}. Nothing was published.`;
    if (r.status === 'rendering') return '**Video Studio is rendering the clip for real** — it is taking longer than usual. The render keeps going on its own; run this step again to collect it. Nothing has been published.';
    const lines = [`**Video Studio rendered a ${r.params.duration}-second ${r.params.aspectRatio} clip for real.**`, ''];
    if (r.concept) lines.push(`What it shows: ${r.concept}`, '');
    lines.push(`Shot prompt (checked: no words, logos or unsupported figures on screen): ${r.prompt}`, '');
    if (r.video && r.video.storage !== 'permanent') lines.push(`⚠️ This video is only on the generator's own temporary link, which expires. ${r.video.storageNote || ''} Download it soon.`, '');
    lines.push('Waiting for your approval. Nothing has been posted or published — approving adds it to the Video Studio gallery. It is AI-generated video; say so where you use it.');
    return lines.join('\n');
  }

  const api = { runVideo, sanitizeParams, describeParams, missingInputs, describeResult, aspectForPlatform, ASPECTS, RESOLUTIONS, MIN_DURATION, MAX_DURATION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VideoMission = api;
})(typeof window !== 'undefined' ? window : globalThis);
