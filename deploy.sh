#!/bin/bash
set -e
cd /home/deployer/apps/satmi-ads
echo "Extracting new build..."
tar -xzf release.tar.gz
rm release.tar.gz
echo "Installing production dependencies..."
npm ci --omit=dev
chmod +x scripts/run-ingest-cron.sh scripts/install-ingest-cron.sh
echo "Installing system cron job for raw clip tagging..."
bash scripts/install-ingest-cron.sh
echo "Reloading PM2 processes..."
pm2 startOrReload ecosystem.config.cjs --update-env
if pm2 describe satmi-ads-cron >/dev/null 2>&1; then
  pm2 delete satmi-ads-cron
fi
sleep 3
curl -f http://localhost:3000/api/health > /dev/null || (echo "Health check failed!" && exit 1)
echo "Deploy complete: $(date)"
