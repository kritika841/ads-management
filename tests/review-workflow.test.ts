import { describe, expect, it } from "vitest";
import { queuesForRole, matchesQueue } from "@/lib/work-queues";
import { getProductionStageLabel } from "@/lib/production-workflow";
import type { AdWithRelations } from "@/lib/types";

describe("review queue tabs and submission classification", () => {
  it("provides separated Creator and Editor changes queues for managers and admins", () => {
    const adminQueues = queuesForRole("admin");
    const managerQueues = queuesForRole("manager");

    expect(adminQueues.find((q) => q.key === "creator_changes")?.label).toBe("Changes: Creator");
    expect(adminQueues.find((q) => q.key === "changes")?.label).toBe("Changes: Editor");
    expect(managerQueues.find((q) => q.key === "creator_changes")?.label).toBe("Changes: Creator");
    expect(managerQueues.find((q) => q.key === "changes")?.label).toBe("Changes: Editor");

    expect(matchesQueue({ production_stage: "creator_changes_requested" }, "creator_changes")).toBe(true);
    expect(matchesQueue({ production_stage: "changes_requested" }, "creator_changes")).toBe(false);
    expect(matchesQueue({ production_stage: "changes_requested" }, "changes")).toBe(true);
    expect(matchesQueue({ production_stage: "creator_changes_requested" }, "changes")).toBe(false);
  });

  it("displays 'Admin approval pending' status when admin-only approval is active", () => {
    expect(getProductionStageLabel("final_review", "manager", false)).toBe("Admin approval pending");
    expect(getProductionStageLabel("final_review", "editor", false)).toBe("Admin approval pending");
    expect(getProductionStageLabel("final_review", "content_creator", false)).toBe("Admin approval pending");
    expect(getProductionStageLabel("final_review", "admin", false)).toBe("Final review");
    expect(getProductionStageLabel("final_review", "manager", true)).toBe("Final review");
  });

  it("classifies review submissions into new, editor resubmission, and creator resubmission", () => {
    const newAd: Partial<AdWithRelations> = {
      id: "ad-1",
      production_stage: "creator_review",
      review_submission_type: "new"
    };

    const editorResubmissionAd: Partial<AdWithRelations> = {
      id: "ad-2",
      production_stage: "creator_review",
      review_submission_type: "editor_resubmission"
    };

    const creatorResubmissionAd: Partial<AdWithRelations> = {
      id: "ad-3",
      production_stage: "final_review",
      review_submission_type: "creator_resubmission"
    };

    const reviewAds = [newAd, editorResubmissionAd, creatorResubmissionAd] as AdWithRelations[];

    const filterBySubTab = (subTab: "all" | "new" | "editor" | "creator") =>
      reviewAds.filter((ad) => {
        if (subTab === "all") return true;
        if (subTab === "new") return ad.review_submission_type === "new";
        if (subTab === "editor") return ad.review_submission_type === "editor_resubmission";
        if (subTab === "creator") return ad.review_submission_type === "creator_resubmission";
        return true;
      });

    expect(filterBySubTab("all")).toHaveLength(3);
    expect(filterBySubTab("new")).toEqual([newAd]);
    expect(filterBySubTab("editor")).toEqual([editorResubmissionAd]);
    expect(filterBySubTab("creator")).toEqual([creatorResubmissionAd]);
  });
});
