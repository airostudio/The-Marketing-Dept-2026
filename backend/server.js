/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AUDEMA BACKEND API SERVER
 * Express.js REST API for AI Marketing Platform
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
require('dotenv').config();

const { validateEnv } = require('./config/env');
validateEnv();

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

// Trust proxy when running behind nginx/Vercel so rate limiting sees real client IPs
app.set('trust proxy', 1);

// Security headers (CSP defaults: only same-origin scripts/styles, allow Claude proxy via same-origin)
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginResourcePolicy: { policy: 'same-site' }
}));

// CORS — explicit allowlist. Comma-separated origins in CORS_ORIGIN.
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0 && process.env.NODE_ENV !== 'production') {
  // Dev default: allow common local frontends
  allowedOrigins.push('http://localhost:8080', 'http://localhost:3000', 'http://localhost:5173');
}

app.use(cors({
  origin(origin, callback) {
    // Allow same-origin / curl / server-to-server (no Origin header)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    success: false,
    error: 'Too many requests, please try again later'
  }
});
app.use('/api/', limiter);

// Request ID (for debugging)
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
app.use('/api/auth', authRoutes);
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

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', {
    requestId: req.id,
    error: err.message,
    stack: err.stack
  });

  const status = err.status || 500;
  const exposeMessage = status < 500 || process.env.NODE_ENV !== 'production';
  res.status(status).json({
    success: false,
    error: exposeMessage ? (err.message || 'Internal server error') : 'Internal server error',
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
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await db.pool.end();
  process.exit(0);
});

module.exports = app;
