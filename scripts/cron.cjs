const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const dotenv = require("dotenv");

const RUN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const META_SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
let running = false;
let syncingMeta = false;

console.log("Starting background cron scheduler for auto-tagging and performance sync...");
bootstrapEnv();

function runIngest() {
  if (running) {
    console.log("[cron] Previous scheduler request is still active; skipping this interval.");
    return;
  }
  running = true;
  console.log(`[cron] Triggering ingest script at ${new Date().toISOString()}`);

  const child = spawn(
    "/bin/bash",
    ["scripts/run-ingest-cron.sh"],
    {
      cwd: path.resolve(process.cwd()),
      stdio: "inherit",
      env: { ...process.env },
    }
  );

  child.on('close', (code) => {
    running = false;
    if (code === 73) console.log("[cron] Another scheduler owns the ingest lock; this run was safely skipped.");
    else console.log(`[cron] Tagging and embedding pipeline finished with code ${code}`);
  });
  
  child.on('error', (err) => {
    running = false;
    console.error(`[cron] Failed to start ingest script:`, err);
  });
}

function runMetaSync() {
  if (syncingMeta) {
    console.log("[cron-meta] Previous Meta sync is still active; skipping this interval.");
    return;
  }
  syncingMeta = true;
  console.log(`[cron-meta] Triggering Meta incentives sync at ${new Date().toISOString()}`);

  const port = process.env.PORT || 3000;
  const secret = process.env.CRON_SECRET || "";

  const options = {
    hostname: "127.0.0.1",
    port: Number(port),
    path: "/api/incentives/sync",
    method: "GET",
    headers: {
      "Authorization": secret ? `Bearer ${secret}` : "",
      "X-Internal-Cron": "1",
      "User-Agent": "satmi-ads-cron"
    },
    timeout: 180000
  };

  const req = http.request(options, (res) => {
    let data = "";
    res.on("data", (chunk) => { data += chunk; });
    res.on("end", () => {
      syncingMeta = false;
      try {
        const json = JSON.parse(data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[cron-meta] Meta sync succeeded: ${json.message || JSON.stringify(json)}`);
        } else {
          console.error(`[cron-meta] Meta sync failed HTTP ${res.statusCode}: ${json.error || data.slice(0, 100)}`);
        }
      } catch {
        console.log(`[cron-meta] Meta sync finished with HTTP ${res.statusCode}`);
      }
    });
  });

  req.on("error", (err) => {
    syncingMeta = false;
    console.error(`[cron-meta] Error contacting local sync endpoint:`, err.message);
  });

  req.on("timeout", () => {
    syncingMeta = false;
    req.destroy();
    console.warn(`[cron-meta] Meta sync request timed out (will retry on next interval).`);
  });

  req.end();
}

// Run immediately on startup
runIngest();
setTimeout(runMetaSync, 15000); // 15s after startup to allow server to be ready

// Schedule subsequent runs
setInterval(runIngest, RUN_INTERVAL_MS);
setInterval(runMetaSync, META_SYNC_INTERVAL_MS);

function bootstrapEnv() {
  const projectRoot = path.resolve(process.cwd());
  const candidates = [".env", ".env.local", ".env.production", ".env.vercel-production"];

  for (const relativePath of candidates) {
    const fullPath = path.join(projectRoot, relativePath);
    if (!fs.existsSync(fullPath)) continue;
    dotenv.config({ path: fullPath, override: false });
    console.log(`[cron] Loaded environment from ${relativePath}`);
    return;
  }

  console.warn("[cron] No local env file found. Continuing with inherited environment only.");
}
