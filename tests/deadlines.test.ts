import { describe, expect, it } from "vitest";
import { indiaDateString, indiaDayStartIso, isDeadlineActiveStatus } from "@/lib/deadlines";

describe("isDeadlineActiveStatus", () => {
  it.each(["draft", "pending_review", "changes_requested", "rejected"] as const)(
    "treats %s ads as deadline-active",
    (status) => {
      expect(isDeadlineActiveStatus(status)).toBe(true);
    }
  );

  it.each(["approved", "published"] as const)(
    "does not mark %s ads overdue",
    (status) => {
      expect(isDeadlineActiveStatus(status)).toBe(false);
    }
  );
});

describe("India deadline dates", () => {
  it("uses the India calendar day around UTC midnight", () => {
    const now = new Date("2026-07-10T20:00:00.000Z");
    expect(indiaDateString(now)).toBe("2026-07-11");
    expect(indiaDateString(now, 2)).toBe("2026-07-13");
    expect(indiaDayStartIso(now)).toBe("2026-07-10T18:30:00.000Z");
  });
});
