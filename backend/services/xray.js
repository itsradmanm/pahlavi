const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');
const { query } = require('../database');

const XRAY_CONFIG_PATH = process.env.XRAY_CONFIG_PATH || '/usr/local/etc/xray/config.json';
const XRAY_API_PORT = parseInt(process.env.XRAY_API_PORT) || 62789;

// ========== Generate Reality Keypairs & Utilities ==========

function generateRealityKeys() {
  try {
    const output = execSync('xray x25519 2>/dev/null', { timeout: 4000 }).toString();
    const privMatch = output.match(/Private key:\s*([^\s]+)/i);
    const pubMatch = output.match(/Public key:\s*([^\s]+)/i);
    
    if (privMatch && pubMatch) {
      return {
        privateKey: privMatch[1],
        publicKey: pubMatch[1],
        shortId: crypto.randomBytes(4).toString('hex')
      };
    }
  } catch (e) {
    // Fallback if xray binary isn't found in current environment
  }
  
  try {
    const keyPair = crypto.generateKeyPairSync('x25519');
    return {
      privateKey: keyPair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
      publicKey: keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      shortId: crypto.randomBytes(4).toString('hex')
    };
  } catch (e) {
    return {
      privateKey: crypto.randomBytes(32).toString('base64'),
      publicKey: crypto.randomBytes(32).toString('base64'),
      shortId: crypto.randomBytes(4).toString('hex')
    };
  }
}

function generateRandomPort() {
  return Math.floor(Math.random() * (60000 - 10000 + 1)) + 10000;
}

// ========== Build Full Xray Config from Database ==========

async function buildFullXrayConfig() {
  const inboundsResult = await query(`
    SELECT i.*, 
      COALESCE(
        json_agg(
          json_build_object(
            'id', c.id,
            'email', c.email,
            'uuid', c.uuid,
            'flow', c.flow,
            'password', c.password,
            'enable', c.enable,
            'traffic_limit_gb', c.traffic_limit_gb,
            'traffic_used_gb', c.traffic_used_gb,
            'expires_at', c.expires_at,
            'start_after_first_use', c.start_after_first_use,
            'first_use_at', c.first_use_at
          )
        ) FILTER (WHERE c.id IS NOT NULL),
        '[]'
      ) as clients
    FROM inbounds i
    LEFT JOIN clients c ON c.inbound_id = i.id
    WHERE i.enable = true
    GROUP BY i.id
    ORDER BY i.port ASC
  `);

  const inbounds = [];

  // API Inbound for stats & handler querying (dokodemo-door)
  inbounds.push({
    tag: 'api',
    port: XRAY_API_PORT,
    listen: '127.0.0.1',
    protocol: 'dokodemo-door',
    settings: { address: '127.0.0.1' }
  });

  for (const row of inboundsResult.rows) {
    const rawSettings = typeof row.settings === 'string' ? JSON.parse(row.settings) : (row.settings || {});
    const rawStream = typeof row.stream_settings === 'string' ? JSON.parse(row.stream_settings) : (row.stream_settings || {});
    const rawSniffing = typeof row.sniffing === 'string' ? JSON.parse(row.sniffing) : (row.sniffing || {});

    // Filter valid & active clients
    const validClients = (row.clients || []).filter(c => {
      if (!c.enable) return false;
      if (c.traffic_limit_gb > 0 && c.traffic_used_gb >= c.traffic_limit_gb) return false;
      if (c.expires_at && new Date(c.expires_at) < new Date()) return false;
      return true;
    });

    const inboundTag = row.tag || `inbound-${row.port}-${row.protocol}`;
    const net = rawStream.network || 'tcp';
    const sec = rawStream.security || 'none';

    const inboundObj = {
      tag: inboundTag,
      port: row.port,
      listen: row.listen || '0.0.0.0',
      protocol: row.protocol,
      settings: {},
      streamSettings: {
        network: net,
        security: sec
      },
      sniffing: rawSniffing.enabled !== false ? {
        enabled: true,
        destOverride: ['http', 'tls', 'quic']
      } : { enabled: false }
    };

    // 1. VLESS Settings
    if (row.protocol === 'vless') {
      inboundObj.settings = {
        clients: validClients.map(c => ({
          id: c.uuid,
          flow: (sec === 'reality' && net === 'tcp') ? (c.flow || 'xtls-rprx-vision') : '',
          email: c.email
        })),
        decryption: 'none'
      };
    } 
    // 2. VMess Settings
    else if (row.protocol === 'vmess') {
      inboundObj.settings = {
        clients: validClients.map(c => ({
          id: c.uuid,
          alterId: 0,
          email: c.email
        }))
      };
    } 
    // 3. Trojan Settings
    else if (row.protocol === 'trojan') {
      inboundObj.settings = {
        clients: validClients.map(c => ({
          password: c.password || c.uuid,
          email: c.email
        }))
      };
    } 
    // 4. Shadowsocks Settings
    else if (row.protocol === 'shadowsocks') {
      const ssMethod = rawSettings.method || '2022-blake3-aes-128-gcm';
      const ssPassword = rawSettings.password || (validClients[0]?.password || crypto.randomBytes(16).toString('base64'));
      inboundObj.settings = {
        method: ssMethod,
        password: ssPassword,
        network: rawSettings.network || 'tcp,udp'
      };
    }
    // 5. Dokodemo-door Settings (Port forwarding)
    else if (row.protocol === 'dokodemo-door') {
      inboundObj.settings = {
        address: rawSettings.address || '127.0.0.1',
        port: rawSettings.port || row.port,
        network: rawSettings.network || 'tcp,udp'
      };
    }

    // Stream Settings: WebSocket
    if (net === 'ws') {
      inboundObj.streamSettings.wsSettings = {
        path: rawStream.wsSettings?.path || '/',
        headers: rawStream.wsSettings?.headers || {}
      };
    } 
    // Stream Settings: gRPC
    else if (net === 'grpc') {
      inboundObj.streamSettings.grpcSettings = {
        serviceName: rawStream.grpcSettings?.serviceName || ''
      };
    }
    // Stream Settings: HTTPUpgrade
    else if (net === 'httpupgrade') {
      inboundObj.streamSettings.httpupgradeSettings = {
        path: rawStream.httpupgradeSettings?.path || '/',
        host: rawStream.httpupgradeSettings?.host || ''
      };
    }
    // Stream Settings: SplitHTTP
    else if (net === 'splithttp') {
      inboundObj.streamSettings.splithttpSettings = {
        path: rawStream.splithttpSettings?.path || '/'
      };
    }

    // Security: Reality
    if (sec === 'reality') {
      const real = rawStream.realitySettings || {};
      const serverNames = Array.isArray(real.serverNames) 
        ? real.serverNames 
        : (typeof real.serverNames === 'string' ? real.serverNames.split(',').map(s => s.trim()) : ['www.microsoft.com', 'microsoft.com']);
      
      const shortIds = Array.isArray(real.shortIds) 
        ? real.shortIds 
        : (typeof real.shortIds === 'string' ? real.shortIds.split(',').map(s => s.trim()) : ['0123456789abcdef']);

      inboundObj.streamSettings.realitySettings = {
        show: false,
        dest: real.dest || 'www.microsoft.com:443',
        xver: 0,
        serverNames: serverNames,
        privateKey: real.privateKey || '',
        shortIds: shortIds,
        fingerprint: real.fingerprint || 'chrome'
      };
    } 
    // Security: TLS
    else if (sec === 'tls') {
      const domain = rawStream.tlsSettings?.serverName || 'localhost';
      const certPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
      const keyPath = `/etc/letsencrypt/live/${domain}/privkey.pem`;
      const selfCertPath = `/etc/pahlavy/certs/${domain}/fullchain.pem`;
      const selfKeyPath = `/etc/pahlavy/certs/${domain}/privkey.pem`;

      let certificates = [];
      if (fs.existsSync(certPath)) {
        certificates.push({ certificateFile: certPath, keyFile: keyPath });
      } else if (fs.existsSync(selfCertPath)) {
        certificates.push({ certificateFile: selfCertPath, keyFile: selfKeyPath });
      }

      inboundObj.streamSettings.tlsSettings = {
        serverName: domain,
        certificates: certificates,
        fingerprint: rawStream.tlsSettings?.fingerprint || 'chrome'
      };
    }

    inbounds.push(inboundObj);
  }

  const xrayConfig = {
    log: { loglevel: 'warning' },
    api: {
      tag: 'api',
      services: ['HandlerService', 'StatsService', 'LoggerService']
    },
    stats: {},
    policy: {
      levels: {
        '0': { statsUserUplink: true, statsUserDownlink: true }
      },
      system: {
        statsInboundUplink: true,
        statsInboundDownlink: true
      }
    },
    inbounds: inbounds,
    outbounds: [
      { protocol: 'freedom', tag: 'direct' },
      { protocol: 'blackhole', tag: 'blocked' }
    ],
    routing: {
      rules: [
        { inbounds: ['api'], outbounds: ['api'], tag: 'api', type: 'field' },
        { protocol: ['bittorrent'], outboundTag: 'blocked', type: 'field' }
      ]
    }
  };

  return xrayConfig;
}

// ========== Apply to local Xray Service ==========

async function applyConfigToXray() {
  try {
    const config = await buildFullXrayConfig();
    const configDir = path.dirname(XRAY_CONFIG_PATH);

    if (!fs.existsSync(configDir)) {
      try {
        fs.mkdirSync(configDir, { recursive: true });
      } catch (e) {}
    }

    try {
      fs.writeFileSync(XRAY_CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (e) {
      // Local dev fallback if no permission to write to /usr/local/etc/xray
    }

    try {
      execSync('systemctl reload xray 2>/dev/null || systemctl restart xray 2>/dev/null || true', { timeout: 5000 });
    } catch (e) {
      // Non-Linux or development fallback
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to apply config to Xray:', error.message);
    throw error;
  }
}

// ========== Collect Real-time Traffic from Xray Core (3X-UI Style) ==========

async function collectXrayTraffic() {
  try {
    const cmd = `xray api statsquery --server=127.0.0.1:${XRAY_API_PORT} -reset=true 2>/dev/null`;
    let rawOutput = '';
    
    try {
      rawOutput = execSync(cmd, { timeout: 4000 }).toString();
    } catch (e) {
      return null;
    }

    if (!rawOutput || !rawOutput.trim()) return null;

    const data = JSON.parse(rawOutput);
    const statsList = data.stat || [];

    const userStats = {}; // { email: { uplink: bytes, downlink: bytes } }
    const inboundStats = {}; // { tag: { uplink: bytes, downlink: bytes } }

    for (const item of statsList) {
      const name = item.name || '';
      const val = parseInt(item.value || 0);
      if (val === 0) continue;

      // Match user traffic: user>>>email>>>traffic>>>uplink | downlink
      const userMatch = name.match(/^user>>>(.+)>>>traffic>>>(uplink|downlink)$/);
      if (userMatch) {
        const email = userMatch[1];
        const dir = userMatch[2]; // 'uplink' or 'downlink'
        if (!userStats[email]) userStats[email] = { uplink: 0, downlink: 0 };
        userStats[email][dir] = val;
        continue;
      }

      // Match inbound traffic: inbound>>>tag>>>traffic>>>uplink | downlink
      const inboundMatch = name.match(/^inbound>>>(.+)>>>traffic>>>(uplink|downlink)$/);
      if (inboundMatch) {
        const tag = inboundMatch[1];
        const dir = inboundMatch[2];
        if (!inboundStats[tag]) inboundStats[tag] = { uplink: 0, downlink: 0 };
        inboundStats[tag][dir] = val;
        continue;
      }
    }

    return { userStats, inboundStats };
  } catch (err) {
    return null;
  }
}

// ========== Client Expiry & Quota Checker Cron ==========

const { sendTelegramMessage } = require('./telegram');

function startConfigExpiryChecker() {
  // Check every 1 minute
  cron.schedule('* * * * *', async () => {
    try {
      const expired = await query(`
        UPDATE clients
        SET enable = false, updated_at = NOW()
        WHERE enable = true
          AND expires_at IS NOT NULL
          AND expires_at < NOW()
        RETURNING id, email
      `);

      const quotaFull = await query(`
        UPDATE clients
        SET enable = false, updated_at = NOW()
        WHERE enable = true
          AND traffic_limit_gb > 0
          AND traffic_used_gb >= traffic_limit_gb
        RETURNING id, email, traffic_used_gb, traffic_limit_gb
      `);

      if (expired.rows.length > 0) {
        for (const c of expired.rows) {
          sendTelegramMessage(`⚠️ *انقضای حساب کاربر*\n\nکاربر: \`${c.email}\` منقضی شد و دسترسی غیرفعال گردید.`);
        }
      }

      if (quotaFull.rows.length > 0) {
        for (const c of quotaFull.rows) {
          sendTelegramMessage(`🚫 *اتمام حجم کاربر*\n\nکاربر: \`${c.email}\`\nسقف: ${c.traffic_limit_gb} GB\nمصرف: ${c.traffic_used_gb} GB\nدسترسی غیرفعال شد.`);
        }
      }

      if (expired.rows.length > 0 || quotaFull.rows.length > 0) {
        applyConfigToXray().catch(console.error);
      }
    } catch (err) {
      console.error('Client expiry cron error:', err.message);
    }
  });
}

module.exports = {
  applyConfigToXray,
  buildFullXrayConfig,
  generateRealityKeys,
  generateRandomPort,
  collectXrayTraffic,
  startConfigExpiryChecker,
  XRAY_API_PORT,
  XRAY_CONFIG_PATH
};
