import type { Ad, AdStatus, ApprovalStage, ProductionStage, UserRole } from "@/lib/types";

export const activeEditorStages = [
  "ready_for_edit",
  "editing",
  "changes_requested"
] as const satisfies readonly ProductionStage[];

export const inProgressEditingStages = [
  "editing",
  "changes_requested"
] as const satisfies readonly ProductionStage[];

export type ProductionAction =
  | "mark_script_ready"
  | "mark_shoot_complete"
  | "share_raw_footage"
  | "start_editing";

export const productionStages: ProductionStage[] = [
  "script_writing",
  "ready_to_shoot",
  "shoot_complete",
  "ready_for_edit",
  "editing",
  "creator_review",
  "final_review",
  "changes_requested",
  "approved"
];

export const productionStageLabels: Record<ProductionStage, string> = {
  script_writing: "Script in progress",
  ready_to_shoot: "Ready to shoot",
  shoot_complete: "Shoot complete",
  ready_for_edit: "Ready for editing",
  editing: "Editing",
  creator_review: "Creator review",
  final_review: "Final review",
  changes_requested: "Changes requested",
  approved: "Approved"
};

export const productionStageShortLabels: Record<ProductionStage, string> = {
  script_writing: "Script",
  ready_to_shoot: "Shoot ready",
  shoot_complete: "Shot",
  ready_for_edit: "Handoff",
  editing: "Editing",
  creator_review: "Creator review",
  final_review: "Final review",
  changes_requested: "Changes",
  approved: "Approved"
};

export function productionStageIndex(stage: ProductionStage) {
  return productionStages.indexOf(stage);
}

export function productionProgress(stage: ProductionStage) {
  return Math.round(((productionStageIndex(stage) + 1) / productionStages.length) * 100);
}

export const creatorControlledStages = [
  "script_writing",
  "ready_to_shoot",
  "shoot_complete",
  "ready_for_edit"
] as const satisfies readonly ProductionStage[];

export type CreatorControlledStage = (typeof creatorControlledStages)[number];

export const creatorStatusOptionLabels: Record<CreatorControlledStage, string> = {
  script_writing: "Writing script",
  ready_to_shoot: "Scripting done",
  shoot_complete: "Clips done",
  ready_for_edit: "Ready – assign editor"
};

export const creatorSelectableStages = creatorControlledStages.filter(
  (stage) => stage !== "script_writing"
) as Exclude<CreatorControlledStage, "script_writing">[];

export const creatorEditableStages = [
  "script_writing",
  "ready_to_shoot",
  "shoot_complete"
] as const satisfies readonly ProductionStage[];

export function legacyStatusForProductionStage(stage: ProductionStage): AdStatus {
  if (stage === "creator_review" || stage === "final_review") return "pending_review";
  if (stage === "changes_requested") return "changes_requested";
  if (stage === "approved") return "approved";
  return "draft";
}

export function workflowWaitingLabel(changedAt: string, now = Date.now()) {
  const elapsed = Math.max(0, now - new Date(changedAt).getTime());
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return "Just updated";
  if (hours < 24) return `Waiting ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Waiting ${days}d`;
}

export function workflowStageAgeLabel(stage: ProductionStage, changedAt: string, now = Date.now()) {
  const age = workflowWaitingLabel(changedAt, now)
    .replace("Just updated", "just now")
    .replace("Waiting ", "");

  if (stage === "approved") return age === "just now" ? "Approved just now" : `Approved ${age} ago`;
  if (stage === "changes_requested") return age === "just now" ? "Changes requested just now" : `Changes requested ${age} ago`;
  return age === "just now" ? "Entered status just now" : `In this status for ${age}`;
}

export function isFinalMediaVisible(stage: ProductionStage) {
  return !["script_writing", "ready_to_shoot", "shoot_complete", "ready_for_edit"].includes(stage);
}

export function productionActionError(params: {
  action: ProductionAction;
  ad: Pick<Ad, "production_stage" | "creator_id" | "editor_id" | "script_text">;
  role: UserRole;
  userId: string;
  rawFootageUrl?: string;
}) {
  const isReviewer = params.role === "admin" || params.role === "manager";
  const isCreator = params.role === "content_creator" && params.ad.creator_id === params.userId;
  const isEditor = params.role === "editor" && params.ad.editor_id === params.userId;

  if (params.action === "mark_script_ready") {
    if (params.ad.production_stage !== "script_writing") return "The script stage is already complete.";
    if (!isCreator && !isReviewer) return "Only the assigned content creator can mark the script ready.";
    if (!params.ad.script_text?.trim()) return "Add the script before marking it ready to shoot.";
    return null;
  }

  if (params.action === "mark_shoot_complete") {
    if (params.ad.production_stage !== "ready_to_shoot") return "The ad is not ready to record the shoot.";
    if (!isCreator && !isReviewer) return "Only the assigned content creator can mark the shoot complete.";
    return null;
  }

  if (params.action === "share_raw_footage") {
    if (params.ad.production_stage !== "shoot_complete") return "Mark the shoot complete before sharing raw footage.";
    if (!isCreator && !isReviewer) return "Only the assigned content creator can share raw footage.";
    if (!params.ad.editor_id) return "Assign an editor before sharing raw footage.";
    if (!params.rawFootageUrl?.trim()) return "Add the raw footage folder link.";
    try {
      new URL(params.rawFootageUrl);
    } catch {
      return "Use a valid raw footage folder URL.";
    }
    return null;
  }

  if (params.ad.production_stage !== "ready_for_edit") return "The raw footage has not been handed to editing yet.";
  if (!isEditor && !isReviewer) return "Only the assigned editor can start editing.";
  return null;
}

export function nextProductionStage(action: ProductionAction): ProductionStage {
  if (action === "mark_script_ready") return "ready_to_shoot";
  if (action === "mark_shoot_complete") return "shoot_complete";
  if (action === "share_raw_footage") return "ready_for_edit";
  return "editing";
}

export function creatorReviewTransition(decision: "approve" | "request_changes"): {
  status: AdStatus;
  productionStage: ProductionStage;
  approvalStage: ApprovalStage;
} {
  return decision === "approve"
    ? { status: "pending_review", productionStage: "final_review", approvalStage: "admin_final" }
    : { status: "changes_requested", productionStage: "changes_requested", approvalStage: "manager_review" };
}

export function finalReviewTransition(decision: "approve" | "request_changes" | "reject"): {
  status: AdStatus;
  productionStage: ProductionStage;
  approvalStage: ApprovalStage;
} {
  if (decision === "approve") {
    return { status: "approved", productionStage: "approved", approvalStage: "complete" };
  }

  return {
    status: decision === "reject" ? "rejected" : "changes_requested",
    productionStage: "changes_requested",
    approvalStage: "manager_review"
  };
}
