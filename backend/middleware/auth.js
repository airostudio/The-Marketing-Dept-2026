/**
 * Authentication Middleware
 * JWT-based authentication with role-based access control
 */

const jwt = require('jsonwebtoken');
const db = require('../config/database');

/**
 * Verify JWT token and attach user to request
 */
async function authenticate(req, res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from database
    const result = await db.query(
      'SELECT id, organization_id, email, first_name, last_name, role, status FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = result.rows[0];

    // Check if user is active
    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: 'User account is not active'
      });
    }

    // Attach user to request
    req.user = user;
    req.organizationId = user.organization_id;

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired'
      });
    }

    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
}

/**
 * Require specific role(s)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions'
      });
    }

    next();
  };
}

/**
 * Optional authentication (attach user if token present, but don't require it)
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const result = await db.query(
        'SELECT id, organization_id, email, first_name, last_name, role FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (result.rows.length > 0) {
        req.user = result.rows[0];
        req.organizationId = result.rows[0].organization_id;
      }
    }
  } catch (error) {
    // Silently fail for optional auth
  }

  next();
}

module.exports = {
  authenticate,
  requireRole,
  optionalAuth
};
