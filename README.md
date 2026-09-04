# 🦁 پنل پهلوی (Sanaei 3X-UI Edition) | Pahlavy VPN Panel

پنل مدیریت وی‌پی‌ان فوق حرفه‌ای با معماری ماژولار **Inbounds & Clients (مشابه سنایی / 3X-UI)**، پشتیبانی کامل و دستی از تمامی پروتکل‌های Xray-core، مانیتورینگ بلادرنگ مصرف ترافیک و هسته، تولید خودکار کلیدهای Reality، سیستم جامع نمایندگی، صدور گواهینامه SSL، ابزار خط فرمان اختصاصی (`pahlavi`) و لینک‌های سابسکریپشن هوشمند چندپروتکله.

---

## ✨ ویژگی‌های برجسته (معماری اینباندها)

- ⚡ **پشتیبانی کامل و دستی از تمامی پروتکل‌ها:**
  - **VLESS:** TCP Reality (Vision), WS (TLS / None), gRPC, HTTPUpgrade, SplitHTTP
  - **VMess:** WS, TCP, gRPC, HTTPUpgrade
  - **Trojan:** TCP Reality / TLS, WS TLS, gRPC TLS
  - **Shadowsocks (2022 / AEAD):** `2022-blake3-aes-128-gcm`, `2022-blake3-aes-256-gcm`, `aes-128-gcm`, `chacha20-poly1305`
  - **Dokodemo-door:** Port Forwarding & Relay
- 🎛️ **مدیریت اینباندها (Inbounds Management):**
  - افزودن اینباند با پورت اختصاصی یا تولید خودکار پورت رندوم (`Dice`)
  - تولید خودکار و آنی کلیدهای Reality (`Public Key` / `Private Key` / `Short ID` / `x25519`)
  - قابلیت تعریف چندین کاربر (Multi-Client) داخل هر اینباند
  - ویرایش، حذف، ریست ترافیک و غیرفعال‌سازی آنی اینباندها
- 📊 **مانیتورینگ زنده ترافیک بر پایه هسته Xray-core:**
  - استفاده از API داخلی `xray api statsquery` برای سنجش دقیق بایت به بایت آپلود و دانلود
  - قطع خودکار کاربر پس از رسیدن به سقف حجم تعیین شده
  - تشخیص وضعیت آنلاین/آفلاین کلاینت‌ها
- 👥 **سیستم جامع نمایندگی (Reseller System):**
  - تعریف نماینده با سقف مشخص ترافیک (GB) و سقف تعداد کلاینت
  - برند و پنل اختصاصی برای هر نماینده و قابلیت تعریف زیرنماینده
- ⏱️ **شروع اعتبار پس از اولین اتصال (Start After First Use):**
  - روزهای انقضای کاربر تا زمان اولین برقراری ارتباط با سرور شمارش نمی‌شود.
- 🔗 **لینک سابسکریپشن هوشمند چند پروتکله:**
  - خروجی استاندارد Base64 سازگار با v2rayNG, V2Box, Streisand, Shadowrocket, Nekoray
  - خروجی خودکار Clash / Clash Meta (فایل YAML با Proxy Groups)
  - فرمت‌های JSON و Raw
  - هدرهای استاندارد ترافیک (`Subscription-Userinfo`)
  - تولید خودکار بارکد QR Code برای هر کاربر
- 🛠️ **ابزار خط فرمان سراسری `pahlavi` (مشابه مرزبان):**
  - مدیریت کامل پنل، ریست پسورد ادمین، تغییر پورت، مشاهده لاگ‌ها، بکاپ‌گیری و ریستور
- 🎨 **طراحی Dark Mode شارپ و فوق‌العاده زیبا (Sanaei / 3X-UI Style):**
  - تضاد رنگی بسیار بالا، بردرهای نئونی، ویجت‌های تعاملی، نمودارهای زنده و فونت زیبای وزیرمتن

---

## 💻 دستور نصب سریع (یک خطی)

برای نصب روی سرورهای **Ubuntu, Debian, CentOS, AlmaLinux, RockyLinux**:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/itsradmanm/pahlavi/main/install.sh)
```

یا در صورت دانلود دستی سورس:

```bash
chmod +x install.sh
sudo ./install.sh
```

---

## 🦁 دستورات خط فرمان مدیریت اختصاصی (`pahlavi`)

پس از نصب، می‌توانید در هر کجای ترمینال دستور `pahlavi` را وارد نمایید:

| دستور | عملکرد |
|---|---|
| `pahlavi status` | نمایش وضعیت سرویس‌های پنل، هسته Xray و دیتابیس PostgreSQL |
| `pahlavi restart` | ری‌استارت تمام سرویس‌های پنل و هسته Xray |
| `pahlavi logs` | مشاهده لاگ‌های زنده و برخط پنل |
| `pahlavi admin` | ریست یا تغییر نام کاربری و رمز عبور ادمین |
| `pahlavi port` | تغییر پورت وب پنل و باز کردن خودکار فایروال |
| `pahlavi cert` | صدور یا تمدید خودکار گواهینامه SSL با Certbot |
| `pahlavi backup` | ایجاد فایل پشتیبان کامل از دیتابیس و تنظیمات |
| `pahlavi restore` | بازگردانی دیتابیس از فایل بکاپ |
| `pahlavi core-update` | آپدیت هسته رسمی Xray-core به آخرین نسخه |
| `pahlavi start` | روشن کردن سرویس‌های پنل |
| `pahlavi stop` | متوقف کردن سرویس پنل |
| `pahlavi edit-env` | ویرایش سریع متغیرهای محیطی با Nano |
| `pahlavi uninstall` | حذف کامل پنل از سرور |

---

## 🛠️ ساختار فایل‌های پروژه

```
پنل پهلوی/
├── install.sh                  # اسکریپت نصب تعاملی و خودکار لینوکس
├── uninstall.sh                # اسکریپت حذف کامل
├── pahlavi                     # ابزار خط فرمان سراسری CLI
├── backend/
│   ├── package.json            # پکیج‌ها و وابستگی‌های Node.js
│   ├── server.js               # سرور اصلی Express و مدیریت روت‌ها
│   ├── database.js             # دیتابیس PostgreSQL و ساختار Inbounds/Clients
│   ├── routes/
│   │   ├── auth.js             # احراز هویت ادمین و نمایندگان
│   │   ├── inbounds.js         # مدیریت اینباندها، کلیدهای Reality و پورت‌ها
│   │   ├── clients.js          # مدیریت کلاینت‌ها، تمدید، ریست حجم و لینک‌ها
│   │   ├── reseller.js         # سیستم نمایندگی و تخصیص سهمیه
│   │   ├── analytics.js        # آمار مصرف، روند ترافیک و کاربران برتر
│   │   ├── subscription.js     # سابسکریپشن هوشمند Base64، Clash و JSON
│   │   └── settings.js         # تنظیمات SSL، Let's Encrypt و تنظیمات عمومی
│   ├── services/
│   │   ├── xray.js             # تولید کانفیگ هسته Xray و مانیتورینگ
│   │   ├── traffic.js          # مانیتورینگ دقیق و دوره‌ای مصرف ترافیک
│   │   └── certificate.js      # صدور گواهینامه SSL Let's Encrypt / Self-Signed
│   └── middleware/
│       └── auth.js             # میدلور احراز هویت JWT
└── frontend/
    ├── index.html              # رابط کاربری ماژولار و دو زبانه (فارسی / انگلیسی)
    ├── css/
    │   └── style.css           # طراحی لوکس Dark Mode به سبک Sanaei 3X-UI
    └── js/
        ├── app.js              # هسته ناوبری، چندزبانه و احراز هویت
        ├── dashboard.js        # ویجت‌ها، کارت‌های آماری و نمودارهای Chart.js
        ├── inbounds.js         # کارت‌های اینباند، مودال‌های کلاینت و سرچ زنده
        ├── reseller.js         # مدیریت نمایندگان و سهمیه‌ها
        └── settings.js         # تنظیمات سرور، تغییر پسورد و صدور گواهی SSL
```

---

## 🔒 امنیت و پایداری

- **دیتابیس PostgreSQL:** سرعت بالا در پردازش کوئری‌ها و قابلیت اعتماد بالا
- **هشینگ Bcrypt:** رمزگذاری ۱۲ مرحله‌ای برای تمامی کاربران
- **محدودکننده نرخ درخواست (Rate Limiting):** جلوگیری از حملات Brute-Force
- **توکن‌های امن JWT:** سشن‌های امن با تاریخ انقضا
- **مدیریت فایروال خودکار:** باز کردن خودکار پورت‌های پنل در UFW
