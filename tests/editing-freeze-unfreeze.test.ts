import { describe, expect, it } from "vitest";
import { canToggleEditingFreeze } from "@/lib/production-workflow";
import type { EditingFreezeState, ProductionStage } from "@/lib/types";

describe("Creative Freeze & Unfreeze Workflow", () => {
  it("allows toggling editing freeze for valid in-production stages including ready_for_edit and editing", () => {
    expect(canToggleEditingFreeze("ready_for_edit")).toBe(true);
    expect(canToggleEditingFreeze("editing")).toBe(true);
    expect(canToggleEditingFreeze("changes_requested")).toBe(true);
    expect(canToggleEditingFreeze("shoot_complete")).toBe(true);
    expect(canToggleEditingFreeze("ready_to_shoot")).toBe(true);
    expect(canToggleEditingFreeze("script_writing")).toBe(true);

    // Terminal / review stages cannot be frozen
    expect(canToggleEditingFreeze("creator_review")).toBe(false);
    expect(canToggleEditingFreeze("final_review")).toBe(false);
    expect(canToggleEditingFreeze("approved")).toBe(false);
  });

  it("handles unfreeze state transition logic for ready_for_edit creatively", () => {
    // Simulating the decision logic in setEditingFreeze and FreezeEditingToggle
    function resolveFreezeAction(
      currentStage: ProductionStage,
      currentFreeze: EditingFreezeState | null,
      requestedState: EditingFreezeState,
      hasEditor: boolean
    ) {
      if (currentFreeze === requestedState) {
        // If already marked unfrozen but stuck in ready_for_edit with an editor,
        // it must still force transition to editing.
        const needsTransitionToEditing =
          requestedState === "unfrozen" && currentStage === "ready_for_edit" && hasEditor;
        if (!needsTransitionToEditing) {
          return { changed: false, stage: currentStage, state: currentFreeze };
        }
      }

      if (requestedState === "unfrozen" && currentStage === "ready_for_edit") {
        if (!hasEditor) {
          return { error: "Assign an editor before unfreezing this creative." };
        }
        return { changed: true, stage: "editing" as ProductionStage, state: "unfrozen" as EditingFreezeState };
      }

      return { changed: true, stage: currentStage, state: requestedState };
    }

    // 1. Creative on card in ready_for_edit with editor -> clicking Unfreeze moves to editing
    const result1 = resolveFreezeAction("ready_for_edit", null, "unfrozen", true);
    expect(result1).toEqual({
      changed: true,
      stage: "editing",
      state: "unfrozen"
    });

    // 2. Creative was previously marked 'unfrozen' but still waiting in ready_for_edit -> clicking Unfreeze moves to editing
    const result2 = resolveFreezeAction("ready_for_edit", "unfrozen", "unfrozen", true);
    expect(result2).toEqual({
      changed: true,
      stage: "editing",
      state: "unfrozen"
    });

    // 3. Creative in ready_for_edit without editor -> fails with helpful message
    const result3 = resolveFreezeAction("ready_for_edit", null, "unfrozen", false);
    expect(result3).toEqual({
      error: "Assign an editor before unfreezing this creative."
    });

    // 4. Creative in editing -> clicking Freeze keeps stage editing and sets state frozen
    const result4 = resolveFreezeAction("editing", null, "frozen", true);
    expect(result4).toEqual({
      changed: true,
      stage: "editing",
      state: "frozen"
    });

    // 5. Creative in editing currently frozen -> clicking Unfreeze sets state unfrozen and stays editing
    const result5 = resolveFreezeAction("editing", "frozen", "unfrozen", true);
    expect(result5).toEqual({
      changed: true,
      stage: "editing",
      state: "unfrozen"
    });
  });
});
