const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { query } = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { applyConfigToXray, removeConfigFromXray } = require('../services/xray');

// GET /api/configs — list configs
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const offset = (page - 1) * limit;
    
    let whereClause = req.user.role === 'admin' ? '1=1' : 'c.created_by = $1';
    let params = req.user.role === 'admin' ? [] : [req.user.id];
    let paramIndex = params.length + 1;
    
    if (status) {
      whereClause += ` AND c.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    if (search) {
      whereClause += ` AND c.name ILIKE $${paramIndex}`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    const total = await query(
      `SELECT COUNT(*) FROM configs c WHERE ${whereClause}`,
      params
    );
    
    params.push(limit, offset);
    const result = await query(
      `SELECT c.*, s.name as server_name, s.host as server_host, u.username as owner
       FROM configs c
       LEFT JOIN servers s ON s.id = c.server_id
       LEFT JOIN users u ON u.id = c.created_by
       WHERE ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );
    
    res.json({
      configs: result.rows,
      total: parseInt(total.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/configs/:id — single config with full details
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT c.*, s.name as server_name, s.host as server_host, s.ip as server_ip,
              u.username as owner
       FROM configs c
       LEFT JOIN servers s ON s.id = c.server_id
       LEFT JOIN users u ON u.id = c.created_by
       WHERE c.id = $1 AND (c.created_by = $2 OR $3 = 'admin')`,
      [req.params.id, req.user.id, req.user.role]
    );
    
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Config not found' });
    }
    
    const config = result.rows[0];
    
    // Generate links
    const links = await generateConfigLinks(config);
    config.links = links;
    
    // Generate QR
    const subUrl = await getSubUrl(config);
    config.qr_code = await QRCode.toDataURL(subUrl);
    config.sub_url = subUrl;
    
    res.json(config);
  } catch (error) {
    next(error);
  }
});

// POST /api/configs — create config
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    // Check quota for resellers
    if (req.user.role === 'reseller') {
      if (req.user.configs_created >= req.user.max_configs) {
        return res.status(403).json({ error: 'Config quota exceeded' });
      }
      const remaining = req.user.traffic_quota_gb - req.user.traffic_used_gb;
      if (remaining <= 0) {
        return res.status(403).json({ error: 'Traffic quota exceeded' });
      }
    }
    
    const {
      name,
      server_id,
      protocol = 'vless',
      network = 'ws',
      security = 'tls',
      port,
      host,
      path: wsPath = '/',
      tls_sni,
      tls_fingerprint = 'chrome',
      reality_public_key,
      reality_short_id,
      traffic_limit_gb = 0,
      expires_at,
      duration_days,
      start_after_first_use = false
    } = req.body;
    
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!server_id) return res.status(400).json({ error: 'Server is required' });
    if (!port) return res.status(400).json({ error: 'Port is required' });
    
    // Validate protocol combination
    const validCombos = {
      'vless-ws-tls': true,
      'vless-ws-none': true,
      'vmess-ws-tls': true,
      'vmess-ws-none': true,
      'vless-tcp-reality': true,
    };
    const combo = `${protocol}-${network}-${security}`;
    if (!validCombos[combo]) {
      return res.status(400).json({ error: `Invalid protocol combination: ${combo}` });
    }
    
    // Get server
    const serverResult = await query('SELECT * FROM servers WHERE id = $1', [server_id]);
    if (!serverResult.rows[0]) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    const uuid = uuidv4();
    const subToken = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
    
    // Determine expiry
    let actualExpiresAt = expires_at || null;
    if (start_after_first_use && duration_days && !actualExpiresAt) {
      actualExpiresAt = null; // Will be set on first use
    }
    
    const result = await query(`
      INSERT INTO configs (
        name, created_by, server_id, protocol, network, security,
        uuid, port, host, path, tls_sni, tls_fingerprint,
        reality_public_key, reality_short_id,
        traffic_limit_gb, expires_at, duration_days,
        start_after_first_use, sub_token, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'active')
      RETURNING *
    `, [
      name, req.user.id, server_id, protocol, network, security,
      uuid, port, host || serverResult.rows[0].host, wsPath, tls_sni, tls_fingerprint,
      reality_public_key, reality_short_id,
      traffic_limit_gb, actualExpiresAt, duration_days,
      start_after_first_use, subToken
    ]);
    
    const config = result.rows[0];
    
    // Apply to Xray server
    try {
      await applyConfigToXray(serverResult.rows[0], config);
    } catch (xrayError) {
      console.error('Warning: Failed to apply config to Xray:', xrayError.message);
    }
    
    // Increment reseller config count
    if (req.user.role === 'reseller') {
      await query('UPDATE users SET configs_created = configs_created + 1 WHERE id = $1', [req.user.id]);
    }
    
    // Generate links
    config.links = await generateConfigLinks(config);
    config.sub_url = await getSubUrl(config);
    config.server_host = serverResult.rows[0].host;
    
    res.status(201).json(config);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/configs/:id — update config
router.patch('/:id', authMiddleware, async (req, res, next) => {
  try {
    const existing = await query(
      'SELECT * FROM configs WHERE id = $1 AND (created_by = $2 OR $3 = \'admin\')',
      [req.params.id, req.user.id, req.user.role]
    );
    
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Config not found' });
    }
    
    const allowedFields = [
      'name', 'status', 'traffic_limit_gb', 'expires_at',
      'duration_days', 'start_after_first_use', 'host', 'path', 'tls_sni'
    ];
    
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    const setClause = Object.keys(updates)
      .map((key, i) => `${key} = $${i + 1}`)
      .join(', ');
    const values = [...Object.values(updates), req.params.id];
    
    const result = await query(
      `UPDATE configs SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    
    // Re-apply to Xray if status changed
    if (updates.status) {
      const serverResult = await query('SELECT * FROM servers WHERE id = $1', [result.rows[0].server_id]);
      if (serverResult.rows[0]) {
        try {
          await applyConfigToXray(serverResult.rows[0], result.rows[0]);
        } catch (e) {
          console.error('Xray sync error:', e.message);
        }
      }
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/configs/:id
router.delete('/:id', authMiddleware, async (req, res, next) => {
  try {
    const existing = await query(
      'SELECT c.*, s.* FROM configs c LEFT JOIN servers s ON s.id = c.server_id WHERE c.id = $1 AND (c.created_by = $2 OR $3 = \'admin\')',
      [req.params.id, req.user.id, req.user.role]
    );
    
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Config not found' });
    }
    
    // Remove from Xray
    try {
      await removeConfigFromXray(existing.rows[0], existing.rows[0]);
    } catch (e) {
      console.error('Xray remove error:', e.message);
    }
    
    await query('DELETE FROM configs WHERE id = $1', [req.params.id]);
    
    // Decrement reseller count
    if (existing.rows[0].created_by !== null) {
      await query('UPDATE users SET configs_created = GREATEST(0, configs_created - 1) WHERE id = $1', 
        [existing.rows[0].created_by]);
    }
    
    res.json({ message: 'Config deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// GET /api/configs/:id/qr — get QR code
router.get('/:id/qr', authMiddleware, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT c.*, s.host as server_host FROM configs c LEFT JOIN servers s ON s.id = c.server_id WHERE c.id = $1 AND (c.created_by = $2 OR $3 = \'admin\')',
      [req.params.id, req.user.id, req.user.role]
    );
    
    if (!result.rows[0]) return res.status(404).json({ error: 'Config not found' });
    
    const links = await generateConfigLinks(result.rows[0]);
    const subUrl = await getSubUrl(result.rows[0]);
    
    const qrCodes = {};
    for (const [type, link] of Object.entries(links)) {
      qrCodes[type] = await QRCode.toDataURL(link);
    }
    qrCodes.subscription = await QRCode.toDataURL(subUrl);
    
    res.json({ qr_codes: qrCodes, links, sub_url: subUrl });
  } catch (error) {
    next(error);
  }
});

// POST /api/configs/:id/reset-traffic
router.post('/:id/reset-traffic', authMiddleware, async (req, res, next) => {
  try {
    await query(
      'UPDATE configs SET traffic_used_gb = 0, traffic_used_bytes = 0, status = \'active\', updated_at = NOW() WHERE id = $1 AND (created_by = $2 OR $3 = \'admin\')',
      [req.params.id, req.user.id, req.user.role]
    );
    res.json({ message: 'Traffic reset successfully' });
  } catch (error) {
    next(error);
  }
});

// POST /api/configs/:id/renew
router.post('/:id/renew', authMiddleware, async (req, res, next) => {
  try {
    const { days } = req.body;
    if (!days || days < 1) return res.status(400).json({ error: 'Days must be >= 1' });
    
    const result = await query(
      `UPDATE configs SET 
        expires_at = GREATEST(NOW(), COALESCE(expires_at, NOW())) + ($1 || ' days')::interval,
        status = CASE WHEN status = 'expired' THEN 'active' ELSE status END,
        updated_at = NOW()
       WHERE id = $2 AND (created_by = $3 OR $4 = 'admin')
       RETURNING *`,
      [days, req.params.id, req.user.id, req.user.role]
    );
    
    if (!result.rows[0]) return res.status(404).json({ error: 'Config not found' });
    
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// ========== Helper functions ==========

async function getSubUrl(config) {
  const settingResult = await query('SELECT value FROM settings WHERE key = \'sub_base_url\'');
  const baseUrl = settingResult.rows[0]?.value || 'http://localhost:3000';
  return `${baseUrl}/sub/${config.sub_token}`;
}

async function generateConfigLinks(config) {
  const links = {};
  const host = config.server_host || config.host || 'your-server.com';
  
  if (config.protocol === 'vless' && config.security !== 'reality') {
    // VLESS-WS-TLS
    const params = new URLSearchParams({
      type: config.network,
      security: config.security,
      host: config.tls_sni || host,
      path: config.path || '/',
      sni: config.tls_sni || host,
      fp: config.tls_fingerprint || 'chrome',
      allowInsecure: '0'
    });
    links.vless = `vless://${config.uuid}@${host}:${config.port}?${params.toString()}#${encodeURIComponent(config.name)}`;
  }
  
  if (config.protocol === 'vless' && config.security === 'reality') {
    // VLESS-Reality
    const params = new URLSearchParams({
      type: config.network || 'tcp',
      security: 'reality',
      pbk: config.reality_public_key || '',
      sid: config.reality_short_id || '',
      fp: config.tls_fingerprint || 'chrome',
      sni: config.tls_sni || 'www.microsoft.com',
      flow: 'xtls-rprx-vision'
    });
    links.vless_reality = `vless://${config.uuid}@${host}:${config.port}?${params.toString()}#${encodeURIComponent(config.name)}`;
  }
  
  if (config.protocol === 'vmess') {
    // VMess-WS-TLS
    const vmessConfig = {
      v: '2',
      ps: config.name,
      add: host,
      port: String(config.port),
      id: config.uuid,
      aid: '0',
      scy: 'auto',
      net: config.network,
      type: 'none',
      host: config.tls_sni || host,
      path: config.path || '/',
      tls: config.security === 'tls' ? 'tls' : '',
      sni: config.tls_sni || host,
      alpn: '',
      fp: config.tls_fingerprint || 'chrome'
    };
    links.vmess = 'vmess://' + Buffer.from(JSON.stringify(vmessConfig)).toString('base64');
  }
  
  return links;
}

module.exports = router;
