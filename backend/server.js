require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const session = require('express-session');
const { initDatabase } = require('./database');
const { startTrafficMonitor } = require('./services/traffic');
const { startConfigExpiryChecker, applyConfigToXray } = require('./services/xray');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for reverse proxy headers (e.g. Nginx, Cloudflare)
app.set('trust proxy', 1);

// ========== Middleware ==========
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true
}));

app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'pahlavy-secret-key-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Too many requests, please try again later.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many login attempts, please try again later.' }
});
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// ========== Routes ==========
app.use('/api/auth', require('./routes/auth'));
app.use('/api/inbounds', require('./routes/inbounds'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/reseller', require('./routes/reseller'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/subscription', require('./routes/subscription'));
app.use('/api/settings', require('./routes/settings'));

// Public subscription endpoints (v2rayNG, Clash, V2Box, etc.)
app.use('/sub', require('./routes/subscription'));

// ========== Static Files ==========
app.use(express.static(path.join(__dirname, '../frontend')));

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/sub')) {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  }
});

// ========== Error Handler ==========
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// ========== Startup Sequence ==========
async function start() {
  try {
    await initDatabase();
    console.log('✅ PostgreSQL Database connected & schema verified');
    
    // Apply initial Xray config
    try {
      await applyConfigToXray();
      console.log('✅ Xray core configuration synced');
    } catch (e) {
      console.warn('⚠️ Xray core initial sync note:', e.message);
    }
    
    startTrafficMonitor();
    console.log('✅ Real-time traffic monitor started');
    
    startConfigExpiryChecker();
    console.log('✅ Client expiry & quota checker started');
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Pahlavi Panel (Sanaei 3X-UI Edition) running on port ${PORT}`);
      console.log(`🌐 Web UI: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

start();

module.exports = app;
