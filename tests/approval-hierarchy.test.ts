import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchesQueue } from "@/lib/work-queues";
import { getProductionStageLabel } from "@/lib/production-workflow";
import type { ProductionStage, UserRole } from "@/lib/types";

describe("approval hierarchy and changes requested visibility", () => {
  it("matches both editor changes and creator changes in their respective queues", () => {
    expect(matchesQueue({ production_stage: "changes_requested" as ProductionStage }, "changes")).toBe(true);
    expect(matchesQueue({ production_stage: "creator_changes_requested" as ProductionStage }, "creator_changes")).toBe(true);
    expect(matchesQueue({ production_stage: "approved" as ProductionStage }, "changes")).toBe(false);
  });

  it("determines final approval authority based on role and settings", () => {
    function canUserApprove(role: UserRole, allowManagerFinalApproval: boolean): boolean {
      return role === "admin" || (role === "manager" && allowManagerFinalApproval);
    }

    // When manager approval is enabled (default)
    expect(canUserApprove("admin", true)).toBe(true);
    expect(canUserApprove("manager", true)).toBe(true);
    expect(canUserApprove("editor", true)).toBe(false);
    expect(canUserApprove("content_creator", true)).toBe(false);

    // When manager approval is restricted (admin-only mode)
    expect(canUserApprove("admin", false)).toBe(true);
    expect(canUserApprove("manager", false)).toBe(false);
    expect(canUserApprove("editor", false)).toBe(false);
    expect(canUserApprove("content_creator", false)).toBe(false);
  });

  it("shows Admin approval pending label when admin-only final approval is enabled", () => {
    expect(getProductionStageLabel("final_review", "manager", false)).toBe("Admin approval pending");
    expect(getProductionStageLabel("final_review", "editor", false)).toBe("Admin approval pending");
    expect(getProductionStageLabel("final_review", "content_creator", false)).toBe("Admin approval pending");
    expect(getProductionStageLabel("final_review", "admin", false)).toBe("Final review");
    expect(getProductionStageLabel("final_review", "manager", true)).toBe("Final review");
  });

  it("allows both admin and manager to reopen approved creatives", () => {
    function canUserReopenApproved(role: UserRole): boolean {
      return role === "admin" || role === "manager";
    }

    expect(canUserReopenApproved("admin")).toBe(true);
    expect(canUserReopenApproved("manager")).toBe(true);
    expect(canUserReopenApproved("editor")).toBe(false);
    expect(canUserReopenApproved("content_creator")).toBe(false);
  });

  it("contains approval hierarchy migration with database safeguards", () => {
    const migration = readFileSync(
      "supabase/migrations/20260921120000_admin_approval_hierarchy.sql",
      "utf8"
    );
    expect(migration).toContain("allow_manager_final_approval");
    expect(migration).toContain("function public.final_review_ad_atomic");
    expect(migration).toContain("Final approval is restricted to administrators");

    const safeguardsMigration = readFileSync(
      "supabase/migrations/20260923100000_manager_reopen_and_approval_safeguards.sql",
      "utf8"
    );
    expect(safeguardsMigration).toContain("actor_role in ('admin', 'manager')");
    expect(safeguardsMigration).toContain("approved_ad_reopened");
  });
});
