import { describe, expect, it } from "vitest";
import { nextStatusForReview, reviewPermissionError, validateReviewInput } from "@/lib/workflow";

describe("workflow", () => {
  it("approves directly when two-step approval is disabled", () => {
    expect(
      nextStatusForReview({
        decision: "approve",
        reviewerRole: "manager",
        twoStepApproval: false,
        currentStage: "manager_review"
      })
    ).toEqual({ status: "approved", stage: "complete" });
  });

  it("advances manager approval to admin final review when two-step approval is enabled", () => {
    expect(
      nextStatusForReview({
        decision: "approve",
        reviewerRole: "manager",
        twoStepApproval: true,
        currentStage: "manager_review"
      })
    ).toEqual({ status: "pending_review", stage: "admin_final" });
  });

  it("requires feedback for change requests and rejections", () => {
    expect(validateReviewInput("request_changes", "")).toBe("Change requests require specific feedback.");
    expect(validateReviewInput("reject", "")).toBe("Rejected ads require a reason.");
    expect(validateReviewInput("approve", "")).toBeNull();
  });

  it("moves dashboard cancellations into changes requested", () => {
    expect(
      nextStatusForReview({
        decision: "request_changes",
        reviewerRole: "admin",
        twoStepApproval: true,
        currentStage: "admin_final"
      })
    ).toEqual({ status: "changes_requested", stage: "manager_review" });
  });

  it("enforces reviewer ownership for each two-step stage", () => {
    expect(
      reviewPermissionError({
        status: "pending_review",
        stage: "manager_review",
        reviewerRole: "admin",
        twoStepApproval: true
      })
    ).toBe("This ad is waiting for manager approval.");

    expect(
      reviewPermissionError({
        status: "pending_review",
        stage: "admin_final",
        reviewerRole: "manager",
        twoStepApproval: true
      })
    ).toBe("This ad is waiting for final admin approval.");

    expect(
      reviewPermissionError({
        status: "pending_review",
        stage: "admin_final",
        reviewerRole: "admin",
        twoStepApproval: true
      })
    ).toBeNull();
  });

  it("rejects review actions after the ad leaves pending review", () => {
    expect(
      reviewPermissionError({
        status: "approved",
        stage: "complete",
        reviewerRole: "admin",
        twoStepApproval: false
      })
    ).toBe("Only ads pending review can be reviewed.");
  });
});
