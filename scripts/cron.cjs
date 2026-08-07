const { spawn } = require("child_process");
const path = require("path");

const RUN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

console.log("Starting background cron scheduler for auto-tagging...");

function runIngest() {
  console.log(`[cron] Triggering ingest script at ${new Date().toISOString()}`);
  
  const child = spawn(
    process.execPath,
    ["-r", "dotenv/config", "scripts/ingest-ads-clip-segments.cjs", "dotenv_config_path=.env.local"],
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
