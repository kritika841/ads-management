import { describe, expect, it } from "vitest";
import { formatDateOnly } from "@/lib/utils";

describe("formatDateOnly", () => {
  it("keeps calendar dates stable across server and browser time zones", () => {
    expect(formatDateOnly("2026-07-10")).toBe("10 Jul 2026");
  });
});
