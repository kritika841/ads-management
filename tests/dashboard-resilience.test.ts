import { describe, expect, it } from "vitest";
import { buildDashboardSummary, type DashboardSummaryAd } from "@/lib/dashboard-summary";
import type { Profile } from "@/lib/types";

const mockProfiles: Profile[] = [
  {
    id: "editor-1",
    name: "Alex Rivera",
    email: "alex@example.com",
    role: "editor",
    avatar_url: null,
    active: true,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z"
  }
];

describe("Dashboard resilience and lightweight model", () => {
  it("builds summary gracefully when ads list is empty", () => {
    const model = buildDashboardSummary({
      role: "admin",
      ads: [],
      profiles: mockProfiles,
      editorWorkloads: {},
      editorCapacity: 5
    });

    expect(model.kind).toBe("reviewer");
    expect(model.tiles).toBeDefined();
    expect(model.tiles.length).toBe(4);
    expect(model.priorities).toEqual([]);
    expect(model.title).toBe("The team review queue is clear");
  });

  it("handles lightweight DashboardSummaryAd rows without relation bloat", () => {
    const lightAds: DashboardSummaryAd[] = [
      {
        id: "ad-1",
        name: "Serum Promo V1",
        production_stage: "creator_review",
        deadline: "2026-09-25",
        workflow_status_changed_at: new Date().toISOString(),
        campaign: { name: "Fall Campaign" }
      },
      {
        id: "ad-2",
        name: "Cleanser Hook 2",
        production_stage: "approved",
        deadline: null,
        workflow_status_changed_at: new Date().toISOString()
      }
    ];

    const model = buildDashboardSummary({
      role: "manager",
      ads: lightAds,
      profiles: mockProfiles,
      editorWorkloads: { "editor-1": 1 },
      editorCapacity: 5
    });

    expect(model.kind).toBe("reviewer");
    expect(model.tiles.find((t) => t.key === "review")?.count).toBe(1);
    expect(model.priorities.length).toBe(1);
    expect(model.priorities[0].name).toBe("Serum Promo V1");
    expect(model.priorities[0].campaign).toBe("Fall Campaign");
  });

  it("handles secondary analytics failures (empty timeline and average times) without breaking reviewer view", () => {
    const lightAds: DashboardSummaryAd[] = [
      {
        id: "ad-1",
        name: "Promo Video",
        production_stage: "shoot_complete",
        deadline: null,
        workflow_status_changed_at: new Date().toISOString()
      }
    ];

    const model = buildDashboardSummary({
      role: "admin",
      ads: lightAds,
      profiles: mockProfiles,
      editorWorkloads: { "editor-1": 2 },
      editorCapacity: 5,
      timelineData: [], // Fallback empty timeline
      editorAverageEditTimes: {} // Fallback empty averages
    });

    expect(model.workloads[0].name).toBe("Alex Rivera");
    expect(model.workloads[0].active).toBe(2);
    expect(model.workloads[0].avgSecondsPerVideo).toBeUndefined();
    expect(model.timeline).toEqual([]);
  });
});
