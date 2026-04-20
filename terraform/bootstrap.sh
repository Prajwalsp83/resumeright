#!/bin/bash
set -e

exec > /var/log/user-data.log 2>&1

echo "🚀 Starting setup..."

apt update -y
apt install -y nodejs npm git

npm install -g pm2

cd /home/ubuntu

# Clone your repo (IMPORTANT: use correct URL)
if [ ! -d "backend" ]; then
  git clone https://github.com/Prajwalsp83/resumeright.git backend
fi

cd backend

npm install

# Set env
echo "MONGO_URI=${mongo_uri}" > .env
echo "ADMIN_KEY=${admin_key}" >> .env

# Start app
pm2 start server.js --name resumeright
pm2 save
