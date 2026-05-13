/**
 * Database Configuration
 * PostgreSQL connection pool using pg library
 */

const { Pool } = require('pg');
require('dotenv').config();

const STATEMENT_TIMEOUT_MS = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS, 10) || 10_000;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'audema',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  statement_timeout: STATEMENT_TIMEOUT_MS,
  query_timeout: STATEMENT_TIMEOUT_MS
});

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('✅ Database connected');
  }
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
  // Don't process.exit on a transient pool error — let the pool recover.
});

/**
 * Execute a query with automatic error handling.
 * Logs timing but not the raw SQL or parameters (avoids leaking PII).
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'production' || duration > 500) {
      const label = text.split(/\s+/, 2).join(' ').slice(0, 40);
      console.log(`📊 Query [${label}…] ${duration}ms rows=${res.rowCount}`);
    }
    return res;
  } catch (error) {
    console.error('❌ Query error:', error.message);
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 */
async function getClient() {
  return await pool.connect();
}

module.exports = {
  query,
  getClient,
  pool
};
