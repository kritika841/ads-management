#!/bin/bash
set -euo pipefail

APP_DIR="/home/deployer/apps/satmi-ads"
LOCK_FILE="/tmp/ingest-clip-segments.lock"

# Every entry point uses this wrapper. Acquire one non-blocking lock and impose a
# hard timeout before loading application code so redundant schedulers are safe.
if [ "${1:-}" != "--locked" ]; then
  exec /usr/bin/flock -E 73 -n "$LOCK_FILE" /usr/bin/timeout 55m /bin/bash "$0" --locked
fi

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

NODE_BIN=""
if [ -f "$APP_DIR/.node-path" ]; then
  NODE_BIN="$(head -n 1 "$APP_DIR/.node-path")"
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node || true)"
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "Node.js executable could not be resolved" >&2
  exit 1
fi

echo "[scheduler] Run started at $(date --iso-8601=seconds)"

run_worker() {
  local label="$1"
  shift
  set +e
  "$NODE_BIN" -r dotenv/config "$@"
  local status=$?
  set -e

  # 75 is the intentional quota-exhausted exit. The next scheduled pass resumes
  # from pending work, so it should not prevent the remainder of this run.
  if [ "$status" -ne 0 ] && [ "$status" -ne 75 ]; then
    echo "[$label] exited with status $status" >&2
    return "$status"
  fi
  return 0
}

tag_status=0
run_worker "tagging" scripts/ingest-ads-clip-segments.cjs || tag_status=$?
run_worker "embedding-backfill" scripts/backfill-gemini-embeddings.cjs || exit $?
echo "[scheduler] Run completed at $(date --iso-8601=seconds)"
exit "$tag_status"
