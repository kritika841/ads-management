import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
dotenv.config({ path: envPath });

async function runCleanup() {
  const { cleanupExpiredDownloadLogs } = await import("../lib/download-logs.ts");
  console.log(`[cleanup] Checking for expired download logs and stale ZIP files (>3 days)...`);
  const count = await cleanupExpiredDownloadLogs();
  console.log(`[cleanup] Purged ${count} expired download archive(s).`);
}

runCleanup().catch((err) => {
  console.error("[cleanup] Error running download log cleanup:", err);
  process.exit(1);
});
