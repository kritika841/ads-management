"use server";

import { revalidatePath } from "next/cache";
import { invalidateLibraryCache } from "@/lib/library-cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deleteCampaignGoal, writeCampaignGoal } from "@/lib/campaign-goals";
import { isRecycleBinReady, softDeleteCampaign } from "@/lib/recycle-bin";

const campaignPayloadSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Campaign name is required.").max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  videoGoal: z.preprocess(
    (val) => (val === "" || val === undefined || val === null ? null : val),
    z.coerce.number().int().min(1).nullable().optional()
  ),
  active: z.boolean().default(true)
});

export async function saveInternalCampaign(payload: z.input<typeof campaignPayloadSchema>) {
  try {
    const profile = await requireProfile();
    if (profile.role !== "admin" && profile.role !== "manager") {
      return { ok: false, message: "Only managers and admins can create or edit campaigns." };
    }
    const parsed = campaignPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid campaign data." };
    }

    const data = parsed.data;
    const admin = createSupabaseAdminClient();

    // The Supabase campaigns table schema has columns: id, name, description, active, created_at, updated_at, deleted_at, deleted_by.
    // video_goal is managed separately via writeCampaignGoal / campaign-goals.json to prevent PGRST204 errors.
    const patch = {
      name: data.name,
      description: data.description || null,
      active: data.active
    };

    const { data: savedCampaign, error } = data.id
      ? await admin.from("campaigns").update(patch).eq("id", data.id).select("*").single()
      : await admin.from("campaigns").insert(patch).select("*").single();

    if (error) {
      return {
        ok: false,
        message: error.code === "23505" ? "A campaign with this name already exists." : error.message
      };
    }

    const campaignId = savedCampaign?.id ?? data.id;
    if (campaignId) {
      await writeCampaignGoal(campaignId, data.videoGoal != null && data.videoGoal > 0 ? data.videoGoal : null);
    }

    if (savedCampaign) {
      savedCampaign.video_goal = data.videoGoal != null && data.videoGoal > 0 ? data.videoGoal : null;
    }

    revalidatePath("/campaigns");
    if (campaignId) {
      revalidatePath(`/campaigns/${campaignId}`);
    }

    return { ok: true, campaign: savedCampaign };
  } catch (err) {
    console.error("Failed to save internal campaign:", err);
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Failed to save campaign. Please try again."
    };
  }
}

export async function deleteInternalCampaign(id: string) {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only managers and admins can delete campaigns." };
  }

  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) {
    return { ok: false, message: "Invalid campaign ID." };
  }

  // Recycle Bin: the campaign stays restorable for the retention window. Its creatives are not deleted;
  // they only lose the campaign association.
  if (await isRecycleBinReady()) {
    const moved = await softDeleteCampaign(parsedId.data, profile.id);
    if (!moved.ok) return { ok: false, message: moved.message };
    revalidatePath("/campaigns");
    revalidatePath("/dashboard");
    revalidatePath("/library"); invalidateLibraryCache();
    revalidatePath("/analytics");
    revalidatePath("/admin/settings");
    return { ok: true, movedToRecycleBin: true, creativeCount: moved.creativeCount ?? 0 };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("campaigns").delete().eq("id", parsedId.data);
  if (error) {
    return { ok: false, message: error.message };
  }

  await deleteCampaignGoal(parsedId.data);

  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
  revalidatePath("/library"); invalidateLibraryCache();
  return { ok: true };
}
