#!/bin/bash

# RTRWNET Management & Billing System Installer
# Khusus untuk VPS dan NAT VPS (Ubuntu/Debian)

set -e

clear

# Definisi Warna
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${CYAN}${BOLD}"
echo " ██╗  ██╗███████╗███╗   ██╗██████╗ ██████╗ ██╗"
echo " ██║  ██║██╔════╝████╗  ██║██╔══██╗██╔══██╗██║"
echo " ███████║█████╗  ██╔██╗ ██║██║  ██║██████╔╝██║"
echo " ██╔══██║██╔══╝  ██║╚██╗██║██║  ██║██╔══██╗██║"
echo " ██║  ██║███████╗██║ ╚████║██████╔╝██║  ██║██║"
echo " ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝╚═════╝ ╚═╝  ╚═╝╚═╝"
echo -e "       ${GREEN}RTRWNET MANAGEMENT & BILLING SYSTEM${NC}"
echo -e "            ${YELLOW}${BOLD}Installer by Hendri${NC}"
echo -e "${CYAN}----------------------------------------------------${NC}"
echo -e " Sistem: Ubuntu/Debian Support"
echo -e "${CYAN}----------------------------------------------------${NC}"

# 1. Update & Install Dependencies Dasar
echo "[1/6] Memperbarui sistem dan menginstal paket dasar..."
sudo apt-get update -y
sudo apt-get install -y git curl build-essential sqlite3 openssl iproute2

# Deteksi IP dan Lingkungan Jaringan
echo "Mendeteksi konfigurasi jaringan..."
PUBLIC_IP=$(curl -s -m 10 https://ifconfig.me || curl -s -m 10 https://api.ipify.org || echo "IP-ANDA")
LOCAL_IP=$(hostname -I | awk '{print $1}')

if [[ "$PUBLIC_IP" == "$LOCAL_IP" ]] || [[ "$PUBLIC_IP" == "IP-ANDA" ]]; then
    SERVER_TYPE="VPS Standar (Public IP)"
else
    SERVER_TYPE="NAT VPS (Port Forwarding)"
fi

# 2. Instalasi Node.js 20
REINSTALL_NODE="n"
if command -v node &> /dev/null; then
    echo "[2/6] Node.js $(node -v) sudah terinstal."
    read -p "Apakah Anda ingin menginstal ulang/memperbarui Node.js 20? [y/N]: " REINSTALL_NODE < /dev/tty
fi

if [[ $REINSTALL_NODE =~ ^([yY][eE][sS]|[yY])$ ]] || ! command -v node &> /dev/null || [ "$(node -v | cut -d'.' -f1)" != "v20" ]; then
    echo "[2/6] Menginstal/Memperbarui Node.js 20..."
    sudo rm -f /etc/apt/sources.list.d/nodesource.list || true
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "[2/6] Menggunakan versi Node.js yang sudah ada."
fi

# 3. Clone Repository
echo ""
echo "--- KONFIGURASI DIREKTORI ---"
read -p "Masukkan nama folder instalasi [default: billing-rtrw]: " CUSTOM_DIR < /dev/tty
REPO_DIR=${CUSTOM_DIR:-"billing-rtrw"}
PM2_NAME=$REPO_DIR

REINSTALL_APP="n"

if [ -d "$REPO_DIR" ]; then
    echo ""
    echo "[3/6] Direktori $REPO_DIR sudah tersedia."
    read -p "Apakah Anda ingin melakukan instalasi ulang aplikasi (Hapus data lama)? [y/N]: " REINSTALL_APP < /dev/tty
    if [[ $REINSTALL_APP =~ ^([yY][eE][sS]|[yY])$ ]]; then
        echo "Menghapus direktori lama..."
        rm -rf "$REPO_DIR"
    fi
fi

if [ ! -d "$REPO_DIR" ]; then
    echo "[3/6] Mengunduh source code..."
    git clone https://github.com/heruhendri/billing-rtrw.git $REPO_DIR
    cd $REPO_DIR
else
    echo "[3/6] Memperbarui source code (git pull)..."
    cd $REPO_DIR
    git pull
fi

# 4. Konfigurasi Port (Penting untuk NAT VPS)
echo ""
echo "--- KONFIGURASI JARINGAN ---"
echo "Pilih metode pengaturan port:"
echo "1) Default (4000)"
echo "2) Custom (Input manual)"
echo "3) Otomatis (Cari port yang tersedia mulai dari 4000)"
read -p "Pilihan Anda [1/2/3, default 1]: " port_choice < /dev/tty

case ${port_choice:-1} in
    2)
        read -p "Masukkan port custom: " custom_port < /dev/tty
        PORT=${custom_port:-4000}
        ;;
    3)
        echo "Mencari port yang tersedia..."
        PORT=4000
        while ss -tuln | grep -q ":$PORT " 2>/dev/null; do
            PORT=$((PORT + 1))
        done
        echo "✓ Port ditemukan: $PORT"
        ;;
    *)
        PORT=4000
        ;;
esac
echo "Aplikasi akan berjalan pada port: $PORT"
echo "----------------------------"

# 5. Setup settings.json
echo "[4/6] Mengonfigurasi settings.json..."
if [ ! -f "settings.json" ]; then
    # Buat file settings.json baru jika belum ada
    RANDOM_SECRET=$(openssl rand -hex 24)
    cat <<EOF > settings.json
{
  "server_port": $PORT,
  "server_host": "0.0.0.0",
  "admin_username": "admin",
  "admin_password": "admin123",
  "session_secret": "$RANDOM_SECRET",
  "company_header": "My ISP",
  "default_lang": "id"
}
EOF
else
    # Update port di file yang sudah ada menggunakan Node.js
    node -e "const fs = require('fs'); const s = JSON.parse(fs.readFileSync('settings.json', 'utf8')); s.server_port = parseInt('$PORT') || 4000; fs.writeFileSync('settings.json', JSON.stringify(s, null, 2));"
fi

# 6. Install NPM Packages
echo "[5/6] Menginstal dependensi aplikasi (ini mungkin memakan waktu)..."
npm install --omit=dev

# 7. Setup PM2 (Process Manager)
echo ""
echo "--- KONFIGURASI PROSES ---"
read -p "Gunakan PM2 untuk menjalankan aplikasi otomatis (Background)? [Y/n]: " use_pm2 < /dev/tty

if [[ ! $use_pm2 =~ ^([nN][oO]|[nN])$ ]]; then
    echo "[6/6] Mengonfigurasi PM2..."
    if ! command -v pm2 &> /dev/null; then
        echo "Menginstal PM2 secara global..."
        sudo npm install -g pm2
    fi
    
    # Hentikan proses lama jika ada dan jalankan yang baru
    pm2 stop $PM2_NAME 2>/dev/null || true
    pm2 delete $PM2_NAME 2>/dev/null || true
    pm2 start app-customer.js --name $PM2_NAME
    pm2 save
    echo "✓ Aplikasi sekarang berjalan di background via PM2."
else
    echo "[6/6] PM2 dilewati. Instalasi selesai."
    echo "Anda dapat menjalankan aplikasi secara manual dengan perintah: npm start"
fi

# 8. Setup Auto Backup Telegram (Integrasi)
echo ""
echo "--- KONFIGURASI AUTO BACKUP TELEGRAM ---"
read -p "Pasang Bot Auto Backup ke Telegram? [y/N]: " install_backup < /dev/tty

if [[ $install_backup =~ ^([yY][eE][sS]|[yY])$ ]]; then
    echo "[7/7] Mengonfigurasi Backup Bot..."
    
    # Ambil data dari settings.json menggunakan Node.js
    BOT_TOKEN=$(node -e "try { const s = JSON.parse(require('fs').readFileSync('settings.json', 'utf8')); console.log(s.telegram_bot_token || ''); } catch(e) { console.log(''); }")
    ADMIN_ID=$(node -e "try { const s = JSON.parse(require('fs').readFileSync('settings.json', 'utf8')); console.log(s.telegram_admin_id || ''); } catch(e) { console.log(''); }")

    if [ -z "$BOT_TOKEN" ] || [ -z "$ADMIN_ID" ]; then
        echo "⚠️ Data Telegram tidak ditemukan di settings.json."
        read -p "Masukkan Bot Token Telegram: " NEW_TOKEN < /dev/tty
        read -p "Masukkan Admin Chat ID Telegram: " NEW_ID < /dev/tty
        
        # Update settings.json agar tersimpan untuk penggunaan aplikasi
        node -e "const fs = require('fs'); const s = JSON.parse(fs.readFileSync('settings.json', 'utf8')); s.telegram_bot_token = '$NEW_TOKEN'; s.telegram_admin_id = '$NEW_ID'; s.telegram_enabled = true; fs.writeFileSync('settings.json', JSON.stringify(s, null, 2));"
        BOT_TOKEN=$NEW_TOKEN
        ADMIN_ID=$NEW_ID
    fi

    # Jalankan Installer Backup dari repository Hendri
    # Mendukung backup folder database dan backups
    export TG_TOKEN="$BOT_TOKEN"
    export TG_CHAT_ID="$ADMIN_ID"
    export BACKUP_DIRS="$(pwd)/database $(pwd)/backups"
    
    curl -sSL https://raw.githubusercontent.com/heruhendri/Installer-Backup-Vps-Bot-Telegram/master/install.sh | bash
    
    echo "✓ Auto Backup Telegram telah dikonfigurasi."
fi

echo ""
echo "===================================================="
echo "             INSTALASI SELESAI                      "
echo "===================================================="
echo "Direktori      : $REPO_DIR"
echo "Tipe Server    : $SERVER_TYPE"
echo "Akses Admin    : http://$PUBLIC_IP:$PORT/admin/login"
echo "User Default   : admin"
echo "Pass Default   : admin123"
echo "----------------------------------------------------"
echo "Cek status aplikasi: pm2 status"
echo "Restart aplikasi   : pm2 restart $PM2_NAME"
echo "Lihat log          : pm2 logs $PM2_NAME"
echo -e "${CYAN}----------------------------------------------------${NC}"
echo -e "       ${GREEN}${BOLD}Enjoy your system - By Hendri${NC}"
echo -e "${CYAN}====================================================${NC}"