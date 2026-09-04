const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query, pool } = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');

// GET /api/reseller — list resellers (admin) or own profile (reseller)
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      const result = await query(`
        SELECT u.id, u.username, u.role, u.is_active, u.traffic_quota_gb, u.traffic_used_gb,
               u.max_clients, u.clients_created, u.expires_at, u.created_at,
               rp.panel_name, rp.panel_url, rp.primary_color, rp.can_create_resellers
        FROM users u
        LEFT JOIN reseller_panels rp ON rp.reseller_id = u.id
        WHERE u.role = 'reseller'
        ORDER BY u.created_at DESC
      `);
      return res.json(result.rows);
    }
    
    // Reseller sees their own data
    const result = await query(`
      SELECT u.id, u.username, u.traffic_quota_gb, u.traffic_used_gb,
             u.max_clients, u.clients_created, u.expires_at,
             rp.panel_name, rp.panel_url, rp.primary_color, rp.can_create_resellers
      FROM users u
      LEFT JOIN reseller_panels rp ON rp.reseller_id = u.id
      WHERE u.id = $1
    `, [req.user.id]);
    
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// GET /api/reseller/stats — reseller dashboard stats
router.get('/stats', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    
    const whereClause = isAdmin ? '1=1' : 'c.created_by = $1';
    const params = isAdmin ? [] : [userId];
    
    const stats = await query(`
      SELECT 
        COUNT(*) as total_clients,
        COUNT(CASE WHEN c.enable = true AND (c.expires_at IS NULL OR c.expires_at > NOW()) AND (c.traffic_limit_gb = 0 OR c.traffic_used_gb < c.traffic_limit_gb) THEN 1 END) as active_clients,
        COUNT(CASE WHEN c.expires_at IS NOT NULL AND c.expires_at <= NOW() THEN 1 END) as expired_clients,
        COUNT(CASE WHEN c.traffic_limit_gb > 0 AND c.traffic_used_gb >= c.traffic_limit_gb THEN 1 END) as quota_full_clients,
        COUNT(CASE WHEN c.enable = false THEN 1 END) as disabled_clients,
        COUNT(CASE WHEN c.is_online = true THEN 1 END) as online_users,
        COALESCE(SUM(c.traffic_used_gb), 0) as total_traffic_used_gb
      FROM clients c
      WHERE ${whereClause}
    `, params);
    
    const userData = await query(
      'SELECT traffic_quota_gb, traffic_used_gb, max_clients, clients_created FROM users WHERE id = $1',
      [req.user.id]
    );
    
    res.json({
      ...stats.rows[0],
      quota: userData.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/reseller — create reseller (admin or reseller with can_create_resellers)
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    // Check permissions
    if (req.user.role !== 'admin') {
      const panel = await query(
        'SELECT can_create_resellers FROM reseller_panels WHERE reseller_id = $1',
        [req.user.id]
      );
      if (!panel.rows[0]?.can_create_resellers) {
        return res.status(403).json({ error: 'شما دسترسی ایجاد نماینده فروش ندارید / Permission denied' });
      }
    }
    
    const {
      username,
      password,
      traffic_quota_gb = 100,
      max_clients = 30,
      expires_at,
      panel_name,
      panel_url,
      primary_color = '#00D4FF',
      can_create_resellers = false
    } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است / Username & password are required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'رمز عبور باید حداقل ۶ کاراکتر باشد / Password must be at least 6 characters' });
    }
    
    // Check traffic quota for parent reseller
    if (req.user.role === 'reseller') {
      const remaining = req.user.traffic_quota_gb - req.user.traffic_used_gb;
      if (parseFloat(traffic_quota_gb) > remaining) {
        return res.status(400).json({ error: `سهمیه ناکافی است. سهمیه آزاد شما: ${remaining.toFixed(2)} GB` });
      }
    }
    
    const hashed = await bcrypt.hash(password, 12);
    const subToken = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const userResult = await client.query(`
        INSERT INTO users (username, password, role, traffic_quota_gb, max_clients, expires_at, sub_token)
        VALUES ($1, $2, 'reseller', $3, $4, $5, $6)
        RETURNING *
      `, [username, hashed, traffic_quota_gb, max_clients, expires_at || null, subToken]);
      
      const newUser = userResult.rows[0];
      
      await client.query(`
        INSERT INTO reseller_panels (reseller_id, panel_name, panel_url, primary_color, can_create_resellers)
        VALUES ($1, $2, $3, $4, $5)
      `, [newUser.id, panel_name || username, panel_url, primary_color, can_create_resellers]);
      
      // Deduct quota from parent reseller
      if (req.user.role === 'reseller') {
        await client.query(
          'UPDATE users SET traffic_quota_gb = traffic_quota_gb - $1 WHERE id = $2',
          [traffic_quota_gb, req.user.id]
        );
      }
      
      await client.query('COMMIT');
      
      delete newUser.password;
      res.status(201).json(newUser);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'این نام کاربری قبلا ثبت شده است / Username already exists' });
    }
    next(error);
  }
});

// PATCH /api/reseller/:id — update reseller
router.patch('/:id', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const allowedUserFields = ['is_active', 'traffic_quota_gb', 'max_clients', 'expires_at'];
    const allowedPanelFields = ['panel_name', 'panel_url', 'primary_color', 'can_create_resellers'];
    
    const userUpdates = {};
    const panelUpdates = {};
    
    for (const field of allowedUserFields) {
      if (req.body[field] !== undefined) userUpdates[field] = req.body[field];
    }
    for (const field of allowedPanelFields) {
      if (req.body[field] !== undefined) panelUpdates[field] = req.body[field];
    }
    
    if (req.body.password) {
      userUpdates.password = await bcrypt.hash(req.body.password, 12);
    }
    
    if (Object.keys(userUpdates).length > 0) {
      const setClause = Object.keys(userUpdates).map((k, i) => `${k} = $${i + 1}`).join(', ');
      await query(
        `UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = $${Object.keys(userUpdates).length + 1}`,
        [...Object.values(userUpdates), req.params.id]
      );
    }
    
    if (Object.keys(panelUpdates).length > 0) {
      const setClause = Object.keys(panelUpdates).map((k, i) => `${k} = $${i + 1}`).join(', ');
      await query(
        `UPDATE reseller_panels SET ${setClause} WHERE reseller_id = $${Object.keys(panelUpdates).length + 1}`,
        [...Object.values(panelUpdates), req.params.id]
      );
    }
    
    const result = await query(
      `SELECT u.*, rp.panel_name, rp.panel_url, rp.primary_color FROM users u 
       LEFT JOIN reseller_panels rp ON rp.reseller_id = u.id WHERE u.id = $1`,
      [req.params.id]
    );
    
    if (!result.rows[0]) return res.status(404).json({ error: 'Reseller not found' });
    
    delete result.rows[0].password;
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/reseller/:id — admin only
router.delete('/:id', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    await query('DELETE FROM users WHERE id = $1 AND role = \'reseller\'', [req.params.id]);
    res.json({ message: 'Reseller deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// GET /api/reseller/:id/clients — clients created by a specific reseller
router.get('/:id/clients', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT c.*, i.remark as inbound_remark, i.protocol, i.port
      FROM clients c
      JOIN inbounds i ON i.id = c.inbound_id
      WHERE c.created_by = $1
      ORDER BY c.created_at DESC
    `, [req.params.id]);
    
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
