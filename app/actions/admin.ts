"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types";

const userSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  role: z.enum(["admin", "manager", "editor", "content_creator"]),
  avatarUrl: z.string().url().optional().or(z.literal("")),
  password: z.string().min(8).max(72).optional().or(z.literal(""))
});

const campaignSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Campaign name is required.").max(100),
  description: z.string().trim().max(500).optional(),
  active: z.boolean().optional()
});

const productSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Product name is required.").max(160),
  sku: z.string().trim().max(100).optional(),
  imageUrl: z.string().trim().url("Use a valid image URL.").optional().or(z.literal("")),
  active: z.boolean().optional()
});

const settingsSchema = z.object({
  twoStepApproval: z.boolean(),
  deadlineReminderDays: z.number().int().min(1).max(30),
  maxConcurrentEdits: z.number().int().min(1).max(10)
});

const analyticsSlaSchema = z.object({
  assignmentStartHours: z.number().int().min(1).max(720),
  editingHours: z.number().int().min(1).max(720),
  creatorReviewHours: z.number().int().min(1).max(720),
  finalReviewHours: z.number().int().min(1).max(720),
  revisionHours: z.number().int().min(1).max(720)
});

export async function saveUser(payload: z.infer<typeof userSchema>) {
  const adminProfile = await requireRole(["admin"]);
  const parsed = userSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid user." };
  }

  const data = parsed.data;
  const admin = createSupabaseAdminClient();

  if (data.id) {
    const { error: authError } = await admin.auth.admin.updateUserById(data.id, {
      email: data.email,
      email_confirm: true,
      ...(data.password ? { password: data.password } : {}),
      user_metadata: {
        name: data.name,
        role: data.role,
        avatar_url: data.avatarUrl || null
      }
    });

    if (authError) {
      return { ok: false, message: authError.message };
    }

    const { error } = await admin
      .from("profiles")
      .update({
        name: data.name,
        email: data.email,
        role: data.role as UserRole,
        avatar_url: data.avatarUrl || null,
        active: true
      })
      .eq("id", data.id);

    if (error) {
      return { ok: false, message: error.message };
    }

    await audit(adminProfile.id, "updated_user", "profile", data.id, {
      ...sanitizedUserAudit(data),
      password_changed: Boolean(data.password)
    });
  } else {
    if (!data.password || data.password.length < 8) {
      return { ok: false, message: "Set an initial password with at least 8 characters." };
    }

    const { data: existingProfile, error: existingError } = await admin
      .from("profiles")
      .select("id")
      .eq("email", data.email)
      .maybeSingle();

    if (existingError) {
      return { ok: false, message: existingError.message };
    }

    const authPatch = {
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        name: data.name,
        role: data.role,
        avatar_url: data.avatarUrl || null
      }
    };

    const { data: created, error } = existingProfile
      ? await admin.auth.admin.updateUserById(existingProfile.id, authPatch)
      : await admin.auth.admin.createUser(authPatch);

    if (error || !created.user) {
      return { ok: false, message: error?.message ?? "Unable to create user." };
    }

    const { error: profileError } = await admin.from("profiles").upsert({
      id: created.user.id,
      name: data.name,
      email: data.email,
      role: data.role as UserRole,
      avatar_url: data.avatarUrl || null,
      active: true
    });

    if (profileError) {
      if (!existingProfile) {
        await admin.auth.admin.deleteUser(created.user.id);
      }
      return { ok: false, message: profileError.message };
    }

    await audit(adminProfile.id, existingProfile ? "approved_user" : "created_user", "profile", created.user.id, {
      ...sanitizedUserAudit(data),
      password_set: true
    });
  }

  revalidatePath("/admin/users");
  return { ok: true };
}

export async function deactivateUser(userId: string) {
  const adminProfile = await requireRole(["admin"]);
  const parsedId = z.string().uuid().safeParse(userId);
  if (!parsedId.success) {
    return { ok: false, message: "Invalid user id." };
  }

  if (parsedId.data === adminProfile.id) {
    return { ok: false, message: "You cannot deactivate your own account." };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("profiles").update({ active: false }).eq("id", parsedId.data);

  if (error) {
    return { ok: false, message: error.message };
  }

  await audit(adminProfile.id, "deactivated_user", "profile", parsedId.data, {});
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function activateUser(userId: string) {
  const adminProfile = await requireRole(["admin"]);
  const parsedId = z.string().uuid().safeParse(userId);
  if (!parsedId.success) return { ok: false, message: "Invalid user id." };

  const admin = createSupabaseAdminClient();
  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id,name,active,deleted_at")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (targetError || !target) return { ok: false, message: targetError?.message ?? "User not found." };
  if (target.deleted_at) return { ok: false, message: "Deleted users cannot be reactivated." };
  if (target.active) return { ok: true };

  const { error } = await admin.from("profiles").update({ active: true }).eq("id", parsedId.data);
  if (error) return { ok: false, message: error.message };

  await audit(adminProfile.id, "activated_user", "profile", parsedId.data, { name: target.name });
  revalidatePath("/admin/users");
  revalidatePath("/library");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteUser(userId: string) {
  const adminProfile = await requireRole(["admin"]);
  const parsedId = z.string().uuid().safeParse(userId);
  if (!parsedId.success) return { ok: false, message: "Invalid user id." };
  if (parsedId.data === adminProfile.id) return { ok: false, message: "You cannot delete your own account." };

  const admin = createSupabaseAdminClient();
  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id,name,email,role,active")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (targetError || !target) return { ok: false, message: targetError?.message ?? "User not found." };

  if (target.role === "admin" && target.active) {
    const { count, error: countError } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("active", true);
    if (countError) return { ok: false, message: countError.message };
    if ((count ?? 0) <= 1) return { ok: false, message: "Add another active admin before deleting this account." };
  }

  const deletedAt = new Date().toISOString();
  const { error: profileError } = await admin.from("profiles").update({ active: false, deleted_at: deletedAt }).eq("id", parsedId.data);
  if (profileError) return { ok: false, message: profileError.message };

  const { error: authError } = await admin.auth.admin.deleteUser(parsedId.data, true);
  if (authError) {
    await admin.from("profiles").update({ active: target.active, deleted_at: null }).eq("id", parsedId.data);
    return { ok: false, message: authError.message };
  }

  await audit(adminProfile.id, "deleted_user_access", "profile", parsedId.data, {
    name: target.name,
    email: target.email,
    role: target.role,
    historical_attribution_preserved: true,
    deleted_at: deletedAt
  });
  revalidatePath("/admin/users");
  revalidatePath("/library");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function saveCampaign(payload: { id?: string; name: string; description?: string; active?: boolean }) {
  const adminProfile = await requireRole(["admin"]);
  const parsed = campaignSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid campaign." };
  }

  const data = parsed.data;
  const admin = createSupabaseAdminClient();
  const patch = {
    name: data.name,
    description: data.description || null,
    active: data.active ?? true
  };

  const { data: savedCampaign, error } = data.id
    ? await admin.from("campaigns").update(patch).eq("id", data.id).select("*").single()
    : await admin.from("campaigns").insert(patch).select("*").single();

  if (error) {
    return { ok: false, message: error.message };
  }

  await audit(
    adminProfile.id,
    data.id ? "updated_campaign" : "created_campaign",
    "campaign",
    savedCampaign.id,
    patch
  );
  revalidatePath("/admin/settings");
  revalidatePath("/dashboard");
  revalidatePath("/library");
  return { ok: true };
}

export async function saveProduct(payload: {
  id?: string;
  name: string;
  sku?: string;
  imageUrl?: string;
  active?: boolean;
}) {
  const adminProfile = await requireRole(["admin"]);
  const parsed = productSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid product." };
  }

  const data = parsed.data;
  const admin = createSupabaseAdminClient();
  const patch = {
    name: data.name,
    sku: data.sku || null,
    image_url: data.imageUrl || null,
    active: data.active ?? true
  };

  const { data: savedProduct, error } = data.id
    ? await admin.from("products").update(patch).eq("id", data.id).select("*").single()
    : await admin.from("products").insert(patch).select("*").single();

  if (error) {
    return { ok: false, message: error.code === "23505" ? "A product with this name already exists." : error.message };
  }

  await audit(adminProfile.id, data.id ? "updated_product" : "created_product", "product", savedProduct.id, patch);
  revalidatePath("/admin/products");
  revalidatePath("/dashboard");
  revalidatePath("/library");
  return { ok: true };
}

export async function deleteCampaign(id: string) {
  const adminProfile = await requireRole(["admin"]);
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, message: "Invalid campaign id." };

  const admin = createSupabaseAdminClient();
  const { data: campaign, error: fetchError } = await admin
    .from("campaigns")
    .select("id,name")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (fetchError || !campaign) return { ok: false, message: fetchError?.message ?? "Campaign not found." };

  const { error } = await admin.from("campaigns").delete().eq("id", parsedId.data);
  if (error) return { ok: false, message: error.message };

  await audit(adminProfile.id, "deleted_campaign", "campaign", parsedId.data, { name: campaign.name });
  revalidatePath("/admin/settings");
  revalidatePath("/dashboard");
  revalidatePath("/library");
  return { ok: true };
}

export async function deleteProduct(id: string) {
  const adminProfile = await requireRole(["admin"]);
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, message: "Invalid product id." };

  const admin = createSupabaseAdminClient();
  const { data: product, error: fetchError } = await admin
    .from("products")
    .select("id,name")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (fetchError || !product) return { ok: false, message: fetchError?.message ?? "Product not found." };

  const { error } = await admin.from("products").delete().eq("id", parsedId.data);
  if (error) return { ok: false, message: error.code === "23503" ? "Cannot delete a product that has creatives linked to it." : error.message };

  await audit(adminProfile.id, "deleted_product", "product", parsedId.data, { name: product.name });
  revalidatePath("/admin/products");
  revalidatePath("/dashboard");
  revalidatePath("/library");
  return { ok: true };
}

export async function updateSettings(payload: {
  twoStepApproval: boolean;
  deadlineReminderDays: number;
  maxConcurrentEdits: number;
}) {
  const adminProfile = await requireRole(["admin"]);
  const parsed = settingsSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid settings." };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("app_settings")
    .update({
      two_step_approval: parsed.data.twoStepApproval,
      deadline_reminder_days: parsed.data.deadlineReminderDays,
      max_concurrent_edits: parsed.data.maxConcurrentEdits
    })
    .eq("id", 1);

  if (error) {
    return { ok: false, message: error.message };
  }

  await audit(adminProfile.id, "updated_settings", "app_settings", "1", parsed.data);
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function updateAnalyticsSlaTargets(payload: z.infer<typeof analyticsSlaSchema>) {
  const adminProfile = await requireRole(["admin"]);
  const parsed = analyticsSlaSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid SLA targets." };
  }

  const patch = {
    assignment_start_sla_hours: parsed.data.assignmentStartHours,
    editing_sla_hours: parsed.data.editingHours,
    creator_review_sla_hours: parsed.data.creatorReviewHours,
    final_review_sla_hours: parsed.data.finalReviewHours,
    revision_sla_hours: parsed.data.revisionHours
  };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("app_settings").update(patch).eq("id", 1);
  if (error) return { ok: false, message: error.message };

  await audit(adminProfile.id, "updated_analytics_sla_targets", "app_settings", "1", patch);
  revalidatePath("/analytics");
  revalidatePath("/admin/settings");
  return { ok: true };
}

async function audit(
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>
) {
  const admin = createSupabaseAdminClient();
  await admin.from("audit_logs").insert({
    actor_id: actorId,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata
  });
}

function sanitizedUserAudit(data: z.infer<typeof userSchema>) {
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    role: data.role,
    avatarUrl: data.avatarUrl || null
  };
}
