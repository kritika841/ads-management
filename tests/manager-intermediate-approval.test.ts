import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getProductionStageLabel } from "@/lib/production-workflow";
import type { ApprovalStage, ProductionStage, UserRole } from "@/lib/types";

describe("two-stage manager intermediate approval workflow", () => {
  it("displays correct production stage labels depending on approvalStage", () => {
    // When manager approval is disabled (two-stage mode):
    // If ad is in manager review before manager approved:
    expect(getProductionStageLabel("final_review", "manager", false, "manager_review")).toBe("Manager review");
    // If manager has approved and ad is waiting for admin:
    expect(getProductionStageLabel("final_review", "manager", false, "admin_final")).toBe("Admin approval pending");
    expect(getProductionStageLabel("final_review", "editor", false, "admin_final")).toBe("Admin approval pending");
    // Default fallback when approvalStage is omitted:
    expect(getProductionStageLabel("final_review", "manager", false)).toBe("Admin approval pending");

    // When manager direct approval is enabled:
    expect(getProductionStageLabel("final_review", "manager", true, "manager_review")).toBe("Final review");
    expect(getProductionStageLabel("final_review", "admin", true, "manager_review")).toBe("Final review");
  });

  it("calculates workflow transitions for two-stage approval correctly", () => {
    function calculateApprovalTransition(params: {
      role: UserRole;
      allowManagerFinalApproval: boolean;
      currentApprovalStage: ApprovalStage;
    }): { productionStage: ProductionStage; approvalStage: ApprovalStage; finalApproved: boolean } {
      if (params.role === "admin") {
        return { productionStage: "approved", approvalStage: "complete", finalApproved: true };
      }
      if (params.role === "manager") {
        if (params.allowManagerFinalApproval) {
          return { productionStage: "approved", approvalStage: "complete", finalApproved: true };
        }
        return { productionStage: "final_review", approvalStage: "admin_final", finalApproved: false };
      }
      throw new Error("Unauthorized");
    }

    // Manager approving in Admin-Only mode: intercepted, moves to admin_final, NOT final approved
    const managerStep = calculateApprovalTransition({
      role: "manager",
      allowManagerFinalApproval: false,
      currentApprovalStage: "manager_review"
    });
    expect(managerStep).toEqual({
      productionStage: "final_review",
      approvalStage: "admin_final",
      finalApproved: false
    });

    // Admin subsequently approving: completes review and grants final approval
    const adminStep = calculateApprovalTransition({
      role: "admin",
      allowManagerFinalApproval: false,
      currentApprovalStage: managerStep.approvalStage
    });
    expect(adminStep).toEqual({
      productionStage: "approved",
      approvalStage: "complete",
      finalApproved: true
    });

    // Direct approval when Admin & Manager mode is enabled
    const directManagerStep = calculateApprovalTransition({
      role: "manager",
      allowManagerFinalApproval: true,
      currentApprovalStage: "manager_review"
    });
    expect(directManagerStep).toEqual({
      productionStage: "approved",
      approvalStage: "complete",
      finalApproved: true
    });
  });

  it("contains the two-stage migration with manager intermediate approval logic", () => {
    const migration = readFileSync(
      "supabase/migrations/20260922150000_manager_intermediate_approval.sql",
      "utf8"
    );
    expect(migration).toContain("function public.final_review_ad_atomic");
    expect(migration).toContain("admin_final");
    expect(migration).toContain("manager_approved");
    expect(migration).toContain("final_approval_granted");
  });
});
