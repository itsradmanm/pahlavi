/* =========================================================
   PANEL PAHLAVY - CORE APPLICATION & NAVIGATION (SANAEI 3X-UI)
   ========================================================= */

const AppState = {
  token: localStorage.getItem('pahlavy_token') || null,
  user: null,
  lang: localStorage.getItem('pahlavy_lang') || 'en',
  currentPage: 'dashboard',
  settings: {}
};

const I18N = {
  en: {
    login_title: 'Sign in to Admin Panel',
    login_desc: 'Enter your credentials to continue',
    username: 'Username',
    password: 'Password',
    login_button: 'Sign In',
    nav_dashboard: 'Dashboard',
    nav_inbounds: 'Inbounds',
    nav_resellers: 'Resellers',
    nav_analytics: 'Analytics & Traffic',
    nav_settings: 'Settings & SSL',
    refresh: 'Refresh',
    total_clients: 'Total Clients',
    total_inbounds: 'Active Inbounds',
    online_now: 'Online Now',
    active_accounts: 'Active Accounts',
    traffic_used_limit: 'Total Usage / Quota',
    expiring_soon: 'Expiring Soon (7d)',
    expired: 'Expired',
    quota_full: 'Quota Full',
    traffic_trend: 'Traffic Trend (Last 7 Days)',
    traffic_trend_sub: 'Live Download / Upload aggregate from Xray-core',
    download: 'Download',
    upload: 'Upload',
    config_status_chart: 'Accounts Status',
    config_status_sub: 'Distribution of client accounts',
    reseller_management: 'Reseller Management',
    reseller_desc: 'Manage reseller accounts, allocate traffic and client quotas, custom branding',
    create_reseller: 'Add New Reseller',
    reseller_brand: 'Brand / Panel Name',
    traffic_quota: 'Traffic Quota',
    configs_quota: 'Clients Quota',
    created_configs_count: 'Created',
    account_expiry: 'Account Expiry',
    sub_reseller_perm: 'Sub-Reseller Perm',
    status: 'Status',
    actions: 'Actions',
    ssl_cert_title: 'SSL / TLS Certificate Management',
    ssl_cert_desc: 'Issue verified Let\'s Encrypt or Self-Signed SSL certs for domains & inbounds',
    domain_name: 'Domain or Subdomain (SNI)',
    domain_hint: 'Ensure DNS A record points to this server IP address',
    ssl_email: 'Email for Let\'s Encrypt alerts',
    cert_type: 'Certificate Type',
    issue_cert_btn: 'Issue & Install Certificate',
    general_settings: 'General Panel Settings',
    general_settings_desc: 'Configure subscription base URL, panel title and defaults',
    panel_title_label: 'Panel Title',
    sub_base_url: 'Subscription Base URL',
    sub_base_hint: 'Base address used to generate client subscription URLs',
    save_settings: 'Save Settings',
    change_password: 'Change Password',
    current_password: 'Current Password',
    new_password: 'New Password',
    update_password: 'Update Password',
    cancel: 'Cancel',
    copied_to_clipboard: 'Link copied to clipboard successfully!'
  },
  fa: {
    login_title: 'ورود به پنل مدیریت',
    login_desc: 'اطلاعات ورود خود را وارد نمایید',
    username: 'نام کاربری',
    password: 'رمز عبور',
    login_button: 'ورود به حساب',
    nav_dashboard: 'داشبورد',
    nav_inbounds: 'اینباندها (Inbounds)',
    nav_resellers: 'نمایندگی',
    nav_analytics: 'آمار و ترافیک',
    nav_settings: 'تنظیمات و SSL',
    refresh: 'بروزرسانی',
    total_clients: 'کل کاربران / اکانت‌ها',
    total_inbounds: 'اینباندهای فعال',
    online_now: 'کاربران آنلاین',
    active_accounts: 'اکانت‌های فعال',
    traffic_used_limit: 'مصرف ترافیک کل / سهمیه',
    expiring_soon: 'رو به انقضا (۷ روز)',
    expired: 'منقضی شده',
    quota_full: 'اتمام حجم',
    traffic_trend: 'روند مصرف ترافیک (۷ روز گذشته)',
    traffic_trend_sub: 'دانلود / آپلود زنده بر اساس هسته Xray',
    download: 'دانلود',
    upload: 'آپلود',
    config_status_chart: 'وضعیت اکانت‌ها',
    config_status_sub: 'توزیع وضعیت کلاینت‌ها',
    reseller_management: 'مدیریت نمایندگان فروش',
    reseller_desc: 'مدیریت حساب‌های نمایندگی، تعریف سهمیه حجم و تعداد کلاینت، برند اختصاصی',
    create_reseller: 'افزودن نماینده جدید',
    reseller_brand: 'برند / نام پنل',
    traffic_quota: 'سهمیه ترافیک',
    configs_quota: 'سقف کلاینت',
    created_configs_count: 'ساخته شده',
    account_expiry: 'انقضای حساب',
    sub_reseller_perm: 'دسترسی زیرنماینده',
    status: 'وضعیت',
    actions: 'عملیات',
    ssl_cert_title: 'مدیریت سرتیفیکیت SSL / TLS',
    ssl_cert_desc: 'صدور گواهینامه معتبر Let\'s Encrypt یا Self-Signed برای دامنه و اینباندها',
    domain_name: 'نام دامنه یا ساب‌دامنه (Domain / SNI)',
    domain_hint: 'باید رکورد A این دامنه به آی‌پی این سرور اشاره کرده باشد',
    ssl_email: 'ایمیل جهت صدور Let\'s Encrypt',
    cert_type: 'نوع گواهی',
    issue_cert_btn: 'دریافت و نصب سرتیفیکیت',
    general_settings: 'تنظیمات کلی پنل',
    general_settings_desc: 'تنظیم آدرس سابسکریپشن، نام پنل و مقادیر پیش‌فرض',
    panel_title_label: 'عنوان پنل',
    sub_base_url: 'آدرس پایه لینک سابسکریپشن (Sub URL)',
    sub_base_hint: 'آدرسی که لینک‌های ساب بر پایه آن تولید می‌شوند',
    save_settings: 'ذخیره تنظیمات',
    change_password: 'تغییر رمز عبور',
    current_password: 'رمز عبور فعلی',
    new_password: 'رمز عبور جدید',
    update_password: 'بروزرسانی رمز',
    cancel: 'انصراف',
    copied_to_clipboard: 'لینک با موفقیت در کلیپ‌بورد کپی شد!'
  }
};

async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(AppState.token ? { 'Authorization': `Bearer ${AppState.token}` } : {}),
    ...options.headers
  };

  try {
    const res = await fetch(endpoint, { ...options, headers });
    if (res.status === 401) {
      handleLogout();
      throw new Error('Session expired. Please sign in again.');
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Error ${res.status}: ${res.statusText}`);
    }
    return data;
  } catch (err) {
    showToast(err.message, 'error');
    throw err;
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'fa-info-circle';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-triangle-exclamation';
  
  toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function setLanguage(lang) {
  AppState.lang = lang;
  localStorage.setItem('pahlavy_lang', lang);
  
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  
  const dict = I18N[lang] || I18N.en;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });

  const langSwitchLink = document.getElementById('login-lang-switch');
  if (langSwitchLink) {
    langSwitchLink.textContent = lang === 'en' ? 'فارسی (FA)' : 'English (EN)';
  }

  updateLiveDate();
}

function updateLiveDate() {
  const dateEl = document.getElementById('live-date-text');
  if (!dateEl) return;
  const now = new Date();
  if (AppState.lang === 'fa') {
    dateEl.textContent = new Intl.DateTimeFormat('fa-IR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(now);
  } else {
    dateEl.textContent = new Intl.DateTimeFormat('en-US', {
      weekday: 'long', day: 'numeric', month: 'short', year: 'numeric'
    }).format(now);
  }
}

function navigateTo(pageId) {
  AppState.currentPage = pageId;
  document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(b => b.classList.remove('active'));
  
  const targetPage = document.getElementById(`page-${pageId}`);
  const targetNav = document.getElementById(`nav-${pageId}`);
  
  if (targetPage) targetPage.classList.add('active');
  if (targetNav) targetNav.classList.add('active');
  
  const dict = I18N[AppState.lang] || I18N.en;
  const titleKey = `nav_${pageId}`;
  document.getElementById('page-title').textContent = dict[titleKey] || pageId;
  
  if (pageId === 'dashboard') loadDashboard();
  if (pageId === 'inbounds') loadInbounds();
  if (pageId === 'resellers') loadResellers();
  if (pageId === 'analytics') loadAnalytics();
  if (pageId === 'settings') loadSettings();
}

async function checkAuth() {
  if (!AppState.token) {
    showLogin();
    return;
  }
  
  try {
    const data = await apiFetch('/api/auth/me');
    AppState.user = data.user;
    AppState.settings = data.settings || {};
    
    document.getElementById('user-display-name').textContent = data.user.username;
    document.getElementById('user-display-role').textContent = data.user.role.toUpperCase();
    document.getElementById('user-avatar-initial').textContent = data.user.username.charAt(0).toUpperCase();
    
    if (data.user.panel_name) {
      document.getElementById('sidebar-panel-name').textContent = data.user.panel_name;
    }
    
    if (data.user.role === 'reseller') {
      if (!data.user.can_create_resellers) {
        document.getElementById('nav-resellers').style.display = 'none';
      }
    } else {
      document.getElementById('nav-resellers').style.display = 'flex';
    }
    
    hideLogin();
    navigateTo('dashboard');
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-layout').classList.add('hidden');
}

function hideLogin() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-layout').classList.remove('hidden');
}

function handleLogout() {
  AppState.token = null;
  AppState.user = null;
  localStorage.removeItem('pahlavy_token');
  showLogin();
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    const dict = I18N[AppState.lang] || I18N.en;
    showToast(dict.copied_to_clipboard, 'success');
  } catch {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    showToast(I18N[AppState.lang].copied_to_clipboard, 'success');
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
window.escapeHtml = escapeHtml;
window.copyToClipboard = copyToClipboard;

document.addEventListener('DOMContentLoaded', () => {
  setLanguage(AppState.lang);
  
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('login-username').value.trim();
    const p = document.getElementById('login-password').value;
    
    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: u, password: p })
      });
      AppState.token = data.token;
      localStorage.setItem('pahlavy_token', data.token);
      showToast('Welcome to Pahlavi Panel!', 'success');
      await checkAuth();
    } catch {}
  });

  document.getElementById('btn-logout').addEventListener('click', handleLogout);

  document.getElementById('btn-lang-toggle').addEventListener('click', () => {
    setLanguage(AppState.lang === 'en' ? 'fa' : 'en');
  });
  document.getElementById('login-lang-switch').addEventListener('click', () => {
    setLanguage(AppState.lang === 'en' ? 'fa' : 'en');
  });

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.getAttribute('data-page');
      if (page) navigateTo(page);
    });
  });

  document.getElementById('btn-refresh-all').addEventListener('click', () => {
    navigateTo(AppState.currentPage);
    showToast('Refreshed', 'info');
  });

  checkAuth();
});
