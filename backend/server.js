/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AUDEMA BACKEND API SERVER
 * Express.js REST API for AI Marketing Platform
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const db = require('./config/database');
const { authenticate, requireRole } = require('./middleware/auth');

// Import API routes
const authRoutes = require('./api/auth');
const customerRoutes = require('./api/customers');
const healthScoreRoutes = require('./api/health-scores');
const campaignRoutes = require('./api/campaigns');
const lifecycleRoutes = require('./api/lifecycle');
const dealRoutes = require('./api/deals');
const icpRoutes = require('./api/icp');
const integrationRoutes = require('./api/integrations');

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

// Security
app.use(helmet());

// CORS — credentials:true requires an explicit origin, never a wildcard
const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin || corsOrigin === '*') {
  console.warn('⚠️  CORS_ORIGIN is not set or is wildcard — defaulting to no credentials mode');
}
app.use(cors({
  origin: corsOrigin || false,
  credentials: !!corsOrigin && corsOrigin !== '*'
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// Rate limiting — general API limit
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: { success: false, error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// Stricter rate limit on auth endpoints to prevent brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

// Request ID (for debugging) — use crypto for uniqueness guarantee
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Health check
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    await db.query('SELECT 1');
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: 'Database connection failed'
    });
  }
});

// API routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/customers', authenticate, customerRoutes);
app.use('/api/health-scores', authenticate, healthScoreRoutes);
app.use('/api/campaigns', authenticate, campaignRoutes);
app.use('/api/lifecycle', authenticate, lifecycleRoutes);
app.use('/api/deals', authenticate, dealRoutes);
app.use('/api/icp', authenticate, icpRoutes);
app.use('/api/integrations', authenticate, integrationRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Global error handler — never expose raw error messages or stack traces to clients
app.use((err, req, res, next) => {
  console.error('❌ Error:', {
    requestId: req.id,
    error: err.message,
    stack: err.stack
  });

  const statusCode = err.status || 500;
  const clientMessage = statusCode < 500 ? err.message : 'Internal server error';

  res.status(statusCode).json({
    success: false,
    error: clientMessage,
    requestId: req.id
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║                                                               ║
  ║   🚀 AUDEMA BACKEND API SERVER                                ║
  ║                                                               ║
  ║   Environment: ${process.env.NODE_ENV || 'development'}      ║
  ║   Port:        ${PORT}                                        ║
  ║   Database:    ${process.env.DB_NAME || 'audema'}            ║
  ║                                                               ║
  ║   API:         http://localhost:${PORT}/api                  ║
  ║   Health:      http://localhost:${PORT}/health               ║
  ║                                                               ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
async function shutdown(signal) {
  console.log(`${signal} received, closing server...`);
  await db.pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
