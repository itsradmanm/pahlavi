const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'pahlavy',
  user: process.env.DB_USER || 'pahlavy',
  password: process.env.DB_PASS || 'pahlavy123',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
});

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 1500) {
    console.warn('Slow query detected:', { text, duration });
  }
  return res;
}

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users (admin + resellers)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'reseller' CHECK (role IN ('admin', 'reseller')),
        
        -- Reseller quotas
        traffic_quota_gb NUMERIC(12,2) DEFAULT 0,
        traffic_used_gb NUMERIC(12,2) DEFAULT 0,
        max_clients INTEGER DEFAULT 0,
        clients_created INTEGER DEFAULT 0,
        
        sub_token VARCHAR(64) UNIQUE,
        is_active BOOLEAN DEFAULT true,
        expires_at TIMESTAMPTZ,
        
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Inbounds (3X-UI / Sanaei Style)
    await client.query(`
      CREATE TABLE IF NOT EXISTS inbounds (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        remark VARCHAR(255) NOT NULL,
        port INTEGER NOT NULL,
        protocol VARCHAR(30) NOT NULL CHECK (protocol IN ('vless', 'vmess', 'trojan', 'shadowsocks', 'wireguard', 'dokodemo-door')),
        listen VARCHAR(50) DEFAULT '0.0.0.0',
        
        -- Raw / Flexible configuration objects like 3x-ui
        settings JSONB DEFAULT '{}'::jsonb,
        stream_settings JSONB DEFAULT '{}'::jsonb,
        sniffing JSONB DEFAULT '{"enabled": true, "destOverride": ["http", "tls", "quic"]}'::jsonb,
        allocate JSONB DEFAULT '{}'::jsonb,
        
        tag VARCHAR(100) UNIQUE,
        enable BOOLEAN DEFAULT true,
        
        traffic_up_bytes BIGINT DEFAULT 0,
        traffic_down_bytes BIGINT DEFAULT 0,
        
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Clients (Accounts inside inbounds)
    await client.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        inbound_id INTEGER REFERENCES inbounds(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        uuid VARCHAR(64) NOT NULL,
        flow VARCHAR(50) DEFAULT '',
        password VARCHAR(255),
        
        -- Quotas
        traffic_limit_gb NUMERIC(12,2) DEFAULT 0,  -- 0 = unlimited
        traffic_up_bytes BIGINT DEFAULT 0,
        traffic_down_bytes BIGINT DEFAULT 0,
        traffic_used_gb NUMERIC(12,2) DEFAULT 0,
        
        -- Time limits & Start after first use
        start_after_first_use BOOLEAN DEFAULT false,
        first_use_at TIMESTAMPTZ,
        duration_days INTEGER,
        expires_at TIMESTAMPTZ,
        
        -- Security & limits
        ip_limit INTEGER DEFAULT 0,
        sub_token VARCHAR(64) UNIQUE NOT NULL,
        enable BOOLEAN DEFAULT true,
        is_online BOOLEAN DEFAULT false,
        last_seen_at TIMESTAMPTZ,
        
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Traffic Daily Summary
    await client.query(`
      CREATE TABLE IF NOT EXISTS traffic_daily (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        inbound_id INTEGER REFERENCES inbounds(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        bytes_in BIGINT DEFAULT 0,
        bytes_out BIGINT DEFAULT 0,
        UNIQUE(client_id, date)
      )
    `);

    // Traffic Logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS traffic_logs (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        inbound_id INTEGER REFERENCES inbounds(id) ON DELETE CASCADE,
        bytes_in BIGINT DEFAULT 0,
        bytes_out BIGINT DEFAULT 0,
        recorded_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Settings
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Reseller panel settings
    await client.query(`
      CREATE TABLE IF NOT EXISTS reseller_panels (
        id SERIAL PRIMARY KEY,
        reseller_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        panel_name VARCHAR(100),
        panel_url VARCHAR(255),
        logo_url VARCHAR(255),
        primary_color VARCHAR(20) DEFAULT '#00D4FF',
        can_create_resellers BOOLEAN DEFAULT false,
        can_manage_inbounds BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clients_sub_token ON clients(sub_token)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clients_inbound ON clients(inbound_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clients_created_by ON clients(created_by)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inbounds_port ON inbounds(port)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_traffic_daily_date ON traffic_daily(date)`);

    // Default admin creation
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');

    let adminId = null;
    const adminExists = await client.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    if (adminExists.rows.length === 0) {
      const defaultPass = process.env.ADMIN_PASSWORD || 'admin123';
      const hashed = await bcrypt.hash(defaultPass, 12);
      const subToken = uuidv4().replace(/-/g, '');
      
      const adminRes = await client.query(`
        INSERT INTO users (username, password, role, sub_token, traffic_quota_gb, max_clients)
        VALUES ($1, $2, 'admin', $3, 9999999, 999999)
        RETURNING id
      `, ['admin', hashed, subToken]);
      adminId = adminRes.rows[0].id;
      
      console.log(`✅ Default admin initialized: admin / ${defaultPass}`);
    } else {
      adminId = adminExists.rows[0].id;
    }

    // Default settings
    const defaultSettings = [
      ['panel_name', 'پنل پهلوی (Pahlavy UI)'],
      ['panel_url', process.env.PANEL_URL || 'http://localhost:3000'],
      ['sub_base_url', process.env.SUB_BASE_URL || 'http://localhost:3000'],
      ['tls_domain', process.env.TLS_DOMAIN || ''],
      ['tls_email', process.env.TLS_EMAIL || ''],
      ['xray_template', 'standard']
    ];
    
    for (const [key, value] of defaultSettings) {
      await client.query(`
        INSERT INTO settings (key, value) VALUES ($1, $2)
        ON CONFLICT (key) DO NOTHING
      `, [key, value]);
    }

    // Seed default inbounds if no inbounds exist (Sanaei style starter config)
    const inboundsCount = await client.query('SELECT COUNT(*) as count FROM inbounds');
    if (parseInt(inboundsCount.rows[0].count) === 0) {
      const { generateRealityKeys } = require('./services/xray');
      const keys = generateRealityKeys();
      
      // 1. Default VLESS-Reality Inbound (port 443)
      const realityInbound = await client.query(`
        INSERT INTO inbounds (
          user_id, remark, port, protocol, listen,
          settings, stream_settings, sniffing, tag, enable
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `, [
        adminId,
        'VLESS-REALITY',
        443,
        'vless',
        '0.0.0.0',
        JSON.stringify({}),
        JSON.stringify({
          network: 'tcp',
          security: 'reality',
          realitySettings: {
            show: false,
            dest: 'www.microsoft.com:443',
            xver: 0,
            serverNames: ['www.microsoft.com', 'microsoft.com'],
            privateKey: keys.privateKey,
            publicKey: keys.publicKey,
            shortIds: [keys.shortId || '0123456789abcdef'],
            fingerprint: 'chrome'
          }
        }),
        JSON.stringify({ enabled: true, destOverride: ['http', 'tls', 'quic'] }),
        'inbound-443-vless',
        true
      ]);

      const clientUuid = uuidv4();
      const subToken = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
      const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await client.query(`
        INSERT INTO clients (
          inbound_id, email, uuid, flow,
          traffic_limit_gb, duration_days, expires_at,
          start_after_first_use, sub_token, created_by, enable
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
      `, [
        realityInbound.rows[0].id,
        'admin-vless',
        clientUuid,
        'xtls-rprx-vision',
        50,
        30,
        thirtyDays,
        true,
        subToken,
        adminId
      ]);

      // 2. Default VMess-WS Inbound (port 8080)
      const vmessInbound = await client.query(`
        INSERT INTO inbounds (
          user_id, remark, port, protocol, listen,
          settings, stream_settings, sniffing, tag, enable
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `, [
        adminId,
        'VMESS-WS',
        8080,
        'vmess',
        '0.0.0.0',
        JSON.stringify({}),
        JSON.stringify({
          network: 'ws',
          security: 'none',
          wsSettings: {
            path: '/vmess',
            headers: {}
          }
        }),
        JSON.stringify({ enabled: true, destOverride: ['http', 'tls', 'quic'] }),
        'inbound-8080-vmess',
        true
      ]);

      const vmessUuid = uuidv4();
      const vmessSubToken = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');

      await client.query(`
        INSERT INTO clients (
          inbound_id, email, uuid,
          traffic_limit_gb, duration_days, expires_at,
          start_after_first_use, sub_token, created_by, enable
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
      `, [
        vmessInbound.rows[0].id,
        'admin-vmess',
        vmessUuid,
        50,
        30,
        thirtyDays,
        true,
        vmessSubToken,
        adminId
      ]);

      console.log('✅ Default Sanaei VLESS-Reality & VMess inbounds seeded');
    }

    await client.query('COMMIT');
    console.log('✅ Database schema initialized successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, initDatabase };
