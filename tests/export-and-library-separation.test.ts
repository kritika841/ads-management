import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { downloadProgressLabel } from "@/lib/client-download";

const jobs = readFileSync("lib/export-jobs.ts", "utf8");
const jobDownload = readFileSync("app/api/ads/export-jobs/[id]/download/route.ts", "utf8");
const dashboard = readFileSync("components/dashboard/dashboard-client.tsx", "utf8");
const worker = readFileSync("scripts/ingest-ads-clip-segments.cjs", "utf8");
const migration = readFileSync("supabase/migrations/20260905090000_separate_raw_assets_and_audit_editors.sql", "utf8");
const actions = readFileSync("app/actions/ads.ts", "utf8");
const downloadedRoute = readFileSync("app/api/ads/mark-downloaded/route.ts", "utf8");
const downloadedMigration = readFileSync("supabase/migrations/20260905100000_tag_historical_downloaded_creatives.sql", "utf8");

describe("exact ZIP export jobs", () => {
  it("reports exact downloaded and total bytes", () => {
    expect(downloadProgressLabel({ receivedBytes: 5 * 1024 ** 2, totalBytes: 20 * 1024 ** 2, percent: 25, etaSeconds: null }))
      .toBe("25% · 5.0 MB of 20.0 MB");
  });

  it("builds the ZIP before serving it with the final byte size", () => {
    expect(jobs).toContain("job.zipSizeBytes = output.size");
    expect(jobDownload).toContain('"Content-Length": String(job.zipSizeBytes)');
    expect(dashboard).toContain("downloadProgressLabel(progress)");
    expect(dashboard).not.toContain('aria-label="ZIP progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><div className={cn');
  });

  it("retains per-file completion and failure state", () => {
    expect(jobs).toContain('file.state = "included"');
    expect(jobs).toContain('file.state = "failed"');
    expect(dashboard).toContain("skipped/failed");
  });

  it("uses one continuous bar and marks only successfully downloaded creatives", () => {
    expect(dashboard).toContain("downloaded ZIP bytes ÷ exact final ZIP bytes");
    expect(dashboard).not.toContain("Building ZIP ·");
    expect(dashboard).toContain("{progress || complete ? <div");
    expect(dashboard).toContain('file.state === "included" && file.adId');
    expect(dashboard).not.toContain("chooseDownloadDestination(filename)");
    expect(downloadedRoute).toContain('p_tags: ["downloaded"]');
    expect(downloadedMigration).toContain("ad.created_at < now() - interval '5 days'");
  });
});

describe("Ad Library separation", () => {
  it("uses independent source rows and never reads or updates Creative Library rows", () => {
    expect(worker).toContain('.from("raw_asset_sources")');
    expect(worker).not.toContain('.from("ads")');
    expect(worker).not.toMatch(/raw_clip_segments[\s\S]{0,400}ad_id:/);
  });

  it("preserves legacy data before removing the redundant segment ad key", () => {
    expect(migration).toContain("Cannot separate raw segments: legacy raw_clip_id backfill is incomplete");
    expect(migration).toContain("alter table public.raw_clip_segments drop column if exists ad_id");
    expect(migration).toContain("references public.ads(id) on delete set null");
  });

  it("audits editor changes and preserves omitted editor input", () => {
    expect(migration).toContain("editor_assignment_audit");
    expect(migration).toContain("set_ad_editor_assignment_atomic");
    expect(actions).toContain("let editorId: string | null = currentAd?.editor_id ?? null");
  });
});
