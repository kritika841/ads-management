import type { ProductionStage, UserRole } from "@/lib/types";

export type QueueKey =
  | "preparing"
  | "pending_editor_assign"
  | "with_editor"
  | "creator_review"
  | "final_review"
  | "new_assignments"
  | "editing"
  | "changes"
  | "submitted"
  | "needs_review"
  | "in_production"
  | "approved"
  | "all";

export function queuesForRole(role: UserRole): { key: QueueKey; label: string }[] {
  if (role === "content_creator") {
    return [
      { key: "preparing", label: "Preparing" },
      { key: "pending_editor_assign", label: "Pending editor assign" },
      { key: "with_editor", label: "With editor" },
      { key: "creator_review", label: "Needs my review" },
      { key: "final_review", label: "Awaiting final" },
      { key: "approved", label: "Approved" }
    ];
  }
  if (role === "editor") {
    return [
      { key: "new_assignments", label: "New assignments" },
      { key: "editing", label: "Editing" },
      { key: "changes", label: "Changes requested" },
      { key: "submitted", label: "Submitted" },
      { key: "approved", label: "Approved" }
    ];
  }
  return [
    { key: "needs_review", label: "Needs review" },
    { key: "pending_editor_assign", label: "Pending editor assign" },
    { key: "in_production", label: "In production" },
    { key: "changes", label: "Changes requested" },
    { key: "approved", label: "Approved" },
    { key: "all", label: "All" }
  ];
}

export function queueForRole(role: UserRole, value: string | null | undefined): QueueKey | null {
  if (!value) return null;
  return queuesForRole(role).some((queue) => queue.key === value) ? value as QueueKey : null;
}

export function matchesQueue(item: { production_stage: ProductionStage }, queue: QueueKey) {
  const stage = item.production_stage;
  if (queue === "all") return true;
  if (queue === "preparing") return ["script_writing", "ready_to_shoot"].includes(stage);
  if (queue === "pending_editor_assign") return stage === "shoot_complete";
  if (queue === "with_editor") return ["ready_for_edit", "editing", "changes_requested"].includes(stage);
  if (queue === "creator_review") return stage === "creator_review";
  if (queue === "final_review") return stage === "final_review";
  if (queue === "new_assignments") return stage === "ready_for_edit";
  if (queue === "editing") return stage === "editing";
  if (queue === "changes") return stage === "changes_requested";
  if (queue === "submitted" || queue === "needs_review") return stage === "creator_review" || stage === "final_review";
  if (queue === "in_production") return ["script_writing", "ready_to_shoot", "shoot_complete", "ready_for_edit", "editing"].includes(stage);
  return stage === "approved";
}
