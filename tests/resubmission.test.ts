import { describe, expect, it } from "vitest";
import { isResubmissionStatus, validateResubmissionConfirmation } from "@/lib/resubmission";

describe("resubmission confirmation", () => {
  it.each(["changes_requested", "rejected"] as const)("requires confirmation for %s ads", (status) => {
    expect(isResubmissionStatus(status)).toBe(true);
    expect(validateResubmissionConfirmation(status, false)).toBe(
      "Confirm that you have made the necessary changes before resubmitting."
    );
    expect(validateResubmissionConfirmation(status, true)).toBeNull();
  });

  it.each(["draft", "pending_review", "approved", "published"] as const)("does not require confirmation for %s ads", (status) => {
    expect(isResubmissionStatus(status)).toBe(false);
    expect(validateResubmissionConfirmation(status, false)).toBeNull();
  });
});
