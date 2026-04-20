#!/bin/bash
# ResumeRight EC2 Bootstrap — rendered by Terraform templatefile()
set -e
exec > /var/log/userdata.log 2>&1

echo "=== ResumeRight Bootstrap Starting ===" && date

# System update
apt-get update -y && apt-get upgrade -y

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# PM2
npm install -g pm2

# SSM Agent
snap install amazon-ssm-agent --classic
systemctl enable snap.amazon-ssm-agent.amazon-ssm-agent.service
systemctl start  snap.amazon-ssm-agent.amazon-ssm-agent.service

# App directory
mkdir -p /home/ubuntu/backend
cd /home/ubuntu/backend

# Write server files inline (GitHub Actions will overwrite on next deploy)
cat > /home/ubuntu/backend/package.json <<'PKGJSON'
{
  "name": "resumeright-backend",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "mongodb": "^6.3.0",
    "multer": "^1.4.5-lts.1"
  }
}
PKGJSON

# Inject secrets from Terraform variables
export MONGO_URI="${mongo_uri}"
export ADMIN_KEY="${admin_key}"
export PORT=5000

# Write env file for PM2 ecosystem
cat > /home/ubuntu/backend/ecosystem.config.js <<ECOSYSTEM
module.exports = {
  apps: [{
    name: '${app_name}',
    script: 'server.js',
    env: {
      NODE_ENV: 'production',
      PORT: 5000,
      MONGO_URI: '${mongo_uri}',
      ADMIN_KEY: '${admin_key}'
    }
  }]
}
ECOSYSTEM

chown -R ubuntu:ubuntu /home/ubuntu/backend
cd /home/ubuntu/backend && npm install --production

# GitHub Actions will do the first real deploy via SSM
# This just ensures Node + PM2 are ready
echo "=== Bootstrap Complete ===" && date
