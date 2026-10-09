import { describe, expect, it } from "vitest";
import { canAssignCreator, creatorCapableProfiles, eligibleCreatorsFor } from "@/lib/creators";

const admin = { id: "a1", role: "admin", active: true, name: "Admin" };
const manager = { id: "m1", role: "manager", active: true, name: "Manager" };
const manager2 = { id: "m2", role: "manager", active: true, name: "Manager 2" };
const creator = { id: "c1", role: "content_creator", active: true, name: "Creator" };
const inactiveCreator = { id: "c2", role: "content_creator", active: false, name: "Gone" };
const editor = { id: "e1", role: "editor", active: true, name: "Editor" };
const everyone = [admin, manager, manager2, creator, inactiveCreator, editor];

describe("creator eligibility", () => {
  it("lets admins create for themselves, managers, and content creators", () => {
    const ids = eligibleCreatorsFor(admin, everyone).map((p) => p.id);
    expect(ids).toEqual(["a1", "m1", "m2", "c1"]);
  });

  it("lets managers create for themselves and content creators only", () => {
    const ids = eligibleCreatorsFor(manager, everyone).map((p) => p.id);
    expect(ids).toEqual(["m1", "c1"]);
  });

  it("limits content creators to themselves", () => {
    expect(eligibleCreatorsFor(creator, everyone).map((p) => p.id)).toEqual(["c1"]);
  });

  it("never allows editors, inactive users, or cross-role assignment", () => {
    expect(canAssignCreator(admin, editor)).toBe(false);
    expect(canAssignCreator(admin, inactiveCreator)).toBe(false);
    expect(canAssignCreator(manager, admin)).toBe(false);
    expect(canAssignCreator(manager, manager2)).toBe(false);
    expect(canAssignCreator(creator, manager)).toBe(false);
    expect(canAssignCreator(editor, editor)).toBe(false);
  });

  it("lists admins and managers as potential creators for filters", () => {
    expect(creatorCapableProfiles(everyone).map((p) => p.id)).toEqual(["a1", "m1", "m2", "c1", "c2"]);
  });
});
