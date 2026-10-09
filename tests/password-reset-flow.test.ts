import { describe, expect, it } from "vitest";
import { config } from "dotenv";

config({ path: ".env.local" });

describe("Password Reset Authentication Flow", () => {
  it("generates correct callback and redirect URLs", () => {
    const origin = "http://localhost:3000";
    const callbackRedirectUrl = `${origin}/auth/callback?next=/reset-password/update`;
    const hashedToken = "mock_hashed_token_12345";

    const directCallbackLink = `${origin}/auth/callback?token_hash=${hashedToken}&type=recovery&next=/reset-password/update`;

    expect(callbackRedirectUrl).toBe("http://localhost:3000/auth/callback?next=/reset-password/update");
    expect(directCallbackLink).toContain("token_hash=mock_hashed_token_12345");
    expect(directCallbackLink).toContain("type=recovery");
    expect(directCallbackLink).toContain("next=/reset-password/update");
  });

  it("ensures origin does not have trailing slash", () => {
    const rawOrigin = "https://adflow.app///";
    const cleaned = rawOrigin.replace(/\/+$/, "");
    expect(cleaned).toBe("https://adflow.app");
    expect(`${cleaned}/auth/callback`).toBe("https://adflow.app/auth/callback");
  });

  it("generates a valid single token and verifies OTP cleanly", async () => {
    const { sendPasswordResetEmail } = await import("@/lib/password-security");
    const { createClient } = await import("@supabase/supabase-js");

    await new Promise((r) => setTimeout(r, 2500));
    const result = await sendPasswordResetEmail("yash@satmi.in", "http://localhost:3000", { generateDirectLink: true });
    expect(result.ok).toBe(true);
    expect(result.actionLink).toContain("http://localhost:3000/auth/callback");
    expect(result.actionLink).toContain("token_hash=");
    expect(result.actionLink).toContain("type=recovery");

    const parsedUrl = new URL(result.actionLink);
    const tokenHash = parsedUrl.searchParams.get("token_hash");
    expect(tokenHash).toBeTruthy();

    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data, error } = await anon.auth.verifyOtp({
      token_hash: tokenHash!,
      type: "recovery"
    });

    expect(error).toBeNull();
    expect(data.user?.email).toBe("yash@satmi.in");
    expect(data.session).toBeDefined();
  });

  it("handles standard non-admin email reset without rate-limit collision", async () => {
    const { sendPasswordResetEmail } = await import("@/lib/password-security");

    const result = await sendPasswordResetEmail("manager@satmi.in", "http://localhost:3001", {
      generateDirectLink: false
    });

    expect(result.ok).toBe(true);
    expect(result.emailDelivered).toBe(true);
    expect(result.message).toContain("manager@satmi.in");
  });
});
