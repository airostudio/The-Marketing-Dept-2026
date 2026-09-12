/**
 * api/generate-video.js
 * Vercel serverless function — proxies AI video generation to Seedance 2.0.
 * API key stored exclusively server-side, read from ARK_API_KEY (the name
 * BytePlus/Volcengine's own Ark console docs use) or SEEDANCE_API_KEY as a
 * fallback for non-Ark providers — never exposed client-side; the browser
 * only ever talks to this endpoint.
 *
 * Seedance 2.0 ships through more than one host (BytePlus/Volcengine Ark
 * being the primary one at launch, with aggregators such as fal.ai/OpenRouter
 * also fronting it). Exact field names differ slightly per host, so the
 * request/response shape below follows the Ark-style async task contract
 * that ByteDance's video models (Seedance 1.0 → 2.0) have shipped with:
 *   POST {base}/contents/generations/tasks   → { id }
 *   GET  {base}/contents/generations/tasks/{id} → { status, content: { video_url } }
 * If your provider differs, only SEEDANCE_API_BASE_URL / SEEDANCE_MODEL and
 * the two small "Ark request/response shape" blocks below need to change —
 * everything else (validation, polling contract with the client) stays put.
 *
 * Body (create):  { action: 'create', prompt, mode?, imageUrl?, aspectRatio?, duration?, resolution? }
 *   → { taskId }
 * Body (status):  { action: 'status', taskId }
 *   → { status: 'pending'|'processing'|'succeeded'|'failed', videoUrl?, thumbnailUrl?, error? }
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { uploadToR2, isR2Configured } = require('./_lib/r2.js');

const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const DEFAULT_MODEL = 'seedance-2-0';

const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS = new Set(['720p', '1080p']);

// Ark hands back a signed, time-limited URL — typically valid for hours, not
// for the life of a marketing campaign. Storing only that URL meant a
// customer's finished video quietly became a broken <video> tag and a dead
// Download button, and a scheduled social post carried a link that would be
// gone before it published. Mirroring the file into R2 (the same bucket the
// screenshot and ad-image paths already use) makes it durable.
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;   // a 12s 1080p clip is far below this

async function mirrorToR2(sourceUrl, taskId) {
  if (!isR2Configured()) {
    return { url: null, reason: 'R2 storage is not configured, so this video is only available from the ' +
      'generator\'s own temporary link, which expires. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, ' +
      'R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME and R2_PUBLIC_BASE_URL to keep generated videos.' };
  }
  try {
    const r = await fetch(sourceUrl, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) return { url: null, reason: `Could not download the finished video (HTTP ${r.status}).` };

    const declared = Number(r.headers.get('content-length') || 0);
    if (declared && declared > MAX_VIDEO_BYTES) {
      return { url: null, reason: 'The finished video is larger than this service stores.' };
    }
    const buffer = Buffer.from(await r.arrayBuffer());
    if (buffer.length > MAX_VIDEO_BYTES) {
      return { url: null, reason: 'The finished video is larger than this service stores.' };
    }

    const contentType = r.headers.get('content-type') || 'video/mp4';
    const ext = contentType.includes('webm') ? 'webm' : 'mp4';
    const key = `videos/${Date.now()}-${String(taskId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}.${ext}`;
    const url = await uploadToR2(key, buffer, contentType);
    return url
      ? { url, reason: null }
      : { url: null, reason: 'The video was stored but R2_PUBLIC_BASE_URL is not set, so there is no ' +
          'public link to it yet.' };
  } catch (err) {
    return { url: null, reason: 'Could not store the finished video: ' + err.message };
  }
}

function normalizeStatus(arkStatus) {
  if (arkStatus === 'succeeded' || arkStatus === 'success' || arkStatus === 'completed') return 'succeeded';
  if (arkStatus === 'failed' || arkStatus === 'error') return 'failed';
  if (arkStatus === 'queued' || arkStatus === 'pending' || arkStatus === 'created') return 'pending';
  return 'processing';
}

module.exports = withFailureReporting('api/generate-video', async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Every path below reaches a paid third party or this server's own crawler
  // on the account's credentials. Identify the caller before spending any of
  // it; a rate limit caps the speed, not the entitlement.
  const auth = await requireUser(req, res);
  if (!auth) return;

  // ARK_API_KEY is the key name BytePlus/Volcengine's own Ark console docs use;
  // SEEDANCE_API_KEY is kept as a fallback for non-Ark providers of Seedance 2.0.
  const apiKey = process.env.ARK_API_KEY || process.env.SEEDANCE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ARK_API_KEY (or SEEDANCE_API_KEY) is not configured in environment variables. Add it in Vercel → Settings → Environment Variables.' });
  }

  const baseUrl = (process.env.SEEDANCE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = process.env.SEEDANCE_MODEL || DEFAULT_MODEL;
  const { action } = req.body || {};

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  /* ── Create a generation task ────────────────────────────────────────────── */
  if (action === 'create') {
    const {
      prompt,
      mode = 'text-to-video',        // 'text-to-video' | 'image-to-video'
      imageUrl,
      aspectRatio = '16:9',
      duration = 5,
      resolution = '1080p',
    } = req.body || {};

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    if (mode === 'image-to-video' && !imageUrl) {
      return res.status(400).json({ error: 'imageUrl is required for image-to-video mode' });
    }
    if (!ASPECT_RATIOS.has(aspectRatio)) {
      return res.status(400).json({ error: `aspectRatio must be one of: ${[...ASPECT_RATIOS].join(', ')}` });
    }
    if (!RESOLUTIONS.has(resolution)) {
      return res.status(400).json({ error: `resolution must be one of: ${[...RESOLUTIONS].join(', ')}` });
    }
    const durationNum = Math.max(2, Math.min(12, parseInt(duration, 10) || 5));

    // Ark-style content array: a text part carrying the prompt plus inline
    // generation flags, and — for image-to-video — a leading image part.
    const promptWithFlags = `${prompt.trim()} --ratio ${aspectRatio} --dur ${durationNum} --resolution ${resolution}`;
    const content = [];
    if (mode === 'image-to-video') {
      content.push({ type: 'image_url', image_url: { url: imageUrl } });
    }
    content.push({ type: 'text', text: promptWithFlags });

    try {
      const r = await fetch(`${baseUrl}/contents/generations/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, content }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({ error: data.error?.message || data.message || `Seedance API error (${r.status})` });
      }
      const taskId = data.id || data.task_id;
      if (!taskId) {
        return res.status(502).json({ error: 'Seedance API did not return a task id.' });
      }
      return res.json({ taskId });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  /* ── Poll a generation task ──────────────────────────────────────────────── */
  if (action === 'status') {
    const { taskId } = req.body || {};
    if (!taskId) {
      return res.status(400).json({ error: 'taskId is required' });
    }

    try {
      const r = await fetch(`${baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({ error: data.error?.message || data.message || `Seedance API error (${r.status})` });
      }

      const status = normalizeStatus(data.status);
      const sourceUrl = data.content?.video_url || data.content?.url || null;
      const thumbnailUrl = data.content?.thumbnail_url || data.content?.cover_url || null;

      if (status !== 'succeeded') {
        return res.json({
          status,
          videoUrl: null,
          thumbnailUrl,
          error: status === 'failed' ? (data.error?.message || 'Video generation failed') : undefined,
        });
      }

      // Copy it somewhere durable before handing back a link. The caller is
      // told which URL it got and, when the copy did not happen, why — so a
      // temporary link is never passed off as a permanent one.
      const mirror = sourceUrl ? await mirrorToR2(sourceUrl, taskId) : { url: null, reason: 'No video URL was returned.' };

      return res.json({
        status,
        videoUrl: mirror.url || sourceUrl,
        thumbnailUrl,
        storage: mirror.url ? 'permanent' : 'temporary',
        storageNote: mirror.reason,
        // The provider's own link, kept so a customer can still fetch the file
        // themselves while it lasts.
        sourceUrl,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "action must be 'create' or 'status'" });
});
