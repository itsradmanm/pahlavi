#!/usr/bin/env bash

# ==============================================================================
# PAHLAVY VPN PANEL - AUTOMATED INSTALLATION SCRIPT (SANAEI 3X-UI EDITION)
# اسکریپت نصب خودکار، تعاملی و فوق حرفه‌ای پنل مدیریت پهلوی
# ==============================================================================

set -e

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERROR] لطفا این اسکریپت را با دسترسی root اجرا کنید (sudo bash install.sh).${NC}"
    exit 1
fi

clear
echo -e "${CYAN}${BOLD}"
echo "  =================================================================="
echo "    ██████╗  █████╗ ██╗  ██╗██╗      █████╗ ██╗   ██╗██╗   ██╗"
echo "    ██╔══██╗██╔══██╗██║  ██║██║     ██╔══██╗██║   ██║╚██╗ ██╔╝"
echo "    ██████╔╝███████║███████║██║     ███████║██║   ██║ ╚████╔╝ "
echo "    ██╔═══╝ ██╔══██║██╔══██║██║     ██╔══██║╚██╗ ██╔╝  ╚██╔╝  "
echo "    ██║     ██║  ██║██║  ██║███████╗██║  ██║ ╚████╔╝    ██║   "
echo "    ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝  ╚═══╝     ╚═╝   "
echo "          🦁 پنل مدیریت وی‌پی‌ان پهلوی (Sanaei 3X-UI Edition) 🦁       "
echo "  =================================================================="
echo -e "${NC}"

echo -e "${YELLOW}به نصاب خودکار پنل پهلوی خوش آمدید.${NC}\n"

# Step 1: Detect Operating System & Architecture
echo -e "${BLUE}[1/7] بررسی و تشخیص سیستم‌عامل و سخت‌افزار...${NC}"
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    VER=$VERSION_ID
else
    echo -e "${RED}سیستم‌عامل پشتیبانی نمی‌شود.${NC}"
    exit 1
fi

ARCH=$(uname -m)
case "$ARCH" in
    x86_64|amd64) ARCH="64" ;;
    aarch64|arm64) ARCH="arm64-v8a" ;;
    armv7l) ARCH="arm32-v7a" ;;
    *) echo -e "${YELLOW}معماری: $ARCH${NC}" ;;
esac

echo -e "${GREEN}✓ سیستم‌عامل: $OS $VER ($ARCH)${NC}\n"

# Step 2: Interactive Configuration
echo -e "${CYAN}${BOLD}--- تنظیمات اولیه پنل ---${NC}"

read -p "$(echo -e "${YELLOW}پورت وب پنل [پیش‌فرض 3000]: ${NC}")" PANEL_PORT
PANEL_PORT=${PANEL_PORT:-3000}

read -p "$(echo -e "${YELLOW}نام کاربری ادمین [پیش‌فرض admin]: ${NC}")" ADMIN_USER
ADMIN_USER=${ADMIN_USER:-admin}

read -p "$(echo -e "${YELLOW}رمز عبور ادمین [پیش‌فرض admin123]: ${NC}")" ADMIN_PASS
ADMIN_PASS=${ADMIN_PASS:-admin123}

DEFAULT_IP=$(curl -s4 ifconfig.me || curl -s4 api.ipify.org || curl -s4 icanhazip.com || echo "127.0.0.1")
read -p "$(echo -e "${YELLOW}دامنه یا آی‌پی سرور (مثال: vpn.domain.com یا $DEFAULT_IP) [پیش‌فرض $DEFAULT_IP]: ${NC}")" SERVER_HOST
SERVER_HOST=${SERVER_HOST:-$DEFAULT_IP}

echo -e "\n${YELLOW}آیا مایلید سرتیفیکیت رایگان Let's Encrypt فعال شود؟${NC}"
read -p "$(echo -e "${YELLOW}(y/n) [پیش‌فرض n]: ${NC}")" ENABLE_SSL
ENABLE_SSL=${ENABLE_SSL:-n}

SSL_EMAIL=""
if [[ "$ENABLE_SSL" =~ ^[Yy]$ ]]; then
    read -p "$(echo -e "${YELLOW}ایمیل جهت دریافت هشدارهای انقضای گواهی: ${NC}")" SSL_EMAIL
fi

DB_NAME="pahlavy"
DB_USER="pahlavy"
DB_PASS=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 20 ; echo '')

echo -e "\n${GREEN}اطلاعات پیکربندی:${NC}"
echo -e "  - پورت وب پنل: ${CYAN}$PANEL_PORT${NC}"
echo -e "  - نام کاربری:   ${CYAN}$ADMIN_USER${NC}"
echo -e "  - رمز عبور:     ${CYAN}$ADMIN_PASS${NC}"
echo -e "  - دامنه / IP:   ${CYAN}$SERVER_HOST${NC}\n"

read -p "$(echo -e "${BOLD}آیا برای شروع فرآیند نصب اطمینان دارید؟ (y/n) [y]: ${NC}")" CONFIRM
CONFIRM=${CONFIRM:-y}
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo -e "${RED}نصب لغو شد.${NC}"
    exit 0
fi

# Step 3: Install Core Dependencies
echo -e "\n${BLUE}[2/7] نصب پکیج‌های پیش‌نیاز سیستم (Node.js 20, PostgreSQL, Certbot)...${NC}"

if [[ "$OS" == "ubuntu" || "$OS" == "debian" ]]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y curl wget gnupg2 ca-certificates lsb-release ufw git build-essential socat nano cron net-tools

    if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 18 ]]; then
        echo -e "${YELLOW}نصب Node.js 20 LTS...${NC}"
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    fi

    apt-get install -y postgresql postgresql-contrib certbot
    systemctl enable postgresql
    systemctl start postgresql
elif [[ "$OS" == "centos" || "$OS" == "almalinux" || "$OS" == "rocky" ]]; then
    yum update -y
    yum install -y curl wget git epel-release socat nano cronie net-tools
    
    if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 18 ]]; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        yum install -y nodejs
    fi

    yum install -y postgresql-server postgresql-contrib certbot
    postgresql-setup --initdb 2>/dev/null || true
    systemctl enable postgresql
    systemctl start postgresql
fi

echo -e "${GREEN}✓ تمام پیش‌نیازها با موفقیت نصب شدند.${NC}"

# Step 4: Install Xray-Core
echo -e "\n${BLUE}[3/7] نصب هسته رسمی Xray-core...${NC}"
if ! command -v xray &> /dev/null; then
    bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install || {
        echo -e "${YELLOW}نصب Xray از طریق گیت‌هاب رسمی...${NC}"
        mkdir -p /usr/local/bin /usr/local/etc/xray
        XRAY_VER="v1.8.24"
        wget -qO /tmp/xray.zip "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VER}/Xray-linux-64.zip" 2>/dev/null || true
        if [ -f /tmp/xray.zip ]; then
            unzip -o /tmp/xray.zip -d /usr/local/bin/ xray 2>/dev/null || true
            chmod +x /usr/local/bin/xray
            rm -f /tmp/xray.zip
        fi
    }
fi

mkdir -p /usr/local/etc/xray
systemctl enable xray 2>/dev/null || true
echo -e "${GREEN}✓ هسته Xray-core نصب و آماده شد.${NC}"

# Step 5: Configure PostgreSQL Database
echo -e "\n${BLUE}[4/7] ایجاد و پیکربندی دیتابیس PostgreSQL...${NC}"
sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -c "ALTER DATABASE $DB_NAME OWNER TO $DB_USER;" 2>/dev/null || true

# Step 6: Deploy Panel Files
echo -e "\n${BLUE}[5/7] استقرار فایل‌های پنل پهلوی در /opt/pahlavy...${NC}"
INSTALL_DIR="/opt/pahlavy"
mkdir -p "$INSTALL_DIR"

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

if [ -d "$SCRIPT_DIR/backend" ]; then
    cp -r "$SCRIPT_DIR/backend" "$INSTALL_DIR/"
    cp -r "$SCRIPT_DIR/frontend" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/uninstall.sh" "$INSTALL_DIR/" 2>/dev/null || true
    cp "$SCRIPT_DIR/pahlavi" "$INSTALL_DIR/" 2>/dev/null || true
else
    cp -r ./* "$INSTALL_DIR/"
fi

cd "$INSTALL_DIR/backend"

# Create .env file
cat <<EOF > "$INSTALL_DIR/backend/.env"
PORT=$PANEL_PORT
NODE_ENV=production
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASS=$DB_PASS
ADMIN_PASSWORD=$ADMIN_PASS
PANEL_URL=http://$SERVER_HOST:$PANEL_PORT
SUB_BASE_URL=http://$SERVER_HOST:$PANEL_PORT
TLS_DOMAIN=$SERVER_HOST
TLS_EMAIL=$SSL_EMAIL
JWT_SECRET=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 32 ; echo '')
SESSION_SECRET=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 32 ; echo '')
XRAY_CONFIG_PATH=/usr/local/etc/xray/config.json
XRAY_API_PORT=62789
EOF

echo -e "${YELLOW}نصب پکیج‌های Node.js...${NC}"
npm install --production --silent

# Step 7: Install Global CLI Tool (pahlavi)
echo -e "\n${BLUE}[6/7] فعال‌سازی دستور خط فرمان سراسری pahlavi...${NC}"
if [ -f "$INSTALL_DIR/pahlavi" ]; then
    chmod +x "$INSTALL_DIR/pahlavi"
    ln -sf "$INSTALL_DIR/pahlavi" /usr/local/bin/pahlavi
    ln -sf "$INSTALL_DIR/pahlavi" /usr/local/bin/pahlavy
    ln -sf "$INSTALL_DIR/pahlavi" /usr/bin/pahlavi 2>/dev/null || true
    ln -sf "$INSTALL_DIR/pahlavi" /usr/bin/pahlavy 2>/dev/null || true
fi

# Step 8: Setup Systemd Service & Firewall
echo -e "\n${BLUE}[7/7] پیکربندی سرویس پس‌زمینه systemd...${NC}"
cat <<EOF > /etc/systemd/system/pahlavy.service
[Unit]
Description=Pahlavi VPN Management Panel (Sanaei 3X-UI)
After=network.target postgresql.service xray.service
Wants=postgresql.service xray.service

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR/backend
ExecStart=$(which node) server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pahlavy
systemctl restart pahlavy

# Let's Encrypt automatic issuance if requested
if [[ "$ENABLE_SSL" =~ ^[Yy]$ ]] && [ -n "$SSL_EMAIL" ] && [ -n "$SERVER_HOST" ] && [ "$SERVER_HOST" != "127.0.0.1" ]; then
    echo -e "${YELLOW}در حال دریافت سرتیفیکیت SSL رایگان برای $SERVER_HOST...${NC}"
    certbot certonly --standalone --non-interactive --agree-tos --email "$SSL_EMAIL" -d "$SERVER_HOST" 2>/dev/null || true
fi

# Open Ports in Firewall
if command -v ufw &> /dev/null; then
    ufw allow "$PANEL_PORT"/tcp 2>/dev/null || true
    ufw allow 80/tcp 2>/dev/null || true
    ufw allow 443/tcp 2>/dev/null || true
    ufw allow 8080/tcp 2>/dev/null || true
fi

# Final Summary Banner
clear
echo -e "${GREEN}${BOLD}"
echo "=================================================================="
echo "    🎉 نصب پنل پهلوی با موفقیت به پایان رسید! 🎉"
echo "    🦁 Pahlavi Panel (Sanaei 3X-UI) Successfully Installed! 🦁"
echo "=================================================================="
echo -e "${NC}"

echo -e "📌 ${BOLD}اطلاعات ورود به وب پنل:${NC}"
echo -e "   🌐 آدرس وب پنل:  ${CYAN}${BOLD}http://$SERVER_HOST:$PANEL_PORT${NC}"
echo -e "   👤 نام کاربری:   ${CYAN}${BOLD}$ADMIN_USER${NC}"
echo -e "   🔑 رمز عبور:     ${CYAN}${BOLD}$ADMIN_PASS${NC}\n"

echo -e "📌 ${BOLD}کانفیگ‌های پیش‌فرض آماده اتصال (آماده شده در پنل):${NC}"
echo -e "   ⚡ ${GREEN}VLESS-REALITY${NC} (Port: 443 - xtls-rprx-vision)"
echo -e "   ⚡ ${GREEN}VMESS-WS${NC}      (Port: 8080)\n"

echo -e "📌 ${BOLD}دستورات خط فرمان مدیریت اختصاصی (مشابه مرزبان / 3X-UI):${NC}"
echo -e "   کافیست در ترمینال بنویسید:  ${YELLOW}${BOLD}pahlavi${NC}"
echo -e "   - وضعیت سرور و Xray:      ${CYAN}pahlavi status${NC}"
echo -e "   - ری‌استارت سرویس‌ها:      ${CYAN}pahlavi restart${NC}"
echo -e "   - مشاهده لاگ‌های زنده:     ${CYAN}pahlavi logs${NC}"
echo -e "   - تغییر پورت وب پنل:      ${CYAN}pahlavi port${NC}"
echo -e "   - ریست پسورد ادمین:       ${CYAN}pahlavi admin${NC}"
echo -e "   - صدور گواهی SSL:          ${CYAN}pahlavi cert${NC}"
echo -e "   - بروزرسانی هسته Xray:    ${CYAN}pahlavi core-update${NC}\n"

echo -e "${GREEN}برای شروع، آدرس وب پنل را در مرورگر خود باز کنید.${NC}\n"
