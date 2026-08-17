/**
 * api/_lib/r2.js — Cloudflare R2 (S3-compatible object storage) upload helper.
 *
 * Files under api/_lib/ are NOT treated as routes by Vercel — this is a
 * shared module, imported by api/generate-ad-image.js and
 * api/render-social-image.js, not a serverless function itself.
 *
 * Implements AWS Signature Version 4 signing by hand (Node's built-in
 * `crypto` only — no aws-sdk dependency, matching this project's zero-
 * dependency api/*.js convention) since R2 exposes an S3-compatible API
 * authenticated the same way S3 is.
 *
 * SigV4 itself is a stable, long-standing public cryptographic standard
 * (not a shifting vendor API contract) — but a signing bug still fails
 * loudly and immediately (403 SignatureDoesNotMatch), never silently. The
 * first real upload after adding credentials is the actual verification;
 * check the object appears in the R2 dashboard.
 *
 * Env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET_NAME, and optionally R2_PUBLIC_BASE_URL (a custom domain or the
 * bucket's r2.dev URL — required to get back a publicly fetchable URL;
 * without it, uploads still succeed but hostedUrl comes back null, since
 * the S3 API endpoint itself isn't public).
 */

'use strict';

const crypto = require('crypto');

const REGION = 'auto';
const SERVICE = 's3';

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function getSigningKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmac('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function isR2Configured() {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME);
}

/**
 * Uploads a buffer to R2 under the given key (e.g. "social-creatives/foo.png").
 * Returns the public URL if R2_PUBLIC_BASE_URL is set, else null (upload
 * still succeeded — there's just no way to build a fetchable URL for it).
 * Throws on any failure — callers decide whether that's fatal or a
 * fall-back-to-another-backend situation.
 */
async function uploadToR2(key, buffer, contentType) {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('R2 is not configured (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME).');
  }

  const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const payloadHash = sha256Hex(body);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // → YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);

  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const canonicalUri = `/${bucket}/${encodedKey}`;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = getSigningKey(secretAccessKey, dateStamp, REGION, SERVICE);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `https://${host}${canonicalUri}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'Authorization': authorization,
      'Content-Type': contentType || 'application/octet-stream',
    },
    body,
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`R2 upload failed (${res.status}): ${errText}`);
  }

  const publicBase = process.env.R2_PUBLIC_BASE_URL;
  return publicBase ? `${publicBase.replace(/\/+$/, '')}/${key}` : null;
}

module.exports = { uploadToR2, isR2Configured };
