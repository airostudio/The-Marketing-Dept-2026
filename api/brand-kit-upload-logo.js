/**
 * api/brand-kit-upload-logo.js — upload the account's own logo for the
 * shared Brand Kit (supabase-brand-kit.sql).
 *
 * POST { dataUri: string, fileName?: string, projectId?: string, intelProfileId?: string }
 * Returns: { success, logoUrl }
 *
 * The logo has to end up as a real, publicly fetchable URL (not a data:
 * URI) — it gets embedded directly into api/generate-ad-image.js and
 * api/render-social-image.js's requests, and those calls need something an
 * image API/renderer can actually load, the same reason every other
 * generated-asset path in this codebase (generate-video.js, nancy-screenshot.js,
 * render-social-image.js) mirrors its output into R2 rather than keeping only
 * a temporary/local link.
 *
 * Exactly one row per scope (project or intelligence profile) — this
 * upserts brand_kits rather than inserting a new row per upload, since a
 * logo replaces the previous one rather than joining a gallery.
 */

'use strict';

const { requireUser, callerOwnsScope } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { uploadToR2, isR2Configured } = require('./_lib/r2.js');
const { sbRest } = require('./_lib/supabase-rest.js');

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — generous for a logo, bounded against abuse
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

module.exports = withFailureReporting('api/brand-kit-upload-logo', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'brand-kit-upload-logo', max: 10, windowMs: 60 * 1000, auth })) return;

  const { dataUri, fileName = 'logo.png', projectId, intelProfileId } = req.body || {};
  if (!projectId && !intelProfileId) {
    return res.status(400).json({ error: 'projectId or intelProfileId is required' });
  }
  if (!dataUri || typeof dataUri !== 'string') return res.status(400).json({ error: 'dataUri is required' });

  // A scope id taken from the request body is only as safe as the check
  // that the caller actually owns it — see callerOwnsScope's own doc
  // comment for why this exists (an unowned scope would let a signed-in
  // stranger overwrite someone else's logo).
  const owns = await callerOwnsScope(auth.userId, { projectId, intelProfileId });
  if (!owns) return res.status(403).json({ error: 'You do not have access to this business.' });

  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUri);
  if (!match) return res.status(400).json({ error: 'dataUri must be a base64 data URI' });

  const [, mimeType, b64] = match;
  if (!ALLOWED_MIME.has(mimeType.toLowerCase())) {
    return res.status(400).json({ error: `Unsupported file type "${mimeType}". Use PNG, JPG, WEBP, or SVG.` });
  }

  let buffer;
  try {
    buffer = Buffer.from(b64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Could not decode image data' });
  }
  if (!buffer.length) return res.status(400).json({ error: 'Empty file' });
  if (buffer.length > MAX_BYTES) return res.status(413).json({ error: `File too large — max ${Math.round(MAX_BYTES / 1024 / 1024)}MB` });

  if (!isR2Configured()) {
    return res.status(503).json({ error: 'R2 storage is not configured (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME/R2_PUBLIC_BASE_URL) — the logo cannot be stored as a reusable URL. See VERCEL_SETUP.md.' });
  }

  const scopeKey = intelProfileId ? `profile-${intelProfileId}` : `project-${projectId}`;
  const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
  let logoUrl;
  try {
    logoUrl = await uploadToR2(`brand-kit-logos/${scopeKey}/${Date.now()}-${safeName}`, buffer, mimeType);
  } catch (err) {
    return res.status(502).json({ error: 'Could not upload the logo to storage: ' + err.message });
  }
  if (!logoUrl) {
    return res.status(503).json({ error: 'The logo was uploaded but R2_PUBLIC_BASE_URL is not set, so there is no public link to it yet.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const scopeFilter = intelProfileId
    ? `intel_profile_id=eq.${intelProfileId}`
    : `project_id=eq.${projectId}`;
  const existing = await sbRest(supabaseUrl, serviceKey, 'GET', `/brand_kits?${scopeFilter}&select=id&limit=1`);
  if (!existing.ok) return res.status(502).json({ error: 'Could not look up the brand kit', detail: existing.data });

  const row = (existing.data || [])[0];
  const patch = { logo_url: logoUrl, updated_by: auth.userId };
  let saveResp;
  if (row) {
    saveResp = await sbRest(supabaseUrl, serviceKey, 'PATCH', `/brand_kits?id=eq.${row.id}`, patch);
  } else {
    saveResp = await sbRest(supabaseUrl, serviceKey, 'POST', '/brand_kits', [{
      project_id: projectId || null,
      intel_profile_id: intelProfileId || null,
      ...patch,
    }]);
  }
  if (!saveResp.ok) {
    return res.status(502).json({
      error: `The logo uploaded but could not be saved to the brand kit (HTTP ${saveResp.status}). ` +
             'This usually means supabase-brand-kit.sql has not been run in the Supabase SQL editor.',
      detail: saveResp.data,
    });
  }

  return res.json({ success: true, logoUrl });
});
