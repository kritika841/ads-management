import { describe, expect, it } from "vitest";
import { buildDashboardSummary } from "@/lib/dashboard-summary";
import type { AdWithRelations, ProductionStage, Profile } from "@/lib/types";

const profiles: Profile[] = [
  profile("creator", "Creator", "content_creator"),
  profile("editor-a", "Editor A", "editor"),
  profile("editor-b", "Editor B", "editor")
];

describe("role dashboard summary", () => {
  it("builds manager action tiles and editor capacity", () => {
    const model = buildDashboardSummary({
      role: "manager",
      ads: [ad("review", "creator_review"), ad("assign", "shoot_complete"), ad("changes", "changes_requested")],
      profiles,
      editorWorkloads: { "editor-a": 3, "editor-b": 1 },
      editorCapacity: 4,
      now: new Date("2026-07-13T06:30:00.000Z")
    });

    expect(model.kind).toBe("reviewer");
    expect(model.tiles.map((tile) => [tile.label, tile.count, tile.queue])).toEqual([
      ["Need review", 1, "needs_review"],
      ["Need an editor", 1, "pending_editor_assign"],
      ["Changes in progress", 1, "changes"],
      ["Overdue", 0, null]
    ]);
    expect(model.workloads.map((row) => [row.name, row.active, row.capacity])).toEqual([
      ["Editor A", 3, 4],
      ["Editor B", 1, 4]
    ]);
  });

  it("shows creator preparation, handoff, review, and production totals", () => {
    const model = buildDashboardSummary({
      role: "content_creator",
      ads: [ad("script", "script_writing"), ad("shoot", "ready_to_shoot"), ad("assign", "shoot_complete"), ad("editing", "editing"), ad("review", "creator_review"), ad("final", "final_review"), ad("approved", "approved")],
      profiles,
      editorWorkloads: {},
      editorCapacity: 4,
      now: new Date("2026-07-13T06:30:00.000Z")
    });

    expect(model.kind).toBe("creator");
    expect(model.tiles.map((tile) => tile.count)).toEqual([2, 1, 1, 0]);
    expect(model.production).toEqual([
      { label: "Preparing", count: 3 },
      { label: "With editor", count: 1 },
      { label: "Awaiting final approval", count: 1 },
      { label: "Approved", count: 1 }
    ]);
  });

  it("shows only actionable editor stages and configured capacity", () => {
    const model = buildDashboardSummary({
      role: "editor",
      ads: [ad("new", "ready_for_edit"), ad("editing", "editing"), ad("changes", "changes_requested"), ad("submitted", "creator_review"), ad("approved", "approved")],
      profiles,
      editorWorkloads: { "editor-a": 3 },
      editorCapacity: 5,
      now: new Date("2026-07-13T06:30:00.000Z")
    });

    expect(model.tiles.map((tile) => [tile.label, tile.count, tile.queue])).toEqual([
      ["New assignments", 1, "new_assignments"],
      ["Editing now", 1, "editing"],
      ["Changes requested", 1, "changes"],
      ["Due soon or late", 0, null]
    ]);
    expect(model.production).toContainEqual({ label: "Active workload", count: 3 });
    expect(model.production).toContainEqual({ label: "Available capacity", count: 2 });
    expect(model.priorities.map((item) => item.id).sort()).toEqual(["changes", "editing", "new"]);
  });

  it("uses India dates and orders overdue, changes, upcoming deadlines, then old work", () => {
    const now = new Date("2026-07-12T20:00:00.000Z"); // 13 July in India
    const model = buildDashboardSummary({
      role: "manager",
      ads: [
        ad("old", "editing", { deadline: null, workflow_status_changed_at: "2026-07-10T00:00:00.000Z" }),
        ad("soon", "editing", { deadline: "2026-07-15" }),
        ad("changes", "changes_requested", { deadline: null }),
        ad("late", "editing", { deadline: "2026-07-12" }),
        ad("today", "editing", { deadline: "2026-07-13" })
      ],
      profiles,
      editorWorkloads: {},
      editorCapacity: 4,
      now
    });

    expect(model.tiles.find((tile) => tile.key === "overdue")?.count).toBe(1);
    expect(model.priorities.map((item) => item.id)).toEqual(["late", "changes", "today", "soon", "old"]);
    expect(model.priorities.map((item) => item.deadlineState)).toEqual(["overdue", "none", "today", "soon", "none"]);
  });
});

function profile(id: string, name: string, role: Profile["role"]): Profile {
  return { id, name, email: `${id}@example.com`, role, avatar_url: null, active: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
}

function ad(id: string, productionStage: ProductionStage, overrides: Partial<AdWithRelations> = {}): AdWithRelations {
  return {
    id, name: id, campaign_id: "campaign", product_id: "product", creator_id: "creator", editor_id: "editor-a", status: productionStage === "approved" ? "approved" : productionStage === "changes_requested" ? "changes_requested" : productionStage === "creator_review" || productionStage === "final_review" ? "pending_review" : "draft", approval_stage: "manager_review",
    drive_url: null, drive_file_id: null, preview_url: null, thumbnail_url: null, script_html: "<p>Script</p>", script_text: "Script", ad_type: "video", platforms: [], deadline: null, notes: null, live_url: null, submitted_at: null, approved_at: null, published_at: null,
    production_stage: productionStage, raw_footage_url: null, script_ready_at: null, shoot_completed_at: null, raw_footage_shared_at: null, editing_started_at: null, creator_reviewed_at: null, final_approved_at: null, workflow_status_changed_at: "2026-07-13T00:00:00.000Z", editor_notes: null, updated_at: "2026-07-13T00:00:00.000Z", created_at: "2026-07-01T00:00:00.000Z",
    creator: { id: "creator", name: "Creator", email: "creator@example.com", avatar_url: null, role: "content_creator" }, editor: { id: "editor-a", name: "Editor A", email: "editor-a@example.com", avatar_url: null, role: "editor" }, campaign: { id: "campaign", name: "Campaign" }, product: { id: "product", name: "Product", sku: null, image_url: null }, tags: [],
    ...overrides
  };
}
