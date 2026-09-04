/* =========================================================
   PANEL PAHLAVY - CONFIGS MANAGEMENT & MODALS
   ========================================================= */

let configsCurrentPage = 1;
let configsSearchQuery = '';
let configsStatusFilter = '';

async function loadConfigs(page = 1) {
  configsCurrentPage = page;
  const tbody = document.getElementById('configs-table-body');
  if (!tbody) return;

  try {
    const params = new URLSearchParams({
      page: configsCurrentPage,
      limit: 15,
      ...(configsSearchQuery ? { search: configsSearchQuery } : {}),
      ...(configsStatusFilter ? { status: configsStatusFilter } : {})
    });

    const data = await apiFetch(`/api/configs?${params.toString()}`);
    renderConfigsTable(data.configs);
    renderConfigsPagination(data.total, data.page, data.limit);
  } catch (err) {
    console.error('Failed to load configs:', err);
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">خطا در بارگذاری اطلاعات</td></tr>`;
  }
}

function renderConfigsTable(configs = []) {
  const tbody = document.getElementById('configs-table-body');
  if (!tbody) return;

  if (configs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">هیچ کانفیگی یافت نشد</td></tr>`;
    return;
  }

  tbody.innerHTML = configs.map(c => {
    const protoBadge = formatProtocolLabel(c);
    const serverName = c.server_name || c.server_host || 'لوکال';
    const statusClass = `status-pill status-pill-${c.status}`;
    
    // Usage
    const used = parseFloat(c.traffic_used_gb || 0).toFixed(2);
    const limit = parseFloat(c.traffic_limit_gb || 0);
    const limitText = limit > 0 ? `${limit} GB` : 'نامحدود';
    const usageHtml = `<div><strong>${used} GB</strong> <span class="text-xs text-muted">/ ${limitText}</span></div>`;

    // Start Mode
    let startTypeHtml = '<span class="text-xs text-muted">مستقیم</span>';
    if (c.start_after_first_use) {
      if (c.first_use_at) {
        startTypeHtml = `<span class="badge" style="color:var(--accent-green)">استفاده شده</span>`;
      } else {
        startTypeHtml = `<span class="badge" style="color:var(--accent-gold)">شروع پس از اولین اتصال</span>`;
      }
    }

    // Expiry
    let expiryHtml = '<span class="text-muted">نامحدود</span>';
    if (c.expires_at) {
      const expDate = new Date(c.expires_at);
      const isPast = expDate < new Date();
      expiryHtml = `<span class="${isPast ? 'text-danger' : ''}">${expDate.toLocaleDateString('fa-IR')}</span>`;
    } else if (c.start_after_first_use && c.duration_days) {
      expiryHtml = `<span class="text-xs text-muted">${c.duration_days} روز پس از اولین اتصال</span>`;
    }

    return `
      <tr>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td><span class="proto-badge">${protoBadge}</span></td>
        <td><span class="text-sm">${escapeHtml(serverName)}</span></td>
        <td><code>${c.port}</code></td>
        <td>${usageHtml}</td>
        <td>${startTypeHtml}</td>
        <td>${expiryHtml}</td>
        <td><span class="${statusClass}">${c.status}</span></td>
        <td>
          <div class="action-btn-group">
            <button class="btn-table-action" onclick="showConfigQRModal(${c.id})" title="QR & سابسکریپشن"><i class="fa-solid fa-qrcode"></i></button>
            <button class="btn-table-action" onclick="renewConfigModal(${c.id})" title="تمدید زمان"><i class="fa-solid fa-calendar-plus"></i></button>
            <button class="btn-table-action" onclick="resetConfigTraffic(${c.id})" title="ریست حجم"><i class="fa-solid fa-arrows-rotate"></i></button>
            <button class="btn-table-action btn-del" onclick="deleteConfig(${c.id})" title="حذف"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderConfigsPagination(total, currentPage, limit) {
  const container = document.getElementById('configs-pagination');
  if (!container) return;

  const totalPages = Math.ceil(total / limit) || 1;
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `<div class="pagination-flex" style="display:flex; justify-content:center; gap:8px; padding:16px;">`;
  for (let p = 1; p <= totalPages; p++) {
    html += `
      <button class="btn btn-sm ${p === currentPage ? 'btn-primary' : 'btn-outline'}" 
        onclick="loadConfigs(${p})">${p}</button>
    `;
  }
  html += `</div>`;
  container.innerHTML = html;
}

// Modal: Open Create / Edit Config
async function openAddConfigModal(configId = null) {
  const modal = document.getElementById('modal-config');
  const form = document.getElementById('form-config-save');
  form.reset();
  
  document.getElementById('config-edit-id').value = configId || '';
  document.getElementById('modal-config-title').textContent = configId ? 'ویرایش کانفیگ' : 'ایجاد کانفیگ جدید';

  // Load available servers into select
  try {
    const servers = await apiFetch('/api/servers');
    const srvSelect = document.getElementById('cfg-server');
    srvSelect.innerHTML = servers.map(s => `
      <option value="${s.id}" ${s.is_default ? 'selected' : ''}>${s.name} (${s.host})</option>
    `).join('');
  } catch (e) {
    console.error(e);
  }

  // Toggle fields on start-after-first-use
  const toggleFirstUse = document.getElementById('cfg-start-first-use');
  const groupDuration = document.getElementById('group-duration-days');
  const groupExactExpiry = document.getElementById('group-exact-expiry');
  
  toggleFirstUse.onchange = () => {
    if (toggleFirstUse.checked) {
      groupDuration.style.display = 'block';
      groupExactExpiry.style.display = 'none';
    } else {
      groupDuration.style.display = 'none';
      groupExactExpiry.style.display = 'block';
    }
  };
  toggleFirstUse.checked = true;
  toggleFirstUse.dispatchEvent(new Event('change'));

  // Protocol combo changer
  const protoSelect = document.getElementById('cfg-protocol-type');
  const realityPbk = document.getElementById('group-reality-pbk');
  const realitySid = document.getElementById('group-reality-sid');
  
  protoSelect.onchange = () => {
    const isReality = protoSelect.value === 'vless-tcp-reality';
    realityPbk.style.display = isReality ? 'block' : 'none';
    realitySid.style.display = isReality ? 'block' : 'none';
  };
  protoSelect.dispatchEvent(new Event('change'));

  modal.classList.remove('hidden');
}

function closeConfigModal() {
  document.getElementById('modal-config').classList.add('hidden');
}

// Save Config Submit Handler
async function handleConfigSubmit(e) {
  e.preventDefault();
  const configId = document.getElementById('config-edit-id').value;

  const [protocol, network, security] = document.getElementById('cfg-protocol-type').value.split('-');
  const startAfterFirstUse = document.getElementById('cfg-start-first-use').checked;

  const payload = {
    name: document.getElementById('cfg-name').value.trim(),
    server_id: parseInt(document.getElementById('cfg-server').value),
    protocol: protocol,
    network: network,
    security: security,
    port: parseInt(document.getElementById('cfg-port').value),
    traffic_limit_gb: parseFloat(document.getElementById('cfg-traffic-limit').value) || 0,
    start_after_first_use: startAfterFirstUse,
    duration_days: startAfterFirstUse ? parseInt(document.getElementById('cfg-duration-days').value) : null,
    expires_at: !startAfterFirstUse && document.getElementById('cfg-exact-expiry').value ? document.getElementById('cfg-exact-expiry').value : null,
    path: document.getElementById('cfg-ws-path').value.trim() || '/',
    tls_sni: document.getElementById('cfg-tls-sni').value.trim() || null,
    reality_public_key: document.getElementById('cfg-reality-pbk').value.trim() || null,
    reality_short_id: document.getElementById('cfg-reality-sid').value.trim() || null,
  };

  try {
    if (configId) {
      await apiFetch(`/api/configs/${configId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      showToast('کانفیگ با موفقیت بروزرسانی شد', 'success');
    } else {
      const newCfg = await apiFetch('/api/configs', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast('کانفیگ با موفقیت ساخته شد و روی سرور فعال گردید', 'success');
      closeConfigModal();
      // Open QR modal immediately for convenience
      showConfigQRModal(newCfg.id);
    }
    closeConfigModal();
    loadConfigs(configsCurrentPage);
    if (AppState.currentPage === 'dashboard') loadDashboard();
  } catch (err) {
    // Toast handled in apiFetch
  }
}

// Modal: Show QR & Subscription links
async function showConfigQRModal(configId) {
  try {
    const config = await apiFetch(`/api/configs/${configId}`);
    
    document.getElementById('modal-qr-title').textContent = `${config.name} (${config.protocol.toUpperCase()})`;
    
    // Fill links
    const subUrl = config.sub_url;
    document.getElementById('modal-sub-link-input').value = subUrl;
    
    const directLink = Object.values(config.links || {})[0] || '';
    document.getElementById('modal-direct-link-input').value = directLink;
    
    const clashUrl = `${subUrl}?format=clash`;
    document.getElementById('modal-clash-link-input').value = clashUrl;

    // Render QR code
    const qrContainer = document.getElementById('qrcode-container');
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
      text: subUrl,
      width: 180,
      height: 180,
      colorDark: '#0B0F19',
      colorLight: '#FFFFFF',
      correctLevel: QRCode.CorrectLevel.M
    });

    document.getElementById('modal-qr').classList.remove('hidden');
  } catch (err) {
    console.error('Failed to open QR modal:', err);
  }
}

function closeQRModal() {
  document.getElementById('modal-qr').classList.add('hidden');
}

// Quick Copy Sub Link
async function copySubLink(token) {
  const baseUrl = AppState.settings?.sub_base_url || window.location.origin;
  const subUrl = `${baseUrl}/sub/${token}`;
  await copyToClipboard(subUrl);
}

// Delete Config
async function deleteConfig(id) {
  if (!confirm('آیا از حذف این کانفیگ و قطع دسترسی کاربر اطمینان دارید؟')) return;

  try {
    await apiFetch(`/api/configs/${id}`, { method: 'DELETE' });
    showToast('کانفیگ با موفقیت حذف شد', 'success');
    loadConfigs(configsCurrentPage);
    if (AppState.currentPage === 'dashboard') loadDashboard();
  } catch (err) {
    console.error(err);
  }
}

// Reset Traffic
async function resetConfigTraffic(id) {
  if (!confirm('ترافیک مصرفی این کانفیگ صفر شود؟')) return;

  try {
    await apiFetch(`/api/configs/${id}/reset-traffic`, { method: 'POST' });
    showToast('ترافیک کانفیگ ریست و فعال شد', 'success');
    loadConfigs(configsCurrentPage);
  } catch (err) {
    console.error(err);
  }
}

// Renew Config
async function renewConfigModal(id) {
  const days = prompt('چند روز به اعتبار کانفیگ اضافه شود؟', '30');
  if (!days || isNaN(days) || parseInt(days) <= 0) return;

  try {
    await apiFetch(`/api/configs/${id}/renew`, {
      method: 'POST',
      body: JSON.stringify({ days: parseInt(days) })
    });
    showToast(`اعتبار کانفیگ ${days} روز تمدید شد`, 'success');
    loadConfigs(configsCurrentPage);
  } catch (err) {
    console.error(err);
  }
}

// Global exposes for inline handlers
window.showConfigQRModal = showConfigQRModal;
window.copySubLink = copySubLink;
window.deleteConfig = deleteConfig;
window.resetConfigTraffic = resetConfigTraffic;
window.renewConfigModal = renewConfigModal;
window.openAddConfigModal = openAddConfigModal;

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  // Modal toggles
  const openBtn = document.getElementById('btn-open-add-config-modal');
  if (openBtn) openBtn.addEventListener('click', () => openAddConfigModal());
  
  const closeBtn = document.getElementById('btn-close-config-modal');
  if (closeBtn) closeBtn.addEventListener('click', closeConfigModal);
  
  const cancelBtn = document.getElementById('btn-cancel-config-modal');
  if (cancelBtn) cancelBtn.addEventListener('click', closeConfigModal);
  
  const closeQrBtn = document.getElementById('btn-close-qr-modal');
  if (closeQrBtn) closeQrBtn.addEventListener('click', closeQRModal);
  
  const closeQrBottomBtn = document.getElementById('btn-close-qr-modal-bottom');
  if (closeQrBottomBtn) closeQrBottomBtn.addEventListener('click', closeQRModal);

  // Form Submit
  const configForm = document.getElementById('form-config-save');
  if (configForm) configForm.addEventListener('submit', handleConfigSubmit);

  // Copy Buttons in QR Modal
  document.getElementById('btn-copy-sub-link')?.addEventListener('click', () => {
    copyToClipboard(document.getElementById('modal-sub-link-input').value);
  });
  document.getElementById('btn-copy-direct-link')?.addEventListener('click', () => {
    copyToClipboard(document.getElementById('modal-direct-link-input').value);
  });
  document.getElementById('btn-copy-clash-link')?.addEventListener('click', () => {
    copyToClipboard(document.getElementById('modal-clash-link-input').value);
  });

  // Search & Filter
  document.getElementById('config-search-input')?.addEventListener('input', (e) => {
    configsSearchQuery = e.target.value.trim();
    loadConfigs(1);
  });

  document.getElementById('config-status-filter')?.addEventListener('change', (e) => {
    configsStatusFilter = e.target.value;
    loadConfigs(1);
  });
});
