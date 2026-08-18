/**
 * api/nancy-upload-photo.js — Nancy Step 8: user photo upload
 *
 * POST { userId: string, brandId?: string, dataUri: string, fileName?: string }
 * Returns: { success, photo: { id, storageUrl, metadata } }
 *
 * Validates MIME type and size server-side (never trust the client's claim),
 * uploads to R2/Supabase Storage, and persists a nancy_user_photos row via
 * the service-role key (so RLS still protects reads/writes from the client
 * afterward, but this write itself needs to bypass it the same way every
 * other server-side insert in this codebase does).
 */

'use strict';

const { uploadToR2, isR2Configured } = require('./_lib/r2.js');
const { sbRest } = require('./_lib/supabase-rest.js');

const MAX_BYTES = 12 * 1024 * 1024; // 12MB — generous for a phone photo, bounded against abuse
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
const rateBuckets = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}
function checkRateLimit(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now - b.windowStart > RATE_LIMIT_WINDOW_MS) { b = { windowStart: now, count: 0 }; rateBuckets.set(ip, b); }
  b.count++;
  return b.count <= RATE_LIMIT_MAX;
}

const STORAGE_BUCKET = 'nancy-user-photos';
let _bucketEnsured = false;
async function ensureBucket(supabaseUrl, serviceKey) {
  if (_bucketEnsured) return;
  try {
    await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      // Private (not public) — user photos are personal, unlike generated
      // creative assets. Reads happen with a signed URL, see below.
      body: JSON.stringify({ id: STORAGE_BUCKET, name: STORAGE_BUCKET, public: false }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* likely already exists */ }
  _bucketEnsured = true;
}

async function uploadToSupabaseStorage(buffer, mimeType, fileName) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  await ensureBucket(supabaseUrl, serviceKey);
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${fileName}`;
  const upRes = await fetch(`${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${key}`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': mimeType },
    body: buffer,
    signal: AbortSignal.timeout(20000),
  });
  if (!upRes.ok) return null;

  // Private bucket — issue a long-lived signed URL rather than a public one.
  const signRes = await fetch(`${supabaseUrl}/storage/v1/object/sign/${STORAGE_BUCKET}/${key}`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 365 }), // 1 year
    signal: AbortSignal.timeout(10000),
  });
  if (!signRes.ok) return null;
  const signed = await signRes.json().catch(() => null);
  return signed?.signedURL ? `${supabaseUrl}/storage/v1${signed.signedURL}` : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });

  const { userId, brandId, dataUri, fileName = 'photo.jpg' } = req.body || {};
  if (!userId) return res.status(401).json({ error: 'userId is required (must be signed in)' });
  if (!dataUri || typeof dataUri !== 'string') return res.status(400).json({ error: 'dataUri is required' });

  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUri);
  if (!match) return res.status(400).json({ error: 'dataUri must be a base64 data URI' });

  const [, mimeType, b64] = match;
  if (!ALLOWED_MIME.has(mimeType.toLowerCase())) {
    return res.status(400).json({ error: `Unsupported file type "${mimeType}". Use JPG, PNG, WEBP, or HEIC.` });
  }

  let buffer;
  try {
    buffer = Buffer.from(b64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Could not decode image data' });
  }
  if (!buffer.length) return res.status(400).json({ error: 'Empty file' });
  if (buffer.length > MAX_BYTES) return res.status(413).json({ error: `File too large — max ${Math.round(MAX_BYTES / 1024 / 1024)}MB` });

  const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);

  let storageUrl = null;
  if (isR2Configured()) {
    try {
      storageUrl = await uploadToR2(`nancy-user-photos/${userId}/${Date.now()}-${safeName}`, buffer, mimeType);
    } catch (err) {
      console.warn('[nancy-upload-photo] R2 upload failed, trying Supabase Storage:', err.message);
    }
  }
  if (!storageUrl) {
    try {
      storageUrl = await uploadToSupabaseStorage(buffer, mimeType, safeName);
    } catch (err) {
      console.warn('[nancy-upload-photo] Supabase Storage upload failed:', err.message);
    }
  }
  if (!storageUrl) {
    return res.status(503).json({ error: 'No storage backend configured (R2_* or SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY) — could not persist the photo. It can still be used for this session only.' });
  }

  const metadata = { sizeBytes: buffer.length, mimeType, originalFileName: fileName };

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let photoRow = null;
  if (supabaseUrl && serviceKey) {
    const { ok, data } = await sbRest(supabaseUrl, serviceKey, 'POST', '/nancy_user_photos', {
      user_id: userId, brand_id: brandId || null, storage_url: storageUrl, metadata,
    });
    if (ok && Array.isArray(data)) photoRow = data[0];
  }

  return res.json({
    success: true,
    photo: photoRow || { id: null, storage_url: storageUrl, metadata },
  });
};
