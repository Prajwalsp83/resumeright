#!/bin/bash
# Minimal first-boot script. The real deploy (install node/npm/pm2, clone repo,
# fetch SSM secrets, write .env, start pm2) runs from the GitHub Actions
# pipeline via SSM RunCommand — see .github/workflows/deploy.yml. Keeping this
# script tiny means bootstrap failures never block a deploy.
set -e
exec > /var/log/user-data.log 2>&1

echo "[$(date -Is)] cloud-init starting"

# Ubuntu 22.04 ships with the SSM agent pre-installed. Just make sure it's
# enabled + running so the deploy can target this instance immediately.
systemctl enable amazon-ssm-agent >/dev/null 2>&1 || true
systemctl start amazon-ssm-agent  >/dev/null 2>&1 || true

echo "[$(date -Is)] ready for SSM deploy"
