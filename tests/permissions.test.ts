import { describe, expect, it } from "vitest";
import { canDeleteAd } from "@/lib/permissions";

describe("canDeleteAd", () => {
  it.each(["admin", "manager"] as const)("allows %s users to delete ads", (role) => {
    expect(canDeleteAd(role)).toBe(true);
  });

  it.each(["content_creator", "editor"] as const)("prevents %s users from deleting ads", (role) => {
    expect(canDeleteAd(role)).toBe(false);
  });
});
