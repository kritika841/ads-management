"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { invalidateLibraryCache } from "@/lib/library-cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const protectedTags = new Set(["downloaded"]);

/**
 * Admin/manager: delete a tag everywhere. Creatives keep existing — only the tag is removed
 * from them. System tags (e.g. "downloaded") are protected.
 */
export async function deleteTag(tagId: string) {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only managers and admins can delete tags." };
  }
  if (!z.string().uuid().safeParse(tagId).success) return { ok: false, message: "Choose a tag." };

  const admin = createSupabaseAdminClient();
  const { data: tag, error } = await admin.from("tags").select("id,name").eq("id", tagId).maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!tag) return { ok: false, message: "This tag no longer exists." };
  if (protectedTags.has(tag.name.trim().toLowerCase())) {
    return { ok: false, message: `"${tag.name}" is a system tag and can't be deleted.` };
  }

  const { count: removedFrom, error: unlinkError } = await admin.from("ad_tags").delete({ count: "exact" }).eq("tag_id", tag.id);
  if (unlinkError) return { ok: false, message: unlinkError.message };
  const { error: deleteError } = await admin.from("tags").delete().eq("id", tag.id);
  if (deleteError) return { ok: false, message: deleteError.message };

  try {
    await admin.from("audit_logs").insert({
      actor_id: profile.id,
      action: "tag_deleted",
      target_type: "tag",
      target_id: tag.id,
      metadata: { name: tag.name, removed_from_creatives: removedFrom ?? 0 }
    });
  } catch (auditError) {
    console.warn("Non-fatal issue inserting audit log:", auditError);
  }

  revalidatePath("/tags");
  revalidatePath("/library"); invalidateLibraryCache();
  revalidatePath("/campaigns", "layout");
  return { ok: true, removedFrom: removedFrom ?? 0, message: `Deleted #${tag.name}${removedFrom ? ` from ${removedFrom} creative${removedFrom === 1 ? "" : "s"}` : ""}.` };
}
