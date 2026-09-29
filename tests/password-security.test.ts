import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPasswordAgainstHash,
  PASSWORD_EXPIRY_DAYS,
  PASSWORD_EXPIRY_MS,
  type PasswordHistoryEntry
} from "@/lib/password-security";

describe("Password Security & Expiration Engine", () => {
  describe("Cryptographic Hashing & Verification", () => {
    it("generates random salts and verifiable hashes for passwords", () => {
      const password = "SuperSecretPassword123!";
      const { salt, hash } = hashPassword(password);

      expect(salt).toBeDefined();
      expect(salt.length).toBe(32); // 16 bytes in hex = 32 chars
      expect(hash).toBeDefined();
      expect(hash.length).toBe(128); // SHA-512 = 64 bytes = 128 hex chars

      // Verify correct password
      expect(verifyPasswordAgainstHash(password, salt, hash)).toBe(true);

      // Verify incorrect password
      expect(verifyPasswordAgainstHash("WrongPassword456!", salt, hash)).toBe(false);
    });

    it("produces distinct salts and hashes for the same password across multiple calls", () => {
      const password = "ConsistentPassword!";
      const res1 = hashPassword(password);
      const res2 = hashPassword(password);

      expect(res1.salt).not.toBe(res2.salt);
      expect(res1.hash).not.toBe(res2.hash);
      expect(verifyPasswordAgainstHash(password, res1.salt, res1.hash)).toBe(true);
      expect(verifyPasswordAgainstHash(password, res2.salt, res2.hash)).toBe(true);
    });

    it("handles special characters and Unicode in passwords correctly", () => {
      const specialPassword = "P@$$w0rd!#%^&*()_+-=~`{}[]:;'<>?,./";
      const { salt, hash } = hashPassword(specialPassword);
      expect(verifyPasswordAgainstHash(specialPassword, salt, hash)).toBe(true);
      expect(verifyPasswordAgainstHash("P@$$w0rd!#%^&*()_+-=~`{}[]:;'<>?,.", salt, hash)).toBe(false);
    });
  });

  describe("Historical Password Reuse Prevention (Never reuse past passwords)", () => {
    it("detects when a candidate password matches a past password in history", () => {
      // User historically set password 'XYZ'
      const history: PasswordHistoryEntry[] = [];
      const pastPassword = "XYZ";
      const { salt, hash } = hashPassword(pastPassword);
      history.push({ salt, hash, createdAt: new Date(Date.now() - 100000).toISOString() });

      // Add another historical password 'ABC12345'
      const pastPassword2 = "ABC12345";
      const res2 = hashPassword(pastPassword2);
      history.push({ salt: res2.salt, hash: res2.hash, createdAt: new Date(Date.now() - 50000).toISOString() });

      // Check if candidate matches any historical entry
      function checkReused(candidate: string) {
        return history.some((entry) => verifyPasswordAgainstHash(candidate, entry.salt, entry.hash));
      }

      // Exact previous password 'XYZ' MUST be rejected
      expect(checkReused("XYZ")).toBe(true);

      // Second previous password 'ABC12345' MUST be rejected
      expect(checkReused("ABC12345")).toBe(true);

      // A brand new password MUST be allowed
      expect(checkReused("BrandNewPassword999!")).toBe(false);
    });

    it("prevents reuse regardless of how many historical passwords exist", () => {
      const historicalList = ["initialPass1", "secondPass2", "thirdPass3", "fourthPass4", "currentPass5"];
      const history: PasswordHistoryEntry[] = historicalList.map((p) => {
        const { salt, hash } = hashPassword(p);
        return { salt, hash, createdAt: new Date().toISOString() };
      });

      function checkReused(candidate: string) {
        return history.some((entry) => verifyPasswordAgainstHash(candidate, entry.salt, entry.hash));
      }

      for (const pass of historicalList) {
        expect(checkReused(pass)).toBe(true);
      }

      expect(checkReused("completelyUntouchedPassword2026")).toBe(false);
    });

    it("verifies isPasswordReused function correctly against recorded store", async () => {
      const { isPasswordReused, recordPasswordChange } = await import("@/lib/password-security");
      const testUserId = "test-user-reuse-" + Date.now();
      const testPassword = "OriginalSecretPassword123!";

      // Record this password for the user
      await recordPasswordChange(testUserId, testPassword, "test@example.com");

      // Verify that candidate matching the recorded password returns true (reuse prevented)
      const reused = await isPasswordReused(testUserId, testPassword);
      expect(reused).toBe(true);

      // Verify that candidate with different password returns false (allowed)
      const notReused = await isPasswordReused(testUserId, "CompletelyDifferentPassword456!");
      expect(notReused).toBe(false);

      // Clean up test record from local store
      const { readLocalSecurityStore, writeLocalSecurityStore } = await import("@/lib/password-security");
      const store = await readLocalSecurityStore();
      delete store[testUserId];
      await writeLocalSecurityStore(store);
    });
  });

  describe("30-Day Password Expiration Lifecycle", () => {
    it("calculates 30-day expiration constants accurately", () => {
      expect(PASSWORD_EXPIRY_DAYS).toBe(30);
      expect(PASSWORD_EXPIRY_MS).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it("correctly identifies active password when within 30 days", () => {
      const now = Date.now();
      const lastChangedAt = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
      const expiresAt = new Date(now + 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 days in future

      const diffMs = new Date(expiresAt).getTime() - now;
      const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      const isExpired = diffMs <= 0;

      expect(isExpired).toBe(false);
      expect(daysRemaining).toBe(20);
    });

    it("correctly identifies expiring soon status when <= 5 days remaining", () => {
      const now = Date.now();
      const expiresAt = new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days in future
      const diffMs = new Date(expiresAt).getTime() - now;
      const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      const isExpiringSoon = !((diffMs <= 0)) && daysRemaining <= 5;

      expect(isExpiringSoon).toBe(true);
      expect(daysRemaining).toBe(3);
    });

    it("correctly flags password as expired when > 30 days have elapsed", () => {
      const now = Date.now();
      const lastChangedAt = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString(); // 31 days ago
      const expiresAt = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(); // expired 1 day ago

      const diffMs = new Date(expiresAt).getTime() - now;
      const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      const isExpired = diffMs <= 0;

      expect(isExpired).toBe(true);
      expect(daysRemaining).toBe(0);
    });
  });
});
