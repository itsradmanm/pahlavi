const express = require('express');
const router = express.Router();
const { query } = require('../database');

// GET /sub/:token — Multi-protocol & Multi-client Smart Subscription Endpoint
router.get('/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const format = req.query.format || 'v2ray'; // v2ray (base64), clash, json, raw

    // 1. Determine Server Host Address
    const hostSetting = await query("SELECT key, value FROM settings WHERE key IN ('tls_domain', 'sub_base_url', 'panel_name')");
    const settingsMap = {};
    hostSetting.rows.forEach(r => settingsMap[r.key] = r.value);

    // Prefer request host header (if not localhost), then tls_domain, then fallback
    const reqHostHeader = (req.headers['x-forwarded-host'] || req.get('host') || '').split(':')[0];
    let serverHost = reqHostHeader;
    if (!serverHost || serverHost === 'localhost' || serverHost === '127.0.0.1') {
      serverHost = settingsMap.tls_domain || reqHostHeader || '127.0.0.1';
    }

    let clientsList = [];
    let primaryClient = null;

    // 2. Check if token belongs to a specific client
    const clientRes = await query(`
      SELECT c.*, i.protocol, i.port, i.stream_settings, i.settings as inbound_settings, i.listen, i.remark as inbound_remark, i.enable as inbound_enable
      FROM clients c
      JOIN inbounds i ON i.id = c.inbound_id
      WHERE c.sub_token = $1
    `, [token]);

    if (clientRes.rows[0]) {
      primaryClient = clientRes.rows[0];

      // Fetch all other inbounds/clients for the same client email/uuid so 1 sub token provides all protocols
      const allClientsRes = await query(`
        SELECT c.*, i.protocol, i.port, i.stream_settings, i.settings as inbound_settings, i.listen, i.remark as inbound_remark, i.enable as inbound_enable
        FROM clients c
        JOIN inbounds i ON i.id = c.inbound_id
        WHERE (c.email = $1 OR c.uuid = $2) AND i.enable = true
        ORDER BY i.port ASC
      `, [primaryClient.email, primaryClient.uuid]);

      clientsList = allClientsRes.rows.length > 0 ? allClientsRes.rows : [primaryClient];
    } else {
      // 3. Check if token belongs to a User (reseller / admin)
      const userRes = await query('SELECT id, username FROM users WHERE sub_token = $1', [token]);
      if (!userRes.rows[0]) {
        return res.status(404).send('Subscription not found');
      }

      const userClients = await query(`
        SELECT c.*, i.protocol, i.port, i.stream_settings, i.settings as inbound_settings, i.listen, i.remark as inbound_remark, i.enable as inbound_enable
        FROM clients c
        JOIN inbounds i ON i.id = c.inbound_id
        WHERE c.created_by = $1 AND i.enable = true
        ORDER BY c.created_at DESC
      `, [userRes.rows[0].id]);

      if (userClients.rows.length === 0) {
        return res.status(404).send('No active configs found for this subscription');
      }

      clientsList = userClients.rows;
      primaryClient = userClients.rows[0];
    }

    // 4. Handle Start After First Use
    for (const c of clientsList) {
      if (c.start_after_first_use && !c.first_use_at && c.enable) {
        const duration = c.duration_days || 30;
        const expiresAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString();
        
        await query(
          'UPDATE clients SET first_use_at = NOW(), expires_at = $1 WHERE id = $2',
          [expiresAt, c.id]
        );
        c.first_use_at = new Date();
        c.expires_at = expiresAt;
      }
    }

    // 5. Filter active & valid clients
    const validClients = clientsList.filter(c => {
      if (!c.enable || !c.inbound_enable) return false;
      if (c.expires_at && new Date(c.expires_at) < new Date()) return false;
      if (c.traffic_limit_gb > 0 && c.traffic_used_gb >= c.traffic_limit_gb) return false;
      return true;
    });

    // 6. Set Subscription-Userinfo Headers
    const totalBytes = Math.round((parseFloat(primaryClient.traffic_limit_gb) || 0) * (1024 * 1024 * 1024));
    const usedUp = parseInt(primaryClient.traffic_up_bytes || 0);
    const usedDown = parseInt(primaryClient.traffic_down_bytes || 0);
    const expireTimestamp = primaryClient.expires_at ? Math.floor(new Date(primaryClient.expires_at).getTime() / 1000) : 0;

    res.set('Subscription-Userinfo', `upload=${usedUp}; download=${usedDown}; total=${totalBytes}; expire=${expireTimestamp}`);
    res.set('Profile-Update-Interval', '6');
    res.set('Profile-Title', encodeURIComponent(primaryClient.email || 'Pahlavy'));

    // If no valid active configs
    if (validClients.length === 0) {
      const isExpired = primaryClient.expires_at && new Date(primaryClient.expires_at) < new Date();
      const isQuotaFull = primaryClient.traffic_limit_gb > 0 && primaryClient.traffic_used_gb >= primaryClient.traffic_limit_gb;
      const reason = isExpired ? 'EXPIRED' : (isQuotaFull ? 'QUOTA_FULL' : 'DISABLED');
      
      const disabledMsg = `# Status: ${reason}\n# User: ${primaryClient.email}\n# Message: Account is not active`;
      res.set('Content-Type', 'text/plain; charset=utf-8');
      return res.send(Buffer.from(disabledMsg).toString('base64'));
    }

    // Auto-detect client apps by User-Agent
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    const isBrowser = (req.headers['accept'] || '').includes('text/html') && 
                      !userAgent.includes('v2ray') && !userAgent.includes('clash') && 
                      !userAgent.includes('sing-box') && !userAgent.includes('shadowrocket') && 
                      !userAgent.includes('streisand') && !userAgent.includes('hiddify') && 
                      !userAgent.includes('happ') && !userAgent.includes('nekoray') && 
                      !userAgent.includes('v2box') && !userAgent.includes('foxray') &&
                      !userAgent.includes('curl') && !userAgent.includes('wget');

    // 7. Generate Format Outputs
    if (format === 'html' || (isBrowser && format !== 'raw' && format !== 'v2ray' && format !== 'clash' && format !== 'json')) {
      const subUrl = `${req.protocol}://${req.get('host')}/sub/${token}`;
      const htmlPortal = generateClientPortalHtml({
        client: primaryClient,
        validClients,
        serverHost,
        subUrl,
        usedUp,
        usedDown,
        totalBytes
      });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(htmlPortal);
    }

    if (format === 'clash' || userAgent.includes('clash') || userAgent.includes('mihomo')) {
      const clashYaml = generateClashConfig(validClients, serverHost);
      res.set('Content-Type', 'text/yaml; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${primaryClient.email || 'pahlavy'}.yaml"`);
      return res.send(clashYaml);
    }

    if (format === 'json' || format === 'singbox' || userAgent.includes('sing-box')) {
      return res.json({
        user: primaryClient.email,
        traffic_used_gb: primaryClient.traffic_used_gb,
        traffic_limit_gb: primaryClient.traffic_limit_gb,
        expires_at: primaryClient.expires_at,
        configs: validClients.map(c => ({
          remark: `${c.email}-${c.inbound_remark || c.protocol.toUpperCase()}`,
          protocol: c.protocol,
          port: c.port,
          link: buildSingleProtocolUri(c, serverHost)
        }))
      });
    }

    // 8. Default: Base64 V2Ray Subscription (Standard format for v2rayNG / V2Box / Streisand / Shadowrocket)
    const links = validClients.map(c => buildSingleProtocolUri(c, serverHost)).filter(Boolean);
    const rawContent = links.join('\r\n');

    if (format === 'raw') {
      res.set('Content-Type', 'text/plain; charset=utf-8');
      return res.send(rawContent);
    }

    const base64Encoded = Buffer.from(rawContent, 'utf-8').toString('base64');
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', `inline; filename="${primaryClient.email || 'subscription'}.txt"`);
    res.send(base64Encoded);

  } catch (error) {
    console.error('Subscription generation error:', error);
    next(error);
  }
});

// ========== Standard Protocol Link Generators ==========

function buildSingleProtocolUri(c, serverHost) {
  const stream = typeof c.stream_settings === 'string' ? JSON.parse(c.stream_settings) : (c.stream_settings || {});
  const net = stream.network || 'tcp';
  const sec = stream.security || 'none';
  const port = c.port;
  
  const inboundRemark = c.inbound_remark || c.protocol.toUpperCase();
  const configName = `${c.email} | ${inboundRemark}`;
  const remarkEncoded = encodeURIComponent(configName);

  // 1. VLESS Protocol
  if (c.protocol === 'vless') {
    if (sec === 'reality') {
      const real = stream.realitySettings || {};
      const sniList = Array.isArray(real.serverNames) ? real.serverNames : (typeof real.serverNames === 'string' ? real.serverNames.split(',') : []);
      const primarySni = sniList[0]?.trim() || real.dest?.split(':')[0] || 'www.microsoft.com';
      const shortId = Array.isArray(real.shortIds) ? real.shortIds[0] : (real.shortIds || '');
      const pbk = real.publicKey || '';
      const fp = real.fingerprint || 'chrome';
      const flow = c.flow || (net === 'tcp' ? 'xtls-rprx-vision' : '');

      const params = new URLSearchParams({
        type: net,
        security: 'reality',
        pbk: pbk,
        fp: fp,
        sni: primarySni,
        sid: shortId
      });
      if (flow) params.set('flow', flow);

      if (net === 'grpc') {
        params.set('serviceName', stream.grpcSettings?.serviceName || '');
      } else if (net === 'ws') {
        params.set('path', stream.wsSettings?.path || '/');
        if (stream.wsSettings?.headers?.Host) params.set('host', stream.wsSettings.headers.Host);
      } else if (net === 'httpupgrade') {
        params.set('path', stream.httpupgradeSettings?.path || '/');
        if (stream.httpupgradeSettings?.host) params.set('host', stream.httpupgradeSettings.host);
      }

      return `vless://${c.uuid}@${serverHost}:${port}?${params.toString()}#${remarkEncoded}`;
    } else if (sec === 'tls') {
      const tls = stream.tlsSettings || {};
      const sni = tls.serverName || serverHost;
      const fp = tls.fingerprint || 'chrome';

      const params = new URLSearchParams({
        type: net,
        security: 'tls',
        sni: sni,
        fp: fp
      });

      if (net === 'ws') {
        params.set('path', stream.wsSettings?.path || '/');
        params.set('host', stream.wsSettings?.headers?.Host || sni);
      } else if (net === 'grpc') {
        params.set('serviceName', stream.grpcSettings?.serviceName || '');
      } else if (net === 'httpupgrade') {
        params.set('path', stream.httpupgradeSettings?.path || '/');
        params.set('host', stream.httpupgradeSettings?.host || sni);
      }

      return `vless://${c.uuid}@${serverHost}:${port}?${params.toString()}#${remarkEncoded}`;
    } else {
      // VLESS None
      const params = new URLSearchParams({
        type: net,
        security: 'none'
      });
      if (net === 'ws') {
        params.set('path', stream.wsSettings?.path || '/');
        if (stream.wsSettings?.headers?.Host) params.set('host', stream.wsSettings.headers.Host);
      }
      return `vless://${c.uuid}@${serverHost}:${port}?${params.toString()}#${remarkEncoded}`;
    }
  }

  // 2. VMess Protocol
  if (c.protocol === 'vmess') {
    const isTls = sec === 'tls';
    const sni = stream.tlsSettings?.serverName || (isTls ? serverHost : '');
    const wsPath = net === 'ws' ? (stream.wsSettings?.path || '/') : '';
    const wsHost = net === 'ws' ? (stream.wsSettings?.headers?.Host || sni || '') : '';

    const vmessJson = {
      v: '2',
      ps: configName,
      add: serverHost,
      port: String(port),
      id: c.uuid,
      aid: 0,
      scy: 'auto',
      net: net,
      type: 'none',
      host: wsHost,
      path: wsPath,
      tls: isTls ? 'tls' : '',
      sni: sni,
      alpn: '',
      fp: isTls ? (stream.tlsSettings?.fingerprint || 'chrome') : ''
    };
    return 'vmess://' + Buffer.from(JSON.stringify(vmessJson), 'utf-8').toString('base64');
  }

  // 3. Trojan Protocol
  if (c.protocol === 'trojan') {
    const pwd = c.password || c.uuid;
    const isReality = sec === 'reality';
    const isTls = sec === 'tls';

    if (isReality) {
      const real = stream.realitySettings || {};
      const sniList = Array.isArray(real.serverNames) ? real.serverNames : (typeof real.serverNames === 'string' ? real.serverNames.split(',') : []);
      const primarySni = sniList[0]?.trim() || 'www.microsoft.com';

      const params = new URLSearchParams({
        type: net,
        security: 'reality',
        pbk: real.publicKey || '',
        fp: real.fingerprint || 'chrome',
        sni: primarySni,
        sid: Array.isArray(real.shortIds) ? real.shortIds[0] : (real.shortIds || '')
      });
      return `trojan://${pwd}@${serverHost}:${port}?${params.toString()}#${remarkEncoded}`;
    } else {
      const params = new URLSearchParams({
        type: net,
        security: isTls ? 'tls' : 'none'
      });
      if (isTls) {
        params.set('sni', stream.tlsSettings?.serverName || serverHost);
        params.set('fp', stream.tlsSettings?.fingerprint || 'chrome');
      }
      if (net === 'ws') {
        params.set('path', stream.wsSettings?.path || '/');
        if (stream.wsSettings?.headers?.Host) params.set('host', stream.wsSettings.headers.Host);
      }
      return `trojan://${pwd}@${serverHost}:${port}?${params.toString()}#${remarkEncoded}`;
    }
  }

  // 4. Shadowsocks Protocol (SIP002)
  if (c.protocol === 'shadowsocks') {
    const rawSettings = typeof c.inbound_settings === 'string' ? JSON.parse(c.inbound_settings) : (c.inbound_settings || {});
    const method = rawSettings.method || '2022-blake3-aes-128-gcm';
    const pwd = rawSettings.password || c.password || c.uuid;
    
    const credentials = Buffer.from(`${method}:${pwd}`, 'utf-8').toString('base64').replace(/=/g, '');
    return `ss://${credentials}@${serverHost}:${port}#${remarkEncoded}`;
  }

  return '';
}

// ========== Clash Configuration Generator ==========

function generateClashConfig(clients, serverHost) {
  const proxies = clients.map(c => {
    const stream = typeof c.stream_settings === 'string' ? JSON.parse(c.stream_settings) : (c.stream_settings || {});
    const net = stream.network || 'tcp';
    const sec = stream.security || 'none';
    const name = `${c.email} | ${c.inbound_remark || c.protocol.toUpperCase()}`;

    if (c.protocol === 'vless') {
      const isReality = sec === 'reality';
      const isTls = sec === 'tls' || isReality;
      const real = stream.realitySettings || {};
      const sniList = Array.isArray(real.serverNames) ? real.serverNames : [];
      const sni = isReality ? (sniList[0] || 'www.microsoft.com') : (stream.tlsSettings?.serverName || serverHost);

      const p = {
        name: name,
        type: 'vless',
        server: serverHost,
        port: c.port,
        uuid: c.uuid,
        udp: true,
        tls: isTls,
        servername: sni,
        network: net,
        'client-fingerprint': stream.realitySettings?.fingerprint || stream.tlsSettings?.fingerprint || 'chrome'
      };

      if (c.flow) p.flow = c.flow;

      if (net === 'ws') {
        p['ws-opts'] = {
          path: stream.wsSettings?.path || '/',
          headers: { Host: stream.wsSettings?.headers?.Host || sni }
        };
      } else if (net === 'grpc') {
        p['grpc-opts'] = {
          'grpc-service-name': stream.grpcSettings?.serviceName || ''
        };
      }

      if (isReality) {
        p['reality-opts'] = {
          'public-key': real.publicKey || '',
          'short-id': Array.isArray(real.shortIds) ? real.shortIds[0] : (real.shortIds || '')
        };
      }

      return p;
    }

    if (c.protocol === 'vmess') {
      const isTls = sec === 'tls';
      const sni = stream.tlsSettings?.serverName || serverHost;
      const p = {
        name: name,
        type: 'vmess',
        server: serverHost,
        port: c.port,
        uuid: c.uuid,
        alterId: 0,
        cipher: 'auto',
        udp: true,
        tls: isTls,
        servername: isTls ? sni : undefined,
        network: net
      };

      if (net === 'ws') {
        p['ws-opts'] = {
          path: stream.wsSettings?.path || '/',
          headers: { Host: stream.wsSettings?.headers?.Host || sni }
        };
      }
      return p;
    }

    if (c.protocol === 'trojan') {
      const isTls = sec === 'tls';
      const sni = stream.tlsSettings?.serverName || serverHost;
      const p = {
        name: name,
        type: 'trojan',
        server: serverHost,
        port: c.port,
        password: c.password || c.uuid,
        udp: true,
        sni: isTls ? sni : undefined,
        network: net
      };
      if (net === 'ws') {
        p['ws-opts'] = {
          path: stream.wsSettings?.path || '/',
          headers: { Host: stream.wsSettings?.headers?.Host || sni }
        };
      }
      return p;
    }

    if (c.protocol === 'shadowsocks') {
      const rawSettings = typeof c.inbound_settings === 'string' ? JSON.parse(c.inbound_settings) : (c.inbound_settings || {});
      return {
        name: name,
        type: 'ss',
        server: serverHost,
        port: c.port,
        cipher: rawSettings.method || '2022-blake3-aes-128-gcm',
        password: rawSettings.password || c.password || c.uuid,
        udp: true
      };
    }

    return null;
  }).filter(Boolean);

// ========== Client Portal HTML Generator ==========

function generateClientPortalHtml({ client, validClients, serverHost, subUrl, usedUp, usedDown, totalBytes }) {
  const usedGB = ((usedUp + usedDown) / (1024 * 1024 * 1024)).toFixed(2);
  const totalGB = client.traffic_limit_gb > 0 ? `${parseFloat(client.traffic_limit_gb).toFixed(1)} GB` : 'نامحدود (Unlimited)';
  const percent = client.traffic_limit_gb > 0 ? Math.min(100, Math.round((parseFloat(usedGB) / parseFloat(client.traffic_limit_gb)) * 100)) : 0;
  
  let expireText = 'نامحدود (No Expiry)';
  let daysLeft = '∞';
  if (client.expires_at) {
    const expDate = new Date(client.expires_at);
    const now = new Date();
    const diffMs = expDate - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    daysLeft = diffDays > 0 ? `${diffDays} روز باقی‌مانده` : 'منقضی شده (Expired)';
    expireText = expDate.toLocaleDateString('fa-IR');
  } else if (client.start_after_first_use && !client.first_use_at) {
    daysLeft = `${client.duration_days || 30} روز`;
    expireText = 'شروع پس از اولین اتصال';
  }

  const nodesHtml = validClients.map(c => {
    const link = buildSingleProtocolUri(c, serverHost);
    return `
      <div class="node-item">
        <div class="node-info">
          <span class="node-badge node-${c.protocol}">${c.protocol.toUpperCase()}</span>
          <span class="node-name">${c.email} | :${c.port} (${c.inbound_remark || ''})</span>
        </div>
        <button class="copy-btn" onclick="copyText('${link}')">کپی لینک</button>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>اشتراک من | ${escapeHtml(client.email)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700;800&family=Outfit:wght@500;700&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <style>
    :root {
      --bg: #070B14;
      --card-bg: rgba(15, 23, 42, 0.85);
      --border: rgba(255, 255, 255, 0.08);
      --primary: #00E5FF;
      --green: #00FF87;
      --gold: #FFB800;
      --text: #F8FAFC;
      --text-muted: #94A3B8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      background-image: radial-gradient(circle at 50% 0%, rgba(0, 229, 255, 0.12) 0%, transparent 60%);
      color: var(--text);
      font-family: 'Vazirmatn', sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      padding: 24px 16px;
    }
    .container {
      width: 100%;
      max-width: 540px;
    }
    .header-brand {
      text-align: center;
      margin-bottom: 24px;
    }
    .header-brand h1 {
      font-size: 1.6rem;
      font-weight: 800;
      background: linear-gradient(135deg, #00E5FF, #00FF87);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .header-brand p {
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 24px;
      margin-bottom: 20px;
      backdrop-filter: blur(16px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .user-badge {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .user-badge .email {
      font-weight: 700;
      font-size: 1.1rem;
    }
    .status-pill {
      background: rgba(0, 255, 135, 0.15);
      color: var(--green);
      padding: 4px 12px;
      border-radius: 99px;
      font-size: 0.8rem;
      font-weight: 700;
    }
    .stats-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 20px;
    }
    .stat-item {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px;
    }
    .stat-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      display: block;
      margin-bottom: 4px;
    }
    .stat-val {
      font-size: 1.1rem;
      font-weight: 700;
      color: #FFF;
    }
    .progress-bar-wrap {
      margin-bottom: 20px;
    }
    .progress-labels {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .progress-track {
      width: 100%;
      height: 8px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 99px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--primary), var(--green));
      border-radius: 99px;
      transition: width 0.5s ease;
    }
    .qr-center {
      text-align: center;
      margin-bottom: 20px;
    }
    .qr-box {
      background: #FFF;
      padding: 12px;
      border-radius: 14px;
      display: inline-block;
    }
    .btn {
      width: 100%;
      padding: 12px 16px;
      border-radius: 12px;
      border: none;
      font-family: inherit;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 10px;
      transition: 0.2s ease;
    }
    .btn-primary {
      background: linear-gradient(135deg, var(--primary), #00B4D8);
      color: #070B14;
    }
    .btn-primary:hover { opacity: 0.9; }
    .btn-outline {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      color: var(--text);
    }
    .btn-outline:hover { background: rgba(255, 255, 255, 0.1); }
    .import-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 14px;
    }
    .node-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 8px;
      font-size: 0.85rem;
    }
    .node-badge {
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 0.7rem;
      font-weight: 700;
      margin-left: 6px;
    }
    .node-vless { background: rgba(168, 85, 247, 0.2); color: #C084FC; }
    .node-vmess { background: rgba(0, 255, 135, 0.2); color: #00FF87; }
    .node-trojan { background: rgba(0, 229, 255, 0.2); color: #00E5FF; }
    .node-shadowsocks { background: rgba(255, 184, 0, 0.2); color: #FFB800; }
    .copy-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--primary);
      padding: 4px 10px;
      border-radius: 8px;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: #00FF87;
      color: #070B14;
      padding: 10px 20px;
      border-radius: 99px;
      font-weight: 700;
      font-size: 0.85rem;
      display: none;
      z-index: 9999;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-brand">
      <h1>🦁 PAHLAVI VIP</h1>
      <p>پرتال هوشمند اشتراک و وضعیت کاربر</p>
    </div>

    <div class="card">
      <div class="user-badge">
        <span class="email">${escapeHtml(client.email)}</span>
        <span class="status-pill">${client.enable ? '● فعال (Active)' : '○ غیرفعال'}</span>
      </div>

      <div class="stats-row">
        <div class="stat-item">
          <span class="stat-label">حجم مصرف شده</span>
          <span class="stat-val">${usedGB} GB</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">سقف کل حجم</span>
          <span class="stat-val">${totalGB}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">تاریخ انقضا</span>
          <span class="stat-val" style="font-size:0.95rem;">${expireText}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">زمان باقی‌مانده</span>
          <span class="stat-val text-primary">${daysLeft}</span>
        </div>
      </div>

      <div class="progress-bar-wrap">
        <div class="progress-labels">
          <span>درصد مصرف</span>
          <span>${percent}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${percent}%"></div>
        </div>
      </div>

      <div class="qr-center">
        <div id="qrcode" class="qr-box"></div>
      </div>

      <button class="btn btn-primary" onclick="copyText('${subUrl}')">
        📋 کپی لینک اشتراک هوشمند
      </button>

      <div class="import-grid">
        <a href="v2rayng://install-config?url=${encodeURIComponent(subUrl)}" class="btn btn-outline" style="text-decoration:none;">
          🚀 ورود به v2rayNG
        </a>
        <a href="streisand://import/${subUrl}" class="btn btn-outline" style="text-decoration:none;">
          ⚡ Streisand
        </a>
        <a href="sub://${Buffer.from(subUrl).toString('base64')}" class="btn btn-outline" style="text-decoration:none;">
          🚀 Shadowrocket
        </a>
        <a href="clash://install-config?url=${encodeURIComponent(subUrl + '?format=clash')}" class="btn btn-outline" style="text-decoration:none;">
          🐱 Clash / Mihomo
        </a>
      </div>
    </div>

    <div class="card">
      <h3 style="font-size:1rem; margin-bottom:12px; color:var(--text-muted);">کانفیگ‌های مجزا (Direct Nodes)</h3>
      ${nodesHtml}
    </div>
  </div>

  <div id="toast" class="toast">کپی شد!</div>

  <script>
    new QRCode(document.getElementById("qrcode"), {
      text: "${subUrl}",
      width: 160,
      height: 160,
      colorDark : "#000000",
      colorLight : "#ffffff",
      correctLevel : QRCode.CorrectLevel.M
    });

    function copyText(text) {
      navigator.clipboard.writeText(text).then(() => {
        const toast = document.getElementById('toast');
        toast.style.display = 'block';
        setTimeout(() => toast.style.display = 'none', 2000);
      });
    }
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = router;
