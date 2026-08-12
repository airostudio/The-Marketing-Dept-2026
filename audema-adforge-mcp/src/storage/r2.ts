/**
 * Cloudflare R2 (S3-compatible object storage) upload helper — the same
 * signing implementation as the main Audema web app's api/_lib/r2.js
 * (hand-rolled AWS SigV4 via Node's built-in crypto, no aws-sdk dependency),
 * so exported ad creative can optionally land in the SAME shared bucket the
 * live product uses, under an "adforge/" prefix.
 *
 * This is what closes the gap between "AdForge rendered a file to local
 * disk" and "the main app's Pat/publish flow can actually use it" — those
 * flows need a real hosted URL, not a local file path.
 *
 * SigV4 is a stable, long-standing public cryptographic standard, not a
 * shifting vendor API contract — but a signing bug still fails loudly and
 * immediately (403 SignatureDoesNotMatch), never silently. Verify with one
 * real upload after adding credentials; check the object appears in the R2
 * dashboard.
 *
 * Env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET_NAME, and optionally R2_PUBLIC_BASE_URL (a custom domain or the
 * bucket's r2.dev URL — required to get back a fetchable URL; without it,
 * the upload still succeeds but the hosted URL comes back null).
 */

import { createHash, createHmac } from 'node:crypto';

const REGION = 'auto';
const SERVICE = 's3';

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function getSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export function isR2Configured(): boolean {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME);
}

/**
 * Uploads a buffer to R2 under the given key (e.g. "adforge/foo.png").
 * Returns the public URL if R2_PUBLIC_BASE_URL is set, else null (upload
 * still succeeded — there's just no way to build a fetchable URL for it).
 * Throws on any failure.
 */
export async function uploadToR2(key: string, buffer: Buffer, contentType: string): Promise<string | null> {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('R2 is not configured (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME).');
  }

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const payloadHash = sha256Hex(buffer);

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
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `https://${host}${canonicalUri}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'Authorization': authorization,
      'Content-Type': contentType,
    },
    body: buffer,
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`R2 upload failed (${res.status}): ${errText}`);
  }

  const publicBase = process.env.R2_PUBLIC_BASE_URL;
  return publicBase ? `${publicBase.replace(/\/+$/, '')}/${key}` : null;
}
