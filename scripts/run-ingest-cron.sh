#!/bin/bash
set -euo pipefail

APP_DIR="/home/deployer/apps/satmi-ads"

cd "$APP_DIR"

# Load configuration with dotenv instead of sourcing it as shell code. This handles
# JSON service-account values correctly and matches how local/manual runs behave.
if [ -f ".env" ]; then
  export DOTENV_CONFIG_PATH="$APP_DIR/.env"
elif [ -f ".env.production" ]; then
  export DOTENV_CONFIG_PATH="$APP_DIR/.env.production"
elif [ -f ".env.local" ]; then
  export DOTENV_CONFIG_PATH="$APP_DIR/.env.local"
fi

exec /usr/bin/node -r dotenv/config scripts/ingest-ads-clip-segments.cjs
