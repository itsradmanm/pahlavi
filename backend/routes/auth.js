const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../database');
const { generateToken, authMiddleware } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    const result = await query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
    
    const user = result.rows[0];
    
    if (!user) {
      return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است / Invalid credentials' });
    }
    
    if (!user.is_active) {
      return res.status(403).json({ error: 'حساب کاربری مسدود شده است / Account is disabled' });
    }
    
    if (user.expires_at && new Date(user.expires_at) < new Date()) {
      return res.status(403).json({ error: 'حساب کاربری منقضی شده است / Account has expired' });
    }
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است / Invalid credentials' });
    }
    
    const token = generateToken(user);
    
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        traffic_quota_gb: user.traffic_quota_gb,
        traffic_used_gb: user.traffic_used_gb,
        max_clients: user.max_clients,
        clients_created: user.clients_created,
        expires_at: user.expires_at
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.username, u.role, u.is_active, u.traffic_quota_gb, u.traffic_used_gb,
              u.max_clients, u.clients_created, u.expires_at, u.sub_token,
              rp.panel_name, rp.logo_url, rp.primary_color, rp.can_create_resellers
       FROM users u
       LEFT JOIN reseller_panels rp ON rp.reseller_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    const panelSettings = await query(`SELECT key, value FROM settings WHERE key IN ('panel_name', 'sub_base_url', 'tls_domain')`);
    const settings = {};
    panelSettings.rows.forEach(r => settings[r.key] = r.value);
    
    res.json({ 
      user: result.rows[0],
      settings 
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Both current and new passwords are required' });
    }
    
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    
    const result = await query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(current_password, result.rows[0].password);
    
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    const hashed = await bcrypt.hash(new_password, 12);
    await query('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [hashed, req.user.id]);
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
