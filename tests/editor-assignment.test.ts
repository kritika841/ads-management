import { describe, expect, it } from "vitest";
import { planEditorAssignment, summarizeEditorAssignmentPlans } from "@/lib/editor-assignment";

const base = { editor_id: null, deadline: null } as const;

describe("planEditorAssignment", () => {
  it("assigns creatives waiting for an editor", () => {
    expect(planEditorAssignment({ ...base, production_stage: "shoot_complete" }, "assign", { editorId: "e1", deadline: "2026-10-10" }))
      .toEqual({ kind: "assign", deadline: "2026-10-10" });
  });

  it("falls back to the creative's own deadline and requires one", () => {
    expect(planEditorAssignment({ ...base, production_stage: "shoot_complete", deadline: "2026-11-01" }, "assign", { editorId: "e1" }))
      .toEqual({ kind: "assign", deadline: "2026-11-01" });
    expect(planEditorAssignment({ ...base, production_stage: "shoot_complete" }, "assign", { editorId: "e1" }).kind).toBe("skip");
  });

  it("reassigns editing work to a different editor and skips the same editor", () => {
    for (const stage of ["ready_for_edit", "editing", "changes_requested"] as const) {
      expect(planEditorAssignment({ production_stage: stage, editor_id: "e1", deadline: "2026-10-10" }, "assign", { editorId: "e2" }).kind).toBe("reassign");
    }
    const same = planEditorAssignment({ production_stage: "editing", editor_id: "e1", deadline: "2026-10-10" }, "assign", { editorId: "e1" });
    expect(same).toMatchObject({ kind: "skip", reason: "Already assigned to this editor." });
  });

  it("skips creatives that are not shot yet or already submitted", () => {
    expect(planEditorAssignment({ ...base, production_stage: "script_writing" }, "assign", { editorId: "e1", deadline: "2026-10-10" }).kind).toBe("skip");
    expect(planEditorAssignment({ production_stage: "creator_review", editor_id: "e1", deadline: null }, "assign", { editorId: "e2", deadline: "2026-10-10" }).kind).toBe("skip");
    expect(planEditorAssignment({ production_stage: "approved", editor_id: "e1", deadline: null }, "unassign").kind).toBe("skip");
  });

  it("unassigns only creatives with an editor still editing", () => {
    expect(planEditorAssignment({ production_stage: "editing", editor_id: "e1", deadline: null }, "unassign").kind).toBe("unassign");
    expect(planEditorAssignment({ ...base, production_stage: "shoot_complete" }, "unassign")).toMatchObject({ kind: "skip", reason: "No editor is assigned." });
  });

  it("requires an editor in assign mode", () => {
    expect(planEditorAssignment({ ...base, production_stage: "shoot_complete" }, "assign", { deadline: "2026-10-10" }).kind).toBe("skip");
  });
});

describe("summarizeEditorAssignmentPlans", () => {
  it("counts each kind", () => {
    expect(summarizeEditorAssignmentPlans([{ kind: "assign" }, { kind: "skip" }, { kind: "assign" }, { kind: "unassign" }]))
      .toEqual({ assign: 2, reassign: 0, unassign: 1, skip: 1 });
  });
});
