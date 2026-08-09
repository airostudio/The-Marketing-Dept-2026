/**
 * api/generate-video.js
 * Vercel serverless function — proxies AI video generation to Seedance 2.0.
 * API key stored exclusively in the SEEDANCE_API_KEY environment variable
 * (never exposed client-side — the browser only ever talks to this endpoint).
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

const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const DEFAULT_MODEL = 'seedance-2-0';

const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS = new Set(['720p', '1080p']);

function normalizeStatus(arkStatus) {
  if (arkStatus === 'succeeded' || arkStatus === 'success' || arkStatus === 'completed') return 'succeeded';
  if (arkStatus === 'failed' || arkStatus === 'error') return 'failed';
  if (arkStatus === 'queued' || arkStatus === 'pending' || arkStatus === 'created') return 'pending';
  return 'processing';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.SEEDANCE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'SEEDANCE_API_KEY is not configured in environment variables. Add it in Vercel → Settings → Environment Variables.' });
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
      const videoUrl = data.content?.video_url || data.content?.url || null;
      const thumbnailUrl = data.content?.thumbnail_url || data.content?.cover_url || null;

      return res.json({
        status,
        videoUrl: status === 'succeeded' ? videoUrl : null,
        thumbnailUrl,
        error: status === 'failed' ? (data.error?.message || 'Video generation failed') : undefined,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "action must be 'create' or 'status'" });
};
