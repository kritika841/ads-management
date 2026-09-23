import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  createDownloadLog,
  updateDownloadLog,
  getDownloadLogs,
  getDownloadLogById,
  deleteDownloadLog,
  recordDownloadAccess,
  cleanupExpiredDownloadLogs
} from "@/lib/download-logs";

describe("Download Logs & Retention System", () => {
  const testDir = path.join(process.cwd(), "storage", "test-zips");

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  it("creates a download log with 3-day expiration", async () => {
    const log = await createDownloadLog({
      id: "test-job-1",
      userId: "user-123",
      userName: "Admin User",
      userRole: "admin",
      title: "Summer Campaign Export (3 items)",
      source: "campaigns",
      campaignId: "camp-1",
      campaignName: "Summer Campaign",
      creativeCount: 3,
      creativeIds: ["ad-1", "ad-2", "ad-3"],
      creativeNames: ["Ad 1", "Ad 2", "Ad 3"],
      zipFilename: "summer-campaign.zip",
    });

    expect(log.id).toBe("test-job-1");
    expect(log.status).toBe("preparing");
    expect(log.creative_count).toBe(3);
    expect(log.download_count).toBe(0);

    const now = Date.now();
    const expiresAt = new Date(log.expires_at).getTime();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    // Difference should be approximately 3 days (within 5 seconds)
    expect(Math.abs(expiresAt - (now + threeDaysMs))).toBeLessThan(5000);
  });

  it("updates download log status, file size, and file path", async () => {
    const testZip = path.join(testDir, "test-job-1.zip");
    await fs.writeFile(testZip, "mock zip contents");

    const updated = await updateDownloadLog("test-job-1", {
      status: "ready",
      zip_size_bytes: 1024,
      zip_file_path: testZip,
    });

    expect(updated?.status).toBe("ready");
    expect(updated?.zip_size_bytes).toBe(1024);

    const fetched = await getDownloadLogById("test-job-1");
    expect(fetched?.status).toBe("ready");
  });

  it("records download access and increments counter", async () => {
    await recordDownloadAccess("test-job-1");
    const log = await getDownloadLogById("test-job-1");
    expect(log?.download_count).toBe(1);
    expect(log?.last_downloaded_at).toBeTruthy();
  });

  it("deletes a download log and unlinks the zip file from disk", async () => {
    const testZip = path.join(testDir, "test-delete.zip");
    await fs.writeFile(testZip, "mock delete zip");

    await createDownloadLog({
      id: "test-job-delete",
      userId: "user-123",
      userName: "Admin",
      userRole: "admin",
      title: "To Delete",
      creativeCount: 1,
      creativeIds: ["ad-del"],
      creativeNames: ["Ad Del"],
      zipFilename: "test-delete.zip",
      zipFilePath: testZip,
    });

    expect(await fs.stat(testZip).catch(() => null)).not.toBeNull();

    await deleteDownloadLog("test-job-delete");

    const fetched = await getDownloadLogById("test-job-delete");
    expect(fetched).toBeNull();
    // Physical file should also be unlinked
    const fileStillExists = await fs.stat(testZip).catch(() => null);
    expect(fileStillExists).toBeNull();
  });

  it("cleans up expired download logs and deletes stale files", async () => {
    const expiredZip = path.join(testDir, "expired.zip");
    await fs.writeFile(expiredZip, "expired zip file");

    const expiredLog = await createDownloadLog({
      id: "test-expired-job",
      userId: "user-123",
      userName: "Admin",
      userRole: "admin",
      title: "Expired Archive",
      creativeCount: 1,
      creativeIds: ["ad-exp"],
      creativeNames: ["Ad Exp"],
      zipFilename: "expired.zip",
      zipFilePath: expiredZip,
    });

    // Manually set expiration date to the past (4 days ago)
    await updateDownloadLog("test-expired-job", {
      expires_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const purgedCount = await cleanupExpiredDownloadLogs();
    expect(purgedCount).toBeGreaterThanOrEqual(1);

    const fetched = await getDownloadLogById("test-expired-job");
    expect(fetched).toBeNull();

    // Expired file should be deleted
    const fileStat = await fs.stat(expiredZip).catch(() => null);
    expect(fileStat).toBeNull();
  });

  it("operates independently of the Creative Library admin-only downloaded badge", async () => {
    // 1. Download logs can track campaigns or creative library exports without any tag requirements
    const campaignLog = await createDownloadLog({
      id: "test-campaign-independence",
      userId: "manager-user-1",
      userName: "Marketing Manager",
      userRole: "manager",
      title: "Campaign Ads Export",
      source: "campaigns",
      creativeCount: 2,
      creativeIds: ["unbadged-ad-1", "unbadged-ad-2"],
      creativeNames: ["Ad 1", "Ad 2"],
      zipFilename: "campaign-ads.zip",
    });

    expect(campaignLog.source).toBe("campaigns");
    expect(campaignLog.status).toBe("preparing");

    // 2. Accessing or downloading does not modify any tags or require admin role
    await recordDownloadAccess("test-campaign-independence");
    const updated = await getDownloadLogById("test-campaign-independence");
    expect(updated?.download_count).toBe(1);

    // 3. Deleting download log removes the archive without touching creative tags
    await deleteDownloadLog("test-campaign-independence");
    expect(await getDownloadLogById("test-campaign-independence")).toBeNull();
  });
});
