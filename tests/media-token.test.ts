import { describe, expect, it } from "vitest";
import { createMediaAccessToken, verifyMediaAccessToken } from "@/lib/media-token";

describe("media access tokens", () => {
  const secret = "test-secret";
  const expiresAt = 2_000;

  it("authorizes only the signed ad and Drive file before expiry", () => {
    const token = createMediaAccessToken("ad-1", "file-1", { expiresAt, secret });
    expect(verifyMediaAccessToken(token, "ad-1", "file-1", { now: 1_999, secret })).toBe(true);
    expect(verifyMediaAccessToken(token, "ad-2", "file-1", { now: 1_999, secret })).toBe(false);
    expect(verifyMediaAccessToken(token, "ad-1", "file-2", { now: 1_999, secret })).toBe(false);
    expect(verifyMediaAccessToken(token, "ad-1", "file-1", { now: 2_001, secret })).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(verifyMediaAccessToken("not-a-token", "ad-1", "file-1", { now: 1, secret })).toBe(false);
  });
});
