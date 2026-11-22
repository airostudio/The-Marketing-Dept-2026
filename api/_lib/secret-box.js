/**
 * api/_lib/secret-box.js — encrypt a business's connection secrets (a
 * WordPress application password, a Shopify token…) before they are stored,
 * and decrypt them only inside the server when an agent needs to act.
 *
 * AES-256-GCM with a key from CONNECTIONS_ENCRYPTION_KEY (any long random
 * string; it is hashed to 32 bytes). Fails closed: with no key set nothing
 * is stored, rather than storing a secret in plain text.
 *
 * Format: v1.<iv b64url>.<tag b64url>.<ciphertext b64url>
 */

'use strict';

const crypto = require('crypto');

const NOT_CONFIGURED = 'CONNECTIONS_ENCRYPTION_KEY is not set, so connection secrets cannot be stored safely. Add a long random value in Vercel (e.g. the output of `openssl rand -base64 48`).';

function key() {
  const raw = process.env.CONNECTIONS_ENCRYPTION_KEY || '';
  if (raw.length < 32) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

function isConfigured() { return !!key(); }

/** @param {object} value  any JSON-able secret bundle */
function seal(value) {
  const k = key();
  if (!k) { const e = new Error(NOT_CONFIGURED); e.status = 503; e.kind = 'not_configured'; throw e; }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

/** @returns {object} the secret bundle; throws if the key is wrong or the value was tampered with */
function open(sealed) {
  const k = key();
  if (!k) { const e = new Error(NOT_CONFIGURED); e.status = 503; e.kind = 'not_configured'; throw e; }
  const [v, iv, tag, ct] = String(sealed || '').split('.');
  if (v !== 'v1' || !iv || !tag || !ct) { const e = new Error('The stored connection secret is unreadable.'); e.kind = 'auth'; throw e; }
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8'));
  } catch {
    // The key changed or the row was altered: the business has to reconnect.
    const e = new Error('The stored connection secret could not be decrypted (the encryption key may have changed).'); e.kind = 'auth'; throw e;
  }
}

module.exports = { seal, open, isConfigured, NOT_CONFIGURED };
