const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const dotenv = require("dotenv");

const RUN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

console.log("Starting background cron scheduler for auto-tagging...");
bootstrapEnv();

function runIngest() {
  console.log(`[cron] Triggering ingest script at ${new Date().toISOString()}`);

  const child = spawn(
    process.execPath,
    ["scripts/ingest-ads-clip-segments.cjs"],
    {
      cwd: path.resolve(process.cwd()),
      stdio: "inherit",
      env: { ...process.env },
    }
  );

  child.on('close', (code) => {
    console.log(`[cron] Ingest finished with code ${code}`);
  });
  
  child.on('error', (err) => {
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
