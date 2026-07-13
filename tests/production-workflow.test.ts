import { describe, expect, it } from "vitest";
import {
  creatorEditableStages,
  creatorReviewTransition,
  finalReviewTransition,
  isFinalMediaVisible,
  legacyStatusForProductionStage,
  nextProductionStage,
  productionActionError,
  workflowWaitingLabel
} from "@/lib/production-workflow";
import type { Ad } from "@/lib/types";

const baseAd = {
  production_stage: "script_writing",
  creator_id: "creator-1",
  editor_id: "editor-1",
  script_text: "A finished script"
} as Ad;

describe("production workflow", () => {
  it("moves through the pre-edit production stages", () => {
    expect(nextProductionStage("mark_script_ready")).toBe("ready_to_shoot");
    expect(nextProductionStage("mark_shoot_complete")).toBe("shoot_complete");
    expect(nextProductionStage("share_raw_footage")).toBe("ready_for_edit");
    expect(nextProductionStage("start_editing")).toBe("editing");
  });

  it("requires the assigned creator and a script", () => {
    expect(productionActionError({ action: "mark_script_ready", ad: baseAd, role: "content_creator", userId: "creator-1" })).toBeNull();
    expect(productionActionError({ action: "mark_script_ready", ad: { ...baseAd, script_text: "" }, role: "content_creator", userId: "creator-1" })).toContain("Add the script");
    expect(productionActionError({ action: "mark_script_ready", ad: baseAd, role: "content_creator", userId: "other" })).toContain("assigned content creator");
  });

  it("requires an assigned editor and raw footage URL for handoff", () => {
    const shot = { ...baseAd, production_stage: "shoot_complete" as const };
    expect(productionActionError({ action: "share_raw_footage", ad: shot, role: "content_creator", userId: "creator-1", rawFootageUrl: "https://drive.google.com/folder" })).toBeNull();
    expect(productionActionError({ action: "share_raw_footage", ad: { ...shot, editor_id: null }, role: "content_creator", userId: "creator-1", rawFootageUrl: "https://drive.google.com/folder" })).toContain("Assign an editor");
  });

  it("locks creator editing after the handoff", () => {
    expect(creatorEditableStages).toEqual(["script_writing", "ready_to_shoot", "shoot_complete"]);
  });

  it("keeps creator approval pending until final review", () => {
    expect(creatorReviewTransition("approve")).toEqual({
      status: "pending_review",
      productionStage: "final_review",
      approvalStage: "admin_final"
    });
  });

  it("allows manager or admin approval to finalize from either review stage", () => {
    expect(finalReviewTransition("approve")).toEqual({
      status: "approved",
      productionStage: "approved",
      approvalStage: "complete"
    });
    expect(finalReviewTransition("request_changes")).toEqual({
      status: "changes_requested",
      productionStage: "changes_requested",
      approvalStage: "manager_review"
    });
  });

  it("keeps the legacy analytics status synchronized", () => {
    expect(legacyStatusForProductionStage("shoot_complete")).toBe("draft");
    expect(legacyStatusForProductionStage("creator_review")).toBe("pending_review");
    expect(legacyStatusForProductionStage("changes_requested")).toBe("changes_requested");
    expect(legacyStatusForProductionStage("approved")).toBe("approved");
  });

  it("reports time waiting in the current workflow status", () => {
    const now = new Date("2026-07-10T12:00:00.000Z").getTime();
    expect(workflowWaitingLabel("2026-07-10T11:45:00.000Z", now)).toBe("Just updated");
    expect(workflowWaitingLabel("2026-07-10T04:00:00.000Z", now)).toBe("Waiting 8h");
    expect(workflowWaitingLabel("2026-07-08T12:00:00.000Z", now)).toBe("Waiting 2d");
  });

  it("keeps final media hidden until editing starts", () => {
    expect(isFinalMediaVisible("script_writing")).toBe(false);
    expect(isFinalMediaVisible("ready_for_edit")).toBe(false);
    expect(isFinalMediaVisible("editing")).toBe(true);
    expect(isFinalMediaVisible("creator_review")).toBe(true);
    expect(isFinalMediaVisible("approved")).toBe(true);
  });
});
