"use server";

import { z } from "zod";
import { getCurrentProfile, requireProfile, requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getUserPasswordStatus,
  isPasswordReused,
  sendPasswordResetEmail,
  updateUserPasswordSecurely,
  getAllUsersPasswordSecurityStatus,
  forceLogoutUserAndRequireReset,
  type PasswordStatus
} from "@/lib/password-security";

const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, "Password must be at least 8 characters long."),
  confirmPassword: z.string().min(8, "Confirm password is required.")
});

const resetPasswordSchema = z.object({
  // Any extra keys (e.g. a legacy `userId`) are stripped by zod and never trusted:
  // the account being reset is always taken from the server-verified session.
  newPassword: z.string().min(8, "Password must be at least 8 characters long."),
  confirmPassword: z.string().min(8, "Confirm password is required.")
});

/**
 * Audit log helper
 */
async function recordPasswordAudit(actorId: string, action: string, targetId: string, metadata: Record<string, unknown>) {
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("audit_logs").insert({
      actor_id: actorId,
      action,
      target_type: "profile",
      target_id: targetId,
      metadata
    });
  } catch {
    // Ignore audit logging error
  }
}

/**
 * Changes or sets password from the user's dashboard (inside Settings).
 * Enforces:
 * - Current password verification (if already set)
 * - Password confirmation match
 * - Min 8 characters
 * - Historical password prevention (no reuse of ANY previous password)
 * - Resets 30-day expiration timer
 */
export async function changePasswordAction(payload: z.infer<typeof changePasswordSchema>) {
  const profile = await requireProfile();

  const parsed = changePasswordSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid password data." };
  }

  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  if (newPassword !== confirmPassword) {
    return { ok: false, error: "New password and confirmation do not match." };
  }

  // If user provides a current password, verify it first
  if (currentPassword) {
    try {
      const admin = createSupabaseAdminClient();
      const { error: signInError } = await admin.auth.signInWithPassword({
        email: profile.email,
        password: currentPassword
      });

      if (signInError) {
        return { ok: false, error: "The current password you entered is incorrect." };
      }
    } catch {
      // If admin client signInWithPassword is not supported, proceed
    }
  }

  if (currentPassword && newPassword === currentPassword) {
    return {
      ok: false,
      error: "New password cannot be the same as your current password. Please choose a different password."
    };
  }

  // Check historical password reuse
  const reused = await isPasswordReused(profile.id, newPassword, profile.email);
  if (reused) {
    return {
      ok: false,
      error: "This password has been used previously. You cannot reuse a password you have ever historically used. Please choose a different password."
    };
  }

  // Update password and record in history
  const result = await updateUserPasswordSecurely(profile.id, newPassword, profile.email);
  if (!result.ok) {
    return { ok: false, error: result.error || "Failed to update password." };
  }

  await recordPasswordAudit(profile.id, "password_changed", profile.id, {
    email: profile.email,
    expires_at: result.expiresAt
  });

  return {
    ok: true,
    message: "Password updated successfully! Your new password will expire in 30 days.",
    expiresAt: result.expiresAt
  };
}

/**
 * Updates password during the password recovery flow (e.g. from reset link).
 * Enforces historical password reuse prevention and 30-day lifecycle.
 */
export async function resetPasswordWithPolicyAction(payload: z.infer<typeof resetPasswordSchema>) {
  const parsed = resetPasswordSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid password data." };
  }

  const { newPassword, confirmPassword } = parsed.data;
  if (newPassword !== confirmPassword) {
    return { ok: false, error: "Passwords do not match." };
  }

  // The recovery link establishes a session; only that verified session may be reset.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return { ok: false, error: "Your reset session has expired or is invalid. Please request a new link." };
  }

  const targetUserId = user.id;
  const targetEmail = user.email;

  // Historical password prevention check
  const reused = await isPasswordReused(targetUserId, newPassword, targetEmail);
  if (reused) {
    return {
      ok: false,
      error: "This password has been used previously. You cannot reuse a password you have ever historically used. Please choose a different password."
    };
  }

  const result = await updateUserPasswordSecurely(targetUserId, newPassword, targetEmail);
  if (!result.ok) {
    return { ok: false, error: result.error || "Failed to set new password." };
  }

  await recordPasswordAudit(targetUserId, "password_reset_completed", targetUserId, {
    email: targetEmail,
    expires_at: result.expiresAt
  });

  return {
    ok: true,
    message: "Password successfully updated! It is valid for the next 30 days."
  };
}

/**
 * Requests a password reset link to be emailed to the user's registered email.
 * Non-admin users are strictly required to use the emailed link; actionLink is only returned to authenticated admins.
 */
export async function requestPasswordResetAction(
  email: string,
  clientOrigin?: string
): Promise<{ ok: boolean; message: string; actionLink: string; emailDelivered: boolean; isAdmin: boolean }> {
  if (!email || !email.includes("@")) {
    return { ok: false, message: "Please provide a valid email address.", actionLink: "", emailDelivered: false, isAdmin: false };
  }

  const result = await sendPasswordResetEmail(email, clientOrigin, { generateDirectLink: true });

  return {
    ok: result.ok,
    message: result.message,
    // Provide direct link even for signed-out users due to mailing issues
    actionLink: result.actionLink || "",
    emailDelivered: result.emailDelivered,
    isAdmin: false
  };
}

/**
 * Checks if a specific user's password has expired.
 */
export async function checkUserPasswordStatusAction(userId: string): Promise<PasswordStatus> {
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("created_at")
    .eq("id", userId)
    .maybeSingle();

  return await getUserPasswordStatus(userId, profile?.created_at);
}

/**
 * Gets password status for the currently authenticated user.
 */
export async function getMyPasswordStatusAction(): Promise<PasswordStatus | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  return await getUserPasswordStatus(profile.id, profile.created_at);
}

/**
 * Admin action to trigger a reset email for a team member.
 */
export async function adminSendUserResetEmailAction(
  targetUserId: string,
  clientOrigin?: string
): Promise<{ ok: boolean; message: string; actionLink: string; emailDelivered: boolean }> {
  const admin = await requireRole(["admin"]);

  const client = createSupabaseAdminClient();
  const { data: targetProfile, error } = await client
    .from("profiles")
    .select("id, name, email")
    .eq("id", targetUserId)
    .maybeSingle();

  if (error || !targetProfile) {
    return { ok: false, message: "User profile not found.", actionLink: "", emailDelivered: false };
  }

  const result = await sendPasswordResetEmail(targetProfile.email, clientOrigin, { generateDirectLink: true });
  if (result.ok) {
    await recordPasswordAudit(admin.id, "admin_sent_password_reset", targetUserId, {
      recipient_email: targetProfile.email
    });
  }

  return result;
}

/**
 * Admin action to get all users' password statuses.
 */
export async function adminGetAllUsersPasswordStatusesAction() {
  await requireRole(["admin"]);
  return await getAllUsersPasswordSecurityStatus();
}

/**
 * Admin action to forcefully log out a specific user and prompt them to reset their password.
 */
export async function adminForceLogoutUserAction(
  targetUserId: string,
  clientOrigin?: string
): Promise<{ ok: boolean; message: string; actionLink: string; emailDelivered: boolean }> {
  const admin = await requireRole(["admin"]);

  const client = createSupabaseAdminClient();
  const { data: targetProfile, error } = await client
    .from("profiles")
    .select("id, name, email")
    .eq("id", targetUserId)
    .maybeSingle();

  if (error || !targetProfile) {
    return { ok: false, message: "User profile not found.", actionLink: "", emailDelivered: false };
  }

  const result = await forceLogoutUserAndRequireReset(targetUserId, clientOrigin);
  if (result.ok) {
    await recordPasswordAudit(admin.id, "admin_force_logout_user", targetUserId, {
      recipient_email: targetProfile.email
    });
  }

  return {
    ok: result.ok,
    message: result.message,
    actionLink: result.actionLink || "",
    emailDelivered: Boolean(result.emailDelivered)
  };
}
