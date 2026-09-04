const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { applyConfigToXray, generateRealityKeys, generateRandomPort } = require('../services/xray');

// GET /api/inbounds/reality-keys — Generate new Reality Keypair & ShortID
router.get('/reality-keys', authMiddleware, adminOnly, (req, res) => {
  const keys = generateRealityKeys();
  res.json(keys);
});

// GET /api/inbounds/random-port
router.get('/random-port', authMiddleware, (req, res) => {
  res.json({ port: generateRandomPort() });
});

// GET /api/inbounds — List all inbounds with their active clients
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const isReseller = req.user.role === 'reseller';
    
    // Admin gets all inbounds and all clients. Reseller gets inbounds with only their created clients.
    const result = await query(`
      SELECT 
        i.*,
        COUNT(c.id) as total_clients,
        COUNT(CASE WHEN c.enable = true THEN 1 END) as active_clients,
        COALESCE(
          json_agg(
            json_build_object(
              'id', c.id,
              'email', c.email,
              'uuid', c.uuid,
              'flow', c.flow,
              'password', c.password,
              'traffic_limit_gb', c.traffic_limit_gb,
              'traffic_used_gb', c.traffic_used_gb,
              'traffic_up_bytes', c.traffic_up_bytes,
              'traffic_down_bytes', c.traffic_down_bytes,
              'start_after_first_use', c.start_after_first_use,
              'first_use_at', c.first_use_at,
              'duration_days', c.duration_days,
              'expires_at', c.expires_at,
              'sub_token', c.sub_token,
              'enable', c.enable,
              'is_online', c.is_online,
              'created_by', c.created_by
            ) ORDER BY c.created_at DESC
          ) FILTER (WHERE c.id IS NOT NULL ${isReseller ? 'AND c.created_by = ' + req.user.id : ''}),
          '[]'
        ) as clients
      FROM inbounds i
      LEFT JOIN clients c ON c.inbound_id = i.id
      GROUP BY i.id
      ORDER BY i.port ASC
    `);

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/inbounds/:id
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM inbounds WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Inbound not found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// POST /api/inbounds — Create Inbound (Admin Only)
router.post('/', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const {
      remark,
      port,
      protocol = 'vless',
      listen = '0.0.0.0',
      settings = {},
      stream_settings = {},
      sniffing = { enabled: true, destOverride: ['http', 'tls', 'quic'] },
      enable = true
    } = req.body;

    if (!remark || !port || !protocol) {
      return res.status(400).json({ error: 'نام اینباند، پورت و پروتکل الزامی هستند / Remark, port, and protocol are required' });
    }

    // Check if port is already used
    const portCheck = await query('SELECT id FROM inbounds WHERE port = $1', [port]);
    if (portCheck.rows[0]) {
      return res.status(409).json({ error: `پورت ${port} قبلا توسط اینباند دیگری استفاده شده است / Port is already in use` });
    }

    const tag = `inbound-${port}-${protocol}`;

    const result = await query(`
      INSERT INTO inbounds (
        user_id, remark, port, protocol, listen,
        settings, stream_settings, sniffing, tag, enable
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      req.user.id, remark.trim(), port, protocol, listen,
      JSON.stringify(settings), JSON.stringify(stream_settings),
      JSON.stringify(sniffing), tag, enable
    ]);

    const newInbound = result.rows[0];

    // Automatically apply to Xray
    await applyConfigToXray();

    res.status(201).json(newInbound);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/inbounds/:id — Update Inbound
router.patch('/:id', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const {
      remark,
      port,
      listen,
      settings,
      stream_settings,
      sniffing,
      enable
    } = req.body;

    const existing = await query('SELECT * FROM inbounds WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Inbound not found' });

    if (port && parseInt(port) !== existing.rows[0].port) {
      const portCheck = await query('SELECT id FROM inbounds WHERE port = $1 AND id != $2', [port, req.params.id]);
      if (portCheck.rows[0]) {
        return res.status(409).json({ error: `پورت ${port} قبلا استفاده شده است / Port is already in use` });
      }
    }

    const updates = {};
    if (remark !== undefined) updates.remark = remark.trim();
    if (port !== undefined) updates.port = parseInt(port);
    if (listen !== undefined) updates.listen = listen;
    if (settings !== undefined) updates.settings = JSON.stringify(settings);
    if (stream_settings !== undefined) updates.stream_settings = JSON.stringify(stream_settings);
    if (sniffing !== undefined) updates.sniffing = JSON.stringify(sniffing);
    if (enable !== undefined) updates.enable = enable;

    if (updates.port || existing.rows[0].protocol) {
      updates.tag = `inbound-${updates.port || existing.rows[0].port}-${existing.rows[0].protocol}`;
    }

    const setClause = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = [...Object.values(updates), req.params.id];

    const result = await query(
      `UPDATE inbounds SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );

    // Apply to Xray
    await applyConfigToXray();

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/inbounds/:id
router.delete('/:id', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    await query('DELETE FROM inbounds WHERE id = $1', [req.params.id]);
    await applyConfigToXray();
    res.json({ message: 'Inbound deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// POST /api/inbounds/:id/reset-traffic
router.post('/:id/reset-traffic', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    await query('UPDATE inbounds SET traffic_up_bytes = 0, traffic_down_bytes = 0 WHERE id = $1', [req.params.id]);
    res.json({ message: 'Inbound traffic reset successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
