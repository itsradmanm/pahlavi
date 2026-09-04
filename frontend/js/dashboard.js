/* =========================================================
   PANEL PAHLAVY - DASHBOARD METRICS & CHARTS (3X-UI)
   ========================================================= */

let trafficTrendChartInstance = null;
let configStatusChartInstance = null;

async function loadDashboard() {
  try {
    const [overviewData, trafficData, inboundsData] = await Promise.all([
      apiFetch('/api/analytics/overview'),
      apiFetch('/api/analytics/traffic?days=7'),
      apiFetch('/api/inbounds')
    ]);

    renderDashboardStats(overviewData);
    renderTrafficTrendChart(trafficData);
    renderConfigStatusChart(overviewData.stats);
    renderDashboardInboundsTable(inboundsData);
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  }
}

function renderDashboardStats(data) {
  const stats = data.stats || {};
  const quota = data.quota || {};

  document.getElementById('stat-total-clients').textContent = stats.total_clients || 0;
  document.getElementById('stat-total-inbounds').textContent = stats.total_inbounds || 0;
  document.getElementById('sidebar-inbounds-badge').textContent = stats.total_inbounds || 0;

  document.getElementById('stat-online-now').textContent = stats.online_now || 0;
  document.getElementById('stat-active-clients').textContent = stats.active_clients || 0;

  document.getElementById('stat-expiring-soon').textContent = stats.expiring_soon || 0;
  document.getElementById('stat-expired-clients').textContent = stats.expired_clients || 0;
  document.getElementById('stat-quota-full').textContent = stats.quota_full_clients || 0;

  const totalUsedGB = parseFloat(stats.total_traffic_gb || 0).toFixed(2);
  let limitGB = parseFloat(quota.traffic_quota_gb || 0);

  if (limitGB === 0 || limitGB >= 99999) {
    document.getElementById('stat-traffic-usage').textContent = `${totalUsedGB} GB / ∞`;
    document.getElementById('stat-traffic-bar').style.width = '100%';
  } else {
    document.getElementById('stat-traffic-usage').textContent = `${totalUsedGB} GB / ${limitGB.toFixed(2)} GB`;
    const percent = Math.min(100, Math.round((totalUsedGB / limitGB) * 100));
    document.getElementById('stat-traffic-bar').style.width = `${percent}%`;
  }
}

function renderTrafficTrendChart(trafficData) {
  const ctx = document.getElementById('trafficTrendChart');
  if (!ctx) return;

  const labels = trafficData.map(d => {
    const parts = d.date.split('-');
    return `${parts[1]}/${parts[2]}`;
  });

  const downloadGB = trafficData.map(d => (d.bytes_out / (1024 * 1024 * 1024)).toFixed(3));
  const uploadGB = trafficData.map(d => (d.bytes_in / (1024 * 1024 * 1024)).toFixed(3));

  if (trafficTrendChartInstance) {
    trafficTrendChartInstance.destroy();
  }

  trafficTrendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Download',
          data: downloadGB,
          borderColor: '#FFB800',
          backgroundColor: 'rgba(255, 184, 0, 0.05)',
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: '#FFB800'
        },
        {
          label: 'Upload',
          data: uploadGB,
          borderColor: '#00E5FF',
          backgroundColor: 'rgba(0, 229, 255, 0.1)',
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: '#00E5FF'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0F1626',
          titleColor: '#FFF',
          bodyColor: '#94A3B8',
          borderColor: '#1F2C47',
          borderWidth: 1,
          padding: 10
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(31, 44, 71, 0.6)' },
          ticks: { color: '#64748B', font: { family: 'Outfit' } }
        },
        y: {
          grid: { color: 'rgba(31, 44, 71, 0.6)' },
          ticks: {
            color: '#64748B',
            font: { family: 'Outfit' },
            callback: function(v) { return v + ' G'; }
          },
          beginAtZero: true
        }
      }
    }
  });
}

function renderConfigStatusChart(stats = {}) {
  const ctx = document.getElementById('configStatusChart');
  if (!ctx) return;

  const active = parseInt(stats.active_clients || 0);
  const expired = parseInt(stats.expired_clients || 0);
  const quotaFull = parseInt(stats.quota_full_clients || 0);
  const disabled = parseInt(stats.disabled_clients || 0);

  const total = active + expired + quotaFull + disabled;
  const data = total === 0 ? [1] : [active, expired, quotaFull, disabled];
  const bgColors = total === 0 ? ['#1F2C47'] : ['#00FF87', '#FF385C', '#FF8800', '#64748B'];

  if (configStatusChartInstance) {
    configStatusChartInstance.destroy();
  }

  configStatusChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Active', 'Expired', 'Quota Full', 'Disabled'],
      datasets: [{
        data: data,
        backgroundColor: bgColors,
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '76%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#94A3B8',
            boxWidth: 10,
            padding: 14,
            font: { family: 'Outfit', size: 12 }
          }
        }
      }
    }
  });
}

function renderDashboardInboundsTable(inbounds = []) {
  const tbody = document.getElementById('dashboard-inbounds-body');
  if (!tbody) return;

  if (inbounds.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">هیچ اینباندی یافت نشد</td></tr>`;
    return;
  }

  tbody.innerHTML = inbounds.map(inb => {
    const stream = typeof inb.stream_settings === 'string' ? JSON.parse(inb.stream_settings) : (inb.stream_settings || {});
    const net = stream.network || 'tcp';
    const sec = stream.security || 'none';
    const clientCount = inb.clients ? inb.clients.length : 0;

    return `
      <tr>
        <td><strong>${escapeHtml(inb.remark)}</strong></td>
        <td><span class="badge-proto badge-proto-${inb.protocol}">${inb.protocol.toUpperCase()}</span></td>
        <td><code>:${inb.port}</code></td>
        <td><span class="text-xs">${net.toUpperCase()} / ${sec.toUpperCase()}</span></td>
        <td><strong class="text-primary">${clientCount}</strong> کاربر</td>
        <td><span class="status-pill ${inb.enable ? 'status-pill-active' : 'status-pill-disabled'}">${inb.enable ? 'فعال' : 'غیرفعال'}</span></td>
        <td>
          <button class="btn btn-outline btn-xs" onclick="navigateTo('inbounds')">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> مدیریت
          </button>
        </td>
      </tr>
    `;
  }).join('');
}
