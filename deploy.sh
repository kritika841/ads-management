#!/bin/bash
set -e
cd /home/deployer/apps/satmi-ads

echo "Extracting new build..."
tar -xzf release.tar.gz
rm release.tar.gz

echo "Installing production dependencies..."
npm ci --omit=dev

echo "Reloading PM2 process..."
pm2 reload satmi-ads

sleep 3
curl -f http://localhost:3000/api/health > /dev/null || (echo "Health check failed!" && exit 1)
echo "Deploy complete: $(date)"
