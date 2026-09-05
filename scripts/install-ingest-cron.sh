#!/bin/bash
set -euo pipefail

APP_DIR="/home/deployer/apps/satmi-ads"
CRON_FILE="$APP_DIR/ops/cron/ingest-clip-segments.cron"
MANAGED_COMMAND="/home/deployer/apps/satmi-ads/scripts/run-ingest-cron.sh"
TMP_CRON="$(mktemp)"
LOG_DIR="/home/deployer/logs"
LOG_FILE="$LOG_DIR/ingest-clip-segments.log"

trap 'rm -f "$TMP_CRON"' EXIT

command -v crontab >/dev/null || { echo "crontab is not installed" >&2; exit 1; }
command -v flock >/dev/null || { echo "flock is not installed" >&2; exit 1; }
command -v timeout >/dev/null || { echo "timeout is not installed" >&2; exit 1; }
test -x "$MANAGED_COMMAND" || { echo "Ingest wrapper is not executable: $MANAGED_COMMAND" >&2; exit 1; }
mkdir -p "$LOG_DIR"
touch "$LOG_FILE"

crontab -l 2>/dev/null | grep -v "$MANAGED_COMMAND" | grep -v '^CRON_TZ=Asia/Kolkata$' > "$TMP_CRON" || true
cat "$CRON_FILE" >> "$TMP_CRON"
crontab "$TMP_CRON"
crontab -l | grep -Fq "$MANAGED_COMMAND" || { echo "Cron installation verification failed" >&2; exit 1; }
echo "Raw clip cron installed and logging to $LOG_FILE"
