#!/bin/bash
set -euo pipefail

APP_DIR="/home/deployer/apps/satmi-ads"

cd "$APP_DIR"

if [ -f ".env" ]; then
  set -a
  . ".env"
  set +a
elif [ -f ".env.production" ]; then
  set -a
  . ".env.production"
  set +a
elif [ -f ".env.local" ]; then
  set -a
  . ".env.local"
  set +a
fi

exec /usr/bin/node scripts/ingest-ads-clip-segments.cjs
