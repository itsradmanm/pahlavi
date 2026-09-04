/* =========================================================
   PANEL PAHLAVY - INBOUNDS & CLIENTS (3X-UI / SANAEI ENGINE)
   ========================================================= */

let cachedInbounds = [];

async function loadInbounds() {
  const container = document.getElementById('inbounds-container');
  if (!container) return;

  try {
    const inbounds = await apiFetch('/api/inbounds');
    cachedInbounds = inbounds;
    renderInboundsList(inbounds);
    const badge = document.getElementById('sidebar-inbounds-badge');
    if (badge) badge.textContent = inbounds.length;
  } catch (err) {
    console.error('Failed to load inbounds:', err);
    container.innerHTML = `<div class="card p-4 text-center text-muted">خطا در بارگذاری اینباندها</div>`;
  }
}

function renderInboundsList(inbounds = []) {
  const container = document.getElementById('inbounds-container');
  if (!container) return;

  if (inbounds.length === 0) {
    container.innerHTML = `
      <div class="card p-5 text-center text-muted">
        <i class="fa-solid fa-network-wired fa-3x mb-3 text-dim"></i>
        <h3 class="text-white font-bold mb-1">هیچ اینباندی تعریف نشده است</h3>
        <p class="text-sm mb-4">برای ساخت اولین کانکشن Xray روی دکمه زیر کلیک کنید.</p>
        <button class="btn btn-primary" onclick="openAddInboundModal()">
          <i class="fa-solid fa-plus"></i> افزودن اولین اینباند
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = inbounds.map(inb => {
    const stream = typeof inb.stream_settings === 'string' ? JSON.parse(inb.stream_settings) : (inb.stream_settings || {});
    const net = stream.network || 'tcp';
    const sec = stream.security || 'none';

    const protoBadgeClass = `badge-proto badge-proto-${inb.protocol}`;
    let secBadge = `<span class="badge-proto" style="background:rgba(255,255,255,0.06); color:var(--text-muted);">${sec.toUpperCase()}</span>`;
    if (sec === 'reality') secBadge = `<span class="badge-proto badge-proto-reality">REALITY</span>`;
    if (sec === 'tls') secBadge = `<span class="badge-proto badge-proto-trojan">TLS</span>`;

    const netBadge = `<span class="badge-proto" style="background:rgba(255,255,255,0.08); color:var(--text-main);">${net.toUpperCase()}</span>`;

    const clients = inb.clients || [];
    const clientsCount = clients.length;
    const activeClientsCount = clients.filter(c => c.enable).length;

    // Traffic formatted
    const upGB = (Number(inb.traffic_up_bytes || 0) / (1024 * 1024 * 1024)).toFixed(2);
    const downGB = (Number(inb.traffic_down_bytes || 0) / (1024 * 1024 * 1024)).toFixed(2);

    return `
      <div class="inbound-box" id="inbound-card-${inb.id}">
        <div class="inbound-header-bar">
          <div class="inbound-info-group">
            <h3 class="inbound-title">${escapeHtml(inb.remark)}</h3>
            <div class="inbound-badges-group">
              <span class="${protoBadgeClass}">${inb.protocol.toUpperCase()}</span>
              ${netBadge}
              ${secBadge}
              <span class="badge-port">:${inb.port}</span>
            </div>
            <div class="inbound-traffic-summary text-xs text-muted">
              <span><i class="fa-solid fa-arrow-down text-cyan"></i> ${downGB} GB</span>
              <span><i class="fa-solid fa-arrow-up text-gold"></i> ${upGB} GB</span>
            </div>
          </div>

          <div class="inbound-stats-group">
            <div class="text-xs text-muted">
              <span>کاربران:</span> <strong class="text-white">${activeClientsCount} / ${clientsCount}</strong>
            </div>

            <label class="switch" title="فعال / غیرفعال">
              <input type="checkbox" ${inb.enable ? 'checked' : ''} onchange="toggleInboundStatus(${inb.id}, this.checked)">
              <span class="slider round"></span>
            </label>

            <button class="btn btn-outline btn-sm" onclick="openAddClientModal(${inb.id})" title="افزودن کاربر">
              <i class="fa-solid fa-user-plus"></i> کاربر
            </button>

            <button class="btn btn-outline btn-sm" onclick="editInbound(${inb.id})" title="ویرایش اینباند">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>

            <button class="btn btn-outline btn-sm" onclick="resetInboundTraffic(${inb.id})" title="ریست ترافیک اینباند">
              <i class="fa-solid fa-arrows-rotate"></i>
            </button>

            <button class="btn btn-outline btn-sm" onclick="toggleInboundClientsCollapse(${inb.id})" id="btn-toggle-clients-${inb.id}">
              <i class="fa-solid fa-chevron-up"></i>
            </button>

            <button class="btn-table-action btn-del" onclick="deleteInbound(${inb.id})" title="حذف اینباند">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>

        <!-- Collapsible Clients Table -->
        <div class="inbound-clients-section" id="inbound-clients-${inb.id}">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>نام کاربر (Remark)</th>
                  <th>UUID / Password</th>
                  <th>مصرف / سقف حجم</th>
                  <th>نوع شروع</th>
                  <th>انقضا</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                ${renderClientsRows(clients, inb)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderClientsRows(clients = [], inbound) {
  if (clients.length === 0) {
    return `<tr><td colspan="7" class="text-center text-muted py-3">هیچ کاربری در این اینباند وجود ندارد. روی «+ کاربر» کلیک کنید.</td></tr>`;
  }

  return clients.map(c => {
    const usedGB = parseFloat(c.traffic_used_gb || 0).toFixed(2);
    const limitGB = parseFloat(c.traffic_limit_gb || 0);
    const limitText = limitGB > 0 ? `${limitGB} GB` : 'نامحدود';

    let startText = '<span class="text-xs text-muted">مستقیم</span>';
    if (c.start_after_first_use) {
      startText = c.first_use_at 
        ? '<span class="text-xs text-success">شروع شده</span>'
        : `<span class="text-xs text-warning">پس از اتصال (${c.duration_days || 30} روز)</span>`;
    }

    let expiryText = '<span class="text-muted">نامحدود</span>';
    if (c.expires_at) {
      const exp = new Date(c.expires_at);
      const isPast = exp < new Date();
      expiryText = `<span class="${isPast ? 'text-danger font-bold' : ''}">${exp.toLocaleDateString('fa-IR')}</span>`;
    }

    let statusBadge = c.enable
      ? '<span class="status-pill status-pill-active">فعال</span>'
      : '<span class="status-pill status-pill-disabled">غیرفعال</span>';
    
    if (c.is_online) {
      statusBadge += ' <span class="status-pill status-pill-active" style="padding:2px 6px; font-size:10px;"><i class="fa-solid fa-bolt"></i> آنلاین</span>';
    }

    return `
      <tr>
        <td><strong>${escapeHtml(c.email)}</strong></td>
        <td><code class="text-xs font-mono">${(c.uuid || c.password || '').substring(0, 16)}...</code></td>
        <td><strong>${usedGB}</strong> <span class="text-xs text-muted">/ ${limitText}</span></td>
        <td>${startText}</td>
        <td>${expiryText}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="action-btn-group">
            <button class="btn-table-action" onclick="showClientLinksModal(${c.id})" title="QR و لینک ساب"><i class="fa-solid fa-qrcode"></i></button>
            <button class="btn-table-action" onclick="editClient(${c.id}, ${inbound.id})" title="ویرایش کاربر"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-table-action" onclick="renewClient(${c.id})" title="تمدید زمان"><i class="fa-solid fa-calendar-plus"></i></button>
            <button class="btn-table-action" onclick="resetClientTraffic(${c.id})" title="ریست ترافیک"><i class="fa-solid fa-arrows-rotate"></i></button>
            <button class="btn-table-action btn-del" onclick="deleteClient(${c.id})" title="حذف"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Expand / Collapse Client List
function toggleInboundClientsCollapse(inboundId) {
  const section = document.getElementById(`inbound-clients-${inboundId}`);
  const btn = document.getElementById(`btn-toggle-clients-${inboundId}`);
  if (!section) return;

  if (section.style.display === 'none') {
    section.style.display = 'block';
    if (btn) btn.innerHTML = `<i class="fa-solid fa-chevron-up"></i>`;
  } else {
    section.style.display = 'none';
    if (btn) btn.innerHTML = `<i class="fa-solid fa-chevron-down"></i>`;
  }
}

// Modal: Add / Edit Inbound
async function openAddInboundModal() {
  const modal = document.getElementById('modal-inbound');
  const form = document.getElementById('form-inbound-save');
  form.reset();

  document.getElementById('inbound-edit-id').value = '';
  document.getElementById('modal-inbound-title').textContent = 'افزودن اینباند جدید';

  await generateRandomInboundKeys();
  await generateRandomInboundPort();

  handleProtocolChange();
  modal.classList.remove('hidden');
}

function editInbound(id) {
  const inb = cachedInbounds.find(i => i.id === id);
  if (!inb) return;

  const modal = document.getElementById('modal-inbound');
  document.getElementById('inbound-edit-id').value = inb.id;
  document.getElementById('modal-inbound-title').textContent = `ویرایش اینباند ${inb.remark}`;

  document.getElementById('inb-remark').value = inb.remark || '';
  document.getElementById('inb-protocol').value = inb.protocol || 'vless';
  document.getElementById('inb-port').value = inb.port || 443;

  const stream = typeof inb.stream_settings === 'string' ? JSON.parse(inb.stream_settings) : (inb.stream_settings || {});
  document.getElementById('inb-network').value = stream.network || 'tcp';
  document.getElementById('inb-security').value = stream.security || 'none';

  if (stream.security === 'reality') {
    const real = stream.realitySettings || {};
    document.getElementById('inb-real-dest').value = real.dest || 'www.microsoft.com:443';
    document.getElementById('inb-real-sni').value = Array.isArray(real.serverNames) ? real.serverNames.join(',') : (real.serverNames || 'www.microsoft.com');
    document.getElementById('inb-real-pbk').value = real.publicKey || '';
    document.getElementById('inb-real-pvk').value = real.privateKey || '';
    document.getElementById('inb-real-sid').value = Array.isArray(real.shortIds) ? real.shortIds[0] : (real.shortIds || '');
    document.getElementById('inb-real-fp').value = real.fingerprint || 'chrome';
  }

  if (stream.network === 'ws') {
    document.getElementById('inb-ws-path').value = stream.wsSettings?.path || '/';
    document.getElementById('inb-ws-host').value = stream.wsSettings?.headers?.Host || '';
  }

  if (inb.protocol === 'shadowsocks') {
    const raw = typeof inb.settings === 'string' ? JSON.parse(inb.settings) : (inb.settings || {});
    document.getElementById('inb-ss-method').value = raw.method || '2022-blake3-aes-128-gcm';
    document.getElementById('inb-ss-password').value = raw.password || '';
  }

  handleProtocolChange();
  modal.classList.remove('hidden');
}

function closeInboundModal() {
  document.getElementById('modal-inbound').classList.add('hidden');
}

function handleProtocolChange() {
  const proto = document.getElementById('inb-protocol').value;
  const sec = document.getElementById('inb-security').value;
  const net = document.getElementById('inb-network').value;

  const realitySec = document.getElementById('section-reality');
  const wsSec = document.getElementById('section-ws');
  const ssSec = document.getElementById('section-ss');

  if (realitySec) realitySec.style.display = (sec === 'reality') ? 'block' : 'none';
  if (wsSec) wsSec.style.display = (net === 'ws') ? 'block' : 'none';
  if (ssSec) ssSec.style.display = (proto === 'shadowsocks') ? 'block' : 'none';
}

async function generateRandomInboundKeys() {
  try {
    const data = await apiFetch('/api/inbounds/reality-keys');
    document.getElementById('inb-real-pbk').value = data.publicKey || '';
    document.getElementById('inb-real-pvk').value = data.privateKey || '';
    document.getElementById('inb-real-sid').value = data.shortId || '0123456789abcdef';
  } catch (e) {
    console.error(e);
  }
}

async function generateRandomInboundPort() {
  try {
    const data = await apiFetch('/api/inbounds/random-port');
    document.getElementById('inb-port').value = data.port || 443;
  } catch (e) {
    console.error(e);
  }
}

// Save Inbound Submit (Create or Edit)
async function handleInboundSubmit(e) {
  e.preventDefault();

  const editId = document.getElementById('inbound-edit-id').value;
  const proto = document.getElementById('inb-protocol').value;
  const net = document.getElementById('inb-network').value;
  const sec = document.getElementById('inb-security').value;

  const streamSettings = {
    network: net,
    security: sec
  };

  if (net === 'ws') {
    streamSettings.wsSettings = {
      path: document.getElementById('inb-ws-path').value.trim() || '/',
      headers: { Host: document.getElementById('inb-ws-host').value.trim() }
    };
  }

  if (sec === 'reality') {
    const dest = document.getElementById('inb-real-dest').value.trim();
    const sniStr = document.getElementById('inb-real-sni').value.trim();
    streamSettings.realitySettings = {
      show: false,
      dest: dest || 'www.microsoft.com:443',
      xver: 0,
      serverNames: sniStr ? sniStr.split(',').map(s => s.trim()) : ['www.microsoft.com', 'microsoft.com'],
      privateKey: document.getElementById('inb-real-pvk').value.trim(),
      publicKey: document.getElementById('inb-real-pbk').value.trim(),
      shortIds: [document.getElementById('inb-real-sid').value.trim() || '0123456789abcdef'],
      fingerprint: document.getElementById('inb-real-fp').value || 'chrome'
    };
  }

  const rawSettings = {};
  if (proto === 'shadowsocks') {
    rawSettings.method = document.getElementById('inb-ss-method').value;
    rawSettings.password = document.getElementById('inb-ss-password').value.trim();
  }

  const payload = {
    remark: document.getElementById('inb-remark').value.trim(),
    protocol: proto,
    port: parseInt(document.getElementById('inb-port').value),
    listen: '0.0.0.0',
    settings: rawSettings,
    stream_settings: streamSettings,
    sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
    enable: true
  };

  try {
    if (editId) {
      await apiFetch(`/api/inbounds/${editId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      showToast('اینباند با موفقیت بروزرسانی شد', 'success');
    } else {
      await apiFetch('/api/inbounds', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast('اینباند جدید با موفقیت ایجاد و فعال شد', 'success');
    }

    closeInboundModal();
    loadInbounds();
  } catch (err) {
    // Handled in apiFetch
  }
}

// Toggle Inbound Enable
async function toggleInboundStatus(id, enable) {
  try {
    await apiFetch(`/api/inbounds/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enable })
    });
    showToast(`اینباند ${enable ? 'فعال' : 'غیرفعال'} شد`, 'success');
    loadInbounds();
  } catch (err) {
    console.error(err);
  }
}

// Reset Inbound Traffic
async function resetInboundTraffic(id) {
  if (!confirm('آیا ترافیک مصرفی این اینباند صفر شود؟')) return;
  try {
    await apiFetch(`/api/inbounds/${id}/reset-traffic`, { method: 'POST' });
    showToast('ترافیک اینباند صفر گردید', 'success');
    loadInbounds();
  } catch (err) {
    console.error(err);
  }
}

// Delete Inbound
async function deleteInbound(id) {
  if (!confirm('آیا از حذف این اینباند و تمام کاربران داخل آن اطمینان دارید؟')) return;

  try {
    await apiFetch(`/api/inbounds/${id}`, { method: 'DELETE' });
    showToast('اینباند با موفقیت حذف شد', 'success');
    loadInbounds();
  } catch (err) {
    console.error(err);
  }
}

// Modal: Add / Edit Client
function openAddClientModal(inboundId) {
  const modal = document.getElementById('modal-add-client');
  const form = document.getElementById('form-client-save');
  form.reset();

  document.getElementById('client-inbound-id').value = inboundId;
  document.getElementById('client-edit-id').value = '';
  document.getElementById('modal-add-client-title').textContent = 'افزودن کاربر به اینباند';
  document.getElementById('cli-uuid').value = crypto.randomUUID();

  modal.classList.remove('hidden');
}

function editClient(clientId, inboundId) {
  const inb = cachedInbounds.find(i => i.id === inboundId);
  if (!inb) return;
  const client = (inb.clients || []).find(c => c.id === clientId);
  if (!client) return;

  const modal = document.getElementById('modal-add-client');
  document.getElementById('client-inbound-id').value = inboundId;
  document.getElementById('client-edit-id').value = client.id;
  document.getElementById('modal-add-client-title').textContent = `ویرایش کاربر ${client.email}`;

  document.getElementById('cli-email').value = client.email || '';
  document.getElementById('cli-uuid').value = client.uuid || '';
  document.getElementById('cli-traffic').value = client.traffic_limit_gb || 0;
  document.getElementById('cli-duration').value = client.duration_days || 30;
  document.getElementById('cli-start-first-use').checked = !!client.start_after_first_use;

  modal.classList.remove('hidden');
}

function closeClientModal() {
  document.getElementById('modal-add-client').classList.add('hidden');
}

// Save Client Submit (Add or Edit)
async function handleClientSubmit(e) {
  e.preventDefault();

  const editId = document.getElementById('client-edit-id').value;
  const inboundId = parseInt(document.getElementById('client-inbound-id').value);

  const payload = {
    inbound_id: inboundId,
    email: document.getElementById('cli-email').value.trim(),
    uuid: document.getElementById('cli-uuid').value.trim(),
    traffic_limit_gb: parseFloat(document.getElementById('cli-traffic').value) || 0,
    duration_days: parseInt(document.getElementById('cli-duration').value) || 30,
    start_after_first_use: document.getElementById('cli-start-first-use').checked
  };

  try {
    if (editId) {
      await apiFetch(`/api/clients/${editId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      showToast('کاربر با موفقیت بروزرسانی شد', 'success');
      closeClientModal();
      loadInbounds();
    } else {
      const newClient = await apiFetch('/api/clients', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      showToast('کاربر با موفقیت به اینباند اضافه شد', 'success');
      closeClientModal();
      loadInbounds();
      showClientLinksModal(newClient.id);
    }
  } catch (err) {
    console.error(err);
  }
}

// Modal: Show Client Links & QR
async function showClientLinksModal(clientId) {
  try {
    const data = await apiFetch(`/api/clients/${clientId}/links`);

    document.getElementById('modal-qr-title').textContent = `${data.client.email} (${data.client.protocol.toUpperCase()})`;
    document.getElementById('modal-sub-link-input').value = data.sub_url;
    document.getElementById('modal-direct-link-input').value = data.link;
    document.getElementById('modal-clash-link-input').value = data.clash_url;

    const qrContainer = document.getElementById('qrcode-container');
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
      text: data.sub_url,
      width: 180,
      height: 180,
      colorDark: '#070A11',
      colorLight: '#FFFFFF',
      correctLevel: QRCode.CorrectLevel.M
    });

    document.getElementById('modal-qr').classList.remove('hidden');
  } catch (err) {
    console.error('Failed to get client links:', err);
  }
}

function closeQRModal() {
  document.getElementById('modal-qr').classList.add('hidden');
}

// Renew Client
async function renewClient(id) {
  const days = prompt('چند روز به اعتبار کاربر اضافه شود؟', '30');
  if (!days || isNaN(days) || parseInt(days) <= 0) return;

  try {
    await apiFetch(`/api/clients/${id}/renew`, {
      method: 'POST',
      body: JSON.stringify({ days: parseInt(days) })
    });
    showToast(`اعتبار کاربر ${days} روز تمدید گردید`, 'success');
    loadInbounds();
  } catch (err) {
    console.error(err);
  }
}

// Reset Client Traffic
async function resetClientTraffic(id) {
  if (!confirm('آیا ترافیک مصرفی این کاربر ریست و صفر شود؟')) return;

  try {
    await apiFetch(`/api/clients/${id}/reset-traffic`, { method: 'POST' });
    showToast('ترافیک کاربر ریست شد', 'success');
    loadInbounds();
  } catch (err) {
    console.error(err);
  }
}

// Delete Client
async function deleteClient(id) {
  if (!confirm('آیا از حذف این کاربر اطمینان دارید؟')) return;

  try {
    await apiFetch(`/api/clients/${id}`, { method: 'DELETE' });
    showToast('کاربر با موفقیت حذف شد', 'success');
    loadInbounds();
  } catch (err) {
    console.error(err);
  }
}

// Real-time Search Filter for Inbounds & Clients
function setupSearchFilter() {
  const searchInput = document.getElementById('inbound-search-input');
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderInboundsList(cachedInbounds);
      return;
    }

    const filtered = cachedInbounds.filter(inb => {
      const matchInb = (inb.remark || '').toLowerCase().includes(q) ||
                       String(inb.port).includes(q) ||
                       (inb.protocol || '').toLowerCase().includes(q);
      const matchCli = (inb.clients || []).some(c => 
        (c.email || '').toLowerCase().includes(q) ||
        (c.uuid || '').toLowerCase().includes(q)
      );
      return matchInb || matchCli;
    });

    renderInboundsList(filtered);
  });
}

// Global exposes
window.openAddInboundModal = openAddInboundModal;
window.editInbound = editInbound;
window.toggleInboundStatus = toggleInboundStatus;
window.resetInboundTraffic = resetInboundTraffic;
window.deleteInbound = deleteInbound;
window.toggleInboundClientsCollapse = toggleInboundClientsCollapse;
window.openAddClientModal = openAddClientModal;
window.editClient = editClient;
window.showClientLinksModal = showClientLinksModal;
window.renewClient = renewClient;
window.resetClientTraffic = resetClientTraffic;
window.deleteClient = deleteClient;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-open-add-inbound-modal')?.addEventListener('click', openAddInboundModal);
  document.getElementById('btn-quick-new-inbound')?.addEventListener('click', openAddInboundModal);
  document.getElementById('btn-close-inbound-modal')?.addEventListener('click', closeInboundModal);
  document.getElementById('btn-cancel-inbound-modal')?.addEventListener('click', closeInboundModal);

  document.getElementById('inb-protocol')?.addEventListener('change', handleProtocolChange);
  document.getElementById('inb-security')?.addEventListener('change', handleProtocolChange);
  document.getElementById('inb-network')?.addEventListener('change', handleProtocolChange);

  document.getElementById('btn-generate-random-port')?.addEventListener('click', generateRandomInboundPort);
  document.getElementById('btn-generate-reality-keys')?.addEventListener('click', generateRandomInboundKeys);
  document.getElementById('btn-generate-client-uuid')?.addEventListener('click', () => {
    document.getElementById('cli-uuid').value = crypto.randomUUID();
  });

  document.getElementById('form-inbound-save')?.addEventListener('submit', handleInboundSubmit);

  document.getElementById('btn-close-client-modal')?.addEventListener('click', closeClientModal);
  document.getElementById('btn-cancel-client-modal')?.addEventListener('click', closeClientModal);
  document.getElementById('form-client-save')?.addEventListener('submit', handleClientSubmit);

  document.getElementById('btn-close-qr-modal')?.addEventListener('click', closeQRModal);
  document.getElementById('btn-close-qr-modal-bottom')?.addEventListener('click', closeQRModal);

  // Copy buttons
  document.getElementById('btn-copy-sub-link')?.addEventListener('click', () => {
    copyToClipboard(document.getElementById('modal-sub-link-input').value);
  });
  document.getElementById('btn-copy-direct-link')?.addEventListener('click', () => {
    copyToClipboard(document.getElementById('modal-direct-link-input').value);
  });
  document.getElementById('btn-copy-clash-link')?.addEventListener('click', () => {
    copyToClipboard(document.getElementById('modal-clash-link-input').value);
  });

  setupSearchFilter();
});
