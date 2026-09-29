import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Resend } from "resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types";

export const PASSWORD_EXPIRY_DAYS = 30;
export const PASSWORD_EXPIRY_MS = PASSWORD_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

export type PasswordHistoryEntry = {
  salt: string;
  hash: string;
  createdAt: string;
};

export type UserSecurityRecord = {
  userId: string;
  email: string;
  lastChangedAt: string;
  expiresAt: string;
  history: PasswordHistoryEntry[];
};

export type PasswordStatus = {
  isExpired: boolean;
  daysRemaining: number;
  lastChangedAt: string;
  expiresAt: string;
  hasHistory: boolean;
};

const LOCAL_STORE_FILE = path.join(process.cwd(), "data", "password-history.json");

/**
 * Hash a password using PBKDF2 with SHA-512 and 100,000 iterations.
 */
export function hashPassword(password: string, existingSalt?: string): { salt: string; hash: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, "sha512").toString("hex");
  return { salt, hash };
}

/**
 * Verifies a candidate plaintext password against a stored salt and hash.
 */
export function verifyPasswordAgainstHash(password: string, salt: string, expectedHash: string): boolean {
  try {
    const computedHash = crypto.pbkdf2Sync(password, salt, 100_000, 64, "sha512").toString("hex");
    const bufA = Buffer.from(computedHash, "hex");
    const bufB = Buffer.from(expectedHash, "hex");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Read the local persistent password history store.
 */
export async function readLocalSecurityStore(): Promise<Record<string, UserSecurityRecord>> {
  try {
    const raw = await fs.readFile(LOCAL_STORE_FILE, "utf-8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

/**
 * Write the local persistent password history store.
 */
export async function writeLocalSecurityStore(store: Record<string, UserSecurityRecord>): Promise<void> {
  try {
    await fs.mkdir(path.dirname(LOCAL_STORE_FILE), { recursive: true });
    await fs.writeFile(LOCAL_STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to write to local password security store:", error);
  }
}

/**
 * Get all historical password entries for a specific user from all available layers.
 */
export async function getPasswordHistory(userId: string): Promise<PasswordHistoryEntry[]> {
  const history: PasswordHistoryEntry[] = [];
  const seenHashes = new Set<string>();

  // 1. Check local persistent store
  const localStore = await readLocalSecurityStore();
  const userRecord = localStore[userId];
  if (userRecord?.history) {
    for (const item of userRecord.history) {
      if (item.hash && !seenHashes.has(item.hash)) {
        seenHashes.add(item.hash);
        history.push(item);
      }
    }
  }

  // 2. Check Supabase user_metadata if available
  try {
    const admin = createSupabaseAdminClient();
    const { data: userData } = await admin.auth.admin.getUserById(userId);
    const metaHistory = userData?.user?.user_metadata?.password_history;
    if (Array.isArray(metaHistory)) {
      for (const item of metaHistory) {
        if (item.hash && !seenHashes.has(item.hash)) {
          seenHashes.add(item.hash);
          history.push(item);
        }
      }
    }
  } catch {
    // Supabase auth admin query may fail if network/credentials issue
  }

  // 3. Check public.password_history table if it exists
  try {
    const admin = createSupabaseAdminClient();
    const { data: tableData, error } = await admin
      .from("password_history")
      .select("password_hash, salt, created_at")
      .eq("user_id", userId);

    if (!error && Array.isArray(tableData)) {
      for (const row of tableData) {
        if (row.password_hash && !seenHashes.has(row.password_hash)) {
          seenHashes.add(row.password_hash);
          history.push({
            hash: row.password_hash,
            salt: row.salt,
            createdAt: row.created_at
          });
        }
      }
    }
  } catch {
    // Ignore if table does not exist
  }

  return history;
}

/**
 * Checks whether a candidate password matches ANY password historically used by the user.
 * Returns true if reused (must be rejected), false otherwise.
 */
export async function isPasswordReused(
  userId: string,
  candidatePassword: string,
  userEmail?: string
): Promise<boolean> {
  if (!candidatePassword) return false;

  // 1. Check against all historical records (local store, user_metadata, postgres)
  const history = await getPasswordHistory(userId);
  for (const entry of history) {
    if (entry.salt && entry.hash) {
      if (verifyPasswordAgainstHash(candidatePassword, entry.salt, entry.hash)) {
        return true;
      }
    }
  }

  // 2. Also check against current active password in Supabase Auth (e.g. for baseline accounts before history was recorded)
  try {
    let emailToTest = userEmail;
    if (!emailToTest) {
      const admin = createSupabaseAdminClient();
      const { data: userObj } = await admin.auth.admin.getUserById(userId);
      emailToTest = userObj?.user?.email;
    }

    if (emailToTest) {
      const { createClient } = await import("@supabase/supabase-js");
      const tempClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { data: signInData, error: signInErr } = await tempClient.auth.signInWithPassword({
        email: emailToTest,
        password: candidatePassword
      });

      if (!signInErr && signInData?.user) {
        // Candidate password matches their current active password
        // Backfill this password into the history store immediately
        await recordPasswordChange(userId, candidatePassword, emailToTest).catch(() => null);
        return true;
      }
    }
  } catch {
    // Ignore sign-in verification failure
  }

  return false;
}

/**
 * Records a new password for the user in the security store:
 * - Hashes the password with a fresh salt
 * - Appends to history
 * - Resets the 30-day expiration timer
 */
export async function recordPasswordChange(
  userId: string,
  newPassword: string,
  email?: string
): Promise<{ expiresAt: string; lastChangedAt: string }> {
  const now = new Date();
  const lastChangedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + PASSWORD_EXPIRY_MS).toISOString();

  const { salt, hash } = hashPassword(newPassword);
  const newEntry: PasswordHistoryEntry = {
    salt,
    hash,
    createdAt: lastChangedAt
  };

  // 1. Update local persistent store
  const localStore = await readLocalSecurityStore();
  const existing = localStore[userId] || {
    userId,
    email: email || "",
    lastChangedAt,
    expiresAt,
    history: []
  };

  if (email) existing.email = email;
  existing.lastChangedAt = lastChangedAt;
  existing.expiresAt = expiresAt;

  // Append new entry without duplicates
  const filteredHistory = (existing.history || []).filter((h) => h.hash !== hash);
  filteredHistory.push(newEntry);
  existing.history = filteredHistory;
  localStore[userId] = existing;
  await writeLocalSecurityStore(localStore);

  // 2. Update Supabase Auth user_metadata
  try {
    const admin = createSupabaseAdminClient();
    const { data: userObj } = await admin.auth.admin.getUserById(userId);
    const existingMeta = userObj?.user?.user_metadata || {};
    const metaHistory: PasswordHistoryEntry[] = Array.isArray(existingMeta.password_history)
      ? existingMeta.password_history.filter((h: PasswordHistoryEntry) => h.hash !== hash)
      : [];
    metaHistory.push(newEntry);

    await admin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...existingMeta,
        password_updated_at: lastChangedAt,
        password_expires_at: expiresAt,
        password_history: metaHistory
      }
    });
  } catch (err) {
    console.warn("[recordPasswordChange] Could not update user_metadata:", err);
  }

  // 3. Try to insert into public.password_history table if it exists
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("password_history").insert({
      user_id: userId,
      password_hash: hash,
      salt: salt,
      created_at: lastChangedAt
    });
  } catch {
    // Ignore if table does not exist
  }

  return { expiresAt, lastChangedAt };
}

/**
 * Calculates the current password expiration status for a user.
 */
export async function getUserPasswordStatus(
  userId: string,
  fallbackCreatedAt?: string | null
): Promise<PasswordStatus> {
  const localStore = await readLocalSecurityStore();
  const userRecord = localStore[userId];

  let lastChangedAt = userRecord?.lastChangedAt;
  let expiresAt = userRecord?.expiresAt;
  const hasHistory = Boolean(userRecord?.history?.length);

  // If not found in local store, check Supabase user_metadata
  if (!lastChangedAt || !expiresAt) {
    try {
      const admin = createSupabaseAdminClient();
      const { data: userObj } = await admin.auth.admin.getUserById(userId);
      const meta = userObj?.user?.user_metadata;
      if (meta?.password_updated_at && meta?.password_expires_at) {
        lastChangedAt = meta.password_updated_at;
        expiresAt = meta.password_expires_at;
      }
    } catch {
      // Ignore
    }
  }

  // If no password change record exists at all yet:
  // Baseline starts 30 days from either fallbackCreatedAt or initial feature rollout so existing
  // users have their full 30 days to regenerate their password.
  if (!expiresAt || !lastChangedAt) {
    // If the user was just created or we have no record, baseline from fallbackCreatedAt or now
    const baselineDate = fallbackCreatedAt ? new Date(fallbackCreatedAt) : new Date();
    // Default expiration is 30 days from baseline
    const calculatedExpiresAt = new Date(baselineDate.getTime() + PASSWORD_EXPIRY_MS);

    // If baseline was months ago (e.g. from initial setup before this feature),
    // give existing accounts a 30-day window from the feature rollout date unless explicitly expired.
    // However, if it's already expired past the 30-day mark, check date:
    const now = Date.now();
    const isPast = calculatedExpiresAt.getTime() <= now;

    return {
      isExpired: isPast,
      daysRemaining: Math.max(0, Math.ceil((calculatedExpiresAt.getTime() - now) / (1000 * 60 * 60 * 24))),
      lastChangedAt: baselineDate.toISOString(),
      expiresAt: calculatedExpiresAt.toISOString(),
      hasHistory: false
    };
  }

  const now = Date.now();
  const expiryTime = new Date(expiresAt).getTime();
  const diffMs = expiryTime - now;
  const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  const isExpired = diffMs <= 0;

  return {
    isExpired,
    daysRemaining,
    lastChangedAt,
    expiresAt,
    hasHistory: true
  };
}

/**
 * Updates a user's password securely, ensuring:
 * 1. The password has not been used previously by this user.
 * 2. Password has minimum length 8 characters.
 * 3. Records new hash in history and resets 30-day expiration timer.
 */
export async function updateUserPasswordSecurely(
  userId: string,
  newPassword: string,
  email?: string
): Promise<{ ok: boolean; error?: string; expiresAt?: string }> {
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters long." };
  }

  // Historical password prevention check
  const reused = await isPasswordReused(userId, newPassword);
  if (reused) {
    return {
      ok: false,
      error: "This password has been used previously. You cannot reuse a password you have ever historically used. Please choose a different password."
    };
  }

  try {
    const admin = createSupabaseAdminClient();

    // Update password in Supabase Auth
    const { error: authError } = await admin.auth.admin.updateUserById(userId, {
      password: newPassword
    });

    if (authError) {
      return { ok: false, error: authError.message };
    }

    // Record in history and reset 30-day timer
    const { expiresAt } = await recordPasswordChange(userId, newPassword, email);

    return { ok: true, expiresAt };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update password."
    };
  }
}

/**
 * Sends a password reset email to the user's registered email address.
 * Uses Supabase generateLink and sends via Resend with branded template, or Supabase resetPasswordForEmail.
 */
export async function sendPasswordResetEmail(
  email: string,
  appOrigin?: string,
  options?: { generateDirectLink?: boolean }
): Promise<{ ok: boolean; message: string; actionLink: string; emailDelivered: boolean }> {
  const normalizedEmail = email.trim().toLowerCase();
  const generateDirectLink = Boolean(options?.generateDirectLink);

  // Dynamically resolve the origin from request headers, client origin, or environment
  let origin = appOrigin;
  if (!origin) {
    try {
      const { headers } = await import("next/headers");
      const headerList = await headers();
      const host = headerList.get("x-forwarded-host") || headerList.get("host");
      if (host) {
        const proto = headerList.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
        origin = `${proto}://${host}`;
      }
    } catch {
      // outside Next.js request context (e.g. background tasks or tests)
    }
  }
  if (!origin) {
    origin = process.env.NEXT_PUBLIC_APP_URL || "https://stock-hip-mon-configure.trycloudflare.com";
  }
  origin = origin.replace(/\/+$/, "");

  const callbackRedirectUrl = `${origin}/auth/callback?next=/reset-password/update`;

  try {
    const admin = createSupabaseAdminClient();

    // 1. Verify user exists in profiles or auth
    const { data: profile } = await admin
      .from("profiles")
      .select("id, name, email")
      .eq("email", normalizedEmail)
      .maybeSingle();

    const userName = profile?.name || "Team Member";

    let actionLink = `${origin}/reset-password`;
    let directCallbackLink = "";

    // 2. Only generate a direct token/link if explicitly requested (e.g. by Admins)
    // IMPORTANT: Calling generateLink immediately updates recovery_sent_at in Supabase,
    // which causes a subsequent resetPasswordForEmail call to fail with HTTP 429 rate limit!
    if (generateDirectLink) {
      try {
        const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
          type: "recovery",
          email: normalizedEmail,
          options: {
            redirectTo: callbackRedirectUrl
          }
        });

        if (!linkError && linkData?.properties) {
          if (linkData.properties.hashed_token) {
            directCallbackLink = `${origin}/auth/callback?token_hash=${linkData.properties.hashed_token}&type=recovery&next=/reset-password/update`;
          }
          actionLink = directCallbackLink || linkData.properties.action_link || `${origin}/reset-password`;
        } else if (linkError) {
          console.warn("[sendPasswordResetEmail] Supabase generateLink warning:", linkError.message);
        }
      } catch (genErr) {
        console.warn("[sendPasswordResetEmail] generateLink error:", genErr);
      }
    }

    let emailDelivered = false;
    let deliveryErrorMessage: string | null = null;

    // 3. Primary email delivery: Supabase Custom SMTP (Google Workspace via support@satmi.in)
    // Only call resetPasswordForEmail if we didn't generate a link that would collide
    if (!generateDirectLink) {
      try {
        const { createClient } = await import("@supabase/supabase-js");
        const anonClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        const { error: resetError } = await anonClient.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: callbackRedirectUrl
        });

        if (!resetError) {
          emailDelivered = true;
        } else {
          deliveryErrorMessage = resetError.message;
          console.warn("[sendPasswordResetEmail] Supabase resetPasswordForEmail notice:", resetError.message);
        }
      } catch (supaErr) {
        deliveryErrorMessage = supaErr instanceof Error ? supaErr.message : "Supabase email error";
        console.warn("[sendPasswordResetEmail] Supabase reset error:", supaErr);
      }
    } else {
      // For direct links (e.g. Admin copy link or test), consider direct link generation a success
      emailDelivered = true;
    }

    // 4. Secondary fallback: Attempt Resend delivery if Supabase SMTP failed
    if (!emailDelivered && process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const rawFrom = process.env.EMAIL_FROM || "";
        const fromEmail = rawFrom && !rawFrom.includes("example.com")
          ? rawFrom
          : "onboarding@resend.dev";

        const htmlContent = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background-color: #0f172a; color: #f8fafc; border-radius: 12px;">
            <div style="margin-bottom: 28px;">
              <span style="font-size: 20px; font-weight: 700; color: #6366f1; letter-spacing: -0.5px;">AdFlow</span>
            </div>
            <h2 style="font-size: 22px; font-weight: 600; margin: 0 0 16px 0; color: #ffffff;">
              Reset Your AdFlow Password
            </h2>
            <p style="font-size: 15px; line-height: 1.6; color: #cbd5e1; margin: 0 0 20px 0;">
              Hi ${userName},
            </p>
            <p style="font-size: 15px; line-height: 1.6; color: #cbd5e1; margin: 0 0 24px 0;">
              A password reset was requested for your account. For security, passwords must be updated every <strong>30 days</strong> and previously used passwords cannot be reused.
            </p>
            <div style="margin: 28px 0;">
              <a href="${actionLink}" style="display: inline-block; background-color: #6366f1; color: #ffffff; padding: 12px 28px; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px;">
                Set New Password
              </a>
            </div>
            <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">
              This link is valid for 1 hour. If you did not request this, please contact your AdFlow system administrator immediately.
            </p>
            <hr style="border: none; border-top: 1px solid #334155; margin: 28px 0;" />
            <p style="font-size: 12px; color: #64748b; margin: 0;">
              AdFlow Internal Workspace • Internal Security Policy
            </p>
          </div>
        `;

        const resendRes = await resend.emails.send({
          from: fromEmail,
          to: normalizedEmail,
          subject: "AdFlow - Reset Your Password",
          html: htmlContent
        });

        if (!resendRes.error) {
          emailDelivered = true;
          deliveryErrorMessage = null;
        } else {
          console.warn("[sendPasswordResetEmail] Resend delivery notice:", resendRes.error.message);
        }
      } catch (resendErr) {
        console.warn("[sendPasswordResetEmail] Resend error:", resendErr);
      }
    }

    // Always log the link to server console for developer and admin convenience
    console.log(`\n======================================================`);
    console.log(`🔑 [ADFLOW PASSWORD RESET LINK for ${normalizedEmail}]:`);
    console.log(actionLink);
    console.log(`======================================================\n`);

    if (!emailDelivered) {
      return {
        ok: false,
        emailDelivered: false,
        actionLink,
        message: deliveryErrorMessage || "Failed to deliver reset email. Please try again shortly."
      };
    }

    return {
      ok: true,
      emailDelivered: true,
      actionLink,
      message: `A password reset link has been emailed to ${normalizedEmail}. Please check your inbox and spam folder.`
    };
  } catch (err) {
    console.error("[sendPasswordResetEmail] Error:", err);
    return {
      ok: false,
      emailDelivered: false,
      actionLink: `${origin}/reset-password`,
      message: err instanceof Error ? err.message : "Unable to generate password reset link."
    };
  }
}

/**
 * Gets password security statuses for all team members (for Admin Settings).
 */
export async function getAllUsersPasswordSecurityStatus(): Promise<
  Array<{
    id: string;
    name: string;
    email: string;
    role: UserRole;
    lastChangedAt: string;
    expiresAt: string;
    daysRemaining: number;
    isExpired: boolean;
  }>
> {
  try {
    const admin = createSupabaseAdminClient();
    const { data: profiles, error } = await admin
      .from("profiles")
      .select("id, name, email, role, created_at, active")
      .order("name", { ascending: true });

    if (error || !profiles) return [];

    const localStore = await readLocalSecurityStore();
    const now = Date.now();

    return profiles.map((p) => {
      const record = localStore[p.id];
      const lastChangedAt = record?.lastChangedAt || p.created_at;
      const expiresAt =
        record?.expiresAt ||
        new Date(new Date(p.created_at).getTime() + PASSWORD_EXPIRY_MS).toISOString();

      const diffMs = new Date(expiresAt).getTime() - now;
      const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      const isExpired = diffMs <= 0;

      return {
        id: p.id,
        name: p.name,
        email: p.email,
        role: p.role as UserRole,
        lastChangedAt,
        expiresAt,
        daysRemaining,
        isExpired
      };
    });
  } catch (err) {
    console.error("[getAllUsersPasswordSecurityStatus] Error:", err);
    return [];
  }
}
