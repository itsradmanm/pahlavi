/* =========================================================
   PANEL PAHLAVY - SETTINGS, SSL CERTIFICATES & ANALYTICS
   ========================================================= */

let analyticsChartInstance = null;

// ========== Settings & SSL Loader ==========
async function loadSettings() {
  try {
    const [settings, certStatus] = await Promise.all([
      apiFetch('/api/settings'),
      apiFetch('/api/settings/certificate')
    ]);

    if (settings.panel_name) document.getElementById('setting-panel-name').value = settings.panel_name;
    if (settings.sub_base_url) document.getElementById('setting-sub-base').value = settings.sub_base_url;
    if (settings.tls_domain) document.getElementById('ssl-domain').value = settings.tls_domain;
    if (settings.tls_email) document.getElementById('ssl-email').value = settings.tls_email;

    renderCertStatus(certStatus);
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function renderCertStatus(status) {
  const badge = document.getElementById('cert-badge');
  const details = document.getElementById('cert-details-text');
  if (!badge || !details) return;

  if (status.status === 'valid') {
    badge.className = 'cert-status-badge status-pill status-pill-active';
    badge.textContent = 'گواهی معتبر و فعال (SSL Active)';
    details.innerHTML = `
      <span><strong>دامنه:</strong> ${escapeHtml(status.domain)}</span> | 
      <span><strong>اعتبار باقی‌مانده:</strong> ${status.days_left} روز</span> | 
      <span class="text-xs text-muted">(${status.is_letsencrypt ? "Let's Encrypt" : 'Self-Signed'})</span>
    `;
  } else if (status.status === 'expired') {
    badge.className = 'cert-status-badge status-pill status-pill-expired';
    badge.textContent = 'گواهی منقضی شده';
    details.textContent = `گواهی دامنه ${status.domain} منقضی شده است. لطفا مجددا صادر نمایید.`;
  } else {
    badge.className = 'cert-status-badge status-pill status-pill-disabled';
    badge.textContent = 'بدون گواهی فعال';
    details.textContent = 'هیچ سرتیفیکیتی برای این سرور صادر نشده است.';
  }
}

async function handleCertSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-issue-cert');
  const originalHtml = btn.innerHTML;
  
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> در حال صدور گواهی و احراز هویت دامنه...`;

  const domain = document.getElementById('ssl-domain').value.trim();
  const email = document.getElementById('ssl-email').value.trim();
  const certType = document.querySelector('input[name="cert_type"]:checked')?.value || 'letsencrypt';

  try {
    await apiFetch('/api/settings/certificate', {
      method: 'POST',
      body: JSON.stringify({ domain, email, type: certType })
    });
    
    showToast('سرتیفیکیت SSL با موفقیت صادر و روی سرور نصب شد!', 'success');
    loadSettings();
  } catch (err) {
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

async function handleGeneralSettingsSubmit(e) {
  e.preventDefault();

  const payload = {
    panel_name: document.getElementById('setting-panel-name').value.trim(),
    sub_base_url: document.getElementById('setting-sub-base').value.trim()
  };

  try {
    await apiFetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    showToast('تنظیمات پنل با موفقیت ذخیره شد', 'success');
    
    if (payload.panel_name) {
      document.getElementById('sidebar-panel-name').textContent = payload.panel_name;
    }
  } catch (err) {
    console.error(err);
  }
}

async function handleChangePasswordSubmit(e) {
  e.preventDefault();

  const current_password = document.getElementById('cp-current').value;
  const new_password = document.getElementById('cp-new').value;

  try {
    await apiFetch('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password })
    });
    showToast('رمز عبور با موفقیت بروزرسانی شد', 'success');
    document.getElementById('change-password-form').reset();
  } catch (err) {
    console.error(err);
  }
}

// ========== Analytics Page Loader ==========
async function loadAnalytics(days = 7) {
  try {
    const [trafficHistory, topClients] = await Promise.all([
      apiFetch(`/api/analytics/traffic?days=${days}`),
      apiFetch('/api/analytics/top-clients?limit=10')
    ]);

    renderDetailedAnalyticsChart(trafficHistory);
    renderTopClientsTable(topClients);
  } catch (err) {
    console.error('Failed to load analytics:', err);
  }
}

function renderDetailedAnalyticsChart(trafficData) {
  const ctx = document.getElementById('detailedAnalyticsChart');
  if (!ctx) return;

  const labels = trafficData.map(d => d.date);
  const downloadGB = trafficData.map(d => (d.bytes_out / (1024 * 1024 * 1024)).toFixed(3));
  const uploadGB = trafficData.map(d => (d.bytes_in / (1024 * 1024 * 1024)).toFixed(3));

  if (analyticsChartInstance) {
    analyticsChartInstance.destroy();
  }

  analyticsChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Download (GB)',
          data: downloadGB,
          backgroundColor: '#00E5FF',
          borderRadius: 6
        },
        {
          label: 'Upload (GB)',
          data: uploadGB,
          backgroundColor: '#FFB800',
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: 'rgba(31, 44, 71, 0.6)' }, ticks: { color: '#94A3B8' } },
        y: { grid: { color: 'rgba(31, 44, 71, 0.6)' }, ticks: { color: '#94A3B8' }, beginAtZero: true }
      },
      plugins: {
        legend: { labels: { color: '#F8FAFC', font: { family: 'Outfit' } } }
      }
    }
  });
}

function renderTopClientsTable(clients = []) {
  const tbody = document.getElementById('top-clients-table-body');
  if (!tbody) return;

  if (clients.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">داده‌ای یافت نشد</td></tr>`;
    return;
  }

  tbody.innerHTML = clients.map(c => {
    const used = `${parseFloat(c.traffic_used_gb || 0).toFixed(2)} GB`;
    const limit = c.traffic_limit_gb > 0 ? `${c.traffic_limit_gb} GB` : 'نامحدود';
    const isOnline = c.is_online
      ? `<span class="text-success"><i class="fa-solid fa-circle" style="font-size:8px;"></i> آنلاین</span>`
      : `<span class="text-dim">آفلاین</span>`;

    return `
      <tr>
        <td><strong>${escapeHtml(c.email)}</strong></td>
        <td><span class="badge-proto badge-proto-${c.protocol}">${c.protocol.toUpperCase()}</span> (${escapeHtml(c.inbound_remark)})</td>
        <td><code>:${c.port}</code></td>
        <td><strong>${used}</strong></td>
        <td>${limit}</td>
        <td>${isOnline}</td>
      </tr>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('cert-issue-form')?.addEventListener('submit', handleCertSubmit);
  document.getElementById('general-settings-form')?.addEventListener('submit', handleGeneralSettingsSubmit);
  document.getElementById('change-password-form')?.addEventListener('submit', handleChangePasswordSubmit);

  document.querySelectorAll('.timeframe-buttons button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.timeframe-buttons button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const days = parseInt(btn.getAttribute('data-days')) || 7;
      loadAnalytics(days);
    });
  });
});
