#!/bin/bash
# ResumeRight EC2 Bootstrap Script
# Used as User Data in Launch Template for Auto Scaling Group

set -e
exec > /var/log/userdata.log 2>&1

echo "=== ResumeRight EC2 Bootstrap Starting ==="
date

# Update system
apt-get update -y
apt-get upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# Install PM2 globally
npm install -g pm2

# Install AWS SSM Agent (for GitHub Actions deployment)
snap install amazon-ssm-agent --classic
systemctl enable snap.amazon-ssm-agent.amazon-ssm-agent.service
systemctl start snap.amazon-ssm-agent.amazon-ssm-agent.service

# Create app directory
mkdir -p /home/ubuntu/backend
cd /home/ubuntu/backend

# Clone the repository (replace with your actual repo URL)
git clone https://github.com/YOUR_GITHUB_USERNAME/resumeright.git /tmp/resumeright
cp -r /tmp/resumeright/backend/* /home/ubuntu/backend/
chown -R ubuntu:ubuntu /home/ubuntu/backend

# Install dependencies
cd /home/ubuntu/backend
npm ci --production

# Start the application with PM2
sudo -u ubuntu pm2 start server.js --name resumeright
sudo -u ubuntu pm2 save
sudo -u ubuntu pm2 startup systemd -u ubuntu --hp /home/ubuntu

echo "=== Bootstrap Complete ==="
date
