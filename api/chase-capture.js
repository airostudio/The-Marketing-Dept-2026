/**
 * api/chase-capture.js — Chase's Site Capture: a full-page screenshot of any
 * public website, for prospect audits and "before" shots in outreach.
 *
 * POST { url, options?: { fullPage, width, height, scale, lazyScroll, hideFixed, delayMs, blockBanners } }
 *   → { ok, imageUrl, storage: 'permanent'|'inline', filename, width, height, bytes, provider, notes }
 * Header: Authorization: Bearer <Supabase access token>
 *
 * The page is captured by the hosted screenshot service (api/_lib/site-capture.js).
 * The address is checked first so only public websites are captured — never
 * this server's own network. The image is stored in R2 when it is configured
 * (a permanent link); otherwise it is returned inline if it is small enough
 * to send back, and the response says it is not stored anywhere.
 *
 * Env: SCREENSHOT_API_KEY, SCREENSHOT_PROVIDER (screenshotone recommended for
 * full pages). Optional R2_* to keep captures.
 */

'use strict';

const crypto = require('crypto');
const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { validateTarget } = require('./_lib/safe-fetch.js');
const { capture } = require('./_lib/site-capture.js');
const { uploadToR2, isR2Configured } = require('./_lib/r2.js');

// Vercel caps a response at about 4.5 MB; base64 adds a third.
const MAX_INLINE_BYTES = 3 * 1024 * 1024;

function filenameFor(url) {
  let host = 'page', path = '';
  try { const u = new URL(url); host = u.hostname.replace(/^www\./, ''); path = u.pathname.replace(/^\/+|\/+$/g, '').replace(/\//g, '_'); } catch { /* keep defaults */ }
  const base = `${host}${path ? '_' + path : ''}`.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80) || 'page';
  return `${base}_${new Date().toISOString().slice(0, 10)}_${crypto.randomBytes(4).toString('hex')}.png`;
}

module.exports = withFailureReporting('api/chase-capture', async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Every capture is a paid call to the screenshot service.
  const auth = await requireUser(req, res);
  if (!auth) return;
  if (rateLimited(req, res, { name: 'chase-capture', max: 6, windowMs: 60 * 1000, auth })) return;

  const body = req.body || {};
  let raw = String(body.url || '').trim();
  if (!raw) return res.status(400).json({ error: 'Enter a website address.', field: 'url' });
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  const target = await validateTarget(raw);
  if (!target.ok) return res.status(400).json({ error: `That address can't be captured: ${target.reason}.`, field: 'url' });
  const url = target.url.href;

  const shot = await capture(url, body.options || {});
  if (!shot.ok) return res.status(shot.code === 'not_configured' || shot.code === 'bad_provider' ? 503 : 502).json({ error: shot.error, code: shot.code });

  const filename = filenameFor(url);
  const out = { ok: true, url, filename, width: shot.width, height: shot.height, bytes: shot.buffer.length, provider: shot.provider, notes: shot.notes || [] };

  if (isR2Configured()) {
    try {
      const hosted = await uploadToR2(`captures/${auth.user.id}/${filename}`, shot.buffer, shot.mimeType);
      if (hosted) return res.json({ ...out, imageUrl: hosted, storage: 'permanent' });
      out.notes.push('R2_PUBLIC_BASE_URL is not set, so the capture was stored without a public link.');
    } catch (e) {
      out.notes.push(`The capture could not be stored (${e.message}).`);
    }
  }
  if (shot.buffer.length > MAX_INLINE_BYTES) {
    return res.status(413).json({ error: `The capture is ${(shot.buffer.length / 1048576).toFixed(1)} MB, too big to send back without storage. Set up R2 storage to keep large captures, or capture at 1× or without full page.`, code: 'too_large' });
  }
  return res.json({ ...out, imageUrl: `data:${shot.mimeType};base64,${shot.buffer.toString('base64')}`, storage: 'inline', notes: [...out.notes, 'Not stored: download it now — it will not be kept.'] });
});

module.exports.filenameFor = filenameFor;
