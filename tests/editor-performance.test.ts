import { describe, expect, it } from "vitest";
import { computeEditorStats } from "@/lib/editor-performance";
import type { ActivityLog, AdWithRelations, EditorTimeLog, Profile } from "@/lib/types";

function editor(id: string): Profile {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    role: "editor",
    avatar_url: null,
    active: true,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z"
  };
}

function ad(overrides: Partial<AdWithRelations>): AdWithRelations {
  return {
    id: "ad-1",
    name: "Ad",
    campaign_id: "campaign",
    product_id: "product",
    creator_id: "creator",
    editor_id: "editor",
    status: "pending_review",
    approval_stage: "manager_review",
    drive_url: null,
    drive_file_id: null,
    preview_url: null,
    thumbnail_url: null,
    script_html: null,
    script_text: null,
    ad_type: "video",
    platforms: [],
    deadline: null,
    notes: null,
    live_url: null,
    submitted_at: null,
    approved_at: null,
    published_at: null,
    production_stage: "editing",
    raw_footage_url: null,
    script_ready_at: null,
    shoot_completed_at: null,
    raw_footage_shared_at: null,
    assigned_at: null,
    editing_started_at: null,
    creator_reviewed_at: null,
    final_approved_at: null,
    workflow_status_changed_at: "2026-07-10T00:00:00.000Z",
    editor_notes: null,
    updated_at: "2026-07-10T00:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
    creator: { id: "creator", name: "Creator", email: "creator@example.com", avatar_url: null, role: "content_creator" },
    editor: { id: "editor", name: "Editor", email: "editor@example.com", avatar_url: null, role: "editor" },
    campaign: { id: "campaign", name: "Campaign" },
    product: { id: "product", name: "Product", sku: null, image_url: null },
    tags: [],
    version_count: 1,
    ...overrides
  };
}

describe("editor performance", () => {
  it("uses activity-log events to split in-period work from backlog", () => {
    const stats = computeEditorStats(
      [editor("editor")],
      [
        ad({ id: "in-period", assigned_at: null, editing_started_at: null, final_approved_at: null, approved_at: null }),
        ad({ id: "backlog", assigned_at: null, editing_started_at: null, final_approved_at: null, approved_at: null })
      ],
      [
        { id: "t1", ad_id: "in-period", editor_id: "editor", session_started_at: "2026-07-11T02:00:00.000Z", session_ended_at: "2026-07-11T03:00:00.000Z", pause_reason: null, is_active: false, created_at: "2026-07-11T02:00:00.000Z" },
        { id: "t2", ad_id: "backlog", editor_id: "editor", session_started_at: "2026-07-11T03:00:00.000Z", session_ended_at: "2026-07-11T04:00:00.000Z", pause_reason: null, is_active: false, created_at: "2026-07-11T03:00:00.000Z" }
      ] as EditorTimeLog[],
      [
        { id: "assign-1", ad_id: "in-period", actor_id: "creator", action: "editor_assigned", metadata: { production_stage: "ready_for_edit" }, created_at: "2026-07-11T01:00:00.000Z" },
        { id: "start-1", ad_id: "in-period", actor_id: "editor", action: "editing_started", metadata: { previous_stage: "ready_for_edit", production_stage: "editing" }, created_at: "2026-07-11T02:00:00.000Z" },
        { id: "approve-1", ad_id: "in-period", actor_id: "manager", action: "final_approval_granted", metadata: { previous_stage: "final_review", production_stage: "approved" }, created_at: "2026-07-11T05:00:00.000Z" },
        { id: "assign-2", ad_id: "backlog", actor_id: "creator", action: "editor_assigned", metadata: { production_stage: "ready_for_edit" }, created_at: "2026-07-08T02:00:00.000Z" },
        { id: "start-2", ad_id: "backlog", actor_id: "editor", action: "editing_started", metadata: { previous_stage: "ready_for_edit", production_stage: "editing" }, created_at: "2026-07-11T03:00:00.000Z" },
        { id: "approve-2", ad_id: "backlog", actor_id: "manager", action: "final_approval_granted", metadata: { previous_stage: "final_review", production_stage: "approved" }, created_at: "2026-07-11T06:00:00.000Z" }
      ] as ActivityLog[],
      new Date("2026-07-11T00:00:00.000Z"),
      new Date("2026-07-11T23:59:59.999Z")
    );

    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      started: 2,
      startedInPeriod: 1,
      startedBacklog: 1,
      completed: 2,
      completedInPeriod: 1,
      completedBacklog: 1
    });
  });
});