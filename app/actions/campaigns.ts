"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const campaignPayloadSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Campaign name is required.").max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  videoGoal: z.coerce.number().int().min(0).default(10),
  active: z.boolean().default(true)
});

export async function saveInternalCampaign(payload: z.input<typeof campaignPayloadSchema>) {
  const profile = await requireProfile();
  const parsed = campaignPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid campaign data." };
  }

  const data = parsed.data;
  const admin = createSupabaseAdminClient();

  const fullPatch = {
    name: data.name,
    description: data.description || null,
    video_goal: data.videoGoal,
    active: data.active
  };

  // Attempt with video_goal first
  let { data: savedCampaign, error } = data.id
    ? await admin.from("campaigns").update(fullPatch).eq("id", data.id).select("*").single()
    : await admin.from("campaigns").insert(fullPatch).select("*").single();

  // If column doesn't exist on remote yet, fallback gracefully
  if (error && (error.message?.includes("video_goal") || error.code === "PGRST204" || error.code === "42703")) {
    const fallbackPatch = {
      name: data.name,
      description: data.description || null,
      active: data.active
    };
    const retry = data.id
      ? await admin.from("campaigns").update(fallbackPatch).eq("id", data.id).select("*").single()
      : await admin.from("campaigns").insert(fallbackPatch).select("*").single();
    savedCampaign = retry.data;
    error = retry.error;
  }

  if (error) {
    return {
      ok: false,
      message: error.code === "23505" ? "A campaign with this name already exists." : error.message
    };
  }

  revalidatePath("/campaigns");
  if (data.id) {
    revalidatePath(`/campaigns/${data.id}`);
  }
  revalidatePath("/dashboard");
  revalidatePath("/library");

  return { ok: true, campaign: savedCampaign };
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

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("campaigns").delete().eq("id", parsedId.data);
  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
  revalidatePath("/library");
  return { ok: true };
}
