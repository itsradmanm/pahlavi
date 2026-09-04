const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { testServerConnection, getServerStats } = require('../services/xray');

// GET /api/servers
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM configs c WHERE c.server_id = s.id) as total_configs,
        (SELECT COUNT(*) FROM configs c WHERE c.server_id = s.id AND c.status = 'active') as active_configs,
        (SELECT COUNT(*) FROM configs c WHERE c.server_id = s.id AND c.is_online = true) as online_users
      FROM servers s
      ORDER BY s.is_default DESC, s.name ASC
    `);
    
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/servers/:id
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Server not found' });
    
    // Don't expose SSH credentials to non-admins
    if (req.user.role !== 'admin') {
      delete result.rows[0].ssh_password;
      delete result.rows[0].ssh_key;
      delete result.rows[0].api_secret;
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// POST /api/servers — admin only
router.post('/', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const {
      name, host, ip,
      ssh_port = 22, ssh_user, ssh_password, ssh_key,
      api_port = 62789, api_secret,
      xray_config_path = '/usr/local/etc/xray/config.json',
      is_default = false
    } = req.body;
    
    if (!name || !host) {
      return res.status(400).json({ error: 'Name and host are required' });
    }
    
    // If setting as default, unset others
    if (is_default) {
      await query('UPDATE servers SET is_default = false');
    }
    
    const result = await query(`
      INSERT INTO servers (name, host, ip, ssh_port, ssh_user, ssh_password, ssh_key, api_port, api_secret, xray_config_path, is_default)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [name, host, ip, ssh_port, ssh_user, ssh_password, ssh_key, api_port, api_secret, xray_config_path, is_default]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/servers/:id — admin only
router.patch('/:id', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const allowedFields = ['name', 'host', 'ip', 'ssh_port', 'ssh_user', 'ssh_password', 'ssh_key',
      'api_port', 'api_secret', 'xray_config_path', 'status', 'is_default'];
    
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    
    if (req.body.is_default) {
      await query('UPDATE servers SET is_default = false');
    }
    
    const setClause = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = [...Object.values(updates), req.params.id];
    
    const result = await query(
      `UPDATE servers SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    
    if (!result.rows[0]) return res.status(404).json({ error: 'Server not found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/servers/:id — admin only
router.delete('/:id', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    await query('DELETE FROM servers WHERE id = $1', [req.params.id]);
    res.json({ message: 'Server deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// POST /api/servers/:id/test — test connection
router.post('/:id/test', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const serverResult = await query('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (!serverResult.rows[0]) return res.status(404).json({ error: 'Server not found' });
    
    const result = await testServerConnection(serverResult.rows[0]);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// GET /api/servers/:id/stats
router.get('/:id/stats', authMiddleware, async (req, res, next) => {
  try {
    const serverResult = await query('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (!serverResult.rows[0]) return res.status(404).json({ error: 'Server not found' });
    
    const stats = await getServerStats(serverResult.rows[0]);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
