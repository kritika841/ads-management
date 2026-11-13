#!/bin/bash
set -e
cd /home/deployer/apps/satmi-ads

echo "Backing up previous static chunks for zero-downtime client compatibility..."
mkdir -p /home/deployer/static-cache
if [ -d ".next/static" ]; then
  cp -rn .next/static/* /home/deployer/static-cache/ 2>/dev/null || true
fi

echo "Extracting new build..."
rm -rf .release-stage
mkdir -p .release-stage
tar -xzf release.tar.gz -C .release-stage
rm -f release.tar.gz

rm -rf .next-prev
if [ -d ".next" ]; then
  mv .next .next-prev
fi
mv .release-stage/.next .next
rm -rf .next-prev

cp -rf .release-stage/ops .release-stage/public .release-stage/scripts .release-stage/lib .release-stage/supabase .release-stage/package.json .release-stage/package-lock.json .release-stage/ecosystem.config.cjs .release-stage/next.config.ts ./
cp -f .release-stage/deploy.sh ./deploy.sh.new && mv -f ./deploy.sh.new ./deploy.sh && chmod +x ./deploy.sh
rm -rf .release-stage

echo "Restoring previous static chunks..."
if [ -d "/home/deployer/static-cache" ]; then
  cp -rn /home/deployer/static-cache/* .next/static/ 2>/dev/null || true
  find /home/deployer/static-cache -type f -mtime +3 -delete 2>/dev/null || true
fi

LOCK_HASH="$(sha256sum package-lock.json | awk '{print $1}')"
PREV_HASH="$(cat .package-lock.sha256 2>/dev/null || true)"
DEPS_OK=0
if node -e "require('./node_modules/next/package.json'); require('./node_modules/@supabase/supabase-js/package.json'); require('./node_modules/sanitize-html/package.json'); require('./node_modules/googleapis/package.json'); require('./node_modules/sharp/package.json');" 2>/dev/null; then
  DEPS_OK=1
fi

if [ "$DEPS_OK" -eq 1 ] && { [ -z "$PREV_HASH" ] || [ "$PREV_HASH" = "$LOCK_HASH" ]; }; then
  echo "Production node_modules verified and package-lock.json unchanged; skipping npm ci."
  echo "$LOCK_HASH" > .package-lock.sha256
else
  echo "Installing production dependencies..."
  npm ci --omit=dev --prefer-offline --no-audit --no-fund
  echo "$LOCK_HASH" > .package-lock.sha256
fi

command -v node > .node-path
chmod +x scripts/run-ingest-cron.sh scripts/install-ingest-cron.sh
echo "Installing system cron job for raw clip tagging..."
bash scripts/install-ingest-cron.sh

echo "Restarting AdFlow PM2 processes..."
pm2 delete satmi-ads 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true
sleep 1
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 describe satmi-ads >/dev/null 2>&1 || (echo "AdFlow PM2 process is missing" && exit 1)
pm2 describe satmi-ads-cron >/dev/null 2>&1 || (echo "Raw clip scheduler PM2 process is missing" && exit 1)
pm2 save

echo "Waiting for health check on port 3000..."
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/health > /dev/null 2>&1; then
    echo "Health check passed on attempt $i!"
    echo "Deploy complete: $(date)"
    exit 0
  fi
  sleep 1
done

echo "Health check failed!"
pm2 logs satmi-ads --lines 30 --nostream || true
exit 1
