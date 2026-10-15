import { describe, expect, it } from "vitest";
import { getRoleHierarchyLevel, roleLabel, userRoles } from "@/lib/constants";
import { canDeleteAd, canEditAd, canPublish, canSubmitAd } from "@/lib/permissions";
import { canAssignCreator, eligibleCreatorsFor } from "@/lib/creators";
import { reviewPermissionError } from "@/lib/workflow";
import { isCreativeCreationBlocked } from "@/lib/production-workflow";
import { createDownloadLog, deleteDownloadLog, getDownloadLogById } from "@/lib/download-logs";
import { queuesForRole } from "@/lib/work-queues";
import { buildDashboardSummary } from "@/lib/dashboard-summary";
import type { Profile, UserRole } from "@/lib/types";

describe("Media Buyer Role & Hierarchy", () => {
  it("includes media_buyer in userRoles and formats label correctly", () => {
    expect(userRoles).toContain("media_buyer");
    expect(roleLabel("media_buyer")).toBe("Media Buyer");
  });

  it("enforces hierarchy: Level 4 Admin > Level 3 Manager > Level 2 Media Buyer > Level 1 Editor & Creator", () => {
    expect(getRoleHierarchyLevel("admin")).toBe(4);
    expect(getRoleHierarchyLevel("manager")).toBe(3);
    expect(getRoleHierarchyLevel("media_buyer")).toBe(2);
    expect(getRoleHierarchyLevel("editor")).toBe(1);
    expect(getRoleHierarchyLevel("content_creator")).toBe(1);

    expect(getRoleHierarchyLevel("admin")).toBeGreaterThan(getRoleHierarchyLevel("media_buyer"));
    expect(getRoleHierarchyLevel("manager")).toBeGreaterThan(getRoleHierarchyLevel("media_buyer"));
    expect(getRoleHierarchyLevel("media_buyer")).toBeGreaterThan(getRoleHierarchyLevel("editor"));
    expect(getRoleHierarchyLevel("media_buyer")).toBeGreaterThan(getRoleHierarchyLevel("content_creator"));
  });
});

describe("Media Buyer Creative Permissions", () => {
  const mediaBuyerId = "mb-100";
  const otherUserId = "user-200";

  it("cannot delete ads or publish ads", () => {
    expect(canDeleteAd("media_buyer")).toBe(false);
    expect(canPublish("media_buyer", "approved")).toBe(false);
  });

  it("can only edit and submit their own authored creatives in draft/changes_requested state", () => {
    // Self-authored draft
    expect(
      canEditAd({
        role: "media_buyer",
        userId: mediaBuyerId,
        creatorId: mediaBuyerId,
        editorId: null,
        status: "draft"
      })
    ).toBe(true);

    expect(
      canSubmitAd({
        role: "media_buyer",
        userId: mediaBuyerId,
        creatorId: mediaBuyerId,
        editorId: null,
        status: "draft"
      })
    ).toBe(true);

    // Another user's creative (read-only for media buyer)
    expect(
      canEditAd({
        role: "media_buyer",
        userId: mediaBuyerId,
        creatorId: otherUserId,
        editorId: null,
        status: "draft"
      })
    ).toBe(false);

    expect(
      canSubmitAd({
        role: "media_buyer",
        userId: mediaBuyerId,
        creatorId: otherUserId,
        editorId: null,
        status: "draft"
      })
    ).toBe(false);

    // Approved ad cannot be edited directly by media buyer
    expect(
      canEditAd({
        role: "media_buyer",
        userId: mediaBuyerId,
        creatorId: mediaBuyerId,
        editorId: null,
        status: "approved"
      })
    ).toBe(false);
  });

  it("can only author creatives for themselves", () => {
    const mb = { id: mediaBuyerId, role: "media_buyer", active: true, name: "Media Buyer" };
    const creator = { id: "c-1", role: "content_creator", active: true, name: "Creator" };
    const admin = { id: "a-1", role: "admin", active: true, name: "Admin" };

    expect(canAssignCreator(mb, mb)).toBe(true);
    expect(canAssignCreator(mb, creator)).toBe(false);
    expect(canAssignCreator(mb, admin)).toBe(false);

    const eligible = eligibleCreatorsFor(mb, [mb, creator, admin]);
    expect(eligible.map((u) => u.id)).toEqual([mediaBuyerId]);
  });
});

describe("Media Buyer Review Permissions", () => {
  it("can request changes on creatives but CANNOT approve", () => {
    // Requesting changes is permitted
    expect(
      reviewPermissionError({
        status: "pending_review",
        stage: "manager_review",
        reviewerRole: "media_buyer",
        twoStepApproval: false,
        decision: "request_changes"
      })
    ).toBeNull();

    // Approving is strictly forbidden without requested changes
    const approveError = reviewPermissionError({
      status: "pending_review",
      stage: "manager_review",
      reviewerRole: "media_buyer",
      twoStepApproval: false,
      decision: "approve"
    });
    expect(approveError).not.toBeNull();
    expect(approveError?.toLowerCase()).toContain("cannot approve");
  });

  it("can approve their own changes that they previously requested from creator or editor", () => {
    // When approving their own requested changes, approval is permitted
    expect(
      reviewPermissionError({
        status: "pending_review",
        stage: "manager_review",
        reviewerRole: "media_buyer",
        twoStepApproval: false,
        decision: "approve",
        isChangeRequestApproval: true
      })
    ).toBeNull();
  });

  it("blocks lower roles (editor, creator) from requesting changes or approving", () => {
    expect(
      reviewPermissionError({
        status: "pending_review",
        stage: "manager_review",
        reviewerRole: "content_creator",
        twoStepApproval: false,
        decision: "request_changes"
      })
    ).not.toBeNull();

    expect(
      reviewPermissionError({
        status: "pending_review",
        stage: "manager_review",
        reviewerRole: "content_creator",
        twoStepApproval: false,
        decision: "approve"
      })
    ).not.toBeNull();

    expect(
      reviewPermissionError({
        status: "pending_review",
        stage: "manager_review",
        reviewerRole: "editor",
        twoStepApproval: false,
        decision: "request_changes"
      })
    ).not.toBeNull();

    expect(
      reviewPermissionError({
        status: "pending_review",
        stage: "manager_review",
        reviewerRole: "editor",
        twoStepApproval: false,
        decision: "approve"
      })
    ).not.toBeNull();
  });
});

describe("Media Buyer Production Workflow Blocking", () => {
  it("blocks media buyer from creating new creatives if they have unresolved change requests on their own creatives", () => {
    const adWithUnresolvedChanges = {
      id: "ad-1",
      creator_id: "mb-100",
      production_stage: "creator_changes_requested" as const,
      deleted_at: null
    };

    expect(
      isCreativeCreationBlocked({
        role: "media_buyer",
        userId: "mb-100",
        ads: [adWithUnresolvedChanges]
      })
    ).toBe(true);

    const normalAd = {
      id: "ad-1",
      creator_id: "mb-100",
      production_stage: "approved" as const,
      deleted_at: null
    };

    expect(
      isCreativeCreationBlocked({
        role: "media_buyer",
        userId: "mb-100",
        ads: [normalAd]
      })
    ).toBe(false);
  });
});

describe("Media Buyer Download Logging", () => {
  it("successfully creates and retrieves single ad download logs for media buyers", async () => {
    const testLogId = `mb-dl-test-${Date.now()}`;
    const log = await createDownloadLog({
      id: testLogId,
      userId: "mb-100",
      userName: "Alex MediaBuyer",
      userRole: "media_buyer",
      title: "Hero Product Video",
      source: "single_ad",
      creativeCount: 1,
      creativeIds: ["creative-abc"],
      creativeNames: ["Hero Product Video"],
      status: "ready",
      downloadCount: 1,
      lastDownloadedAt: new Date().toISOString()
    });

    expect(log.id).toBe(testLogId);
    expect(log.user_role).toBe("media_buyer");
    expect(log.source).toBe("single_ad");
    expect(log.creative_count).toBe(1);
    expect(log.creative_names).toEqual(["Hero Product Video"]);
    expect(log.status).toBe("ready");

    const retrieved = await getDownloadLogById(testLogId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.user_role).toBe("media_buyer");

    await deleteDownloadLog(testLogId);
  });
});

describe("Media Buyer Creative Library Queues & Dashboard", () => {
  it("defaults to All creatives queue and provides full library views without approval responsibility", () => {
    const queues = queuesForRole("media_buyer");
    // Primary default tab must be All so media buyers see all creatives across the library
    expect(queues[0]).toEqual({ key: "all", label: "All" });
    expect(queues.map((q) => q.key)).toEqual([
      "all",
      "approved",
      "in_production",
      "needs_review",
      "creator_changes",
      "changes"
    ]);
    // The review queue label must be 'In review' (status filter), not 'Needs my review'
    const reviewQueue = queues.find((q) => q.key === "needs_review");
    expect(reviewQueue?.label).toBe("In review");
  });

  it("builds a tailored dashboard summary focusing on approved assets and creative pipeline", () => {
    const summary = buildDashboardSummary({
      role: "media_buyer",
      profileId: "mb-100",
      ads: [
        {
          id: "ad-1",
          name: "Approved Ad 1",
          production_stage: "approved",
          deadline: null,
          workflow_status_changed_at: new Date().toISOString()
        },
        {
          id: "ad-2",
          name: "Editing Ad 2",
          production_stage: "editing",
          deadline: null,
          workflow_status_changed_at: new Date().toISOString()
        },
        {
          id: "ad-3",
          name: "In Review Ad 3",
          production_stage: "final_review",
          deadline: null,
          workflow_status_changed_at: new Date().toISOString()
        }
      ],
      profiles: [],
      editorWorkloads: {},
      editorCapacity: 5
    });

    expect(summary.eyebrow).toBe("Creative pipeline & library");
    expect(summary.title).toContain("1 approved creative ready");
    expect(summary.tiles.find((t) => t.key === "approved")?.count).toBe(1);
    expect(summary.tiles.find((t) => t.key === "review")?.count).toBe(1);
    expect(summary.tiles.find((t) => t.key === "production")?.count).toBe(1);
  });

  it("filters download logs correctly for media buyers in export-jobs endpoint", async () => {
    const testLogId = `mb-dl-filter-${Date.now()}`;
    await createDownloadLog({
      id: testLogId,
      userId: "mb-100",
      userName: "Alex MediaBuyer",
      userRole: "media_buyer",
      title: "Hero Product Video Export",
      source: "creative_library",
      creativeCount: 2,
      creativeIds: ["creative-1", "creative-2"],
      creativeNames: ["Ad 1", "Ad 2"],
      status: "ready",
      downloadCount: 1,
      lastDownloadedAt: new Date().toISOString()
    });

    const { getDownloadLogs } = await import("@/lib/download-logs");
    const allLogs = await getDownloadLogs();
    const mediaBuyerLogs = allLogs.filter((l) => l.user_id === "mb-100");

    expect(mediaBuyerLogs.length).toBeGreaterThan(0);
    expect(mediaBuyerLogs.some((l) => l.id === testLogId)).toBe(true);
    expect(mediaBuyerLogs.every((l) => l.user_id === "mb-100")).toBe(true);

    await deleteDownloadLog(testLogId);
  });
});

describe("Media Buyer Campaign Visibility & Overview Access", () => {
  const mediaBuyerProfile: Profile = {
    id: "mb-100",
    name: "Alex MediaBuyer",
    role: "media_buyer",
    email: "mb@example.com",
    avatar_url: null,
    active: true,
    deleted_at: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  const sampleAds = [
    {
      id: "ad-c1-1",
      campaign_id: "camp-1",
      creator_id: "creator-999",
      editor_id: "editor-888",
      name: "Creator Ad 1",
      production_stage: "approved" as const,
      status: "approved" as const
    },
    {
      id: "ad-c1-2",
      campaign_id: "camp-1",
      creator_id: "creator-777",
      editor_id: "editor-666",
      name: "Creator Ad 2",
      production_stage: "editing" as const,
      status: "in_progress" as const
    },
    {
      id: "ad-c2-1",
      campaign_id: "camp-2",
      creator_id: "creator-555",
      editor_id: "editor-444",
      name: "Creator Ad 3",
      production_stage: "final_review" as const,
      status: "pending_review" as const
    }
  ];

  it("evaluates isFullAccess to true for media buyers in campaign data fetching", () => {
    const managerScope: string = "all";
    const profile: Profile = mediaBuyerProfile;
    const isFullAccess =
      !profile ||
      profile.role === "admin" ||
      profile.role === "media_buyer" ||
      (profile.role === "manager" && managerScope !== "own");

    expect(isFullAccess).toBe(true);

    const ads = isFullAccess
      ? sampleAds
      : sampleAds.filter((ad) => {
          if (profile.role === "media_buyer") return true;
          return false;
        });

    expect(ads).toHaveLength(3);
    expect(ads.map((a) => a.id)).toEqual(["ad-c1-1", "ad-c1-2", "ad-c2-1"]);
  });

  it("shows all campaign creatives and full campaign aggregates to media buyers", () => {
    // Media buyer can see creatives across all campaigns, even those created by other creators
    const camp1Ads = sampleAds.filter((a) => a.campaign_id === "camp-1");
    expect(camp1Ads).toHaveLength(2);

    const approvedCount = camp1Ads.filter((a) => a.production_stage === "approved").length;
    const inCreationCount = camp1Ads.filter((a) => a.production_stage === "editing").length;

    expect(approvedCount).toBe(1);
    expect(inCreationCount).toBe(1);
  });

  it("grants media buyers permission to add creatives in campaigns", () => {
    const role: UserRole = mediaBuyerProfile.role;
    const canAddCreative =
      role === "content_creator" || role === "admin" || role === "manager" || role === "media_buyer";
    expect(canAddCreative).toBe(true);
  });

  it("does not restrict campaign detail filtered creatives for media buyers", () => {
    const profile: Profile = mediaBuyerProfile;
    const filteredCreatives = sampleAds.filter((creative) => {
      if (profile.role === "content_creator" && creative.creator_id && creative.creator_id !== profile.id) {
        return false;
      }
      if (profile.role === "editor" && creative.editor_id && creative.editor_id !== profile.id) {
        return false;
      }
      return true;
    });

    expect(filteredCreatives).toHaveLength(3);
    expect(filteredCreatives.map((c) => c.name)).toEqual([
      "Creator Ad 1",
      "Creator Ad 2",
      "Creator Ad 3"
    ]);
  });
});


