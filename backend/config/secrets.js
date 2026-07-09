/**
 * Application-layer encryption for integration credentials.
 *
 * Uses AES-256-GCM with a key supplied via INTEGRATION_ENCRYPTION_KEY
 * (hex, 64 chars = 32 bytes). If the key is missing in non-production
 * environments we warn once and pass values through unchanged so local dev
 * keeps working without forcing a key on every contributor.
 */

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = 'enc::v1::';

let warned = false;

function getKey() {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) {
    if (!warned) {
      warned = true;
      const msg = 'INTEGRATION_ENCRYPTION_KEY not set — integration credentials will be stored in plaintext. Generate one with `openssl rand -hex 32` and set it before going to production.';
      if (process.env.NODE_ENV === 'production') {
        // Fail loud so prod can't silently store secrets in plaintext.
        throw new Error(msg);
      }
      console.warn('⚠️  ' + msg);
    }
    return null;
  }
  const buf = Buffer.from(raw, 'hex');
  if (buf.length !== 32) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  }
  return buf;
}

function encryptString(plaintext) {
  if (plaintext == null) return plaintext;
  const key = getKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptString(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  const key = getKey();
  if (!key) return value;

  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

// Sensitive field names that should be encrypted regardless of integration.
const SENSITIVE_FIELDS = new Set([
  'apiKey', 'api_key', 'secretKey', 'secret_key', 'accessId',
  'accessToken', 'refreshToken', 'clientSecret', 'webhookUrl',
  'password', 'token'
]);

function encryptIntegrations(integrations) {
  if (!integrations || typeof integrations !== 'object') return integrations;
  const out = {};
  for (const [provider, creds] of Object.entries(integrations)) {
    if (!creds || typeof creds !== 'object') { out[provider] = creds; continue; }
    const encrypted = {};
    for (const [field, val] of Object.entries(creds)) {
      encrypted[field] = SENSITIVE_FIELDS.has(field) ? encryptString(val) : val;
    }
    out[provider] = encrypted;
  }
  return out;
}

function decryptIntegrations(integrations) {
  if (!integrations || typeof integrations !== 'object') return integrations;
  const out = {};
  for (const [provider, creds] of Object.entries(integrations)) {
    if (!creds || typeof creds !== 'object') { out[provider] = creds; continue; }
    const decrypted = {};
    for (const [field, val] of Object.entries(creds)) {
      decrypted[field] = SENSITIVE_FIELDS.has(field) ? decryptString(val) : val;
    }
    out[provider] = decrypted;
  }
  return out;
}

module.exports = {
  encryptString,
  decryptString,
  encryptIntegrations,
  decryptIntegrations
};
