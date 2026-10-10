import { describe, it, expect } from "vitest";
import { getTodayIstKey, formatAttendanceTime } from "@/lib/attendance";

describe("attendance utility tests", () => {
  it("computes IST date string correctly regardless of local machine offset", () => {
    // 2026-10-09 20:00:00 UTC is 2026-10-10 01:30:00 IST (+05:30)
    const utcDateMs = new Date("2026-10-09T20:00:00Z").getTime();
    const istDateStr = getTodayIstKey(utcDateMs);
    expect(istDateStr).toBe("2026-10-10");

    // 2026-10-09 18:00:00 UTC is 2026-10-09 23:30:00 IST (before midnight)
    const utcDateBeforeMidnightMs = new Date("2026-10-09T18:00:00Z").getTime();
    expect(getTodayIstKey(utcDateBeforeMidnightMs)).toBe("2026-10-09");

    // 2026-10-09 18:31:00 UTC is 2026-10-10 00:01:00 IST (after 12:00 AM midnight)
    const utcDateAfterMidnightMs = new Date("2026-10-09T18:31:00Z").getTime();
    expect(getTodayIstKey(utcDateAfterMidnightMs)).toBe("2026-10-10");
  });

  it("formats IST time strings correctly", () => {
    // 2026-10-09T04:30:00Z is 10:00 AM IST
    const formatted = formatAttendanceTime("2026-10-09T04:30:00Z");
    expect(formatted.replace(/\s+/g, " ")).toMatch(/10:00\s*(AM|am)/i);

    // null / undefined returns "—"
    expect(formatAttendanceTime(null)).toBe("—");
    expect(formatAttendanceTime(undefined)).toBe("—");
  });
});
