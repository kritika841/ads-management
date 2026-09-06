import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wrapper = readFileSync("scripts/run-ingest-cron.sh", "utf8");
const installer = readFileSync("scripts/install-ingest-cron.sh", "utf8");
const crontab = readFileSync("ops/cron/ingest-clip-segments.cron", "utf8");
const processConfig = readFileSync("ecosystem.config.cjs", "utf8");
const deploy = readFileSync("deploy.sh", "utf8");
const watchdog = readFileSync(".github/workflows/raw-clip-tagging.yml", "utf8");
const worker = readFileSync("scripts/ingest-ads-clip-segments.cjs", "utf8");

describe("raw clip scheduler", () => {
  it("supports a date-scoped manual run without re-queuing the historical backlog", () => {
    expect(worker).toContain('process.argv.indexOf("--created-since")');
    expect(worker).toContain('query = query.gte("created_at", createdSince)');
    expect(worker).toContain('staleQuery = staleQuery.gte("created_at", createdSince)');
    expect(worker).toContain('errorQuery = errorQuery.gte("created_at", createdSince)');
  });

  it("uses one shared non-blocking lock and timeout for every trigger", () => {
    expect(wrapper).toContain("flock -E 73 -n");
    expect(wrapper).toContain("timeout 55m");
    expect(wrapper).toContain('run_worker "tagging"');
    expect(wrapper).toContain('run_worker "embedding-backfill"');
  });

  it("writes cron output to a deployer-owned log and verifies installation", () => {
    expect(crontab).toContain("/home/deployer/logs/ingest-clip-segments.log");
    expect(crontab).not.toContain("/var/log/");
    expect(installer).toContain('touch "$LOG_FILE"');
    expect(installer).toContain('crontab -l | grep -Fq "$MANAGED_COMMAND"');
  });

  it("keeps a PM2 fallback alive and persistent across restarts", () => {
    expect(processConfig).toContain('name: "satmi-ads-cron"');
    expect(processConfig).toContain('script: "scripts/cron.cjs"');
    expect(deploy).not.toContain("pm2 delete satmi-ads-cron");
    expect(deploy).toContain("pm2 save");
  });

  it("has an independent GitHub watchdog using the same locked wrapper", () => {
    expect(watchdog).toContain("schedule:");
    expect(watchdog).toContain('cron: "15 19 * * *"');
    expect(watchdog).not.toContain('cron: "17 * * * *"');
    expect(watchdog).toContain("workflow_dispatch:");
    expect(watchdog).toContain("scripts/run-ingest-cron.sh");
    expect(watchdog).toContain("timeout: 60s");
    expect(watchdog).toContain('if [ "$status" -eq 73 ]');
  });
});
