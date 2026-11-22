/**
 * api/_lib/seedance.js — the Seedance 2.0 video render, shared by Video Studio
 * (api/generate-video.js) and Scotty's video step (api/mission-video.js).
 *
 * Seedance 2.0 ships through more than one host (BytePlus/Volcengine Ark
 * being the primary one at launch, with aggregators such as fal.ai/OpenRouter
 * also fronting it). Exact field names differ slightly per host, so the
 * request/response shape below follows the Ark-style async task contract
 * that ByteDance's video models (Seedance 1.0 → 2.0) have shipped with:
 *   POST {base}/contents/generations/tasks   → { id }
 *   GET  {base}/contents/generations/tasks/{id} → { status, content: { video_url } }
 * If your provider differs, only SEEDANCE_API_BASE_URL / SEEDANCE_MODEL and
 * the two small "Ark request/response shape" blocks below need to change.
 *
 * The API key is read from ARK_API_KEY (the name BytePlus/Volcengine's own Ark
 * console docs use) or SEEDANCE_API_KEY as a fallback for non-Ark providers —
 * never exposed client-side.
 */

'use strict';

const { uploadToR2, isR2Configured } = require('./r2.js');

const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const DEFAULT_MODEL = 'seedance-2-0';

const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS = new Set(['720p', '1080p']);
const MIN_DURATION = 2;
const MAX_DURATION = 12;

// Ark hands back a signed, time-limited URL — typically valid for hours, not
// for the life of a marketing campaign. Storing only that URL meant a
// customer's finished video quietly became a broken <video> tag and a dead
// Download button, and a scheduled social post carried a link that would be
// gone before it published. Mirroring the file into R2 (the same bucket the
// screenshot and ad-image paths already use) makes it durable.
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;   // a 12s 1080p clip is far below this

const NOT_CONFIGURED = 'ARK_API_KEY (or SEEDANCE_API_KEY) is not configured in environment variables. Add it in Vercel → Settings → Environment Variables.';

function config() {
  const apiKey = process.env.ARK_API_KEY || process.env.SEEDANCE_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: (process.env.SEEDANCE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: process.env.SEEDANCE_MODEL || DEFAULT_MODEL,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
  };
}

function clampDuration(d) {
  return Math.max(MIN_DURATION, Math.min(MAX_DURATION, parseInt(d, 10) || 5));
}

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

/**
 * Ark's own "model or endpoint ... does not exist or you do not have
 * access to it" is accurate but leaves the operator to independently
 * discover that Ark requires provisioning a real Endpoint (ep-xxxxxxxx) for
 * a model before calling it — DEFAULT_MODEL's bare "seedance-2-0" 404s on
 * most Ark accounts for exactly this reason, and VERCEL_SETUP.md already
 * documents the fix (set SEEDANCE_MODEL to that Endpoint ID). Surfacing the
 * same guidance directly in the error means the person who hits this
 * doesn't have to already know to go find that one line in the setup docs.
 */
function describeCreateFailure(upstreamMessage, modelUsed) {
  if (/does not exist|do not have access|invalid model|model not found/i.test(upstreamMessage)) {
    return `${upstreamMessage} — Ark requires a provisioned Endpoint ID for this, not a bare model name ` +
      `("${modelUsed}" won't work on most accounts). In your BytePlus/Volcengine Ark console, go to ` +
      `Model Inference → Endpoints, create (or copy) the endpoint for your video model, and set its ID ` +
      `(looks like ep-20240611094208-xxxxx) as the SEEDANCE_MODEL environment variable in Vercel, then redeploy.`;
  }
  return upstreamMessage;
}

/** An error carrying the HTTP status the caller should answer with. */
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

/**
 * Start a render. Inputs must already be validated (validateRequest).
 * @returns {Promise<string>} the provider's task id
 */
async function createTask({ prompt, mode = 'text-to-video', imageUrl, aspectRatio, duration, resolution }) {
  const cfg = config();
  if (!cfg) throw httpError(500, NOT_CONFIGURED);

  // Ark request shape: a text part carrying the prompt plus inline
  // generation flags, and — for image-to-video — a leading image part.
  const promptWithFlags = `${prompt.trim()} --ratio ${aspectRatio} --dur ${clampDuration(duration)} --resolution ${resolution}`;
  const content = [];
  if (mode === 'image-to-video') content.push({ type: 'image_url', image_url: { url: imageUrl } });
  content.push({ type: 'text', text: promptWithFlags });

  const r = await fetch(`${cfg.baseUrl}/contents/generations/tasks`, {
    method: 'POST', headers: cfg.headers, body: JSON.stringify({ model: cfg.model, content }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const upstreamMessage = data.error?.message || data.message || `Seedance API error (${r.status})`;
    throw httpError(r.status, describeCreateFailure(upstreamMessage, cfg.model));
  }
  const taskId = data.id || data.task_id;
  if (!taskId) throw httpError(502, 'Seedance API did not return a task id.');
  return String(taskId);
}

/**
 * Where a render is. A finished render is copied somewhere durable before its
 * link is handed back; the caller is told which URL it got and, when the copy
 * did not happen, why — so a temporary link is never passed off as a
 * permanent one.
 * @returns {Promise<{status, videoUrl, thumbnailUrl, storage?, storageNote?, sourceUrl?, error?}>}
 */
async function getTask(taskId) {
  const cfg = config();
  if (!cfg) throw httpError(500, NOT_CONFIGURED);

  const r = await fetch(`${cfg.baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
    method: 'GET', headers: cfg.headers,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(r.status, data.error?.message || data.message || `Seedance API error (${r.status})`);

  // Ark response shape.
  const status = normalizeStatus(data.status);
  const sourceUrl = data.content?.video_url || data.content?.url || null;
  const thumbnailUrl = data.content?.thumbnail_url || data.content?.cover_url || null;

  if (status !== 'succeeded') {
    return {
      status, videoUrl: null, thumbnailUrl,
      error: status === 'failed' ? (data.error?.message || 'Video generation failed') : undefined,
    };
  }

  const mirror = sourceUrl ? await mirrorToR2(sourceUrl, taskId) : { url: null, reason: 'No video URL was returned.' };
  return {
    status,
    videoUrl: mirror.url || sourceUrl,
    thumbnailUrl,
    storage: mirror.url ? 'permanent' : 'temporary',
    storageNote: mirror.reason,
    // The provider's own link, kept so a customer can still fetch the file
    // themselves while it lasts.
    sourceUrl,
  };
}

/** What is wrong with a render request, in plain words ('' if nothing). */
function validateRequest({ prompt, mode = 'text-to-video', imageUrl, aspectRatio, resolution }) {
  if (!prompt || !String(prompt).trim()) return 'prompt is required';
  if (mode === 'image-to-video' && !imageUrl) return 'imageUrl is required for image-to-video mode';
  if (!ASPECT_RATIOS.has(aspectRatio)) return `aspectRatio must be one of: ${[...ASPECT_RATIOS].join(', ')}`;
  if (!RESOLUTIONS.has(resolution)) return `resolution must be one of: ${[...RESOLUTIONS].join(', ')}`;
  return '';
}

module.exports = {
  config, createTask, getTask, validateRequest, clampDuration, mirrorToR2, normalizeStatus,
  describeCreateFailure, NOT_CONFIGURED, ASPECT_RATIOS, RESOLUTIONS, MIN_DURATION, MAX_DURATION, MAX_VIDEO_BYTES,
};
