const express = require('express');
const router = express.Router();
const { execSync } = require('child_process');
const fs = require('fs');
const { query } = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { generateCertificate, getCertStatus } = require('../services/certificate');
const { applyConfigToXray } = require('../services/xray');

// GET /api/settings
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const result = await query('SELECT key, value FROM settings ORDER BY key');
    const settings = {};
    result.rows.forEach(r => settings[r.key] = r.value);
    
    // Add current port and SSL environment status
    settings.port = process.env.PORT || 3000;
    settings.enable_ssl = process.env.ENABLE_SSL === 'true' || fs.existsSync('/etc/pahlavy/certs/active/fullchain.pem');
    
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
      'tls_domain', 'xray_version',
      'default_traffic_limit_gb', 'default_duration_days',
      'telegram_bot_token', 'telegram_admin_id', 'telegram_alerts_enabled',
      'ssl_cert_path', 'ssl_key_path'
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

// POST /api/settings/certificate — generate SSL cert (Zero email required)
router.post('/certificate', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const { domain, type = 'letsencrypt' } = req.body;
    
    if (!domain) return res.status(400).json({ error: 'Domain name is required' });
    
    const result = await generateCertificate({ domain, type });
    
    // Save to settings
    await query(
      'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
      ['tls_domain', domain]
    );

    // Update .env if exists
    try {
      const envPath = '/opt/pahlavy/backend/.env';
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        envContent = envContent.replace(/^ENABLE_SSL=.*/m, 'ENABLE_SSL=true');
        envContent = envContent.replace(/^TLS_DOMAIN=.*/m, `TLS_DOMAIN=${domain}`);
        fs.writeFileSync(envPath, envContent);
      }
    } catch {}

    // Resync Xray for TLS inbounds
    await applyConfigToXray().catch(() => {});
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/certificate — cert status
router.get('/certificate', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const domainResult = await query('SELECT value FROM settings WHERE key = \'tls_domain\'');
    const domain = domainResult.rows[0]?.value || process.env.TLS_DOMAIN;
    
    if (!domain) return res.json({ status: 'none', domain: null });
    
    const status = await getCertStatus(domain);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

// POST /api/settings/restart-core — Restart Xray core
router.post('/restart-core', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    await applyConfigToXray();
    try {
      execSync('systemctl restart xray 2>/dev/null', { timeout: 5000 });
    } catch {}
    res.json({ message: 'Xray-core restarted successfully' });
  } catch (error) {
    next(error);
  }
});

// POST /api/settings/restart-panel — Restart Panel web server
router.post('/restart-panel', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    res.json({ message: 'Pahlavi panel restarting in 2 seconds...' });
    setTimeout(() => {
      try {
        execSync('systemctl restart pahlavy 2>/dev/null');
      } catch {}
    }, 1500);
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/backup — Complete database JSON backup
router.get('/backup', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const users = await query('SELECT * FROM users');
    const inbounds = await query('SELECT * FROM inbounds');
    const clients = await query('SELECT * FROM clients');
    const settings = await query('SELECT * FROM settings');

    const backupData = {
      version: '2.0.0',
      created_at: new Date().toISOString(),
      data: {
        users: users.rows,
        inbounds: inbounds.rows,
        clients: clients.rows,
        settings: settings.rows
      }
    };

    res.set('Content-Disposition', `attachment; filename="pahlavy_backup_${Date.now()}.json"`);
    res.json(backupData);
  } catch (error) {
    next(error);
  }
});

// POST /api/settings/restore — Restore database from backup JSON
router.post('/restore', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const backup = req.body;
    if (!backup || !backup.data) {
      return res.status(400).json({ error: 'Invalid backup file payload' });
    }

    const { inbounds = [], clients = [], settings = [] } = backup.data;

    // Restore Settings
    for (const s of settings) {
      await query(
        'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
        [s.key, s.value]
      );
    }

    // Restore Inbounds
    for (const inb of inbounds) {
      await query(`
        INSERT INTO inbounds (id, user_id, remark, port, protocol, listen, settings, stream_settings, sniffing, tag, enable)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET
          remark = EXCLUDED.remark, port = EXCLUDED.port, protocol = EXCLUDED.protocol,
          settings = EXCLUDED.settings, stream_settings = EXCLUDED.stream_settings,
          sniffing = EXCLUDED.sniffing, enable = EXCLUDED.enable
      `, [
        inb.id, inb.user_id, inb.remark, inb.port, inb.protocol, inb.listen,
        JSON.stringify(inb.settings || {}), JSON.stringify(inb.stream_settings || {}),
        JSON.stringify(inb.sniffing || {}), inb.tag, inb.enable
      ]);
    }

    // Restore Clients
    for (const c of clients) {
      await query(`
        INSERT INTO clients (id, inbound_id, email, uuid, flow, password, traffic_limit_gb, traffic_used_gb, duration_days, expires_at, start_after_first_use, sub_token, created_by, enable)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email, uuid = EXCLUDED.uuid, flow = EXCLUDED.flow,
          password = EXCLUDED.password, traffic_limit_gb = EXCLUDED.traffic_limit_gb,
          expires_at = EXCLUDED.expires_at, enable = EXCLUDED.enable
      `, [
        c.id, c.inbound_id, c.email, c.uuid, c.flow, c.password,
        c.traffic_limit_gb, c.traffic_used_gb || 0, c.duration_days,
        c.expires_at, c.start_after_first_use, c.sub_token, c.created_by, c.enable
      ]);
    }

    await applyConfigToXray();

    res.json({ message: 'Backup restored successfully and Xray re-synced!' });
  } catch (error) {
    next(error);
  }
});

// POST /api/settings/telegram/test
router.post('/telegram/test', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const { token, chatId } = req.body;
    if (!token || !chatId) {
      return res.status(400).json({ error: 'Token and Chat ID are required' });
    }

    const https = require('https');
    const text = encodeURIComponent('🦁 *پیام آزمایشی پنل پهلوی (Pahlavi Panel)*\n\n✅ اتصال به ربات تلگرام با موفقیت برقرار شد!');
    const url = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${text}&parse_mode=Markdown`;

    https.get(url, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok) {
            res.json({ success: true, message: 'پیام آزمایشی به تلگرام ارسال شد' });
          } else {
            res.status(400).json({ error: parsed.description || 'Telegram API Error' });
          }
        } catch {
          res.status(400).json({ error: 'Failed to parse response from Telegram' });
        }
      });
    }).on('error', (err) => {
      res.status(500).json({ error: err.message });
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
