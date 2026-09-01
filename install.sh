#!/bin/bash

# RTRWNET Management & Billing System Installer
# Khusus untuk VPS dan NAT VPS (Ubuntu/Debian)
# Last Updated: 2025

set -e

clear

# Fungsi penanganan error
failure() {
  echo -e "\n${RED}${BOLD}❌ Terjadi kesalahan saat instalasi!${NC}"
  echo -e "Jika butuh bantuan, hubungi: ${CYAN}https://t.me/GbtTapiPngnSndiri${NC}"
  exit 1
}
trap failure ERR

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
echo -e "      ${CYAN}Support: https://t.me/GbtTapiPngnSndiri${NC}"
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

# 5. Setup settings.json dengan validasi lengkap
echo "[4/6] Mengonfigurasi settings.json..."
if [ ! -f "settings.json" ]; then
    # Buat file settings.json baru dengan semua field yang diperlukan
    RANDOM_SECRET=$(openssl rand -hex 24)
    RANDOM_API_KEY=$(openssl rand -hex 16)
    cat <<EOF > settings.json
{
  "genieacs_url": "http://localhost:7557",
  "genieacs_username": "admin",
  "genieacs_password": "admin",
  "genieacs_timeout": 30000,
  "genieacs_monitoring_enabled": true,
  "genieacs_monitoring_interval": 6,
  "genieacs_rxpower_threshold": -27,
  "company_header": "BILLING SYSTEM",
  "footer_info": "Internet Tanpa Batas Kuota, Harga Terjangkau, Layanan Cepat",
  "timezone": "Asia/Jakarta",
  "server_port": $PORT,
  "server_host": "0.0.0.0",
  "session_secret": "$RANDOM_SECRET",
  "admin_username": "admin",
  "admin_password": "admin123",
  "admin_api_key": "$RANDOM_API_KEY",
  "company_phone": "628977345640",
  "company_email": "admin@company.com",
  "company_address": "Alamat Kantor Anda",
  "company_manager": "Administrator",
  "operational_hours": "Setiap Hari: 08.00 - 22.00 WIB",
  "whatsapp_enabled": false,
  "whatsapp_auth_folder": "auth_info_baileys",
  "whatsapp_lid_map_file": "data/wa-lid-map.json",
  "whatsapp_admin_numbers": [],
  "whatsapp_broadcast_delay": 60,
  "telegram_enabled": false,
  "telegram_bot_token": "",
  "telegram_admin_id": "",
  "login_otp_enabled": false,
  "mikrotik_host": "192.168.8.1",
  "mikrotik_user": "admin",
  "mikrotik_password": "admin",
  "mikrotik_port": 8728,
  "multi_router_mode": "disabled",
  "default_router_id": "",
  "isolir_day": 20,
  "usage_tracking_enabled": true,
  "office_lat": "1.563623",
  "office_lng": "124.877533",
  "attendance_geofencing": true,
  "attendance_radius": 100,
  "public_base_url": "",
  "default_gateway": "tripay",
  "tripay_enabled": false,
  "tripay_mode": "sandbox",
  "tripay_api_key": "",
  "tripay_private_key": "",
  "tripay_merchant_code": "",
  "midtrans_enabled": false,
  "midtrans_mode": "sandbox",
  "midtrans_server_key": "",
  "xendit_enabled": false,
  "xendit_api_key": "",
  "duitku_enabled": false,
  "duitku_mode": "sandbox",
  "duitku_merchant_code": "",
  "duitku_api_key": "",
  "digiflazz_username": "",
  "digiflazz_api_key": "",
  "digiflazz_webhook_secret": "",
  "digiflazz_webhook_id": "",
  "digiflazz_markup": 0,
  "qris_static_enabled": false,
  "qris_static_payload": "",
  "qris_static_qr_url": "",
  "qris_file": "",
  "auto_backup_enabled": false,
  "collector_auto_approve": false,
  "use_builtin_acs": false,
  "logo_file": "",
  "radius_enabled": false,
  "radius_secret": "secret123",
  "radius_auth_port": "1812",
  "radius_acct_port": "1813",
  "radius_isolir_action": "pool",
  "radius_isolir_pool": "isolir",
  "radius_limit_simultaneous": "1",
  "radius_default_rate_limit": "5M/10M",
  "radius_isolir_rate_limit": "512k/512k",
  "radius_isolir_ip_pool_enabled": true,
  "radius_isolir_ip_pool_start": "10.10.99.2",
  "radius_isolir_ip_pool_end": "10.10.99.254",
  "radius_ip_pool_enabled": true,
  "radius_ip_pool_start": "10.10.10.2",
  "radius_ip_pool_end": "10.10.10.254",
  "radius_framed_pool": "pool-pppoe"
}
EOF
    echo "✓ File settings.json berhasil dibuat."
else
    # Update hanya port di file yang sudah ada, jaga konfigurasi lain
    node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
settings.server_port = parseInt('$PORT') || 4000;
settings.server_host = '0.0.0.0';
fs.writeFileSync('settings.json', JSON.stringify(settings, null, 2));
console.log('✓ settings.json berhasil diperbarui.');
"
fi

# 6. Install NPM Packages
echo "[5/6] Menginstal dependensi aplikasi (ini mungkin memakan waktu)..."
# Automatisasi pembuatan Swap jika RAM < 1GB untuk mencegah error ENOMEM
TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
if [ "$TOTAL_RAM" -lt 1024 ]; then
    echo "⚠️ RAM terdeteksi rendah ($TOTAL_RAM MB). Menyiapkan swap file 1GB agar instalasi lancar..."
    if [ ! -f /swapfile ]; then
        sudo fallocate -l 1G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=1024
        sudo chmod 600 /swapfile
        sudo mkswap /swapfile
        sudo swapon /swapfile
        echo "✓ Swap file berhasil diaktifkan."
    fi
fi

if npm install --omit=dev --no-audit --no-fund 2>&1; then
    echo "✓ Dependensi berhasil diinstal."
    # Fix permissions setelah npm install (penting jika menggunakan sudo)
    if [ -f "package.json" ]; then
        current_user=$(whoami)
        if [ "$current_user" = "root" ] && [ ! -z "$SUDO_USER" ]; then
            echo "Memperbaiki kepemilikan file untuk user $SUDO_USER..."
            chown -R $SUDO_USER:$SUDO_USER .
        fi
    fi
else
    echo "❌ Gagal menginstal dependensi. Periksa koneksi internet dan space disk."
    exit 1
fi

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
    
    # Setup startup boot script PM2
    if command -v systemctl &> /dev/null; then
        echo "Mengatur PM2 untuk autostart pada boot..."
        pm2 startup systemd -u $(whoami) --hp $(eval echo ~$(whoami)) 2>/dev/null || true
        pm2 save
    fi
    
    echo "✓ Aplikasi sekarang berjalan di background via PM2."
    
    # Test aplikasi
    sleep 2
    if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
        echo "✅ Aplikasi berhasil dijalankan!"
    else
        echo "⚠️ Aplikasi sedang startup, tunggu beberapa saat..."
        sleep 3
    fi
else
    echo "[6/6] PM2 dilewati. Instalasi selesai."
    echo "Anda dapat menjalankan aplikasi secara manual dengan perintah: npm start"
fi

# 8. Setup Database (jika belum ada)
echo ""
echo "Memeriksa database..."
if [ ! -d "database" ]; then
    mkdir -p database
    echo "✓ Folder database berhasil dibuat."
fi

# 9. Setup Auto Backup Telegram (Integrasi)
echo ""
echo "--- KONFIGURASI AUTO BACKUP TELEGRAM (OPSIONAL) ---"
read -p "Pasang Bot Auto Backup ke Telegram? [y/N]: " install_backup < /dev/tty

if [[ $install_backup =~ ^([yY][eE][sS]|[yY])$ ]]; then
    echo "Mengonfigurasi Backup Bot..."
    
    # Ambil data dari settings.json menggunakan Node.js
    BOT_TOKEN=$(node -e "try { const s = JSON.parse(require('fs').readFileSync('settings.json', 'utf8')); console.log(s.telegram_bot_token || ''); } catch(e) { console.log(''); }")
    ADMIN_ID=$(node -e "try { const s = JSON.parse(require('fs').readFileSync('settings.json', 'utf8')); console.log(s.telegram_admin_id || ''); } catch(e) { console.log(''); }")

    if [ -z "$BOT_TOKEN" ] || [ -z "$ADMIN_ID" ]; then
        echo "⚠️ Data Telegram tidak ditemukan di settings.json."
        read -p "Masukkan Bot Token Telegram: " NEW_TOKEN < /dev/tty
        read -p "Masukkan Admin Chat ID Telegram: " NEW_ID < /dev/tty
        
        # Update settings.json
        if [ ! -z "$NEW_TOKEN" ] && [ ! -z "$NEW_ID" ]; then
            node -e "const fs = require('fs'); const s = JSON.parse(fs.readFileSync('settings.json', 'utf8')); s.telegram_bot_token = '$NEW_TOKEN'; s.telegram_admin_id = '$NEW_ID'; s.telegram_enabled = true; fs.writeFileSync('settings.json', JSON.stringify(s, null, 2));"
            BOT_TOKEN=$NEW_TOKEN
            ADMIN_ID=$NEW_ID
            echo "✓ Konfigurasi Telegram berhasil disimpan."
        else
            echo "❌ Bot Token dan Admin ID tidak valid, dilewati."
        fi
    fi

    # Jalankan Installer Backup dari repository Hendri
    if [ ! -z "$BOT_TOKEN" ] && [ ! -z "$ADMIN_ID" ]; then
        export TG_TOKEN="$BOT_TOKEN"
        export TG_CHAT_ID="$ADMIN_ID"
        export BACKUP_DIRS="$(pwd)/database $(pwd)/backups"

        echo "Mengunduh script backup dari repository..."
        
        if curl -fsSL https://raw.githubusercontent.com/heruhendri/Installer-Backup-Vps-Bot-Telegram/master/install-backupvps-telegram.sh | bash; then
            echo "✓ Auto Backup Telegram telah berhasil dikonfigurasi."
        else
            echo "⚠️ Gagal mengunduh script backup. Anda dapat mengkonfigurasinya nanti secara manual."
        fi
    fi
else
    echo "Backup Telegram dilewati. Anda dapat mengkonfigurasinya nanti di panel admin."
fi

echo ""
echo "===================================================="
echo "             INSTALASI SELESAI                      "
echo "===================================================="
echo ""
echo "📁 Direktori Instalasi  : $REPO_DIR"
echo "🖥️  Tipe Server          : $SERVER_TYPE"
echo "🌐 IP Publik            : $PUBLIC_IP"
echo "🖧 IP Lokal             : $LOCAL_IP"
echo "⚙️  Port                 : $PORT"
echo ""
echo "-------- INFORMASI AKSES --------"
echo "🔗 Admin Portal         : http://$PUBLIC_IP:$PORT/admin/login"
echo "📊 Customer Portal      : http://$PUBLIC_IP:$PORT/customer"
echo "🛠️  Tech Portal          : http://$PUBLIC_IP:$PORT/tech/login"
echo "📱 Agent Portal         : http://$PUBLIC_IP:$PORT/agent/login"
echo ""
echo "👤 Username Default     : admin"
echo "🔑 Password Default     : admin123"
echo ""
echo "---- PERINTAH YANG BERGUNA ----"
echo "Cek status aplikasi     : pm2 status"
echo "Restart aplikasi        : pm2 restart $PM2_NAME"
echo "Lihat log real-time     : pm2 logs $PM2_NAME"
echo "Stop aplikasi           : pm2 stop $PM2_NAME"
echo "Start aplikasi          : pm2 start $PM2_NAME"
echo "Hapus dari PM2          : pm2 delete $PM2_NAME"
echo ""
echo "---- KONFIGURASI LEBIH LANJUT ----"
echo "Edit pengaturan         : nano settings.json"
echo "Dokumentasi             : https://github.com/heruhendri/billing-rtrw"
echo "Support                 : https://t.me/GbtTapiPngnSndiri"
echo ""
echo -e "${CYAN}----------------------------------------------------${NC}"
echo -e "       ${GREEN}${BOLD}✅ Instalasi berhasil dilakukan!${NC}"
echo -e "       ${CYAN}Enjoy your RTRWNET System - By Hendri${NC}"
echo -e "${CYAN}====================================================${NC}"