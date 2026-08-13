#!/bin/bash
set -euo pipefail

APP_DIR="/home/deployer/apps/satmi-ads"
CRON_FILE="$APP_DIR/ops/cron/ingest-clip-segments.cron"
MANAGED_COMMAND="/home/deployer/apps/satmi-ads/scripts/run-ingest-cron.sh"
TMP_CRON="$(mktemp)"

trap 'rm -f "$TMP_CRON"' EXIT

crontab -l 2>/dev/null | grep -v "$MANAGED_COMMAND" > "$TMP_CRON" || true
cat "$CRON_FILE" >> "$TMP_CRON"
crontab "$TMP_CRON"
