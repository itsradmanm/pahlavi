#!/usr/bin/env bash

# ==============================================================================
# PAHLAVY VPN PANEL - UNINSTALLATION SCRIPT
# اسکریپت حذف کامل پنل پهلوی
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERROR] لطفا با دسترسی root اجرا کنید.${NC}"
    exit 1
fi

echo -e "${RED}${BOLD}هشدار: این اسکریپت سرویس‌ها و فایل‌های پنل پهلوی را حذف خواهد کرد.${NC}"
read -p "آیا برای حذف کامل پنل اطمینان دارید؟ (y/n): " CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "عملیات لغو شد."
    exit 0
fi

echo -e "${YELLOW}در حال متوقف سازی و حذف سرویس‌ها...${NC}"
systemctl stop pahlavy 2>/dev/null || true
systemctl disable pahlavy 2>/dev/null || true
rm -f /etc/systemd/system/pahlavy.service
systemctl daemon-reload

echo -e "${YELLOW}در حال حذف فایل‌های پنل...${NC}"
rm -rf /opt/pahlavy

read -p "آیا مایلید دیتابیس PostgreSQL مربوط به پنل نیز حذف شود؟ (y/n): " DEL_DB
if [[ "$DEL_DB" =~ ^[Yy]$ ]]; then
    sudo -u postgres dropdb pahlavy 2>/dev/null || true
    sudo -u postgres dropuser pahlavy 2>/dev/null || true
    echo -e "${GREEN}✓ دیتابیس حذف شد.${NC}"
fi

echo -e "\n${GREEN}${BOLD}✓ پنل پهلوی با موفقیت از سرور حذف گردید.${NC}\n"
