#!/bin/bash
set -e
cd /home/deployer/apps/satmi-ads
echo "Pulling latest code..."
git pull origin main
echo "Installing dependencies..."
npm ci
echo "Building..."
npm run build
echo "Reloading PM2 process..."
pm2 reload satmi-ads
sleep 3
curl -f http://localhost:3000/api/health > /dev/null || (echo "Health check failed!" && exit 1)
echo "Deploy complete: $(date)"