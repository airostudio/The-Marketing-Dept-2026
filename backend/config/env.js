/**
 * Environment variable validation.
 * Fails fast at boot if required variables are missing or insecure.
 */

const REQUIRED = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DB_PASSWORD'];

const INSECURE_DEFAULTS = new Set([
  'change-this-secret-in-production',
  'change-this-refresh-secret-in-production',
  'audema_dev_password',
  'changeme',
  'secret',
  'password'
]);

function validateEnv() {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      `Set them in your environment or .env file before starting the server.`
    );
  }

  if (process.env.NODE_ENV === 'production') {
    const insecure = REQUIRED.filter((name) =>
      INSECURE_DEFAULTS.has(process.env[name])
    );
    if (insecure.length > 0) {
      throw new Error(
        `Refusing to boot in production with insecure default values for: ${insecure.join(', ')}. ` +
        `Generate strong secrets (e.g. \`openssl rand -hex 32\`).`
      );
    }

    if (process.env.JWT_SECRET.length < 32 || process.env.JWT_REFRESH_SECRET.length < 32) {
      throw new Error(
        'JWT secrets must be at least 32 characters in production. ' +
        'Generate with: openssl rand -hex 32'
      );
    }

    if (!process.env.CORS_ORIGIN) {
      throw new Error(
        'CORS_ORIGIN must be set explicitly in production (no wildcard fallback).'
      );
    }
  }
}

module.exports = { validateEnv };
