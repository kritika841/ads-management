import { describe, expect, it } from "vitest";
import { approvalRate, averageApprovalHours, buildOperationalAnalytics, groupAdsByWeek, resolveAnalyticsFilters } from "@/lib/analytics";
import type { ActivityLog, AdWithRelations, AppSettings, Profile, ReviewAction } from "@/lib/types";

const settings: AppSettings = {
  id: 1,
  two_step_approval: false,
  email_notifications: false,
  deadline_reminder_days: 2,
  max_concurrent_edits: 4,
  assignment_start_sla_hours: 12,
  editing_sla_hours: 48,
  creator_review_sla_hours: 24,
  final_review_sla_hours: 24,
  revision_sla_hours: 24,
  updated_at: "2026-07-01T00:00:00.000Z"
};

const profiles: Profile[] = [
  { id: "creator", name: "Creator", email: "creator@example.com", role: "content_creator", avatar_url: null, active: true, deleted_at: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  { id: "editor", name: "Editor", email: "editor@example.com", role: "editor", avatar_url: null, active: true, deleted_at: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }
];

function ad(overrides: Partial<AdWithRelations> = {}): AdWithRelations {
  return {
    id: "ad-1", name: "Creative", campaign_id: "campaign", product_id: "product", creator_id: "creator", editor_id: "editor",
    status: "pending_review", approval_stage: "manager_review", drive_url: null, drive_file_id: null, preview_url: null, thumbnail_url: null,
    script_html: "<p>Script</p>", script_text: "Script", ad_type: "video", platforms: ["Meta Ads"], deadline: "2026-07-12", notes: null,
    live_url: null, submitted_at: null, approved_at: null, published_at: null, production_stage: "editing", raw_footage_url: "https://drive.google.com/folder",
    script_ready_at: null, shoot_completed_at: null, raw_footage_shared_at: "2026-07-05T00:00:00.000Z", editing_started_at: "2026-07-05T06:00:00.000Z",
    creator_reviewed_at: null, final_approved_at: null, workflow_status_changed_at: "2026-07-05T06:00:00.000Z", editor_notes: null,
    updated_at: "2026-07-05T06:00:00.000Z", created_at: "2026-07-04T00:00:00.000Z",
    creator: { id: "creator", name: "Creator", email: "creator@example.com", avatar_url: null, role: "content_creator" },
    editor: { id: "editor", name: "Editor", email: "editor@example.com", avatar_url: null, role: "editor" },
    campaign: { id: "campaign", name: "Campaign" }, product: { id: "product", name: "Product", sku: null, image_url: null }, tags: [], version_count: 1,
    ...overrides
  };
}

function activity(adId: string, stage: AdWithRelations["production_stage"], createdAt: string, id = `${adId}-${stage}-${createdAt}`): ActivityLog {
  return { id, ad_id: adId, actor_id: null, action: "workflow_transition", metadata: { production_stage: stage }, created_at: createdAt };
}

describe("analytics helpers", () => {
  it("calculates average approval time", () => {
    expect(
      averageApprovalHours([
        {
          submitted_at: "2026-01-01T00:00:00.000Z",
          approved_at: "2026-01-02T00:00:00.000Z"
        },
        {
          submitted_at: "2026-01-01T00:00:00.000Z",
          approved_at: "2026-01-01T12:00:00.000Z"
        }
      ])
    ).toBe(18);
  });

  it("returns a rounded approval rate", () => {
    expect(approvalRate(2, 3)).toBe(67);
    expect(approvalRate(0, 0)).toBe(0);
  });

  it("groups volume by week", () => {
    const data = groupAdsByWeek([
      { created_at: "2026-07-01T00:00:00.000Z", status: "approved" },
      { created_at: "2026-07-02T00:00:00.000Z", status: "rejected" }
    ]);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ submitted: 2, approved: 1, rejected: 1 });
  });

  it("resolves IST date boundaries and an equal previous period", () => {
    const filters = resolveAnalyticsFilters({ range: "7d" }, new Date("2026-07-10T20:00:00.000Z"));
    expect(filters.from).toBe("2026-07-05");
    expect(filters.to).toBe("2026-07-11");
    expect(new Date(filters.fromMs).toISOString()).toBe("2026-07-04T18:30:00.000Z");
    expect(filters.previousToMs).toBe(filters.fromMs - 1);
    expect(filters.fromMs - filters.previousFromMs).toBe(filters.toMs - filters.fromMs + 1);
  });

  it("keeps live WIP separate from period-completed metrics", () => {
    const filters = resolveAnalyticsFilters({ range: "7d" }, new Date("2026-07-11T06:30:00.000Z"));
    const model = buildOperationalAnalytics({ ads: [ad()], profiles, activities: [], reviews: [], settings, filters, now: new Date("2026-07-11T06:30:00.000Z") });
    expect(model.kpis.approved.value).toBe(0);
    expect(model.kpis.workInProgress.value).toBe(1);
    expect(model.liveWip).toEqual(expect.arrayContaining([expect.objectContaining({ stage: "editing", count: 1, breached: 1 })]));
  });

  it("calculates cycle time, stage SLA, and first-pass approval from workflow events", () => {
    const approved = ad({ id: "approved", production_stage: "approved", status: "approved", submitted_at: "2026-07-06T12:00:00.000Z", creator_reviewed_at: "2026-07-06T18:00:00.000Z", final_approved_at: "2026-07-07T00:00:00.000Z", approved_at: "2026-07-07T00:00:00.000Z", workflow_status_changed_at: "2026-07-07T00:00:00.000Z", created_at: "2026-07-04T00:00:00.000Z", version_count: 1 });
    const activities = [
      activity("approved", "script_writing", "2026-07-04T00:00:00.000Z"),
      activity("approved", "ready_for_edit", "2026-07-05T00:00:00.000Z"),
      activity("approved", "editing", "2026-07-05T06:00:00.000Z"),
      activity("approved", "creator_review", "2026-07-06T12:00:00.000Z"),
      activity("approved", "final_review", "2026-07-06T18:00:00.000Z"),
      activity("approved", "approved", "2026-07-07T00:00:00.000Z")
    ];
    const filters = resolveAnalyticsFilters({ range: "7d" }, new Date("2026-07-11T06:30:00.000Z"));
    const model = buildOperationalAnalytics({ ads: [approved], profiles, activities, reviews: [], settings, filters, now: new Date("2026-07-11T06:30:00.000Z") });
    expect(model.kpis.approved.value).toBe(1);
    expect(model.kpis.cycleHours.value).toBe(72);
    expect(model.kpis.firstPassRate.value).toBe(100);
    expect(model.kpis.slaCompliance).toMatchObject({ value: 100, sample: 4 });
    expect(model.stageTurnaround.find((row) => row.stage === "editing")).toMatchObject({ medianHours: 30, sample: 1, compliance: 100 });
  });

  it("counts repeated change-request loops as rework", () => {
    const revised = ad({ id: "revised", production_stage: "approved", status: "approved", submitted_at: "2026-07-06T00:00:00.000Z", final_approved_at: "2026-07-09T00:00:00.000Z", approved_at: "2026-07-09T00:00:00.000Z", workflow_status_changed_at: "2026-07-09T00:00:00.000Z", version_count: 3 });
    const activities = [
      activity("revised", "creator_review", "2026-07-06T00:00:00.000Z"),
      activity("revised", "changes_requested", "2026-07-06T06:00:00.000Z"),
      activity("revised", "editing", "2026-07-07T06:00:00.000Z"),
      activity("revised", "creator_review", "2026-07-08T00:00:00.000Z", "second-review"),
      activity("revised", "final_review", "2026-07-08T12:00:00.000Z"),
      activity("revised", "approved", "2026-07-09T00:00:00.000Z")
    ];
    const reviews: ReviewAction[] = [{ id: "review", ad_id: "revised", reviewer_id: "creator", decision: "request_changes", note: "Tighten the opening", created_at: "2026-07-06T06:00:00.000Z" }];
    const filters = resolveAnalyticsFilters({ range: "7d" }, new Date("2026-07-11T06:30:00.000Z"));
    const model = buildOperationalAnalytics({ ads: [revised], profiles, activities, reviews, settings, filters, now: new Date("2026-07-11T06:30:00.000Z") });
    expect(model.kpis.reworkRate).toMatchObject({ value: 100, sample: 1 });
    expect(model.kpis.firstPassRate.value).toBe(0);
    expect(model.stageTurnaround.find((row) => row.stage === "changes_requested")).toMatchObject({ medianHours: 24, sample: 1, compliance: 100 });
    expect(model.stageTurnaround.find((row) => row.stage === "ready_for_edit")).toMatchObject({ medianHours: 24, sample: 1, compliance: 0 });
  });

  it("excludes an unverifiable negative legacy cycle from the sample", () => {
    const legacy = ad({ id: "legacy", production_stage: "approved", status: "approved", created_at: "2026-07-10T00:00:00.000Z", approved_at: "2026-07-09T00:00:00.000Z", final_approved_at: null, workflow_status_changed_at: "2026-07-09T00:00:00.000Z" });
    const filters = resolveAnalyticsFilters({ range: "7d" }, new Date("2026-07-11T06:30:00.000Z"));
    const model = buildOperationalAnalytics({ ads: [legacy], profiles, activities: [], reviews: [], settings, filters, now: new Date("2026-07-11T06:30:00.000Z") });
    expect(model.kpis.approved).toMatchObject({ value: 1, sample: 1 });
    expect(model.kpis.cycleHours).toMatchObject({ value: null, sample: 0 });
  });

  it("accepts the standardized new_stage activity metadata", () => {
    const assigned = ad({ id: "new-metadata", production_stage: "editing", raw_footage_shared_at: null, editing_started_at: null });
    const activities: ActivityLog[] = [
      { id: "assigned", ad_id: assigned.id, actor_id: "creator", action: "assigned", metadata: { previous_stage: "shoot_complete", new_stage: "ready_for_edit" }, created_at: "2026-07-08T00:00:00.000Z" },
      { id: "started", ad_id: assigned.id, actor_id: "editor", action: "editing_started", metadata: { previous_stage: "ready_for_edit", new_stage: "editing" }, created_at: "2026-07-08T06:00:00.000Z" }
    ];
    const filters = resolveAnalyticsFilters({ range: "7d" }, new Date("2026-07-11T06:30:00.000Z"));
    const model = buildOperationalAnalytics({ ads: [assigned], profiles, activities, reviews: [], settings, filters, now: new Date("2026-07-11T06:30:00.000Z") });
    expect(model.stageTurnaround.find((row) => row.stage === "ready_for_edit")).toMatchObject({ medianHours: 6, sample: 1, compliance: 100 });
  });
});
