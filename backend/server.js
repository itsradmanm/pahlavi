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

const http = require('http');
const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');

function resolveSslCertificates() {
  const isSslExplicitlyDisabled = process.env.ENABLE_SSL === 'false' || process.env.ENABLE_SSL === '0';
  if (isSslExplicitlyDisabled) {
    return { isSsl: false };
  }

  const isSslRequested = process.env.ENABLE_SSL === 'true' || process.env.ENABLE_SSL === '1';
  const domain = process.env.TLS_DOMAIN;
  const envCert = process.env.SSL_CERT_PATH;
  const envKey = process.env.SSL_KEY_PATH;

  const candidatePairs = [
    { cert: envCert, key: envKey },
    { cert: '/etc/pahlavy/certs/active/fullchain.pem', key: '/etc/pahlavy/certs/active/privkey.pem' },
    domain ? { cert: `/etc/letsencrypt/live/${domain}/fullchain.pem`, key: `/etc/letsencrypt/live/${domain}/privkey.pem` } : null,
    domain ? { cert: `/etc/pahlavy/certs/${domain}/fullchain.pem`, key: `/etc/pahlavy/certs/${domain}/privkey.pem` } : null
  ].filter(Boolean);

  for (const pair of candidatePairs) {
    if (pair.cert && pair.key && fs.existsSync(pair.cert) && fs.existsSync(pair.key)) {
      try {
        const cert = fs.readFileSync(pair.cert);
        const key = fs.readFileSync(pair.key);
        return { isSsl: true, cert, key, certPath: pair.cert, keyPath: pair.key, isSelfSigned: pair.cert.includes('pahlavy') };
      } catch (err) {
        console.warn('⚠️ Could not read SSL cert pair:', pair, err.message);
      }
    }
  }

  // If SSL was explicitly enabled or domain is configured, generate self-signed fallback
  if (isSslRequested && domain && domain !== '127.0.0.1' && domain !== 'localhost') {
    try {
      const certDir = `/etc/pahlavy/certs/${domain}`;
      execSync(`mkdir -p ${certDir} /etc/pahlavy/certs/active`, { stdio: 'ignore' });
      execSync(
        `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ${certDir}/privkey.pem -out ${certDir}/fullchain.pem -subj "/CN=${domain}" 2>/dev/null`,
        { timeout: 15000 }
      );
      execSync(`cp -f ${certDir}/privkey.pem /etc/pahlavy/certs/active/privkey.pem && cp -f ${certDir}/fullchain.pem /etc/pahlavy/certs/active/fullchain.pem`, { stdio: 'ignore' });
      const cert = fs.readFileSync(`${certDir}/fullchain.pem`);
      const key = fs.readFileSync(`${certDir}/privkey.pem`);
      return { isSsl: true, cert, key, certPath: `${certDir}/fullchain.pem`, keyPath: `${certDir}/privkey.pem`, isSelfSigned: true };
    } catch (e) {
      console.warn('⚠️ Auto-generation of self-signed SSL cert fallback failed:', e.message);
    }
  }

  return { isSsl: false };
}

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
    
    const ssl = resolveSslCertificates();
    const host = process.env.TLS_DOMAIN || 'localhost';

    if (ssl.isSsl && ssl.cert && ssl.key) {
      const httpsServer = https.createServer({ cert: ssl.cert, key: ssl.key }, app);
      httpsServer.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Pahlavi Panel (Sanaei 3X-UI Edition) running with HTTPS on port ${PORT}`);
        console.log(`🔒 SSL Active: ${ssl.certPath} ${ssl.isSelfSigned ? '(Self-Signed Fallback)' : '(Valid SSL)'}`);
        console.log(`🌐 Web UI: https://${host}:${PORT}`);
      });
    } else {
      const httpServer = http.createServer(app);
      httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Pahlavi Panel (Sanaei 3X-UI Edition) running with HTTP on port ${PORT}`);
        console.log(`🌐 Web UI: http://${host}:${PORT}`);
      });
    }
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

start();

module.exports = app;
