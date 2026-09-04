/* =========================================================
   PANEL PAHLAVY - SERVERS & NODES MANAGEMENT
   ========================================================= */

async function loadServers() {
  const grid = document.getElementById('servers-grid');
  if (!grid) return;

  try {
    const servers = await apiFetch('/api/servers');
    AppState.servers = servers;
    renderServersGrid(servers);
  } catch (err) {
    console.error('Failed to load servers:', err);
    grid.innerHTML = `<p class="text-center text-muted col-span-2">خطا در دریافت سرورها</p>`;
  }
}

function renderServersGrid(servers = []) {
  const grid = document.getElementById('servers-grid');
  if (!grid) return;

  if (servers.length === 0) {
    grid.innerHTML = `
      <div class="card p-4 text-center text-muted" style="grid-column: 1 / -1;">
        <i class="fa-solid fa-server fa-2x mb-3 text-dim"></i>
        <p>هیچ سروری ثبت نشده است. روی افزودن سرور جدید کلیک کنید.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = servers.map(s => {
    const isDefaultBadge = s.is_default 
      ? `<span class="badge" style="background:rgba(0,230,118,0.15); color:var(--accent-green);"><i class="fa-solid fa-star"></i> سرور پیش‌فرض</span>`
      : '';

    return `
      <div class="server-card">
        <div class="server-card-header">
          <div>
            <h3 class="card-title">${escapeHtml(s.name)}</h3>
            <span class="text-xs text-muted"><code>${escapeHtml(s.host)}</code> : ${s.ssh_port || 22}</span>
          </div>
          ${isDefaultBadge}
        </div>

        <div class="server-card-stats">
          <div>
            <span class="text-xs text-muted block">کانفیگ‌های فعال</span>
            <strong>${s.active_configs || 0} / ${s.total_configs || 0}</strong>
          </div>
          <div>
            <span class="text-xs text-muted block">کاربران آنلاین</span>
            <strong class="text-success"><i class="fa-solid fa-circle" style="font-size:8px;"></i> ${s.online_users || 0}</strong>
          </div>
        </div>

        <div class="server-card-actions" style="display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn btn-outline btn-sm" onclick="testServer(${s.id})" id="btn-test-srv-${s.id}">
            <i class="fa-solid fa-plug"></i> تست اتصال
          </button>
          ${!s.is_default ? `
            <button class="btn btn-outline btn-sm" onclick="setDefaultServer(${s.id})">
              انتخاب پیش‌فرض
            </button>
          ` : ''}
          <button class="btn btn-outline btn-sm btn-del" onclick="deleteServer(${s.id})">
            <i class="fa-solid fa-trash text-danger"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function openAddServerModal() {
  const modal = document.getElementById('modal-server');
  const form = document.getElementById('form-server-save');
  form.reset();
  document.getElementById('server-edit-id').value = '';
  modal.classList.remove('hidden');
}

function closeServerModal() {
  document.getElementById('modal-server').classList.add('hidden');
}

async function handleServerSubmit(e) {
  e.preventDefault();

  const payload = {
    name: document.getElementById('srv-name').value.trim(),
    host: document.getElementById('srv-host').value.trim(),
    ssh_port: parseInt(document.getElementById('srv-ssh-port').value) || 22,
    ssh_user: document.getElementById('srv-ssh-user').value.trim() || 'root',
    ssh_password: document.getElementById('srv-ssh-pass').value || null,
    is_default: document.getElementById('srv-is-default').checked
  };

  try {
    await apiFetch('/api/servers', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    showToast('سرور جدید با موفقیت اضافه شد', 'success');
    closeServerModal();
    loadServers();
  } catch (err) {
    console.error(err);
  }
}

async function testServer(id) {
  const btn = document.getElementById(`btn-test-srv-${id}`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> در حال تست...`;
  }

  try {
    const res = await apiFetch(`/api/servers/${id}/test`, { method: 'POST' });
    if (res.success) {
      showToast(`اتصال برقرار است! Xray: ${res.xray_installed ? 'فعال' : 'نصب نیست'}`, 'success');
    } else {
      showToast(`خطا در اتصال به سرور: ${res.error}`, 'error');
    }
  } catch (err) {
    console.error(err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-plug"></i> تست اتصال`;
    }
  }
}

async function setDefaultServer(id) {
  try {
    await apiFetch(`/api/servers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_default: true })
    });
    showToast('سرور پیش‌فرض با موفقیت تغییر یافت', 'success');
    loadServers();
  } catch (err) {
    console.error(err);
  }
}

async function deleteServer(id) {
  if (!confirm('آیا از حذف این سرور اطمینان دارید؟')) return;

  try {
    await apiFetch(`/api/servers/${id}`, { method: 'DELETE' });
    showToast('سرور با موفقیت حذف شد', 'success');
    loadServers();
  } catch (err) {
    console.error(err);
  }
}

window.testServer = testServer;
window.setDefaultServer = setDefaultServer;
window.deleteServer = deleteServer;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-open-add-server-modal')?.addEventListener('click', openAddServerModal);
  document.getElementById('btn-close-server-modal')?.addEventListener('click', closeServerModal);
  document.getElementById('btn-cancel-server-modal')?.addEventListener('click', closeServerModal);
  document.getElementById('form-server-save')?.addEventListener('submit', handleServerSubmit);
});
