import { describe, expect, it } from "vitest";
import { PASSWORD_EXPIRY_MS, resolvePasswordStatus } from "@/lib/password-security";

const now = new Date("2026-10-07T00:00:00Z").getTime();
const day = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("resolvePasswordStatus", () => {
  it("is not expired when a reset was recorded only in auth metadata", () => {
    const status = resolvePasswordStatus(
      [null, { lastChangedAt: iso(now - day), expiresAt: iso(now - day + PASSWORD_EXPIRY_MS) }],
      iso(now - 200 * day),
      now
    );
    expect(status.isExpired).toBe(false);
    expect(status.daysRemaining).toBe(29);
    expect(status.hasHistory).toBe(true);
  });

  it("prefers the most recent change across sources", () => {
    const stale = { lastChangedAt: iso(now - 90 * day), expiresAt: iso(now - 60 * day) };
    const fresh = { lastChangedAt: iso(now - 2 * day), expiresAt: iso(now + 28 * day) };
    expect(resolvePasswordStatus([stale, fresh], null, now).isExpired).toBe(false);
    expect(resolvePasswordStatus([fresh, stale], null, now).isExpired).toBe(false);
  });

  it("only expires when the newest recorded change is past its window", () => {
    const old = { lastChangedAt: iso(now - 40 * day), expiresAt: iso(now - 10 * day) };
    expect(resolvePasswordStatus([old, null], null, now).isExpired).toBe(true);
  });

  it("falls back to account creation when nothing is recorded", () => {
    expect(resolvePasswordStatus([null, undefined], iso(now - 5 * day), now).isExpired).toBe(false);
    expect(resolvePasswordStatus([null], iso(now - 45 * day), now).isExpired).toBe(true);
  });

  it("ignores malformed records", () => {
    const status = resolvePasswordStatus([{ lastChangedAt: "nope", expiresAt: "nope" }], iso(now - day), now);
    expect(status.isExpired).toBe(false);
    expect(status.hasHistory).toBe(false);
  });
});
