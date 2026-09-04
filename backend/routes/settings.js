const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { generateCertificate, getCertStatus } = require('../services/certificate');

// GET /api/settings
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const result = await query('SELECT key, value FROM settings ORDER BY key');
    const settings = {};
    result.rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  } catch (error) {
    next(error);
  }
});

// PUT /api/settings — admin only
router.put('/', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const allowedKeys = [
      'panel_name', 'panel_url', 'sub_base_url',
      'tls_domain', 'tls_email', 'xray_version',
      'default_traffic_limit_gb', 'default_duration_days'
    ];
    
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowedKeys.includes(key)) continue;
      await query(
        'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
        [key, String(value)]
      );
    }
    
    res.json({ message: 'Settings saved successfully' });
  } catch (error) {
    next(error);
  }
});

// POST /api/settings/certificate — generate SSL cert
router.post('/certificate', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const { domain, email, type = 'letsencrypt' } = req.body;
    
    if (!domain) return res.status(400).json({ error: 'Domain is required' });
    
    if (type === 'letsencrypt' && !email) {
      return res.status(400).json({ error: 'Email is required for Let\'s Encrypt' });
    }
    
    const result = await generateCertificate({ domain, email, type });
    
    // Save to settings
    await query(
      'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
      ['tls_domain', domain]
    );
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/certificate — cert status
router.get('/certificate', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const domainResult = await query('SELECT value FROM settings WHERE key = \'tls_domain\'');
    const domain = domainResult.rows[0]?.value;
    
    if (!domain) return res.json({ status: 'none', domain: null });
    
    const status = await getCertStatus(domain);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
