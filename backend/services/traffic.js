const cron = require('node-cron');
const { query } = require('../database');
const { collectXrayTraffic, applyConfigToXray } = require('./xray');

function startTrafficMonitor() {
  // Collect traffic from Xray-core every 30 seconds
  cron.schedule('*/30 * * * * *', async () => {
    try {
      await processLiveTrafficCollection();
    } catch (error) {
      console.error('Traffic collection cycle error:', error.message);
    }
  });

  // Offline detection & maintenance every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      await query(`
        UPDATE clients
        SET is_online = false
        WHERE is_online = true
          AND last_seen_at < NOW() - interval '3 minutes'
      `);
    } catch (error) {
      console.error('Offline detector error:', error.message);
    }
  });
  
  // Aggregate daily traffic at midnight & clean old logs
  cron.schedule('0 0 * * *', async () => {
    try {
      await query(`
        INSERT INTO traffic_daily (client_id, inbound_id, date, bytes_in, bytes_out)
        SELECT client_id, inbound_id, CURRENT_DATE - 1, SUM(bytes_in), SUM(bytes_out)
        FROM traffic_logs
        WHERE recorded_at >= CURRENT_DATE - 1 AND recorded_at < CURRENT_DATE
        GROUP BY client_id, inbound_id
        ON CONFLICT (client_id, date) DO UPDATE
          SET bytes_in = EXCLUDED.bytes_in,
              bytes_out = EXCLUDED.bytes_out
      `);
      
      // Clean old logs (keep 90 days)
      await query(`
        DELETE FROM traffic_logs 
        WHERE recorded_at < NOW() - interval '90 days'
      `);
      console.log('✅ Daily traffic aggregated & old logs pruned');
    } catch (error) {
      console.error('Daily traffic aggregation error:', error.message);
    }
  });
}

async function processLiveTrafficCollection() {
  const data = await collectXrayTraffic();
  if (!data) return;

  const { userStats = {}, inboundStats = {} } = data;
  let shouldReapplyXray = false;

  // 1. Process User/Client Traffic
  for (const [email, stats] of Object.entries(userStats)) {
    const uplink = parseInt(stats.uplink || 0);
    const downlink = parseInt(stats.downlink || 0);
    const totalDeltaBytes = uplink + downlink;
    if (totalDeltaBytes === 0) continue;

    // Find client
    const clientRes = await query(`
      SELECT c.*, i.id as inbound_id
      FROM clients c
      JOIN inbounds i ON i.id = c.inbound_id
      WHERE c.email = $1
      LIMIT 1
    `, [email]);

    if (!clientRes.rows[0]) continue;
    const client = clientRes.rows[0];

    const newUpBytes = (BigInt(client.traffic_up_bytes || 0) + BigInt(uplink)).toString();
    const newDownBytes = (BigInt(client.traffic_down_bytes || 0) + BigInt(downlink)).toString();
    const totalBytesNumber = Number(BigInt(newUpBytes) + BigInt(newDownBytes));
    const totalGbUsed = (totalBytesNumber / (1024 * 1024 * 1024)).toFixed(4);

    // Handle Start After First Use
    let firstUseClause = '';
    let firstUseParams = [];
    if (client.start_after_first_use && !client.first_use_at) {
      const duration = client.duration_days || 30;
      const expiresAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString();
      firstUseClause = ', first_use_at = NOW(), expires_at = $5';
      firstUseParams = [expiresAt];
    }

    // Check quota exceeded
    let isQuotaFull = false;
    if (client.traffic_limit_gb > 0 && parseFloat(totalGbUsed) >= parseFloat(client.traffic_limit_gb)) {
      isQuotaFull = true;
      shouldReapplyXray = true;
    }

    // Update Client in DB
    const updateQuery = `
      UPDATE clients
      SET traffic_up_bytes = $1,
          traffic_down_bytes = $2,
          traffic_used_gb = $3,
          is_online = true,
          last_seen_at = NOW(),
          enable = CASE WHEN $4 = true THEN false ELSE enable END,
          updated_at = NOW()
          ${firstUseClause}
      WHERE id = ${firstUseParams.length > 0 ? '$6' : '$5'}
    `;

    const params = [
      newUpBytes,
      newDownBytes,
      totalGbUsed,
      isQuotaFull,
      ...firstUseParams,
      client.id
    ];

    await query(updateQuery, params);

    // Update Reseller usage if created by a reseller
    if (client.created_by) {
      const deltaGB = totalDeltaBytes / (1024 * 1024 * 1024);
      await query(
        'UPDATE users SET traffic_used_gb = traffic_used_gb + $1 WHERE id = $2',
        [deltaGB, client.created_by]
      );
    }

    // Log to traffic_logs table
    await query(
      'INSERT INTO traffic_logs (client_id, inbound_id, bytes_in, bytes_out) VALUES ($1, $2, $3, $4)',
      [client.id, client.inbound_id, uplink, downlink]
    );

    // Update traffic_daily table for today
    await query(`
      INSERT INTO traffic_daily (client_id, inbound_id, date, bytes_in, bytes_out)
      VALUES ($1, $2, CURRENT_DATE, $3, $4)
      ON CONFLICT (client_id, date)
      DO UPDATE SET 
        bytes_in = traffic_daily.bytes_in + EXCLUDED.bytes_in,
        bytes_out = traffic_daily.bytes_out + EXCLUDED.bytes_out
    `, [client.id, client.inbound_id, uplink, downlink]);
  }

  // 2. Process Inbound Traffic
  for (const [tag, stats] of Object.entries(inboundStats)) {
    const uplink = parseInt(stats.uplink || 0);
    const downlink = parseInt(stats.downlink || 0);
    if (uplink === 0 && downlink === 0) continue;

    await query(`
      UPDATE inbounds
      SET traffic_up_bytes = traffic_up_bytes + $1,
          traffic_down_bytes = traffic_down_bytes + $2,
          updated_at = NOW()
      WHERE tag = $3
    `, [uplink, downlink, tag]);
  }

  // If any client exceeded quota during this tick, refresh Xray config
  if (shouldReapplyXray) {
    applyConfigToXray().catch(console.error);
  }
}

module.exports = { startTrafficMonitor, processLiveTrafficCollection };
