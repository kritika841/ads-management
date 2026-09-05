const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const dotenv = require("dotenv");

const RUN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
let running = false;

console.log("Starting background cron scheduler for auto-tagging...");
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

// Run immediately on startup
runIngest();

// Schedule subsequent runs
setInterval(runIngest, RUN_INTERVAL_MS);

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
