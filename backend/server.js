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

// Security headers
app.use(helmet({
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],
      imgSrc:         ["'self'", 'data:', 'https:'],
      connectSrc:     ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
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
  req.id = Math.random().toString(36).substring(7);
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

  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
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
