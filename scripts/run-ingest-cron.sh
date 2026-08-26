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

run_worker() {
  local label="$1"
  shift
  set +e
  /usr/bin/node -r dotenv/config "$@"
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
exit "$tag_status"
