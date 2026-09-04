/* =========================================================
   PANEL PAHLAVY - RESELLER (نمایندگی) MANAGEMENT
   ========================================================= */

async function loadResellers() {
  const tbody = document.getElementById('resellers-table-body');
  if (!tbody) return;

  try {
    const resellers = await apiFetch('/api/reseller');
    const list = Array.isArray(resellers) ? resellers : [resellers];
    renderResellersTable(list);
  } catch (err) {
    console.error('Failed to load resellers:', err);
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">خطا در دریافت لیست نمایندگان</td></tr>`;
  }
}

function renderResellersTable(resellers = []) {
  const tbody = document.getElementById('resellers-table-body');
  if (!tbody) return;

  if (resellers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">هیچ نماینده‌ای ثبت نشده است</td></tr>`;
    return;
  }

  tbody.innerHTML = resellers.map(r => {
    const quotaUsed = parseFloat(r.traffic_used_gb || 0).toFixed(2);
    const quotaTotal = parseFloat(r.traffic_quota_gb || 0).toFixed(2);
    const configsCount = `${r.configs_created || 0} / ${r.max_configs || 0}`;
    const brandName = r.panel_name || r.username;
    
    let expiryText = 'نامحدود';
    if (r.expires_at) {
      expiryText = new Date(r.expires_at).toLocaleDateString('fa-IR');
    }

    const canSubBadge = r.can_create_resellers 
      ? '<span class="status-pill status-pill-active">مجاز</span>' 
      : '<span class="status-pill status-pill-disabled">غیرمجاز</span>';

    const statusBadge = r.is_active 
      ? '<span class="status-pill status-pill-active">فعال</span>' 
      : '<span class="status-pill status-pill-expired">مسدود</span>';

    return `
      <tr>
        <td><strong>${escapeHtml(r.username)}</strong></td>
        <td><span class="badge" style="background:rgba(0,212,255,0.1); color:var(--accent-cyan);">${escapeHtml(brandName)}</span></td>
        <td><strong>${quotaUsed}</strong> / ${quotaTotal} GB</td>
        <td>${configsCount}</td>
        <td>${r.configs_created || 0}</td>
        <td>${expiryText}</td>
        <td>${canSubBadge}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="action-btn-group">
            <button class="btn-table-action" onclick="toggleResellerStatus(${r.id}, ${!r.is_active})" title="${r.is_active ? 'مسدودسازی' : 'فعال‌سازی'}">
              <i class="fa-solid ${r.is_active ? 'fa-lock' : 'fa-lock-open'}"></i>
            </button>
            <button class="btn-table-action btn-del" onclick="deleteReseller(${r.id})" title="حذف">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openAddResellerModal() {
  const modal = document.getElementById('modal-reseller');
  const form = document.getElementById('form-reseller-save');
  form.reset();
  document.getElementById('reseller-edit-id').value = '';
  modal.classList.remove('hidden');
}

function closeResellerModal() {
  document.getElementById('modal-reseller').classList.add('hidden');
}

async function handleResellerSubmit(e) {
  e.preventDefault();
  
  const payload = {
    username: document.getElementById('reseller-username').value.trim(),
    password: document.getElementById('reseller-password').value,
    traffic_quota_gb: parseFloat(document.getElementById('reseller-traffic-quota').value) || 100,
    max_configs: parseInt(document.getElementById('reseller-max-configs').value) || 20,
    panel_name: document.getElementById('reseller-panel-name').value.trim() || null,
    expires_at: document.getElementById('reseller-expiry').value || null,
    can_create_resellers: document.getElementById('reseller-can-sub').checked
  };

  try {
    await apiFetch('/api/reseller', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    showToast('نماینده فروش با موفقیت ایجاد شد', 'success');
    closeResellerModal();
    loadResellers();
  } catch (err) {
    // Error already toasted
  }
}

async function toggleResellerStatus(id, newStatus) {
  try {
    await apiFetch(`/api/reseller/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: newStatus })
    });
    showToast(`وضعیت نماینده به ${newStatus ? 'فعال' : 'غیرفعال'} تغییر یافت`, 'success');
    loadResellers();
  } catch (err) {
    console.error(err);
  }
}

async function deleteReseller(id) {
  if (!confirm('آیا از حذف این نماینده و تمام کانفیگ‌های مربوط به آن اطمینان دارید؟')) return;

  try {
    await apiFetch(`/api/reseller/${id}`, { method: 'DELETE' });
    showToast('نماینده با موفقیت حذف شد', 'success');
    loadResellers();
  } catch (err) {
    console.error(err);
  }
}

window.toggleResellerStatus = toggleResellerStatus;
window.deleteReseller = deleteReseller;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-open-add-reseller-modal')?.addEventListener('click', openAddResellerModal);
  document.getElementById('btn-close-reseller-modal')?.addEventListener('click', closeResellerModal);
  document.getElementById('btn-cancel-reseller-modal')?.addEventListener('click', closeResellerModal);
  document.getElementById('form-reseller-save')?.addEventListener('submit', handleResellerSubmit);
});
