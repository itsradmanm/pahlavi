const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { authMiddleware } = require('../middleware/auth');

// GET /api/analytics/overview
router.get('/overview', authMiddleware, async (req, res, next) => {
  try {
    const isReseller = req.user.role === 'reseller';
    const userId = req.user.id;
    const clientWhere = isReseller ? 'WHERE c.created_by = $1' : '';
    const params = isReseller ? [userId] : [];

    const stats = await query(`
      SELECT 
        COUNT(*) as total_clients,
        COUNT(CASE WHEN c.enable = true AND (c.expires_at IS NULL OR c.expires_at > NOW()) AND (c.traffic_limit_gb = 0 OR c.traffic_used_gb < c.traffic_limit_gb) THEN 1 END) as active_clients,
        COUNT(CASE WHEN c.expires_at IS NOT NULL AND c.expires_at <= NOW() THEN 1 END) as expired_clients,
        COUNT(CASE WHEN c.traffic_limit_gb > 0 AND c.traffic_used_gb >= c.traffic_limit_gb THEN 1 END) as quota_full_clients,
        COUNT(CASE WHEN c.enable = false THEN 1 END) as disabled_clients,
        COUNT(CASE WHEN c.is_online = true THEN 1 END) as online_now,
        COALESCE(SUM(c.traffic_used_gb), 0) as total_traffic_gb,
        COUNT(CASE WHEN i.protocol = 'vless' THEN 1 END) as vless_count,
        COUNT(CASE WHEN i.protocol = 'vmess' THEN 1 END) as vmess_count,
        COUNT(CASE WHEN i.protocol = 'trojan' THEN 1 END) as trojan_count,
        COUNT(CASE WHEN i.protocol = 'shadowsocks' THEN 1 END) as shadowsocks_count,
        COUNT(CASE WHEN c.expires_at IS NOT NULL AND c.expires_at < NOW() + interval '7 days' AND c.expires_at > NOW() THEN 1 END) as expiring_soon
      FROM clients c
      LEFT JOIN inbounds i ON i.id = c.inbound_id
      ${clientWhere}
    `, params);

    const inboundsCount = await query('SELECT COUNT(*) as count FROM inbounds WHERE enable = true');

    const userQuota = await query(
      'SELECT traffic_quota_gb, traffic_used_gb, max_clients, clients_created FROM users WHERE id = $1',
      [userId]
    );

    res.json({
      stats: {
        ...stats.rows[0],
        total_inbounds: inboundsCount.rows[0]?.count || 0
      },
      quota: userQuota.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/analytics/traffic — 7 days trend
router.get('/traffic', authMiddleware, async (req, res, next) => {
  try {
    const { days = 7 } = req.query;
    const isReseller = req.user.role === 'reseller';
    
    let whereClause = `WHERE td.date >= CURRENT_DATE - ($1 || ' days')::interval`;
    let params = [parseInt(days)];
    if (isReseller) {
      whereClause += ` AND c.created_by = $2`;
      params.push(req.user.id);
    }

    const result = await query(`
      SELECT 
        td.date,
        SUM(td.bytes_in) as bytes_in,
        SUM(td.bytes_out) as bytes_out,
        SUM(td.bytes_in + td.bytes_out) as bytes_total
      FROM traffic_daily td
      LEFT JOIN clients c ON c.id = td.client_id
      ${whereClause}
      GROUP BY td.date
      ORDER BY td.date ASC
    `, params);

    const filled = [];
    const now = new Date();
    for (let i = parseInt(days) - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const found = result.rows.find(r => r.date.toISOString().split('T')[0] === dateStr);
      filled.push({
        date: dateStr,
        bytes_in: found ? parseInt(found.bytes_in) : 0,
        bytes_out: found ? parseInt(found.bytes_out) : 0,
        bytes_total: found ? parseInt(found.bytes_total) : 0
      });
    }

    res.json(filled);
  } catch (error) {
    next(error);
  }
});

// GET /api/analytics/top-clients
router.get('/top-clients', authMiddleware, async (req, res, next) => {
  try {
    const isReseller = req.user.role === 'reseller';
    const limit = parseInt(req.query.limit) || 10;
    const where = isReseller ? 'WHERE c.created_by = $2' : '';
    const params = isReseller ? [limit, req.user.id] : [limit];

    const result = await query(`
      SELECT c.*, i.remark as inbound_remark, i.protocol, i.port
      FROM clients c
      JOIN inbounds i ON i.id = c.inbound_id
      ${where}
      ORDER BY c.traffic_used_gb DESC
      LIMIT $1
    `, params);

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
