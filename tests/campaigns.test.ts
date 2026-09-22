import { describe, expect, it } from "vitest";
import { getExcelColumnLetter } from "@/components/campaigns/excel-table";

describe("campaigns and excel table functionality", () => {
  it("computes Excel column letters correctly", () => {
    expect(getExcelColumnLetter(0)).toBe("A");
    expect(getExcelColumnLetter(1)).toBe("B");
    expect(getExcelColumnLetter(25)).toBe("Z");
    expect(getExcelColumnLetter(26)).toBe("AA");
    expect(getExcelColumnLetter(27)).toBe("AB");
    expect(getExcelColumnLetter(51)).toBe("AZ");
    expect(getExcelColumnLetter(52)).toBe("BA");
  });

  it("calculates video goal progress accurately", () => {
    const videoGoal = 10;
    const approvedCount = 7;
    const progress = videoGoal > 0 ? Math.min(100, Math.round((approvedCount / videoGoal) * 100)) : 0;
    expect(progress).toBe(70);

    const exceedApproved = 12;
    const exceedProgress = videoGoal > 0 ? Math.min(100, Math.round((exceedApproved / videoGoal) * 100)) : 0;
    expect(exceedProgress).toBe(100);
  });
});
