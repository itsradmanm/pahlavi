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

    // 7. Generate Format Outputs
    if (format === 'clash') {
      const clashYaml = generateClashConfig(validClients, serverHost);
      res.set('Content-Type', 'text/yaml; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${primaryClient.email || 'pahlavy'}.yaml"`);
      return res.send(clashYaml);
    }

    if (format === 'json') {
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

  const proxyNames = proxies.map(p => p.name);

  return `# Pahlavy Subscription (Clash Format)
# Generated: ${new Date().toISOString()}

port: 7890
socks-port: 7891
allow-lan: false
mode: Rule
log-level: info

proxies:
${proxies.map(p => '  - ' + JSON.stringify(p)).join('\n')}

proxy-groups:
  - name: 🦁 PAHLAVY
    type: select
    proxies:
${proxyNames.map(n => `      - "${n}"`).join('\n')}

rules:
  - MATCH,🦁 PAHLAVY
`;
}

module.exports = router;
