import { describe, expect, it } from "vitest";
import { matchesQueue, queueForRole, queuesForRole } from "@/lib/work-queues";
import type { ProductionStage } from "@/lib/types";

const item = (production_stage: ProductionStage) => ({ production_stage });

describe("role work queues", () => {
  it("groups creator work by preparation, handoff, and review ownership", () => {
    expect(queuesForRole("content_creator").map((queue) => queue.label)).toEqual([
      "Preparing",
      "Pending editor assign",
      "With editor",
      "Needs my review",
      "Awaiting final",
      "Approved"
    ]);
    expect(matchesQueue(item("ready_to_shoot"), "preparing")).toBe(true);
    expect(matchesQueue(item("shoot_complete"), "preparing")).toBe(false);
    expect(matchesQueue(item("shoot_complete"), "pending_editor_assign")).toBe(true);
    expect(matchesQueue(item("editing"), "with_editor")).toBe(true);
    expect(matchesQueue(item("creator_review"), "creator_review")).toBe(true);
  });

  it("separates editor assignments, active edits, changes, and submitted work", () => {
    expect(matchesQueue(item("ready_for_edit"), "new_assignments")).toBe(true);
    expect(matchesQueue(item("editing"), "editing")).toBe(true);
    expect(matchesQueue(item("changes_requested"), "changes")).toBe(true);
    expect(matchesQueue(item("creator_review"), "submitted")).toBe(true);
    expect(matchesQueue(item("final_review"), "submitted")).toBe(true);
  });

  it("gives reviewers a final-review queue and a production overview", () => {
    expect(matchesQueue(item("creator_review"), "needs_review")).toBe(true);
    expect(matchesQueue(item("final_review"), "needs_review")).toBe(true);
    expect(matchesQueue(item("ready_for_edit"), "in_production")).toBe(true);
    expect(matchesQueue(item("changes_requested"), "in_production")).toBe(false);
    expect(matchesQueue(item("approved"), "approved")).toBe(true);
  });

  it("accepts only queue parameters available to the current role", () => {
    expect(queueForRole("editor", "new_assignments")).toBe("new_assignments");
    expect(queueForRole("editor", "needs_review")).toBeNull();
    expect(queueForRole("manager", "needs_review")).toBe("needs_review");
    expect(queueForRole("content_creator", "unknown")).toBeNull();
  });
});
