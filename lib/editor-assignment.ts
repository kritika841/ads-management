import type { ProductionStage } from "@/lib/types";

/**
 * Pure planning for (bulk) editor assignment from the Creative Library. Shared by the server
 * action (authoritative) and the bulk modal (live preview of what will happen to each creative).
 *
 *  - assign mode, creative waiting for an editor (shoot_complete)        → "assign"
 *  - assign mode, creative already with a different editor (editing work) → "reassign"
 *  - unassign mode, creative with an editor that hasn't been submitted    → "unassign"
 *  - anything else                                                        → "skip" + reason
 */
export type EditorAssignmentMode = "assign" | "unassign";
export type EditorAssignmentKind = "assign" | "reassign" | "unassign" | "skip";

/** Stages where the editor can still be changed or removed (editing not yet submitted). */
export const reassignableEditorStages = ["ready_for_edit", "editing", "changes_requested"] as const satisfies readonly ProductionStage[];

export type EditorAssignmentTarget = {
  production_stage: ProductionStage;
  editor_id: string | null;
  deadline: string | null;
};

export type EditorAssignmentPlan = {
  kind: EditorAssignmentKind;
  /** Deadline that will be stored (assign / reassign only). */
  deadline?: string;
  /** Why the creative is skipped. */
  reason?: string;
};

function isReassignable(stage: ProductionStage) {
  return (reassignableEditorStages as readonly string[]).includes(stage);
}

function notReadyReason(stage: ProductionStage) {
  if (stage === "script_writing" || stage === "ready_to_shoot") return "Not shot yet — an editor can be assigned once the shoot is complete.";
  return "Editing is already submitted — the editor can no longer be changed.";
}

export function planEditorAssignment(
  ad: EditorAssignmentTarget,
  mode: EditorAssignmentMode,
  options: { editorId?: string | null; deadline?: string | null } = {}
): EditorAssignmentPlan {
  if (mode === "unassign") {
    if (isReassignable(ad.production_stage) && ad.editor_id) return { kind: "unassign" };
    if (ad.production_stage === "shoot_complete" || !ad.editor_id) return { kind: "skip", reason: "No editor is assigned." };
    return { kind: "skip", reason: notReadyReason(ad.production_stage) };
  }

  const editorId = options.editorId?.trim();
  if (!editorId) return { kind: "skip", reason: "Choose an editor." };

  const isWaiting = ad.production_stage === "shoot_complete";
  const isReassign = isReassignable(ad.production_stage);
  if (!isWaiting && !isReassign) return { kind: "skip", reason: notReadyReason(ad.production_stage) };
  if (isReassign && ad.editor_id === editorId) return { kind: "skip", reason: "Already assigned to this editor." };

  const deadline = options.deadline?.trim() || ad.deadline || "";
  if (!deadline) return { kind: "skip", reason: "Needs a deadline — choose one to apply." };

  return { kind: isReassign && ad.editor_id ? "reassign" : "assign", deadline };
}

export function summarizeEditorAssignmentPlans(plans: EditorAssignmentPlan[]) {
  return plans.reduce(
    (summary, plan) => ({ ...summary, [plan.kind]: summary[plan.kind] + 1 }),
    { assign: 0, reassign: 0, unassign: 0, skip: 0 } as Record<EditorAssignmentKind, number>
  );
}
