import type { AdStatus, ApprovalStage, UserRole } from "@/lib/types";

export type ReviewDecision = "approve" | "request_changes" | "reject";

export function reviewPermissionError(params: {
  status: AdStatus;
  stage: ApprovalStage;
  reviewerRole: UserRole;
  twoStepApproval: boolean;
}) {
  if (params.reviewerRole !== "admin" && params.reviewerRole !== "manager") {
    return "Only managers and admins can review ads.";
  }

  if (params.status !== "pending_review") {
    return "Only ads pending review can be reviewed.";
  }

  if (!params.twoStepApproval) {
    return null;
  }

  if (params.stage === "manager_review" && params.reviewerRole !== "manager") {
    return "This ad is waiting for manager approval.";
  }

  if (params.stage === "admin_final" && params.reviewerRole !== "admin") {
    return "This ad is waiting for final admin approval.";
  }

  if (params.stage === "complete") {
    return "This review is already complete.";
  }

  return null;
}

export function nextStatusForReview(params: {
  decision: ReviewDecision;
  reviewerRole: UserRole;
  twoStepApproval: boolean;
  currentStage: ApprovalStage;
}): { status: AdStatus; stage: ApprovalStage } {
  if (params.decision === "request_changes") {
    return { status: "changes_requested", stage: "manager_review" };
  }

  if (params.decision === "reject") {
    return { status: "rejected", stage: "complete" };
  }

  if (!params.twoStepApproval) {
    return { status: "approved", stage: "complete" };
  }

  if (params.reviewerRole === "manager" && params.currentStage === "manager_review") {
    return { status: "pending_review", stage: "admin_final" };
  }

  if (params.reviewerRole === "admin" && params.currentStage === "admin_final") {
    return { status: "approved", stage: "complete" };
  }

  return { status: "pending_review", stage: params.currentStage };
}

export function validateReviewInput(decision: ReviewDecision, note: string) {
  const trimmed = note.trim();
  if (decision === "request_changes" && !trimmed) {
    return "Change requests require specific feedback.";
  }

  if (decision === "reject" && !trimmed) {
    return "Rejected ads require a reason.";
  }

  return null;
}
