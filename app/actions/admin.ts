"use server";

import { revalidatePath } from "next/cache";
import { invalidateLibraryCache } from "@/lib/library-cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PERFORMANCE_METRIC_KEYS, type AdsPerformanceNavItemKey, type HiddenMetricsByRole, type ManagerCreativeScope, type PerformanceMetricKey } from "@/lib/metric-visibility";
import { writeMetricVisibilityFile } from "@/lib/metric-visibility-server";
import type { UserRole } from "@/lib/types";

import { isPasswordReused, recordPasswordChange } from "@/lib/password-security";
import { isRecycleBinReady, softDeleteCampaign } from "@/lib/recycle-bin";

const userSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  role: z.enum(["admin", "manager", "media_buyer", "editor", "content_creator"]),
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

const metricEnum = z.enum(PERFORMANCE_METRIC_KEYS);

const hiddenMetricsSchema = z.object({
  content_creator: z.array(metricEnum).optional(),
  editor: z.array(metricEnum).optional(),
  manager: z.array(metricEnum).optional(),
  media_buyer: z.array(metricEnum).optional()
}).optional();

const managerCreativeScopeSchema = z.enum(["all", "own"]).optional();
const bulkRolesSchema = z.array(z.enum(["admin", "content_creator", "editor", "manager", "media_buyer"])).optional();

const settingsSchema = z.object({
  twoStepApproval: z.boolean(),
  deadlineReminderDays: z.number().int().min(1).max(30),
  maxConcurrentEdits: z.number().int().min(1).max(10),
  allowManagerFinalApproval: z.boolean().default(true),
  managerCreativeScope: managerCreativeScopeSchema,
  hiddenMetricsByRole: hiddenMetricsSchema,
  bulkAddToCampaignRoles: bulkRolesSchema,
  adsPerformanceNavItems: z.array(z.string()).optional()
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
    if (data.password) {
      const reused = await isPasswordReused(data.id, data.password);
      if (reused) {
        return {
          ok: false,
          message: "This password has been used previously by this user. Historical passwords cannot be reused."
        };
      }
    }

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

    if (data.password) {
      await recordPasswordChange(data.id, data.password, data.email);
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

    if (existingProfile?.id) {
      const reused = await isPasswordReused(existingProfile.id, data.password);
      if (reused) {
        return {
          ok: false,
          message: "This password has been used previously by this user. Historical passwords cannot be reused."
        };
      }
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

    await recordPasswordChange(created.user.id, data.password, data.email);

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
  revalidatePath("/library"); invalidateLibraryCache();
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
  revalidatePath("/library"); invalidateLibraryCache();
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
  revalidatePath("/library"); invalidateLibraryCache();
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
  revalidatePath("/library"); invalidateLibraryCache();
  return { ok: true };
}

export async function deleteCampaign(id: string) {
  const adminProfile = await requireRole(["admin"]);
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, message: "Invalid campaign id." };

  // Recycle Bin: the campaign stays restorable for the retention window. Its creatives are not deleted;
  // they only lose the campaign association.
  if (await isRecycleBinReady()) {
    const moved = await softDeleteCampaign(parsedId.data, adminProfile.id);
    if (!moved.ok) return { ok: false, message: moved.message };
    revalidatePath("/admin/settings");
    revalidatePath("/campaigns");
    revalidatePath("/dashboard");
    revalidatePath("/library"); invalidateLibraryCache();
    revalidatePath("/analytics");
    return { ok: true, movedToRecycleBin: true, creativeCount: moved.creativeCount ?? 0 };
  }

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
  revalidatePath("/library"); invalidateLibraryCache();
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
  revalidatePath("/library"); invalidateLibraryCache();
  return { ok: true };
}

export async function updateSettings(payload: {
  twoStepApproval: boolean;
  deadlineReminderDays: number;
  maxConcurrentEdits: number;
  allowManagerFinalApproval?: boolean;
  managerCreativeScope?: ManagerCreativeScope;
  hiddenMetricsByRole?: HiddenMetricsByRole;
  bulkAddToCampaignRoles?: UserRole[];
  adsPerformanceNavItems?: AdsPerformanceNavItemKey[];
}) {
  const adminProfile = await requireRole(["admin"]);
  const parsed = settingsSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid settings." };
  }

  const admin = createSupabaseAdminClient();
  const allowManager = parsed.data.allowManagerFinalApproval !== undefined
    ? parsed.data.allowManagerFinalApproval
    : !parsed.data.twoStepApproval;

  if (parsed.data.hiddenMetricsByRole || parsed.data.managerCreativeScope || parsed.data.bulkAddToCampaignRoles || parsed.data.adsPerformanceNavItems) {
    await writeMetricVisibilityFile(
      parsed.data.hiddenMetricsByRole ?? {},
      parsed.data.managerCreativeScope,
      parsed.data.bulkAddToCampaignRoles,
      {
        ads_performance_nav_items: parsed.data.adsPerformanceNavItems as AdsPerformanceNavItemKey[] | undefined
      }
    );
  }

  const patch: Record<string, unknown> = {
    two_step_approval: !allowManager,
    deadline_reminder_days: parsed.data.deadlineReminderDays,
    max_concurrent_edits: parsed.data.maxConcurrentEdits,
    allow_manager_final_approval: allowManager
  };

  if (parsed.data.managerCreativeScope) {
    patch.manager_creative_scope = parsed.data.managerCreativeScope;
  }

  if (parsed.data.hiddenMetricsByRole) {
    patch.hidden_metrics_by_role = parsed.data.hiddenMetricsByRole;
  }

  if (parsed.data.bulkAddToCampaignRoles) {
    patch.bulk_add_to_campaign_roles = parsed.data.bulkAddToCampaignRoles;
  }

  let { error } = await admin.from("app_settings").update(patch).eq("id", 1);

  if (error && (error.code === "PGRST204" || error.message.includes("manager_creative_scope"))) {
    delete patch.manager_creative_scope;
    const retry = await admin.from("app_settings").update(patch).eq("id", 1);
    error = retry.error;
  }

  if (error && (error.code === "PGRST204" || error.message.includes("hidden_metrics_by_role"))) {
    delete patch.hidden_metrics_by_role;
    const retry = await admin.from("app_settings").update(patch).eq("id", 1);
    error = retry.error;
  }

  if (error && (error.code === "PGRST204" || error.message.includes("allow_manager_final_approval"))) {
    delete patch.allow_manager_final_approval;
    const retry = await admin.from("app_settings").update(patch).eq("id", 1);
    error = retry.error;
  }

  if (error && (error.code === "PGRST204" || error.message.includes("bulk_add_to_campaign_roles"))) {
    delete patch.bulk_add_to_campaign_roles;
    const retry = await admin.from("app_settings").update(patch).eq("id", 1);
    error = retry.error;
  }

  if (error) {
    return { ok: false, message: error.message };
  }

  await audit(adminProfile.id, "updated_settings", "app_settings", "1", parsed.data);
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");
  revalidatePath("/incentives");
  revalidatePath("/library"); invalidateLibraryCache();
  return { ok: true };
}

export async function updateMetricVisibilitySettings(payload: {
  hiddenMetricsByRole: HiddenMetricsByRole;
  managerCreativeScope?: ManagerCreativeScope;
  overviewMetrics?: PerformanceMetricKey[];
  overrideAllUsers?: boolean;
  usersWithAllAdsAccess?: string[];
  hiddenCampaignsByUser?: Record<string, string[]>;
  hiddenCreativesByUser?: Record<string, string[]>;
  allowedCreativesByUser?: Record<string, string[]>;
  campaignVisibleUsers?: Record<string, string[]>;
  adsPerformanceNavItems?: AdsPerformanceNavItemKey[];
}) {
  const adminProfile = await requireRole(["admin"]);
  const parsed = hiddenMetricsSchema.safeParse(payload.hiddenMetricsByRole);
  if (!parsed.success) {
    return { ok: false, message: "Invalid metric visibility settings." };
  }

  const hiddenMetrics = parsed.data ?? {};
  await writeMetricVisibilityFile(hiddenMetrics, payload.managerCreativeScope, undefined, {
    overview_metrics: payload.overviewMetrics,
    override_all_users: payload.overrideAllUsers,
    users_with_all_ads_access: payload.usersWithAllAdsAccess,
    hidden_campaigns_by_user: payload.hiddenCampaignsByUser,
    hidden_creatives_by_user: payload.hiddenCreativesByUser,
    allowed_creatives_by_user: payload.allowedCreativesByUser,
    campaign_visible_users: payload.campaignVisibleUsers,
    ads_performance_nav_items: payload.adsPerformanceNavItems
  });

  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = {
    hidden_metrics_by_role: hiddenMetrics
  };

  if (payload.managerCreativeScope) {
    patch.manager_creative_scope = payload.managerCreativeScope;
  }

  let { error } = await admin.from("app_settings").update(patch).eq("id", 1);
  if (error && (error.code === "PGRST204" || error.message.includes("manager_creative_scope"))) {
    delete patch.manager_creative_scope;
    const retry = await admin.from("app_settings").update(patch).eq("id", 1);
    error = retry.error;
  }
  if (error && (error.code === "PGRST204" || error.message.includes("hidden_metrics_by_role"))) {
    error = null;
  }

  if (error) {
    return { ok: false, message: error.message };
  }

  await audit(adminProfile.id, "updated_metric_visibility", "app_settings", "1", {
    hiddenMetrics,
    managerCreativeScope: payload.managerCreativeScope,
    overviewMetrics: payload.overviewMetrics,
    overrideAllUsers: payload.overrideAllUsers,
    usersWithAllAdsAccess: payload.usersWithAllAdsAccess,
    hiddenCampaignsByUser: payload.hiddenCampaignsByUser,
    hiddenCreativesByUser: payload.hiddenCreativesByUser,
    allowedCreativesByUser: payload.allowedCreativesByUser,
    campaignVisibleUsers: payload.campaignVisibleUsers,
    adsPerformanceNavItems: payload.adsPerformanceNavItems
  });
  revalidatePath("/", "layout");
  revalidatePath("/incentives");
  revalidatePath("/admin/settings");
  return { ok: true, message: "Ads performance settings saved." };
}

export async function updateUserCreativeVisibility(payload: {
  userId: string;
  creativeId: string;
  action: "hide" | "show" | "reset";
}) {
  await requireRole(["admin"]);
  const { readMetricVisibilityFile, writeMetricVisibilityFile } = await import("@/lib/metric-visibility-server");
  const config = await readMetricVisibilityFile();

  const hidden = { ...(config.hidden_creatives_by_user ?? {}) };
  const allowed = { ...(config.allowed_creatives_by_user ?? {}) };

  const userHidden = new Set(hidden[payload.userId] ?? []);
  const userAllowed = new Set(allowed[payload.userId] ?? []);

  if (payload.action === "hide") {
    userHidden.add(payload.creativeId);
    userAllowed.delete(payload.creativeId);
  } else if (payload.action === "show") {
    userHidden.delete(payload.creativeId);
    userAllowed.add(payload.creativeId);
  } else {
    userHidden.delete(payload.creativeId);
    userAllowed.delete(payload.creativeId);
  }

  hidden[payload.userId] = [...userHidden];
  allowed[payload.userId] = [...userAllowed];

  await writeMetricVisibilityFile(config, config.manager_creative_scope, config.bulk_add_to_campaign_roles, {
    overview_metrics: config.overview_metrics,
    override_all_users: config.override_all_users,
    users_with_all_ads_access: config.users_with_all_ads_access,
    hidden_campaigns_by_user: config.hidden_campaigns_by_user,
    hidden_creatives_by_user: hidden,
    allowed_creatives_by_user: allowed,
    campaign_visible_users: config.campaign_visible_users,
    ads_performance_nav_items: config.ads_performance_nav_items
  });

  revalidatePath("/incentives");
  return { ok: true, hiddenCount: userHidden.size, allowedCount: userAllowed.size };
}

export async function bulkUpdateUserCreativeVisibility(payload: {
  userId: string;
  creativeIds: string[];
  action: "hide_all" | "show_all";
}) {
  await requireRole(["admin"]);
  const { readMetricVisibilityFile, writeMetricVisibilityFile } = await import("@/lib/metric-visibility-server");
  const config = await readMetricVisibilityFile();

  const hidden = { ...(config.hidden_creatives_by_user ?? {}) };
  const allowed = { ...(config.allowed_creatives_by_user ?? {}) };

  if (payload.action === "show_all") {
    hidden[payload.userId] = [];
    allowed[payload.userId] = [...payload.creativeIds];
  } else {
    hidden[payload.userId] = [...payload.creativeIds];
    allowed[payload.userId] = [];
  }

  await writeMetricVisibilityFile(config, config.manager_creative_scope, config.bulk_add_to_campaign_roles, {
    overview_metrics: config.overview_metrics,
    override_all_users: config.override_all_users,
    users_with_all_ads_access: config.users_with_all_ads_access,
    hidden_campaigns_by_user: config.hidden_campaigns_by_user,
    hidden_creatives_by_user: hidden,
    allowed_creatives_by_user: allowed,
    campaign_visible_users: config.campaign_visible_users,
    ads_performance_nav_items: config.ads_performance_nav_items
  });

  revalidatePath("/incentives");
  return { ok: true };
}

export async function updateCampaignUserVisibility(payload: {
  campaignId: string;
  visibleUserIds: string[];
}) {
  await requireRole(["admin"]);
  const { readMetricVisibilityFile, writeMetricVisibilityFile } = await import("@/lib/metric-visibility-server");
  const config = await readMetricVisibilityFile();

  const campaignUsers = { ...(config.campaign_visible_users ?? {}) };
  campaignUsers[payload.campaignId] = payload.visibleUserIds;

  try {
    await writeMetricVisibilityFile(config, config.manager_creative_scope, config.bulk_add_to_campaign_roles, {
      overview_metrics: config.overview_metrics,
      override_all_users: config.override_all_users,
      users_with_all_ads_access: config.users_with_all_ads_access,
      hidden_campaigns_by_user: config.hidden_campaigns_by_user,
      hidden_creatives_by_user: config.hidden_creatives_by_user,
      allowed_creatives_by_user: config.allowed_creatives_by_user,
      campaign_visible_users: campaignUsers,
      ads_performance_nav_items: config.ads_performance_nav_items
    }, { strict: true });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save campaign access." };
  }

  revalidatePath("/incentives");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateCampaignPlacement(payload: {
  campaignId: string;
  placement: import("@/lib/metric-visibility").CampaignPlacement | null;
}) {
  await requireRole(["admin"]);
  const { readMetricVisibilityFile, writeMetricVisibilityFile, sanitizePlacement } = await import("@/lib/metric-visibility-server");
  const config = await readMetricVisibilityFile();

  const placements = { ...(config.campaign_placements ?? {}) };
  const clean = payload.placement ? sanitizePlacement(payload.placement) : null;
  if (payload.placement && payload.placement.mode !== "campaigns_only" && !clean) {
    return { ok: false, message: "Choose a valid destination for this campaign." };
  }
  if (clean) placements[payload.campaignId] = clean;
  else delete placements[payload.campaignId];

  try {
    await writeMetricVisibilityFile(config, config.manager_creative_scope, config.bulk_add_to_campaign_roles, {
      campaign_placements: placements
    }, { strict: true });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save placement." };
  }

  revalidatePath("/incentives");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function verifyAndCarryForwardAttributions() {
  await requireRole(["admin", "manager"]);
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  // 1. Fetch library ads with tags
  const { data: ads, error: adsError } = await admin
    .from("ads")
    .select("id, name, product_id, creator_id, editor_id");
  if (adsError) return { ok: false, message: adsError.message };

  const adByName = new Map<string, typeof ads[0]>();
  for (const a of ads || []) {
    const tag = (a.name || "").trim().toUpperCase();
    if (tag.length >= 4 && /[A-Z]/.test(tag) && /\d/.test(tag) && !/[^A-Z0-9]/.test(tag)) {
      adByName.set(tag, a);
    }
  }

  // 2. Fetch all meta_ad_assets
  const { data: assets, error: assetsError } = await admin
    .from("meta_ad_assets")
    .select("id, meta_ad_id, asset_label, video_id, creative_id");
  if (assetsError) return { ok: false, message: assetsError.message };

  const assetMappingRows: Array<Record<string, unknown>> = [];
  for (const asset of assets || []) {
    if (!asset.video_id) continue;
    const label = (asset.asset_label || "").toUpperCase();
    for (const [tag, ad] of adByName.entries()) {
      if (label.includes(tag)) {
        const mappingKey = ["meta", asset.meta_ad_id, "creative", asset.creative_id || "primary", "video", asset.video_id].join(":");
        assetMappingRows.push({
          mapping_key: mappingKey,
          meta_ad_id: asset.meta_ad_id,
          meta_creative_id: asset.creative_id || null,
          meta_video_id: asset.video_id,
          transcript_source: "exact_creative_id",
          transcript_status: "available",
          matched_ad_id: ad.id,
          match_score: 1.0,
          match_confidence: "high",
          matched_tokens: 1,
          transcript_token_count: 0,
          script_token_count: 0,
          review_status: "confirmed_match",
          review_note: `Deterministic asset tag match: ${tag} in ${asset.asset_label}`,
          reviewed_at: now,
          mapped_at: now
        });
        break;
      }
    }
  }

  if (assetMappingRows.length) {
    for (let i = 0; i < assetMappingRows.length; i += 50) {
      await admin.from("meta_ad_transcript_mappings").upsert(assetMappingRows.slice(i, i + 50), { onConflict: "mapping_key" });
    }
  }

  // 3. Scan meta_ads that have spend >= 1000 or top orders and check attribution
  const { data: topAds } = await admin
    .from("meta_ads")
    .select("id, name, creative_name, spend, purchases, matched_ad_id, detected_tag")
    .gte("spend", 1000)
    .order("spend", { ascending: false });

  let updatedAdLevel = 0;
  for (const ma of topAds || []) {
    if (ma.matched_ad_id) continue;
    const tokens = new Set(`${ma.name || ""} ${ma.creative_name || ""}`.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
    for (const [tag, ad] of adByName.entries()) {
      if (tokens.has(tag)) {
        await admin
          .from("meta_ads")
          .update({
            matched_ad_id: ad.id,
            matched_creator_id: ad.creator_id,
            matched_editor_id: ad.editor_id,
            detected_tag: tag,
            auto_matched_at: now
          })
          .eq("id", ma.id);
        updatedAdLevel++;
        break;
      }
    }
  }

  // 4. Check active campaigns and auto-link eligible attributed ads
  const { data: activeCampaigns } = await admin
    .from("incentive_campaigns")
    .select("id, product_id, starts_on, ends_on")
    .eq("active", true);

  let newIncentiveLinks = 0;
  if (activeCampaigns && activeCampaigns.length > 0) {
    const { data: existingLinks } = await admin.from("incentive_creatives").select("meta_ad_id, ad_id");
    const linkedMeta = new Set((existingLinks || []).map((l) => l.meta_ad_id));

    const { data: allReadyAds } = await admin
      .from("meta_ads")
      .select("id, matched_ad_id, created_time")
      .not("matched_ad_id", "is", null);

    const adLookup = new Map((ads || []).map((a) => [a.id, a]));

    const linksToCreate = [];
    for (const ma of allReadyAds || []) {
      if (linkedMeta.has(ma.id)) continue;
      const dbAd = adLookup.get(ma.matched_ad_id);
      if (!dbAd) continue;
      const camp = activeCampaigns.find((c) => c.product_id === dbAd.product_id) || activeCampaigns[0];
      if (camp) {
        linksToCreate.push({
          incentive_campaign_id: camp.id,
          ad_id: dbAd.id,
          meta_ad_id: ma.id,
          launched_on: (ma.created_time || now).slice(0, 10),
          creator_id: dbAd.creator_id,
          editor_id: dbAd.editor_id,
          attribution_source: "auto",
          auto_matched_at: now
        });
        linkedMeta.add(ma.id);
      }
    }

    if (linksToCreate.length) {
      const { data: inserted, error: linkErr } = await admin
        .from("incentive_creatives")
        .insert(linksToCreate)
        .select("id");
      if (!linkErr && inserted) newIncentiveLinks = inserted.length;
    }
  }

  revalidatePath("/incentives");
  return {
    ok: true,
    deterministicAssetMappings: assetMappingRows.length,
    updatedAdLevel,
    newIncentiveLinks,
    message: `Verified and carried forward attributions: ${assetMappingRows.length} video assets mapped, ${updatedAdLevel} ads tagged, ${newIncentiveLinks} creatives linked.`
  };
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
