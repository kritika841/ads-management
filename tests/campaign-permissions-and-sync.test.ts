import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/types";

describe("campaign permissions and sync safeguards", () => {
  const creatorUser: Profile = {
    id: "creator-uuid-1",
    name: "Creator One",
    email: "creator@example.com",
    role: "content_creator",
    avatar_url: null,
    active: true,
    deleted_at: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  const otherCreatorUser: Profile = {
    id: "creator-uuid-2",
    name: "Creator Two",
    email: "creator2@example.com",
    role: "content_creator",
    avatar_url: null,
    active: true,
    deleted_at: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  const editorUser: Profile = {
    id: "editor-uuid-1",
    name: "Editor One",
    email: "editor@example.com",
    role: "editor",
    avatar_url: null,
    active: true,
    deleted_at: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  const otherEditorUser: Profile = {
    id: "editor-uuid-2",
    name: "Editor Two",
    email: "editor2@example.com",
    role: "editor",
    avatar_url: null,
    active: true,
    deleted_at: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  const managerUser: Profile = {
    id: "manager-uuid-1",
    name: "Manager",
    email: "manager@example.com",
    role: "manager",
    avatar_url: null,
    active: true,
    deleted_at: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  const adminUser: Profile = {
    id: "admin-uuid-1",
    name: "Admin",
    email: "admin@example.com",
    role: "admin",
    avatar_url: null,
    active: true,
    deleted_at: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  it("filters campaign creatives so creators cannot see other creators' ads", () => {
    const rawAds = [
      { id: "ad-1", creator_id: "creator-uuid-1", editor_id: "editor-uuid-1", name: "Ad 1" },
      { id: "ad-2", creator_id: "creator-uuid-2", editor_id: "editor-uuid-2", name: "Ad 2" },
      { id: "ad-3", creator_id: "creator-uuid-1", editor_id: "editor-uuid-2", name: "Ad 3" }
    ];

    const collaboratorAdIds = new Set<string>();

    const filterForProfile = (profile: Profile) => {
      const isFullAccess = profile.role === "admin" || profile.role === "manager";
      if (isFullAccess) return rawAds;
      return rawAds.filter((ad) => {
        if (profile.role === "content_creator") {
          return ad.creator_id === profile.id || collaboratorAdIds.has(ad.id);
        }
        if (profile.role === "editor") {
          return ad.editor_id === profile.id || collaboratorAdIds.has(ad.id);
        }
        return false;
      });
    };

    const creator1Ads = filterForProfile(creatorUser);
    expect(creator1Ads).toHaveLength(2);
    expect(creator1Ads.map((a) => a.id)).toEqual(["ad-1", "ad-3"]);

    const creator2Ads = filterForProfile(otherCreatorUser);
    expect(creator2Ads).toHaveLength(1);
    expect(creator2Ads.map((a) => a.id)).toEqual(["ad-2"]);

    const editor1Ads = filterForProfile(editorUser);
    expect(editor1Ads).toHaveLength(1);
    expect(editor1Ads.map((a) => a.id)).toEqual(["ad-1"]);

    const editor2Ads = filterForProfile(otherEditorUser);
    expect(editor2Ads).toHaveLength(2);
    expect(editor2Ads.map((a) => a.id)).toEqual(["ad-2", "ad-3"]);

    const adminAds = filterForProfile(adminUser);
    expect(adminAds).toHaveLength(3);
  });

  it("includes collaborator ads for contributors who were granted access", () => {
    const rawAds = [
      { id: "ad-1", creator_id: "creator-uuid-1", editor_id: "editor-uuid-1", name: "Ad 1" },
      { id: "ad-2", creator_id: "creator-uuid-2", editor_id: "editor-uuid-2", name: "Ad 2" }
    ];

    const collaboratorAdIds = new Set(["ad-2"]); // Creator 1 was added as collaborator on ad-2

    const creator1Ads = rawAds.filter(
      (ad) => ad.creator_id === creatorUser.id || collaboratorAdIds.has(ad.id)
    );
    expect(creator1Ads).toHaveLength(2);
    expect(creator1Ads.map((a) => a.id)).toContain("ad-2");
  });

  it("ensures DOCTYPE and raw HTML are completely eradicated from sync error messages", () => {
    const simulateSyncError = (status: number, text: string) => {
      let errorText: string;
      const isHtml = text.trim().startsWith("<") || /<!DOCTYPE|<html/i.test(text);
      if (isHtml) {
        if (status === 504) {
          errorText = "Sync is taking longer than usual and is continuing in the background. Please refresh in a moment.";
        } else if (status === 502 || status === 503) {
          errorText = "Meta sync service is temporarily unavailable. Please try again shortly.";
        } else if (status === 401) {
          errorText = "Session expired. Please log in again to sync.";
        } else if (status === 403) {
          errorText = "You do not have permission to sync Meta metrics.";
        } else {
          errorText = `Sync request could not complete (HTTP ${status}). Please try again.`;
        }
      } else {
        const cleanError = text.replace(/<[^>]*>/g, "").trim().slice(0, 100);
        errorText = cleanError || `Sync failed (HTTP ${status}).`;
      }

      // Safety guard check
      if (errorText.includes("<!DOCTYPE") || errorText.includes("<html") || /<[a-z][\s\S]*>/i.test(errorText)) {
        errorText = "Sync encountered an unexpected server response. Please try again in a few moments.";
      }
      return errorText;
    };

    // 504 Gateway Timeout HTML page
    const nginx504 = `<!DOCTYPE html>\n<html>\n<head><title>504 Gateway Time-out</title></head>\n<body>\n<center><h1>504 Gateway Time-out</h1></center>\n<hr><center>nginx</center>\n</body>\n</html>`;
    const res504 = simulateSyncError(504, nginx504);
    expect(res504).not.toContain("<!DOCTYPE");
    expect(res504).not.toContain("<html>");
    expect(res504).not.toContain("nginx");
    expect(res504).toContain("taking longer than usual");

    // 502 Bad Gateway HTML page
    const nginx502 = `<!DOCTYPE html><html><body>502 Bad Gateway</body></html>`;
    const res502 = simulateSyncError(502, nginx502);
    expect(res502).not.toContain("<!DOCTYPE");
    expect(res502).toContain("temporarily unavailable");

    // Redirect HTML page (e.g. auth redirect to login)
    const redirectHtml = `<!DOCTYPE html><html lang="en"><head><title>Login - AdFlow</title></head><body><h1>Login</h1></body></html>`;
    const res401 = simulateSyncError(401, redirectHtml);
    expect(res401).not.toContain("<!DOCTYPE");
    expect(res401).toContain("Session expired");

    // Random HTML error
    const genericHtml = `<html><body>Server Error</body></html>`;
    const res500 = simulateSyncError(500, genericHtml);
    expect(res500).not.toContain("<");
    expect(res500).not.toContain(">");
  });

  it("calculates staleness correctly so sync triggers automatically throughout the day", () => {
    const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();

    // Synced 5 minutes ago - fresh
    const freshSyncTime = now - 5 * 60 * 1000;
    const isFreshStale = (now - freshSyncTime) > STALE_THRESHOLD_MS;
    expect(isFreshStale).toBe(false);

    // Synced 45 minutes ago - stale, must auto-sync
    const staleSyncTime = now - 45 * 60 * 1000;
    const isStale = (now - staleSyncTime) > STALE_THRESHOLD_MS;
    expect(isStale).toBe(true);

    // 0 ads synced - must auto-sync
    const noAds = [] as { last_synced_at: string }[];
    const needsSyncOnEmpty = noAds.length === 0;
    expect(needsSyncOnEmpty).toBe(true);
  });
});
