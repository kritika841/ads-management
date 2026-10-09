import { describe, expect, it } from "vitest";
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS, formatRetentionDays, normalizeRetentionDays } from "@/lib/retention";
import { parseLibraryReviewTab } from "@/lib/library-tab-state";

describe("retention settings", () => {
  it("accepts whole days inside the supported range", () => {
    expect(normalizeRetentionDays(7, 3)).toBe(7);
    expect(normalizeRetentionDays("14", 3)).toBe(14);
    expect(normalizeRetentionDays(MIN_RETENTION_DAYS, 3)).toBe(MIN_RETENTION_DAYS);
    expect(normalizeRetentionDays(MAX_RETENTION_DAYS, 3)).toBe(MAX_RETENTION_DAYS);
  });

  it("falls back for missing, non-numeric or out-of-range values", () => {
    expect(normalizeRetentionDays(undefined, 7)).toBe(7);
    expect(normalizeRetentionDays("abc", 7)).toBe(7);
    expect(normalizeRetentionDays(0, 7)).toBe(7);
    expect(normalizeRetentionDays(MAX_RETENTION_DAYS + 1, 7)).toBe(7);
  });

  it("formats singular and plural day labels", () => {
    expect(formatRetentionDays(1)).toBe("1 day");
    expect(formatRetentionDays(7)).toBe("7 days");
  });
});

describe("library tab persistence", () => {
  it("only accepts known review sub-tabs", () => {
    expect(parseLibraryReviewTab("editor")).toBe("editor");
    expect(parseLibraryReviewTab("creator")).toBe("creator");
    expect(parseLibraryReviewTab("bogus")).toBeNull();
    expect(parseLibraryReviewTab(undefined)).toBeNull();
  });
});
