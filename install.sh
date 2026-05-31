#!/bin/bash

# RTRWNET Management & Billing System Installer
# Khusus untuk VPS dan NAT VPS (Ubuntu/Debian)

set -e

clear
echo "===================================================="
echo "   RTRWNET Management & Billing System Installer    "
echo "===================================================="
echo "Sistem: Ubuntu/Debian Support"
echo "----------------------------------------------------"

# 1. Update & Install Dependencies Dasar
echo "[1/6] Memperbarui sistem dan menginstal paket dasar..."
sudo apt-get update -y
sudo apt-get install -y git curl build-essential sqlite3 openssl

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
REPO_DIR="billing-rtrw"
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
read -p "Gunakan port default (4000)? [Y/n]: " use_default < /dev/tty
PORT=4000

if [[ $use_default =~ ^([nN][oO]|[nN])$ ]]; then
    read -p "Masukkan port custom (sesuaikan dengan port NAT Anda): " custom_port < /dev/tty
    PORT=$custom_port
fi
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
    node -e "const fs = require('fs'); const s = JSON.parse(fs.readFileSync('settings.json', 'utf8')); s.server_port = $PORT; fs.writeFileSync('settings.json', JSON.stringify(s, null, 2));"
fi

# 6. Install NPM Packages
echo "[5/6] Menginstal dependensi aplikasi (ini mungkin memakan waktu)..."
npm install --omit=dev

# 7. Setup PM2 (Process Manager)
echo "[6/6] Mengonfigurasi PM2 untuk menjalankan aplikasi di background..."
sudo npm install -g pm2
pm2 stop billing-rtrw || true
pm2 start app-customer.js --name billing-rtrw
pm2 save

echo ""
echo "===================================================="
echo "             INSTALASI SELESAI                      "
echo "===================================================="
echo "Akses Admin    : http://[IP-VPS]:$PORT/admin/login"
echo "User Default   : admin"
echo "Pass Default   : admin123"
echo "----------------------------------------------------"
echo "Cek status aplikasi: pm2 status"
echo "Restart aplikasi   : pm2 restart billing-rtrw"
echo "Lihat log          : pm2 logs billing-rtrw"
echo "===================================================="