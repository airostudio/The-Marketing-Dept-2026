/**
 * api/generate-video.js
 * Vercel serverless function — proxies AI video generation to Seedance 2.0.
 * The provider contract, the API key and the copy into durable storage all
 * live in api/_lib/seedance.js, shared with Scotty's video step
 * (api/mission-video.js); the browser only ever talks to this endpoint.
 *
 * Body (create):  { action: 'create', prompt, mode?, imageUrl?, aspectRatio?, duration?, resolution? }
 *   → { taskId }
 * Body (status):  { action: 'status', taskId }
 *   → { status: 'pending'|'processing'|'succeeded'|'failed', videoUrl?, thumbnailUrl?,
 *       storage?: 'permanent'|'temporary', storageNote?, sourceUrl?, error? }
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const seedance = require('./_lib/seedance.js');

module.exports = withFailureReporting('api/generate-video', async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Every path below reaches a paid third party or this server's own crawler
  // on the account's credentials. Identify the caller before spending any of
  // it; a rate limit caps the speed, not the entitlement.
  const auth = await requireUser(req, res);
  if (!auth) return;

  if (!seedance.config()) {
    return res.status(500).json({ error: seedance.NOT_CONFIGURED });
  }

  const { action } = req.body || {};

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

    const problem = seedance.validateRequest({ prompt, mode, imageUrl, aspectRatio, resolution });
    if (problem) return res.status(400).json({ error: problem });

    try {
      const taskId = await seedance.createTask({ prompt, mode, imageUrl, aspectRatio, duration, resolution });
      return res.json({ taskId });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  }

  /* ── Poll a generation task ──────────────────────────────────────────────── */
  if (action === 'status') {
    const { taskId } = req.body || {};
    if (!taskId) {
      return res.status(400).json({ error: 'taskId is required' });
    }
    try {
      return res.json(await seedance.getTask(taskId));
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "action must be 'create' or 'status'" });
});
