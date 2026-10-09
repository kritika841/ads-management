import { describe, expect, it } from "vitest";
import {
  emptyDashboardFilters,
  readDashboardFilters,
  writeDashboardFilters,
  type DashboardFilterState
} from "@/lib/dashboard-filter-state";
import { parseLibraryReviewTab } from "@/lib/library-tab-state";
import { queueForRole, matchesQueue } from "@/lib/work-queues";
import type { ProductionStage, UserRole } from "@/lib/types";

describe("Creative Library Refresh & Filter Persistence", () => {
  it("preserves active filters including dateFrom and dateTo across URL serialization", () => {
    const activeFilters: DashboardFilterState = {
      ...emptyDashboardFilters,
      stage: ["approved", "editing"],
      editor: ["ed-1"],
      creator: ["cr-1"],
      campaign: ["camp-1"],
      product: ["prod-1"],
      platform: ["Meta Ads"],
      tag: ["hook"],
      download: ["downloaded"],
      deadline: ["soon"],
      sort: "waiting",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-07",
      view: "grid"
    };

    const baseUrl = new URL("https://adflow.test/library?queue=approved");
    const serializedUrl = writeDashboardFilters(baseUrl, activeFilters);

    // Queue query parameter is preserved
    expect(serializedUrl.searchParams.get("queue")).toBe("approved");

    // All filters are serialized into URL
    expect(serializedUrl.searchParams.get("stage")).toBe("approved,editing");
    expect(serializedUrl.searchParams.get("editor")).toBe("ed-1");
    expect(serializedUrl.searchParams.get("creator")).toBe("cr-1");
    expect(serializedUrl.searchParams.get("campaign")).toBe("camp-1");
    expect(serializedUrl.searchParams.get("product")).toBe("prod-1");
    expect(serializedUrl.searchParams.get("platform")).toBe("Meta Ads");
    expect(serializedUrl.searchParams.get("tag")).toBe("hook");
    expect(serializedUrl.searchParams.get("download")).toBe("downloaded");
    expect(serializedUrl.searchParams.get("deadline")).toBe("soon");
    expect(serializedUrl.searchParams.get("sort")).toBe("waiting");
    expect(serializedUrl.searchParams.get("dateFrom")).toBe("2026-10-01");
    expect(serializedUrl.searchParams.get("dateTo")).toBe("2026-10-07");

    // Re-reading from the search string restores the exact same filter state
    const restored = readDashboardFilters(serializedUrl.search);
    expect(restored).toEqual(activeFilters);
  });

  it("preserves queue tab across different roles on refresh", () => {
    // Admin and Manager can access the approved queue
    expect(queueForRole("admin", "approved")).toBe("approved");
    expect(queueForRole("manager", "approved")).toBe("approved");
    expect(queueForRole("content_creator", "approved")).toBe("approved");
    expect(queueForRole("editor", "approved")).toBe("approved");

    // Manager queues
    expect(queueForRole("manager", "creator_changes")).toBe("creator_changes");
    expect(queueForRole("manager", "changes")).toBe("changes");
    expect(queueForRole("manager", "pending_editor_assign")).toBe("pending_editor_assign");

    // Editor queues
    expect(queueForRole("editor", "new_assignments")).toBe("new_assignments");
    expect(queueForRole("editor", "editing")).toBe("editing");
  });

  it("handles review sub-tabs parsing and validation", () => {
    expect(parseLibraryReviewTab("all")).toBe("all");
    expect(parseLibraryReviewTab("new")).toBe("new");
    expect(parseLibraryReviewTab("editor")).toBe("editor");
    expect(parseLibraryReviewTab("creator")).toBe("creator");
    expect(parseLibraryReviewTab("invalid")).toBeNull();
  });
});

describe("Approved Creative Reopen & Revision Target", () => {
  it("correctly identifies approved creatives matching the approved queue", () => {
    expect(matchesQueue({ production_stage: "approved" as ProductionStage }, "approved")).toBe(true);
    expect(matchesQueue({ production_stage: "editing" as ProductionStage }, "approved")).toBe(false);
  });

  it("determines allowed roles for reopening approved creatives", () => {
    function canReopenApproved(role: UserRole): boolean {
      return role === "admin" || role === "manager";
    }

    expect(canReopenApproved("admin")).toBe(true);
    expect(canReopenApproved("manager")).toBe(true);
    expect(canReopenApproved("editor")).toBe(false);
    expect(canReopenApproved("content_creator")).toBe(false);
  });

  it("routes reopened target correctly to creator or editor stage", () => {
    function getReopenStage(target: "creator" | "editor"): ProductionStage {
      return target === "creator" ? "creator_changes_requested" : "changes_requested";
    }

    expect(getReopenStage("creator")).toBe("creator_changes_requested");
    expect(getReopenStage("editor")).toBe("changes_requested");

    // Once reopened, creative lands in the corresponding change queue
    expect(matchesQueue({ production_stage: "creator_changes_requested" as ProductionStage }, "creator_changes")).toBe(true);
    expect(matchesQueue({ production_stage: "changes_requested" as ProductionStage }, "changes")).toBe(true);
  });

  it("determines default revision target from assigned editor", () => {
    function getDefaultRevisionTarget(ad: { editor_id: string | null }): "creator" | "editor" {
      return ad.editor_id ? "editor" : "creator";
    }

    expect(getDefaultRevisionTarget({ editor_id: "ed-123" })).toBe("editor");
    expect(getDefaultRevisionTarget({ editor_id: null })).toBe("creator");
  });
});
