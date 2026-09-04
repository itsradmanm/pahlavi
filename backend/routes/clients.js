const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { query } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { applyConfigToXray } = require('../services/xray');

// POST /api/clients — Add Client to Inbound
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const {
      inbound_id,
      email,
      uuid: customUuid,
      flow = '',
      password: customPassword,
      traffic_limit_gb = 0,
      duration_days = 30,
      expires_at = null,
      start_after_first_use = false,
      ip_limit = 0
    } = req.body;

    if (!inbound_id || !email) {
      return res.status(400).json({ error: 'Inbound and Client remark/email are required' });
    }

    // Reseller quota check
    if (req.user.role === 'reseller') {
      if (req.user.clients_created >= req.user.max_clients) {
        return res.status(403).json({ error: 'سقف تعداد کلاینت‌های مجاز برای حساب شما پر شده است / Max client quota reached' });
      }
      const remainingQuota = req.user.traffic_quota_gb - req.user.traffic_used_gb;
      if (traffic_limit_gb > 0 && traffic_limit_gb > remainingQuota) {
        return res.status(403).json({ error: `سهمیه ترافیک کافی نیست. ترافیک باقی‌مانده شما: ${remainingQuota.toFixed(2)} GB` });
      }
    }

    // Check Inbound
    const inboundRes = await query('SELECT * FROM inbounds WHERE id = $1', [inbound_id]);
    if (!inboundRes.rows[0]) {
      return res.status(404).json({ error: 'Inbound not found' });
    }

    const inbound = inboundRes.rows[0];
    const streamSettings = typeof inbound.stream_settings === 'string' ? JSON.parse(inbound.stream_settings) : (inbound.stream_settings || {});
    const clientUuid = customUuid || uuidv4();
    const subToken = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
    
    // Auto set flow if VLESS Reality TCP
    let clientFlow = flow;
    if (inbound.protocol === 'vless' && streamSettings.security === 'reality' && streamSettings.network === 'tcp' && !clientFlow) {
      clientFlow = 'xtls-rprx-vision';
    }

    let actualExpiresAt = expires_at;
    if (!start_after_first_use && duration_days && !expires_at) {
      actualExpiresAt = new Date(Date.now() + duration_days * 24 * 60 * 60 * 1000).toISOString();
    }

    const result = await query(`
      INSERT INTO clients (
        inbound_id, email, uuid, flow, password,
        traffic_limit_gb, duration_days, expires_at,
        start_after_first_use, ip_limit, sub_token,
        created_by, enable
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
      RETURNING *
    `, [
      inbound_id, email.trim(), clientUuid, clientFlow, customPassword || clientUuid,
      traffic_limit_gb, duration_days, actualExpiresAt,
      start_after_first_use, ip_limit, subToken,
      req.user.id
    ]);

    const newClient = result.rows[0];

    // Increment reseller count
    if (req.user.role === 'reseller') {
      await query('UPDATE users SET clients_created = clients_created + 1 WHERE id = $1', [req.user.id]);
    }

    // Apply to Xray
    await applyConfigToXray();

    res.status(201).json(newClient);
  } catch (error) {
    next(error);
  }
});

// GET /api/clients/:id/links — Get Links & QR
router.get('/:id/links', authMiddleware, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT c.*, i.protocol, i.port, i.stream_settings, i.settings as inbound_settings, i.listen, i.remark as inbound_remark
      FROM clients c
      JOIN inbounds i ON i.id = c.inbound_id
      WHERE c.id = $1 ${req.user.role === 'reseller' ? 'AND c.created_by = ' + req.user.id : ''}
    `, [req.params.id]);

    if (!result.rows[0]) return res.status(404).json({ error: 'Client not found' });
    const c = result.rows[0];

    const hostSetting = await query("SELECT key, value FROM settings WHERE key IN ('sub_base_url', 'tls_domain')");
    const settingsMap = {};
    hostSetting.rows.forEach(r => settingsMap[r.key] = r.value);
    
    const reqHost = (req.headers['x-forwarded-host'] || req.get('host') || '').split(':')[0];
    const serverHost = settingsMap.tls_domain || reqHost || '127.0.0.1';
    const subBase = settingsMap.sub_base_url || `${req.protocol}://${req.get('host')}`;

    const link = generateClientProtocolLink(c, serverHost);
    const subUrl = `${subBase}/sub/${c.sub_token}`;
    const clashUrl = `${subUrl}?format=clash`;

    const qrCode = await QRCode.toDataURL(subUrl);

    res.json({
      link,
      sub_url: subUrl,
      clash_url: clashUrl,
      qr_code: qrCode,
      client: c
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/clients/:id
router.patch('/:id', authMiddleware, async (req, res, next) => {
  try {
    const existing = await query(
      `SELECT * FROM clients WHERE id = $1 ${req.user.role === 'reseller' ? 'AND created_by = ' + req.user.id : ''}`,
      [req.params.id]
    );

    if (!existing.rows[0]) return res.status(404).json({ error: 'Client not found' });

    const allowed = ['email', 'uuid', 'flow', 'password', 'traffic_limit_gb', 'duration_days', 'expires_at', 'start_after_first_use', 'ip_limit', 'enable'];
    const updates = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    if (Object.keys(updates).length > 0) {
      const setClause = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
      const values = [...Object.values(updates), req.params.id];

      const result = await query(
        `UPDATE clients SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
        values
      );

      await applyConfigToXray();
      return res.json(result.rows[0]);
    }

    res.json(existing.rows[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/clients/:id
router.delete('/:id', authMiddleware, async (req, res, next) => {
  try {
    const existing = await query(
      `SELECT * FROM clients WHERE id = $1 ${req.user.role === 'reseller' ? 'AND created_by = ' + req.user.id : ''}`,
      [req.params.id]
    );

    if (!existing.rows[0]) return res.status(404).json({ error: 'Client not found' });

    await query('DELETE FROM clients WHERE id = $1', [req.params.id]);

    if (req.user.role === 'reseller') {
      await query('UPDATE users SET clients_created = GREATEST(0, clients_created - 1) WHERE id = $1', [req.user.id]);
    }

    await applyConfigToXray();
    res.json({ message: 'Client deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// POST /api/clients/:id/reset-traffic
router.post('/:id/reset-traffic', authMiddleware, async (req, res, next) => {
  try {
    await query(`
      UPDATE clients 
      SET traffic_up_bytes = 0, traffic_down_bytes = 0, traffic_used_gb = 0, enable = true 
      WHERE id = $1 ${req.user.role === 'reseller' ? 'AND created_by = ' + req.user.id : ''}
    `, [req.params.id]);

    await applyConfigToXray();
    res.json({ message: 'Traffic reset successfully' });
  } catch (error) {
    next(error);
  }
});

// POST /api/clients/:id/renew
router.post('/:id/renew', authMiddleware, async (req, res, next) => {
  try {
    const { days = 30 } = req.body;
    await query(`
      UPDATE clients 
      SET expires_at = GREATEST(NOW(), COALESCE(expires_at, NOW())) + ($1 || ' days')::interval,
          enable = true
      WHERE id = $2 ${req.user.role === 'reseller' ? 'AND created_by = ' + req.user.id : ''}
    `, [days, req.params.id]);

    await applyConfigToXray();
    res.json({ message: 'Client renewed successfully' });
  } catch (error) {
    next(error);
  }
});

// ========== Helper: Generate Direct URI for All Protocols ==========

function generateClientProtocolLink(c, host) {
  const stream = typeof c.stream_settings === 'string' ? JSON.parse(c.stream_settings) : (c.stream_settings || {});
  const net = stream.network || 'tcp';
  const sec = stream.security || 'none';
  const remark = encodeURIComponent(c.email);

  if (c.protocol === 'vless') {
    if (sec === 'reality') {
      const real = stream.realitySettings || {};
      const sniList = Array.isArray(real.serverNames) ? real.serverNames : (typeof real.serverNames === 'string' ? real.serverNames.split(',') : []);
      const primarySni = sniList[0]?.trim() || real.dest?.split(':')[0] || 'www.microsoft.com';
      const shortId = Array.isArray(real.shortIds) ? real.shortIds[0] : (real.shortIds || '');

      const params = new URLSearchParams({
        type: net,
        security: 'reality',
        pbk: real.publicKey || '',
        fp: real.fingerprint || 'chrome',
        sni: primarySni,
        sid: shortId,
        flow: c.flow || (net === 'tcp' ? 'xtls-rprx-vision' : '')
      });
      if (net === 'ws') {
        params.set('path', stream.wsSettings?.path || '/');
        if (stream.wsSettings?.headers?.Host) params.set('host', stream.wsSettings.headers.Host);
      } else if (net === 'grpc') {
        params.set('serviceName', stream.grpcSettings?.serviceName || '');
      }
      return `vless://${c.uuid}@${host}:${c.port}?${params.toString()}#${remark}`;
    } else {
      const params = new URLSearchParams({
        type: net,
        security: sec,
        path: stream.wsSettings?.path || '/',
        host: stream.wsSettings?.headers?.Host || host,
        sni: stream.tlsSettings?.serverName || host,
        fp: stream.tlsSettings?.fingerprint || 'chrome'
      });
      return `vless://${c.uuid}@${host}:${c.port}?${params.toString()}#${remark}`;
    }
  }

  if (c.protocol === 'vmess') {
    const vmessJson = {
      v: '2',
      ps: c.email,
      add: host,
      port: String(c.port),
      id: c.uuid,
      aid: '0',
      scy: 'auto',
      net: net,
      type: 'none',
      host: stream.wsSettings?.headers?.Host || host,
      path: stream.wsSettings?.path || '/',
      tls: sec === 'tls' ? 'tls' : '',
      sni: stream.tlsSettings?.serverName || host
    };
    return 'vmess://' + Buffer.from(JSON.stringify(vmessJson)).toString('base64');
  }

  if (c.protocol === 'trojan') {
    const params = new URLSearchParams({
      type: net,
      security: sec,
      sni: stream.tlsSettings?.serverName || host
    });
    if (net === 'ws') params.set('path', stream.wsSettings?.path || '/');
    return `trojan://${c.password || c.uuid}@${host}:${c.port}?${params.toString()}#${remark}`;
  }

  if (c.protocol === 'shadowsocks') {
    const rawSettings = typeof c.inbound_settings === 'string' ? JSON.parse(c.inbound_settings) : (c.inbound_settings || {});
    const method = rawSettings.method || '2022-blake3-aes-128-gcm';
    const pwd = rawSettings.password || c.password || c.uuid;
    const auth = Buffer.from(`${method}:${pwd}`).toString('base64');
    return `ss://${auth}@${host}:${c.port}#${remark}`;
  }

  return '';
}

module.exports = router;
