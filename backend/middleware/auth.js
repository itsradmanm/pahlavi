const jwt = require('jsonwebtoken');
const { query } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'pahlavy-jwt-secret-change-in-production';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.cookies?.token;
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    const result = await query(
      'SELECT id, username, role, is_active, traffic_quota_gb, traffic_used_gb, max_configs, configs_created, expires_at FROM users WHERE id = $1',
      [decoded.id]
    );
    
    if (!result.rows[0]) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is disabled' });
    }
    
    if (user.expires_at && new Date(user.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Account has expired' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    next(error);
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function resellerOrAdmin(req, res, next) {
  if (!['admin', 'reseller'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}

module.exports = { authMiddleware, adminOnly, resellerOrAdmin, generateToken, JWT_SECRET };
