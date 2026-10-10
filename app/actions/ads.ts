"use server";

import { revalidatePath } from "next/cache";
import { invalidateDashboardCache } from "@/lib/dashboard-cache";
import { invalidateLibraryCache } from "@/lib/library-cache";
import { z } from "zod";
import { canReview, requireProfile } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasAdAccess } from "@/lib/ad-access";
import { canBulkAddToCampaign, canDeleteAd } from "@/lib/permissions";
import { canAssignCreator, isCreatorCapableRole } from "@/lib/creators";
import { getAppSettings } from "@/lib/data";
import {
  activeEditorStages,
  canToggleEditingFreeze,
  creatorControlledStages,
  creatorEditableStages,
  inProgressEditingStages,
  legacyStatusForProductionStage
} from "@/lib/production-workflow";
import { getDriveMetadata } from "@/lib/drive";
import { parseGoogleDriveVideoFileUrl } from "@/lib/drive-urls";
import { extractMentions, profileMentionHandles } from "@/lib/mentions";
import { createNotification } from "@/lib/notifications";
import { sanitizeScriptHtml } from "@/lib/sanitize";
import { validateReviewInput } from "@/lib/workflow";
import { isRecycleBinReady, liveOnly, softDeleteAd } from "@/lib/recycle-bin";
import { planEditorAssignment, reassignableEditorStages, type EditorAssignmentKind } from "@/lib/editor-assignment";
import type { Ad, Profile } from "@/lib/types";

const creatorItemSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Ad name is required.").max(160),
  campaignId: z.string().uuid({ message: "Choose a campaign." }),
  productId: z.string().uuid({ message: "Choose a product." }),
  creatorId: z.string().uuid({ message: "Choose a content creator." }),
  scriptHtml: z.string().optional().nullable(),
  scriptText: z.string().trim().min(1, "Script is required."),
  stage: z.enum(["script_writing", "ready_to_shoot", "shoot_complete", "ready_for_edit"]),
  editorId: z.string().uuid().optional().or(z.literal("")),
  rawFootageUrl: z.string().trim().optional().or(z.literal("")),
  platforms: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  deadline: z.string().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable()
});

const editorSubmissionSchema = z.object({
  adId: z.string().uuid(),
  driveUrl: z.string().trim().url("Use a valid Google Drive video URL."),
  editorNotes: z.string().trim().max(4000).optional().nullable(),
  changesConfirmed: z.boolean().default(false)
});

const reassignEditorSchema = z.object({
  adId: z.string().uuid(),
  editorId: z.string().uuid(),
  deadline: z.string().trim().min(1, "Choose a deadline."),
  reason: z.string().trim().min(1, "A reassignment reason is required.").max(1000)
});

const unfreezeEditingSchema = z.object({
  adId: z.string().uuid()
});

export async function saveCreatorItem(payload: z.input<typeof creatorItemSchema>) {
  const profile = await requireProfile();
  if (profile.role !== "content_creator" && profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only content creators, managers, and admins can prepare creator work." };
  }

  const parsed = creatorItemSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid creator item." };
  }
  const data = parsed.data;
  if (profile.role === "content_creator" && data.creatorId !== profile.id) {
    return { ok: false, message: "Content creators can only create work under their own account." };
  }

  const admin = createSupabaseAdminClient();

  if (!data.id && (profile.role === "content_creator" || profile.role === "manager" || profile.role === "admin")) {
    const binReady = await isRecycleBinReady();
    const { data: userAds } = await liveOnly(
      admin
        .from("ads")
        .select("id, creator_id, production_stage, deleted_at")
        .eq("production_stage", "creator_changes_requested"),
      binReady
    );

    const activeUserAds = (userAds ?? []).filter((ad) => !ad.deleted_at);

    if (activeUserAds.length > 0) {
      const directMatch = activeUserAds.some((ad) => ad.creator_id === profile.id);
      if (directMatch) {
        return { ok: false, message: "You must resolve requested changes before creating another creative." };
      }

      // Only managers authoring on behalf of another creator get blocked by activity logs.
      // Content creators only ever own ads where ad.creator_id === profile.id.
      // Admins are exempt from authored-on-behalf blocks.
      if (profile.role === "manager") {
        const adIds = activeUserAds.map((ad) => ad.id);
        const { data: createdLogs } = await admin
          .from("activity_logs")
          .select("ad_id")
          .in("ad_id", adIds)
          .eq("actor_id", profile.id)
          .eq("action", "creator_item_created")
          .limit(1);

        if (createdLogs && createdLogs.length > 0) {
          return { ok: false, message: "You must resolve requested changes before creating another creative." };
        }
      }
    }
  }

  // Managers and admins inherit the creator behaviour: they may author as
  // themselves, and admins may also author on behalf of managers. The chosen
  // creator must be an active, creator-capable profile the actor may act for.
  const { data: creatorProfile, error: creatorError } = await admin
    .from("profiles")
    .select("id, role, active")
    .eq("id", data.creatorId)
    .maybeSingle();

  if (creatorError) {
    return { ok: false, message: creatorError.message };
  }
  let unchangedCreator = false;
  if (data.id) {
    const { data: existingCreatorRow } = await admin.from("ads").select("creator_id").eq("id", data.id).maybeSingle();
    unchangedCreator = existingCreatorRow?.creator_id === data.creatorId;
  }
  if (!unchangedCreator && (!creatorProfile || !canAssignCreator({ id: profile.id, role: profile.role }, creatorProfile as { id: string; role: string; active: boolean }))) {
    return { ok: false, message: "Choose an active creator you are allowed to create work for." };
  }


  const { data: product, error: productError } = await admin
    .from("products")
    .select("id")
    .eq("id", data.productId)
    .eq("active", true)
    .maybeSingle();
  if (productError || !product) {
    return { ok: false, message: productError?.message ?? "Choose an active product." };
  }

  let currentAd: Ad | null = null;
  if (data.id) {
    const { data: existing, error } = await admin.from("ads").select("*").eq("id", data.id).maybeSingle();
    if (error || !existing) return { ok: false, message: error?.message ?? "Ad not found." };
    currentAd = existing as Ad;
    if (!creatorEditableStages.includes(currentAd.production_stage as (typeof creatorEditableStages)[number])) {
      return { ok: false, message: "Creator fields are locked after the editor handoff." };
    }
    if (profile.role === "content_creator" && currentAd.creator_id !== profile.id) {
      return { ok: false, message: "You do not have permission to edit this creator item." };
    }
  }

  const handingOff = data.stage === "ready_for_edit";
  const stageIndex = creatorControlledStages.indexOf(data.stage);
  const requiresRawFootage = stageIndex >= creatorControlledStages.indexOf("shoot_complete");

  let rawFootageUrl: string | null = currentAd?.raw_footage_url ?? null;
  if (requiresRawFootage) {
    const rawUrlError = validateGoogleDriveUrl(data.rawFootageUrl, "raw footage folder");
    if (rawUrlError) return { ok: false, message: rawUrlError };
    rawFootageUrl = data.rawFootageUrl!.trim();
  }

  // Creator-form saves never clear an existing editor. Clearing is a privileged,
  // explicitly reasoned operation handled by the dedicated assignment RPC.
  let editorId: string | null = currentAd?.editor_id ?? null;
  if (data.editorId) {
    if (!data.deadline) return { ok: false, message: "Choose a deadline before assigning an editor." };
    const { data: editor, error: editorError } = await admin
      .from("profiles")
      .select("id")
      .eq("id", data.editorId)
      .eq("role", "editor")
      .eq("active", true)
      .maybeSingle();
    if (editorError || !editor) return { ok: false, message: editorError?.message ?? "Choose an active editor." };
    editorId = editor.id;
  }

  const now = new Date().toISOString();
  const assignedAt = editorId ? (currentAd?.editor_id === editorId && currentAd?.assigned_at ? currentAd.assigned_at : now) : null;
  const patch = {
    name: data.name,
    campaign_id: data.campaignId,
    product_id: data.productId,
    creator_id: data.creatorId,
    editor_id: editorId,
    assigned_at: assignedAt,
    production_stage: data.stage,
    raw_footage_url: rawFootageUrl,
    script_html: sanitizeScriptHtml(data.scriptHtml) || null,
    script_text: data.scriptText,
    ad_type: "video" as const,
    platforms: data.platforms,
    deadline: data.deadline || null,
    notes: data.notes || null,
    approval_stage: "manager_review" as const,
    script_ready_at: stageIndex >= 1 ? currentAd?.script_ready_at ?? now : null,
    shoot_completed_at: stageIndex >= 2 ? currentAd?.shoot_completed_at ?? now : null,
    raw_footage_shared_at: requiresRawFootage ? currentAd?.raw_footage_shared_at ?? now : null,
    editing_started_at: null,
    creator_reviewed_at: null,
    final_approved_at: null
  };

  const { data: savedRow, error: saveError } = currentAd
    ? await admin.from("ads").update(patch).eq("id", currentAd.id).select("*").single()
    : await admin.from("ads").insert(patch).select("*").single();
  if (saveError || !savedRow) {
    return { ok: false, message: saveError ? friendlyAdSaveError(saveError) : "Unable to save creator work." };
  }
  const saved = savedRow as Ad;

  const tagError = await syncTags(saved.id, data.tags);
  if (tagError) return { ok: false, message: `The item was saved, but its tags could not be updated: ${tagError}` };

  await logActivity(saved.id, profile.id, currentAd ? "creator_item_updated" : "creator_item_created", {
    previous_stage: currentAd?.production_stage ?? null,
    production_stage: data.stage,
    editor_id: editorId
  });

  const newHandoff = handingOff && (currentAd?.production_stage !== "ready_for_edit" || currentAd.editor_id !== editorId);
  if (newHandoff && editorId) {
    await notifyUserIds(admin, [editorId], saved.id, "New editing assignment", `${profile.name} assigned ${saved.name} to you. The script and raw footage are ready.`);
  }

  revalidateAdPaths(saved.id);
  return { ok: true, adId: saved.id };
}

/**
 * Admin / manager override: edit ALL fields of any creative regardless of production stage.
 * The creator_id is intentionally excluded — it cannot be changed.
 */
const adminOverrideSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Ad name is required.").max(160),
  campaignId: z.string().uuid({ message: "Choose a campaign." }),
  productId: z.string().uuid({ message: "Choose a product." }),
  scriptHtml: z.string().optional().nullable(),
  scriptText: z.string().trim().min(1, "Script is required."),
    stage: z.enum(["script_writing", "ready_to_shoot", "shoot_complete", "ready_for_edit", "editing", "creator_review", "final_review", "creator_changes_requested", "changes_requested", "approved"]),
  editorId: z.string().uuid().optional().or(z.literal("")),
  rawFootageUrl: z.string().trim().optional().or(z.literal("")),
  platforms: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  deadline: z.string().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  driveUrl: z.string().trim().optional().or(z.literal("")),
});

export async function adminOverrideCreativeEdit(payload: z.input<typeof adminOverrideSchema>) {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only admins and managers can use override edit." };
  }

  const parsed = adminOverrideSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid payload." };
  }
  const data = parsed.data;

  const admin = createSupabaseAdminClient();
  const { data: existing, error: fetchError } = await admin.from("ads").select("*").eq("id", data.id).maybeSingle();
  if (fetchError || !existing) return { ok: false, message: fetchError?.message ?? "Ad not found." };
  const currentAd = existing as Ad;

  // Validate editor if provided
  let editorId: string | null = currentAd.editor_id;
  if (data.editorId !== undefined) {
    if (!data.editorId) {
      editorId = null;
    } else {
      const { data: editor, error: editorError } = await admin.from("profiles").select("id").eq("id", data.editorId).eq("role", "editor").eq("active", true).maybeSingle();
      if (editorError || !editor) return { ok: false, message: editorError?.message ?? "Choose an active editor." };
      editorId = editor.id;
    }
  }

  let drivePreview: ReturnType<typeof parseGoogleDriveVideoFileUrl>["result"] = null;
  let driveThumbnail: string | null = null;
  if (data.driveUrl?.trim()) {
    const driveResult = parseGoogleDriveVideoFileUrl(data.driveUrl.trim());
    if (driveResult.error || !driveResult.result) {
      return { ok: false, message: driveResult.error ?? "Use a valid Google Drive video file URL." };
    }
    drivePreview = driveResult.result;
    const metadata = await getDriveMetadata(drivePreview.fileId).catch(() => null);
    driveThumbnail = drivePreview.thumbnailUrl || metadata?.thumbnailLink || null;
  }

  const now = new Date().toISOString();
  const stageIndex = ["script_writing", "ready_to_shoot", "shoot_complete", "ready_for_edit", "editing", "creator_review", "final_review", "creator_changes_requested", "changes_requested", "approved"].indexOf(data.stage);
  const assignedAt = editorId ? (currentAd.editor_id === editorId && currentAd.assigned_at ? currentAd.assigned_at : now) : null;

  const patch: Record<string, unknown> = {
    name: data.name,
    campaign_id: data.campaignId,
    product_id: data.productId,
    // creator_id intentionally omitted — cannot be changed
    editor_id: editorId,
    assigned_at: assignedAt,
    production_stage: data.stage,
    raw_footage_url: data.rawFootageUrl?.trim() || currentAd.raw_footage_url,
    script_html: sanitizeScriptHtml(data.scriptHtml) || null,
    script_text: data.scriptText,
    platforms: data.platforms,
    deadline: data.deadline || null,
    notes: data.notes || null,
    script_ready_at: stageIndex >= 1 ? currentAd.script_ready_at ?? now : null,
    shoot_completed_at: stageIndex >= 2 ? currentAd.shoot_completed_at ?? now : null,
    raw_footage_shared_at: stageIndex >= 3 ? currentAd.raw_footage_shared_at ?? now : null,
    editing_started_at: stageIndex >= 4 ? currentAd.editing_started_at ?? now : null,
    creator_reviewed_at: stageIndex >= 5 ? currentAd.creator_reviewed_at ?? now : null,
    final_approved_at: stageIndex >= 8 ? currentAd.final_approved_at ?? now : null,
  };

  if (drivePreview) {
    patch.drive_url = data.driveUrl!.trim();
    patch.drive_file_id = drivePreview.fileId;
    patch.preview_url = drivePreview.previewUrl;
    patch.thumbnail_url = driveThumbnail || currentAd.thumbnail_url;
  }

  const { data: savedRow, error: saveError } = await admin.from("ads").update(patch).eq("id", currentAd.id).select("*").single();
  if (saveError || !savedRow) {
    return { ok: false, message: saveError ? (saveError.message ?? "Unable to save.") : "Unable to save creative." };
  }
  const saved = savedRow as Ad;

  // Insert a new version if the drive file changed
  if (drivePreview && drivePreview.fileId !== currentAd.drive_file_id) {
    const { count: versionCount } = await admin
      .from("ad_versions")
      .select("*", { count: "exact", head: true })
      .eq("ad_id", currentAd.id);
    const nextVersion = (versionCount ?? 0) + 1;
    await admin.from("ad_versions").insert({
      ad_id: currentAd.id,
      version_number: nextVersion,
      drive_url: data.driveUrl!.trim(),
      drive_file_id: drivePreview.fileId,
      preview_url: drivePreview.previewUrl,
      thumbnail_url: driveThumbnail,
      notes: data.notes || null,
      created_by: profile.id
    });
  }

  const tagError = await syncTags(saved.id, data.tags);
  if (tagError) return { ok: false, message: `Saved, but tags could not be updated: ${tagError}` };

  await logActivity(saved.id, profile.id, "admin_creative_override", {
    previous_stage: currentAd.production_stage,
    new_stage: data.stage,
    editor_id: editorId,
    by: profile.role,
  });

  // Notify newly assigned editor
  const newEditorAssigned = editorId && editorId !== currentAd.editor_id;
  if (newEditorAssigned) {
    await notifyUserIds(admin, [editorId!], saved.id, "New editing assignment", `${profile.name} assigned ${saved.name} to you.`);
  }

  revalidateAdPaths(saved.id);
  return { ok: true, adId: saved.id };
}

export async function startEditing(adId: string) {

  const profile = await requireProfile();
  const parsedId = z.string().uuid().safeParse(adId);
  if (!parsedId.success) return { ok: false, message: "Invalid ad id." };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("ads").select("*").eq("id", parsedId.data).maybeSingle();
  if (error || !data) return { ok: false, message: error?.message ?? "Ad not found." };
  const ad = data as Ad;
  if (profile.role !== "editor" || ad.editor_id !== profile.id) {
    return { ok: false, message: "Only the assigned editor can start this edit." };
  }
  if (ad.production_stage !== "ready_for_edit") {
    return { ok: false, message: "This assignment is not waiting to start." };
  }

  if (ad.editing_freeze === "frozen") {
    return { ok: false, message: "Editing is frozen for this creative by a manager. You can start once it is unfrozen." };
  }
  // A manager/admin "unfrozen" override takes precedence over the editor's active-editing limit.
  if (ad.editing_freeze !== "unfrozen") {
    const concurrencyError = await editorConcurrencyError(admin, profile.id);
    if (concurrencyError) return { ok: false, message: concurrencyError };
  }

  const { error: updateError } = await admin.rpc("transition_editor_work_atomic", {
    p_ad_id: ad.id, p_actor_id: profile.id, p_action: "start_editing", p_editor_id: null, p_deadline: null, p_reason: null
  });
  if (updateError) return { ok: false, message: updateError.message };

  if (ad.creator_id) await notifyUserIds(admin, [ad.creator_id], ad.id, "Editing started", `${profile.name} started editing ${ad.name}.`);
  revalidateAdPaths(ad.id);
  return { ok: true };
}

export async function submitEditedVideo(payload: z.input<typeof editorSubmissionSchema>) {
  const profile = await requireProfile();
  const parsed = editorSubmissionSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid edited video." };
  const data = parsed.data;

  const admin = createSupabaseAdminClient();
  const { data: row, error } = await admin.from("ads").select("*").eq("id", data.adId).maybeSingle();
  if (error || !row) return { ok: false, message: error?.message ?? "Ad not found." };
  const ad = row as Ad;
  if (profile.role !== "editor" || ad.editor_id !== profile.id) {
    return { ok: false, message: "Only the assigned editor can submit this video." };
  }
  if (ad.production_stage !== "editing" && ad.production_stage !== "changes_requested") {
    return { ok: false, message: "This assignment is not ready for video submission." };
  }
  if (ad.editing_freeze === "frozen") {
    return { ok: false, message: "Editing is frozen for this creative by a manager. You can submit once it is unfrozen." };
  }
  if (ad.production_stage === "changes_requested" && !data.changesConfirmed) {
    return { ok: false, message: "Confirm that all requested changes were completed before resubmitting." };
  }

  const driveVideoResult = parseGoogleDriveVideoFileUrl(data.driveUrl);
  if (driveVideoResult.error || !driveVideoResult.result) {
    return { ok: false, message: driveVideoResult.error ?? "Use a valid Google Drive single video file URL." };
  }
  const drivePreview = driveVideoResult.result;
  const metadata = await getDriveMetadata(drivePreview.fileId).catch(() => null);
  const update = {
    drive_url: data.driveUrl,
    drive_file_id: drivePreview.fileId,
    preview_url: drivePreview.previewUrl,
    thumbnail_url: drivePreview.thumbnailUrl || metadata?.thumbnailLink || ad.thumbnail_url,
    editor_notes: data.editorNotes || null,
    production_stage: "creator_review" as const,
    submitted_at: new Date().toISOString(),
    approval_stage: "manager_review" as const,
    creator_reviewed_at: null,
    final_approved_at: null
  };
  const { error: submissionError } = await admin.rpc("submit_edited_video_atomic", {
    p_ad_id: ad.id,
    p_actor_id: profile.id,
    p_drive_url: update.drive_url,
    p_drive_file_id: update.drive_file_id,
    p_preview_url: update.preview_url,
    p_thumbnail_url: update.thumbnail_url ?? "",
    p_editor_notes: update.editor_notes ?? ""
  });
  if (submissionError) return { ok: false, message: submissionError.message };

  // Close any active timer session when the editor submits
  await admin
    .from("editor_time_logs")
    .update({ session_ended_at: new Date().toISOString(), is_active: false })
    .eq("ad_id", ad.id)
    .eq("editor_id", profile.id)
    .eq("is_active", true);

  await notifySubmissionReviewers({ ...ad, ...update } as Ad, profile);
  revalidateAdPaths(ad.id);
  return { ok: true };
}

const reviewerFinalClipSchema = z.object({
  adId: z.string().uuid(),
  driveUrl: z.string().trim().min(1, "Paste the final Drive video URL."),
  rawFootageUrl: z.string().trim().optional().or(z.literal("")),
  scriptHtml: z.string().optional().nullable(),
  scriptText: z.string().trim().optional().nullable(),
  reviewerNotes: z.string().trim().max(4000).optional().nullable()
});

/**
 * Allows an admin or manager to directly upload the final edited clip for any ad,
 * bypassing the normal editor-assignment flow entirely.
 * Requires: a valid single Google Drive video file link (no folders, no other sites).
 */
export async function submitFinalClipByReviewer(payload: z.input<typeof reviewerFinalClipSchema>) {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only admins and managers can upload the final clip directly." };
  }

  const parsed = reviewerFinalClipSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid payload." };
  }
  const data = parsed.data;

  // Strict: must be a single Google Drive video file — no folders, no other sites
  const driveVideoResult = parseGoogleDriveVideoFileUrl(data.driveUrl);
  if (driveVideoResult.error || !driveVideoResult.result) {
    return { ok: false, message: driveVideoResult.error ?? "Use a valid Google Drive single video file URL." };
  }
  const drivePreview = driveVideoResult.result;

  const admin = createSupabaseAdminClient();
  const { data: row, error } = await admin.from("ads").select("*").eq("id", data.adId).maybeSingle();
  if (error || !row) return { ok: false, message: error?.message ?? "Ad not found." };
  const ad = row as Ad;

  // Do not allow overwriting already-approved ads unless user is admin
  if (ad.production_stage === "approved" && profile.role !== "admin") {
    return { ok: false, message: "This ad is already approved. Only an admin can re-upload the final clip." };
  }

  const metadata = await getDriveMetadata(drivePreview.fileId).catch(() => null);

  const rawFootageUrl =
    data.rawFootageUrl?.trim() ||
    ad.raw_footage_url ||
    null;

  // Validate raw footage URL if provided (must be a Google Drive link)
  if (data.rawFootageUrl?.trim()) {
    const rawUrlError = validateGoogleDriveUrl(data.rawFootageUrl, "raw footage folder");
    if (rawUrlError) return { ok: false, message: rawUrlError };
  }

  const now = new Date().toISOString();
  const update = {
    drive_url: data.driveUrl,
    drive_file_id: drivePreview.fileId,
    preview_url: drivePreview.previewUrl,
    thumbnail_url: drivePreview.thumbnailUrl || metadata?.thumbnailLink || ad.thumbnail_url,
    raw_footage_url: rawFootageUrl,
    script_html: data.scriptHtml != null ? (sanitizeScriptHtml(data.scriptHtml) || ad.script_html) : ad.script_html,
    script_text: data.scriptText?.trim() || ad.script_text,
    editor_notes: data.reviewerNotes || null,
    production_stage: "approved" as const,
    status: "approved" as const,
    approval_stage: "complete" as const,
    submitted_at: ad.submitted_at ?? now,
    final_approved_at: now,
    // Preserve existing timestamps where set
    script_ready_at: ad.script_ready_at ?? now,
    shoot_completed_at: ad.shoot_completed_at ?? now,
    raw_footage_shared_at: rawFootageUrl ? (ad.raw_footage_shared_at ?? now) : ad.raw_footage_shared_at,
    editing_started_at: ad.editing_started_at ?? now,
    creator_reviewed_at: ad.creator_reviewed_at ?? now
  };

  const { error: updateError } = await admin.from("ads").update(update).eq("id", ad.id);
  if (updateError) return { ok: false, message: updateError.message };

  await logActivity(ad.id, profile.id, "reviewer_uploaded_final_clip", {
    drive_file_id: drivePreview.fileId,
    bypassed_editor: !ad.editor_id
  });

  // Notify creator and editor (if any)
  const notifyIds = [ad.creator_id, ad.editor_id].filter((id): id is string => Boolean(id));
  await notifyUserIds(
    admin,
    notifyIds,
    ad.id,
    "Final clip uploaded",
    `${profile.name} uploaded the final approved clip for ${ad.name}.`
  );

  revalidateAdPaths(ad.id);
  return { ok: true };
}

export async function reassignEditor(payload: z.input<typeof reassignEditorSchema>) {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only managers and admins can reassign editing work." };
  }
  const parsed = reassignEditorSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid reassignment." };
  const data = parsed.data;

  const admin = createSupabaseAdminClient();
  const [{ data: row, error }, { data: editor, error: editorError }] = await Promise.all([
    admin.from("ads").select("*").eq("id", data.adId).maybeSingle(),
    admin.from("profiles").select("id,name").eq("id", data.editorId).eq("role", "editor").eq("active", true).maybeSingle()
  ]);
  if (error || !row) return { ok: false, message: error?.message ?? "Ad not found." };
  if (editorError || !editor) return { ok: false, message: editorError?.message ?? "Choose an active editor." };
  const ad = row as Ad;
  if (!activeEditorStages.includes(ad.production_stage as (typeof activeEditorStages)[number])) {
    return { ok: false, message: "Editing can only be reassigned before the video is submitted." };
  }
  if (ad.editor_id === editor.id) return { ok: false, message: `${editor.name} is already assigned.` };

  const previousEditorId = ad.editor_id;
  const { error: updateError } = await admin.rpc("transition_editor_work_atomic", {
    p_ad_id: ad.id, p_actor_id: profile.id, p_action: "reassign_editor", p_editor_id: editor.id, p_deadline: data.deadline, p_reason: data.reason
  });
  if (updateError) return { ok: false, message: updateError.message };
  await notifyUserIds(admin, [editor.id], ad.id, "Editing assignment", `${profile.name} assigned ${ad.name} to you. Reason: ${data.reason}`);
  if (previousEditorId) await notifyUserIds(admin, [previousEditorId], ad.id, "Assignment changed", `${ad.name} was reassigned to another editor.`);
  revalidateAdPaths(ad.id);
  return { ok: true };
}

/** Ends any running editor timer on a creative (unassignment only — reassignment leaves timers untouched). */
async function closeActiveEditingSessions(admin: ReturnType<typeof createSupabaseAdminClient>, adId: string, reason: string) {
  await admin
    .from("editor_time_logs")
    .update({ session_ended_at: new Date().toISOString(), is_active: false, pause_reason: reason })
    .eq("ad_id", adId)
    .eq("is_active", true);
}

const bulkEditorAssignmentSchema = z.object({
  adIds: z.array(z.string().uuid()).min(1, "Select at least one creative.").max(200, "Select up to 200 creatives at a time."),
  mode: z.enum(["assign", "unassign"]),
  editorId: z.string().uuid().optional().or(z.literal("")),
  deadline: z.string().trim().optional().or(z.literal("")),
  reason: z.string().trim().max(1000).optional().or(z.literal(""))
});

export type BulkEditorAssignmentResult = {
  adId: string;
  name: string;
  kind: EditorAssignmentKind;
  ok: boolean;
  message?: string;
};

/**
 * Admin/manager: assign, reassign or unassign the editor on one or many creatives.
 * - shoot_complete                         → assign (moves to "ready for edit")
 * - ready_for_edit / editing / changes     → reassign to the chosen editor (restarts at "ready for edit")
 * - unassign                               → removes the editor and returns the creative to
 *                                            "pending editor assign" (shoot complete)
 * Reassignment leaves running timers untouched (original behaviour); unassignment stops the timer
 * because no editor remains. Every change is logged and notifies the editors.
 * Creatives that can't take the change are skipped with a reason instead of failing the batch.
 */
export async function bulkSetEditorAssignment(payload: z.input<typeof bulkEditorAssignmentSchema>) {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only managers and admins can change editor assignments.", results: [] as BulkEditorAssignmentResult[] };
  }
  const parsed = bulkEditorAssignmentSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request.", results: [] as BulkEditorAssignmentResult[] };
  const { mode } = parsed.data;
  const adIds = Array.from(new Set(parsed.data.adIds));
  const editorId = parsed.data.editorId || null;
  const deadline = parsed.data.deadline || null;

  const admin = createSupabaseAdminClient();
  let editor: { id: string; name: string } | null = null;
  if (mode === "assign") {
    if (!editorId) return { ok: false, message: "Choose an editor.", results: [] as BulkEditorAssignmentResult[] };
    const { data, error } = await admin.from("profiles").select("id,name").eq("id", editorId).eq("role", "editor").eq("active", true).maybeSingle();
    if (error || !data) return { ok: false, message: error?.message ?? "Choose an active editor.", results: [] as BulkEditorAssignmentResult[] };
    editor = data as { id: string; name: string };
  }

  const binReady = await isRecycleBinReady();
  const { data: rows, error: adsError } = await liveOnly(admin.from("ads").select("*").in("id", adIds), binReady);
  if (adsError) return { ok: false, message: adsError.message, results: [] as BulkEditorAssignmentResult[] };
  const adsById = new Map(((rows ?? []) as Ad[]).map((row) => [row.id, row]));

  const reason = parsed.data.reason?.trim() || (mode === "assign" ? `Bulk reassignment by ${profile.name}` : `Editor removed by ${profile.name}`);
  const results: BulkEditorAssignmentResult[] = [];
  const assignedToEditor: Ad[] = [];
  const removedFrom = new Map<string, Ad[]>();
  const noteRemoval = (editorKey: string | null, ad: Ad) => {
    if (!editorKey) return;
    removedFrom.set(editorKey, [...(removedFrom.get(editorKey) ?? []), ad]);
  };

  // Sequential on purpose: each transition locks its row in the RPC, and ordering keeps
  // notifications / activity logs deterministic.
  for (const adId of adIds) {
    const ad = adsById.get(adId);
    if (!ad) {
      results.push({ adId, name: "Creative", kind: "skip", ok: false, message: "Not found (it may have been deleted)." });
      continue;
    }
    const plan = planEditorAssignment(ad, mode, { editorId, deadline });
    if (plan.kind === "skip") {
      results.push({ adId, name: ad.name, kind: "skip", ok: false, message: plan.reason });
      continue;
    }

    if (plan.kind === "unassign") {
      const previousEditorId = ad.editor_id;
      // Optimistic concurrency: only succeeds if nobody changed the editor/stage meanwhile.
      const { data: updated, error } = await admin
        .from("ads")
        .update({ editor_id: null, assigned_at: null, editing_started_at: null, production_stage: "shoot_complete" })
        .eq("id", ad.id)
        .eq("production_stage", ad.production_stage)
        .eq("editor_id", previousEditorId as string)
        .select("id");
      if (error || !updated?.length) {
        results.push({ adId, name: ad.name, kind: "unassign", ok: false, message: error?.message ?? "It changed while you were editing — refresh and try again." });
        continue;
      }
      await closeActiveEditingSessions(admin, ad.id, `Editor removed by ${profile.name}`);
      await logActivity(ad.id, profile.id, "editor_unassigned", {
        previous_editor_id: previousEditorId,
        previous_stage: ad.production_stage,
        production_stage: "shoot_complete",
        reason
      });
      noteRemoval(previousEditorId, ad);
      results.push({ adId, name: ad.name, kind: "unassign", ok: true });
      continue;
    }

    // assign / reassign
    const useReassign = (reassignableEditorStages as readonly string[]).includes(ad.production_stage);
    const { error } = await admin.rpc("transition_editor_work_atomic", {
      p_ad_id: ad.id,
      p_actor_id: profile.id,
      p_action: useReassign ? "reassign_editor" : "assign_editor",
      p_editor_id: editor!.id,
      p_deadline: plan.deadline,
      p_reason: useReassign ? reason : null
    });
    if (error) {
      results.push({ adId, name: ad.name, kind: plan.kind, ok: false, message: error.message });
      continue;
    }
    if (useReassign) noteRemoval(ad.editor_id, ad);
    assignedToEditor.push(ad);
    results.push({ adId, name: ad.name, kind: plan.kind, ok: true });
  }

  // One notification per affected editor instead of one per creative.
  if (editor && assignedToEditor.length) {
    const body = assignedToEditor.length === 1
      ? `${profile.name} assigned ${assignedToEditor[0].name} to you.`
      : `${profile.name} assigned ${assignedToEditor.length} creatives to you: ${assignedToEditor.slice(0, 5).map((ad) => ad.name).join(", ")}${assignedToEditor.length > 5 ? "…" : ""}`;
    await notifyUserIds(admin, [editor.id], assignedToEditor[0].id, "New editing assignment", body);
  }
  for (const [previousEditorId, ads] of removedFrom) {
    if (previousEditorId === editor?.id) continue;
    const body = ads.length === 1
      ? `${ads[0].name} is no longer assigned to you.`
      : `${ads.length} creatives are no longer assigned to you: ${ads.slice(0, 5).map((ad) => ad.name).join(", ")}${ads.length > 5 ? "…" : ""}`;
    await notifyUserIds(admin, [previousEditorId], ads[0].id, "Assignment changed", body);
  }

  for (const result of results) if (result.ok) revalidatePath(`/ads/${result.adId}`);
  revalidateAdPaths(results.find((result) => result.ok)?.adId ?? adIds[0]);

  const changed = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok && result.kind !== "skip").length;
  const skipped = results.filter((result) => result.kind === "skip").length;
  const parts = [`${changed} updated`];
  if (skipped) parts.push(`${skipped} skipped`);
  if (failed) parts.push(`${failed} failed`);
  return { ok: changed > 0 || (failed === 0 && skipped === 0), message: parts.join(" · "), results, changed, skipped, failed };
}

export async function unfreezeForEditing(payload: z.input<typeof unfreezeEditingSchema>) {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only managers and admins can unfreeze editing." };
  }

  const parsed = unfreezeEditingSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid editing override." };

  const admin = createSupabaseAdminClient();
  const { data: row, error } = await admin.from("ads").select("*").eq("id", parsed.data.adId).maybeSingle();
  if (error || !row) return { ok: false, message: error?.message ?? "Ad not found." };

  const ad = row as Ad;
  if (!ad.editor_id) return { ok: false, message: "Assign an editor before unfreezing this creative." };
  if (ad.production_stage !== "ready_for_edit") {
    return { ok: false, message: "This creative is already being edited or no longer waiting for editing." };
  }

  const { error: transitionError } = await admin.rpc("transition_editor_work_atomic", {
    p_ad_id: ad.id,
    p_actor_id: profile.id,
    p_action: "force_start_editing",
    p_editor_id: null,
    p_deadline: null,
    p_reason: null
  });
  if (transitionError) return { ok: false, message: transitionError.message };

  await notifyUserIds(
    admin,
    [ad.editor_id],
    ad.id,
    "Editing unfrozen",
    `${profile.name} allowed ${ad.name} to start editing immediately.`
  );

  revalidateAdPaths(ad.id);
  return { ok: true };
}

const editingFreezeSchema = z.object({
  adId: z.string().uuid(),
  state: z.enum(["frozen", "unfrozen"])
});


/**
 * Managers and admins can freeze or unfreeze editing on a single in-production creative.
 * - frozen:   the assigned editor cannot start, resume or submit editing for it.
 * - unfrozen: explicit override; the creative bypasses (and is not counted toward) the
 *             editor's "max concurrent edits" limit from Settings.
 */
export async function setEditingFreeze(payload: z.input<typeof editingFreezeSchema>) {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only managers and admins can freeze or unfreeze editing." };
  }
  const parsed = editingFreezeSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid freeze request." };

  const admin = createSupabaseAdminClient();
  const { data: row, error } = await admin.from("ads").select("*").eq("id", parsed.data.adId).maybeSingle();
  if (error || !row) return { ok: false, message: error?.message ?? "Ad not found." };
  const ad = row as Ad & { deleted_at?: string | null };
  if (ad.deleted_at) return { ok: false, message: "This creative is in the Recycle Bin." };
  if (!canToggleEditingFreeze(ad.production_stage)) {
    return { ok: false, message: "Editing can only be frozen or unfrozen while a creative is in production." };
  }
  if ((ad.editing_freeze ?? null) === parsed.data.state) {
    // If it's already marked unfrozen but is still stuck in ready_for_edit with an assigned editor,
    // we still need to actually transition it to editing so the video unfreezes for the editor.
    const needsTransitionToEditing = parsed.data.state === "unfrozen" && ad.production_stage === "ready_for_edit" && Boolean(ad.editor_id);
    if (!needsTransitionToEditing) {
      return { ok: true, state: parsed.data.state, stage: ad.production_stage };
    }
  }

  // When unfreezing an ad that is waiting in ready_for_edit with an assigned editor,
  // transition it to editing atomically so the editor can actually work on it immediately.
  if (parsed.data.state === "unfrozen" && ad.production_stage === "ready_for_edit") {
    if (!ad.editor_id) {
      return { ok: false, message: "Assign an editor before unfreezing this creative." };
    }
    const { error: transitionError } = await admin.rpc("transition_editor_work_atomic", {
      p_ad_id: ad.id,
      p_actor_id: profile.id,
      p_action: "force_start_editing",
      p_editor_id: null,
      p_deadline: null,
      p_reason: null
    });
    if (transitionError) {
      // Fallback in case of RPC issues
      const nowIso = new Date().toISOString();
      const { error: directError } = await admin
        .from("ads")
        .update({
          production_stage: "editing",
          editing_started_at: nowIso,
          editing_freeze: "unfrozen",
          editing_freeze_by: profile.id,
          editing_freeze_at: nowIso
        })
        .eq("id", ad.id);
      if (directError) return { ok: false, message: directError.message };
      await admin.from("editor_time_logs").insert({
        ad_id: ad.id,
        editor_id: ad.editor_id,
        session_started_at: nowIso,
        is_active: true
      });
      await logActivity(ad.id, profile.id, "editor_unfrozen_for_editing", {
        previous_stage: ad.production_stage,
        production_stage: "editing",
        editor_id: ad.editor_id,
        bypassed_active_limit: true
      });
    }

    await notifyUserIds(
      admin,
      [ad.editor_id],
      ad.id,
      "Editing unfrozen",
      `${profile.name} allowed ${ad.name} to start editing immediately.`
    );

    revalidateAdPaths(ad.id);
    return { ok: true, state: "unfrozen" as const, stage: "editing" as const };
  }

  const { error: updateError } = await admin
    .from("ads")
    .update({ editing_freeze: parsed.data.state, editing_freeze_by: profile.id, editing_freeze_at: new Date().toISOString() })
    .eq("id", ad.id);
  if (updateError) {
    const missingColumn = updateError.code === "PGRST204" || updateError.code === "42703" || /editing_freeze/.test(updateError.message);
    return {
      ok: false,
      message: missingColumn
        ? "Freeze controls need a database update. Apply the latest migration (20261006120000_recycle_bin_retention_and_editing_freeze) and try again."
        : updateError.message
    };
  }

  // Freezing mid-edit stops the editor's running timer so tracked time stays accurate.
  if (parsed.data.state === "frozen" && ad.editor_id && (ad.production_stage === "editing" || ad.production_stage === "changes_requested")) {
    await admin
      .from("editor_time_logs")
      .update({ session_ended_at: new Date().toISOString(), is_active: false, pause_reason: `Editing frozen by ${profile.name}` })
      .eq("ad_id", ad.id)
      .eq("is_active", true);
  }

  // Unfreezing mid-edit resumes the editor's timer if it was paused.
  if (parsed.data.state === "unfrozen" && ad.editor_id && (ad.production_stage === "editing" || ad.production_stage === "changes_requested")) {
    const { data: existingActive } = await admin
      .from("editor_time_logs")
      .select("id")
      .eq("ad_id", ad.id)
      .eq("editor_id", ad.editor_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!existingActive) {
      await admin.from("editor_time_logs").insert({
        ad_id: ad.id,
        editor_id: ad.editor_id,
        session_started_at: new Date().toISOString(),
        is_active: true
      });
    }
  }

  await logActivity(ad.id, profile.id, parsed.data.state === "frozen" ? "editing_frozen" : "editing_unfrozen", {
    editor_id: ad.editor_id,
    production_stage: ad.production_stage,
    overrides_editor_limit: parsed.data.state === "unfrozen"
  });
  if (ad.editor_id) {
    await notifyUserIds(
      admin,
      [ad.editor_id],
      ad.id,
      parsed.data.state === "frozen" ? "Editing frozen" : "Editing unfrozen",
      parsed.data.state === "frozen"
        ? `${profile.name} froze editing on ${ad.name}. You will be notified when it is unfrozen.`
        : `${profile.name} unfroze ${ad.name}. You can edit it regardless of your active editing limit.`
    );
  }

  revalidateAdPaths(ad.id);
  return { ok: true, state: parsed.data.state, stage: ad.production_stage };
}

export async function assignEditor(adId: string, editorId: string, deadline?: string | null) {
  const profile = await requireProfile();
  const parsed = z
    .object({
      adId: z.string().uuid(),
      editorId: z.string().uuid({ message: "Choose an editor." }),
      deadline: z.string().trim().min(1, "Choose a deadline.")
    })
    .safeParse({ adId, editorId, deadline });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid assignment." };

  const admin = createSupabaseAdminClient();
  const [{ data: row, error }, { data: editor, error: editorError }] = await Promise.all([
    admin.from("ads").select("*").eq("id", parsed.data.adId).maybeSingle(),
    admin.from("profiles").select("id").eq("id", parsed.data.editorId).eq("role", "editor").eq("active", true).maybeSingle()
  ]);
  if (error || !row) return { ok: false, message: error?.message ?? "Ad not found." };
  const ad = row as Ad;

  const isCreator = profile.role === "content_creator" && ad.creator_id === profile.id;
  const isReviewer = profile.role === "admin" || profile.role === "manager";
  if (!isCreator && !isReviewer) return { ok: false, message: "You do not have permission to assign an editor for this ad." };
  if (ad.production_stage !== "shoot_complete") return { ok: false, message: "This ad is not waiting for an editor assignment." };
  if (editorError || !editor) return { ok: false, message: editorError?.message ?? "Choose an active editor." };
  const assignmentDeadline = parsed.data.deadline || ad.deadline;
  if (!assignmentDeadline) return { ok: false, message: "Choose a deadline before assigning an editor." };

  const { error: updateError } = await admin.rpc("transition_editor_work_atomic", {
    p_ad_id: ad.id, p_actor_id: profile.id, p_action: "assign_editor", p_editor_id: editor.id, p_deadline: assignmentDeadline, p_reason: null
  });
  if (updateError) return { ok: false, message: updateError.message };
  await notifyUserIds(admin, [editor.id], ad.id, "New editing assignment", `${profile.name} assigned ${ad.name} to you. The script and raw footage are ready.`);
  revalidateAdPaths(ad.id);
  return { ok: true };
}

export async function creatorReviewAd(adId: string, decision: "approve" | "request_changes", note: string) {
  const profile = await requireProfile();
  const parsed = z.object({ adId: z.string().uuid(), decision: z.enum(["approve", "request_changes"]), note: z.string().trim().max(4000) }).safeParse({ adId, decision, note });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid creator review." };
  }
  if (decision === "request_changes" && !parsed.data.note) {
    return { ok: false, message: "Describe the changes the editor needs to make." };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("ads").select("*").eq("id", parsed.data.adId).single();
  if (error || !data) return { ok: false, message: error?.message ?? "Ad not found." };
  const ad = data as Ad;

  if (!isCreatorCapableRole(profile.role) || ad.creator_id !== profile.id) {
    return { ok: false, message: "Only the assigned creator can complete creator review." };
  }
  if (ad.status !== "pending_review" || ad.production_stage !== "creator_review") {
    return { ok: false, message: "This ad is not waiting for creator review." };
  }

  const approved = decision === "approve";
  const { error: transitionError } = await admin.rpc("creator_review_ad_atomic", {
    p_ad_id: ad.id,
    p_actor_id: profile.id,
    p_decision: decision,
    p_note: parsed.data.note || null
  });
  if (transitionError) return { ok: false, message: transitionError.message };

  if (approved) {
    await notifyFinalReviewers(admin, ad, `${profile.name} approved the edit for ${ad.name}. Final approval is required.`);
  } else if (ad.editor_id) {
    await notifyUserIds(admin, [ad.editor_id], ad.id, "Creator requested changes", parsed.data.note);
  }

  revalidateAdPaths(ad.id);
  return { ok: true };
}

const creatorChangeResolutionSchema = z.object({
  adId: z.string().uuid(),
  route: z.enum(["review", "editor"]),
  editorId: z.string().uuid().optional().or(z.literal("")),
  deadline: z.string().trim().optional().or(z.literal("")),
  note: z.string().trim().max(4000).optional().nullable(),
  name: z.string().trim().min(1, "Ad name is required.").max(160),
  campaignId: z.string().uuid({ message: "Choose a campaign." }),
  productId: z.string().uuid({ message: "Choose a product." }),
  scriptText: z.string().trim().min(1, "Script is required."),
  rawFootageUrl: z.string().trim().optional().or(z.literal("")),
  platforms: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([])
});

export async function resolveCreatorChangeRequest(payload: z.input<typeof creatorChangeResolutionSchema>) {
  const profile = await requireProfile();
  const parsed = creatorChangeResolutionSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid change request resolution." };
  if (profile.role !== "content_creator" && profile.role !== "manager" && profile.role !== "admin") {
    return { ok: false, message: "Only the assigned content creator or manager can resolve creator change requests." };
  }

  const data = parsed.data;
  const admin = createSupabaseAdminClient();
  const { data: row, error } = await admin.from("ads").select("*").eq("id", data.adId).maybeSingle();
  if (error || !row) return { ok: false, message: error?.message ?? "Ad not found." };
  const ad = row as Ad;

  if (profile.role !== "admin" && ad.creator_id !== profile.id) {
    const { data: createdLog } = await admin
      .from("activity_logs")
      .select("id")
      .eq("ad_id", ad.id)
      .eq("actor_id", profile.id)
      .eq("action", "creator_item_created")
      .limit(1);

    if (!createdLog || createdLog.length === 0) {
      return { ok: false, message: "You do not own this creative." };
    }
  }
  if (ad.production_stage !== "creator_changes_requested") {
    return { ok: false, message: "This creative is not waiting on creator changes." };
  }

  const binReady = await isRecycleBinReady();
  const { data: campaign, error: campaignError } = await liveOnly(admin.from("campaigns").select("id").eq("id", data.campaignId).eq("active", true), binReady).maybeSingle();
  if (campaignError || !campaign) return { ok: false, message: campaignError?.message ?? "Choose an active campaign." };

  const { data: product, error: productError } = await admin.from("products").select("id").eq("id", data.productId).eq("active", true).maybeSingle();
  if (productError || !product) return { ok: false, message: productError?.message ?? "Choose an active product." };

  let rawFootageUrl = ad.raw_footage_url;
  if (data.rawFootageUrl?.trim()) {
    const rawUrlError = validateGoogleDriveUrl(data.rawFootageUrl, "raw footage folder");
    if (rawUrlError) return { ok: false, message: rawUrlError };
    rawFootageUrl = data.rawFootageUrl.trim();
  }

  const creativeFields = {
    name: data.name,
    campaign_id: data.campaignId,
    product_id: data.productId,
    script_text: data.scriptText,
    raw_footage_url: rawFootageUrl,
    platforms: data.platforms
  };

  if (data.route === "editor") {
    if (!data.editorId) return { ok: false, message: "Choose an editor to send this back for editing." };
    if (!data.deadline) return { ok: false, message: "Choose a deadline before assigning an editor." };

    const { data: editor, error: editorError } = await admin
      .from("profiles")
      .select("id")
      .eq("id", data.editorId)
      .eq("role", "editor")
      .eq("active", true)
      .maybeSingle();
    if (editorError || !editor) return { ok: false, message: editorError?.message ?? "Choose an active editor." };

    const { error: updateError } = await admin.from("ads").update({
      ...creativeFields,
      editor_id: editor.id,
      assigned_at: new Date().toISOString(),
      production_stage: "ready_for_edit",
      status: legacyStatusForProductionStage("ready_for_edit"),
      approval_stage: "manager_review",
      deadline: data.deadline,
      creator_reviewed_at: null,
      final_approved_at: null
    }).eq("id", ad.id);
    if (updateError) return { ok: false, message: updateError.message };

    const tagError = await syncTags(ad.id, data.tags);
    if (tagError) return { ok: false, message: `The creative was sent to editing, but tags could not be updated: ${tagError}` };

    await notifyUserIds(admin, [editor.id], ad.id, "Returned to editing", `${profile.name} sent ${ad.name} back to editing.`);
    await logActivity(ad.id, profile.id, "creator_routed_changes_to_editor", {
      editor_id: editor.id,
      deadline: data.deadline,
      note: data.note || null,
      previous_stage: ad.production_stage,
      production_stage: "ready_for_edit"
    });
    revalidateAdPaths(ad.id);
    return { ok: true };
  }

  const { error: updateError } = await admin.from("ads").update({
    ...creativeFields,
    production_stage: "final_review",
    status: legacyStatusForProductionStage("final_review"),
    approval_stage: "admin_final",
    creator_reviewed_at: new Date().toISOString(),
    final_approved_at: null
  }).eq("id", ad.id);
  if (updateError) return { ok: false, message: updateError.message };

  const tagError = await syncTags(ad.id, data.tags);
  if (tagError) return { ok: false, message: `The creative was sent for review, but tags could not be updated: ${tagError}` };

  await notifyFinalReviewers(admin, ad, `${profile.name} resolved requested changes for ${ad.name}. Final review is ready.`);
  await logActivity(ad.id, profile.id, "creator_routed_changes_to_review", {
    note: data.note || null,
    previous_stage: ad.production_stage,
    production_stage: "final_review"
  });
  revalidateAdPaths(ad.id);
  return { ok: true };
}
export async function reviewAd(adId: string, decision: "approve" | "request_changes", note: string, target?: "creator" | "editor") {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only managers and admins can review ads." };
  }
  if (decision !== "approve" && decision !== "request_changes") {
    return { ok: false, message: "Choose approve or request changes." };
  }

  const validationError = validateReviewInput(decision, note);
  if (validationError) {
    return { ok: false, message: validationError };
  }

  const parsedAdId = z.string().uuid().safeParse(adId);
  if (!parsedAdId.success) {
    return { ok: false, message: "Invalid ad id." };
  }

  const admin = createSupabaseAdminClient();
  const { data: ad, error: adError } = await admin.from("ads").select("*").eq("id", parsedAdId.data).single();
  if (adError || !ad) {
    return { ok: false, message: adError?.message ?? "Ad not found." };
  }

  const isAdminReopen = profile.role === "admin" && decision === "request_changes" && ad.production_stage === "approved";
  const isManagerReopen = profile.role === "manager" && decision === "request_changes" && ad.production_stage === "approved";
  if (!isAdminReopen && !isManagerReopen && (ad.status !== "pending_review" || !["creator_review", "final_review"].includes(ad.production_stage))) {
    return { ok: false, message: "This video is not waiting for final review." };
  }

  const resolvedTarget = target || (ad.production_stage === "creator_changes_requested" ? "creator" : "editor");

  const isManager = profile.role === "manager";
  let isIntermediateManagerApproval = false;

  if (decision === "approve" && isManager) {
    const { data: settings } = await admin.from("app_settings").select("*").eq("id", 1).single();
    const allowManager = (settings as { allow_manager_final_approval?: boolean; two_step_approval?: boolean } | null)?.allow_manager_final_approval !== undefined
      ? (settings as { allow_manager_final_approval?: boolean }).allow_manager_final_approval
      : !(settings as { two_step_approval?: boolean } | null)?.two_step_approval;
    if (settings && allowManager === false) {
      isIntermediateManagerApproval = true;
    }
  }

  const { error } = await admin.rpc("final_review_ad_atomic", {
    p_ad_id: adId,
    p_actor_id: profile.id,
    p_decision: decision,
    p_note: note.trim() || null,
    p_target: resolvedTarget
  });

  if (error) {
    if (isIntermediateManagerApproval && error.message.includes("Final approval is restricted to administrators")) {
      // Fallback: perform intermediate approval directly if DB RPC has not yet been upgraded
      const { error: updateError } = await admin.from("ads").update({
        production_stage: "final_review",
        approval_stage: "admin_final",
        status: "pending_review",
        creator_reviewed_at: ad.production_stage === "creator_review" ? (ad.creator_reviewed_at || new Date().toISOString()) : ad.creator_reviewed_at
      }).eq("id", adId);
      if (updateError) return { ok: false, message: updateError.message };

      await admin.from("review_actions").insert({
        ad_id: adId,
        reviewer_id: profile.id,
        decision: "approve",
        note: note.trim() || null
      });

      await admin.from("activity_logs").insert({
        ad_id: adId,
        actor_id: profile.id,
        action: "manager_approved",
        metadata: {
          note: note.trim() || "",
          previous_stage: ad.production_stage,
          production_stage: "final_review"
        }
      });
    } else if (isAdminReopen || isManagerReopen) {
      // Fallback: perform reopen directly if DB RPC has not yet been upgraded
      const nextStage = resolvedTarget === "creator" ? "creator_changes_requested" : "changes_requested";
      const { error: updateError } = await admin.from("ads").update({
        production_stage: nextStage,
        status: "changes_requested",
        approval_stage: "manager_review",
        approved_at: null,
        final_approved_at: null
      }).eq("id", adId);
      if (updateError) return { ok: false, message: updateError.message };

      await admin.from("review_actions").insert({
        ad_id: adId,
        reviewer_id: profile.id,
        decision: "request_changes",
        note: note.trim() || null
      });

      await admin.from("activity_logs").insert({
        ad_id: adId,
        actor_id: profile.id,
        action: "approved_ad_reopened",
        metadata: {
          note: note.trim() || "",
          previous_stage: "approved",
          production_stage: nextStage,
          target: resolvedTarget,
          reopened: true
        }
      });
    } else {
      return { ok: false, message: error.message };
    }
  }

  // Ensure ad status column matches decision
  if (decision === "request_changes") {
    await admin.from("ads").update({ status: "changes_requested" }).eq("id", adId);
  } else if (decision === "approve" && !isIntermediateManagerApproval) {
    await admin.from("ads").update({ status: "approved" }).eq("id", adId);
  }

  if (isIntermediateManagerApproval) {
    // Notify all active administrators that manager approved and final admin approval is needed
    const { data: admins } = await admin
      .from("profiles")
      .select("*")
      .eq("role", "admin")
      .eq("active", true);

    for (const adminUser of admins ?? []) {
      await createNotification(admin, {
        recipient: adminUser as Profile,
        adId,
        title: "Manager approved · Final review ready",
        body: note.trim()
          ? `${profile.name} approved ${ad.name}: "${note.trim()}". Ready for final admin approval.`
          : `${profile.name} approved ${ad.name}. Ready for final admin approval.`
      });
    }
  } else {
    const nextStatus = decision === "approve"
      ? "approved"
      : resolvedTarget === "creator"
        ? "creator_changes_requested"
        : "changes_requested";

    const recipientIds = nextStatus === "creator_changes_requested"
      ? [ad.creator_id].filter((id): id is string => Boolean(id))
      : nextStatus === "approved"
        ? [ad.creator_id, ad.editor_id].filter((id): id is string => Boolean(id))
        : [ad.editor_id].filter((id): id is string => Boolean(id));

    const { data: recipients } = recipientIds.length
      ? await admin.from("profiles").select("*").in("id", recipientIds)
      : { data: [] };

    for (const recipient of recipients ?? []) {
      await createNotification(admin, {
        recipient: recipient as Profile,
        adId,
        title: notificationTitle(decision, nextStatus),
        body: nextStatus === "creator_changes_requested"
          ? (note || `${ad.name} needs creator updates before final review.`)
          : (note || `${ad.name} is now changes requested.`)
      });
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/library"); invalidateLibraryCache();
  revalidatePath(`/ads/${adId}`);
  revalidatePath("/analytics");

  return { ok: true, intermediateApproval: isIntermediateManagerApproval };
}

export async function deleteAd(adId: string) {
  const profile = await requireProfile();
  if (!canDeleteAd(profile.role)) {
    return { ok: false, message: "Only admins and managers can delete ads." };
  }

  const parsedAdId = z.string().uuid().safeParse(adId);
  if (!parsedAdId.success) {
    return { ok: false, message: "Invalid ad id." };
  }

  // Recycle Bin: keep the creative (script, video link, history) restorable for the retention window.
  if (await isRecycleBinReady()) {
    const moved = await softDeleteAd(parsedAdId.data, profile.id);
    if (!moved.ok) return { ok: false, message: moved.message };
    revalidatePath("/dashboard");
    revalidatePath("/library"); invalidateLibraryCache();
    revalidatePath("/analytics");
    revalidatePath("/admin/audit");
    revalidatePath("/admin/settings");
    return { ok: true, movedToRecycleBin: true };
  }

  const admin = createSupabaseAdminClient();
  const { data: ad, error: findError } = await admin
    .from("ads")
    .select("id,name,status,campaign_id")
    .eq("id", parsedAdId.data)
    .maybeSingle();

  if (findError || !ad) {
    return { ok: false, message: findError?.message ?? "Ad not found." };
  }

  const { error: deleteError } = await admin.from("ads").delete().eq("id", parsedAdId.data);
  if (deleteError) {
    return { ok: false, message: deleteError.message };
  }

  await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: "deleted_ad",
    target_type: "ad",
    target_id: ad.id,
    metadata: {
      name: ad.name,
      status: ad.status,
      campaign_id: ad.campaign_id
    }
  });

  revalidatePath("/dashboard");
  revalidatePath("/library"); invalidateLibraryCache();
  revalidatePath("/analytics");
  revalidatePath("/admin/audit");
  return { ok: true };
}

export async function bulkAddTags(adIds: string[], tags: string[]) {
  const profile = await requireProfile();
  const parsed = z
    .object({
      adIds: z.array(z.string().uuid()).min(1, "Select at least one creative.").max(50, "Select at most 50 creatives at a time."),
      tags: z.array(z.string().trim().min(1)).min(1, "Add at least one tag.").max(20)
    })
    .safeParse({ adIds, tags });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  const admin = createSupabaseAdminClient();
  let query = admin.from("ads").select("id").in("id", parsed.data.adIds);
  if (profile.role === "editor") query = query.eq("editor_id", profile.id);
  else if (profile.role === "content_creator") query = query.eq("creator_id", profile.id);

  const { data: allowedAds, error } = await query;
  if (error) {
    return { ok: false, message: error.message };
  }
  const allowedIds = (allowedAds ?? []).map((row) => row.id);
  if (!allowedIds.length) {
    return { ok: false, message: "You do not have access to the selected creatives." };
  }

  const normalizedTags = Array.from(new Set(parsed.data.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)));
  if (normalizedTags.includes("downloaded")) {
    return { ok: false, message: "Downloaded is a system badge and cannot be added as a regular tag." };
  }
  const { error: rpcError } = await admin.rpc("add_ad_tags_bulk", { p_ad_ids: allowedIds, p_tags: normalizedTags });
  if (rpcError) {
    return { ok: false, message: rpcError.message };
  }

  for (const adId of allowedIds) {
    await logActivity(adId, profile.id, "bulk_tagged", { tags: normalizedTags });
  }

  revalidatePath("/dashboard");
  revalidatePath("/library"); invalidateLibraryCache();

  return { ok: true, count: allowedIds.length };
}

export async function dismissDownloadedBadge(adId: string) {
  const profile = await requireProfile();
  if (profile.role !== "admin") {
    return { ok: false, message: "Only admins can dismiss downloaded badges." };
  }

  const parsedAdId = z.string().uuid().safeParse(adId);
  if (!parsedAdId.success) {
    return { ok: false, message: "Invalid creative." };
  }

  const admin = createSupabaseAdminClient();
  const { data: downloadedTag, error: tagError } = await admin
    .from("tags")
    .select("id")
    .eq("name", "downloaded")
    .maybeSingle();
  if (tagError) return { ok: false, message: tagError.message };
  if (!downloadedTag) return { ok: true };

  const { error } = await admin
    .from("ad_tags")
    .delete()
    .eq("ad_id", parsedAdId.data)
    .eq("tag_id", downloadedTag.id);
  if (error) return { ok: false, message: error.message };

  await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: "dismissed_downloaded_badge",
    target_type: "ad",
    target_id: parsedAdId.data,
    metadata: {}
  });
  revalidatePath("/dashboard");
  revalidatePath("/library"); invalidateLibraryCache();
  revalidatePath("/campaigns");
  revalidatePath("/campaigns/[id]", "page");
  return { ok: true };
}

export async function bulkSetDownloadedBadge(adIds: string[], downloaded: boolean) {
  const profile = await requireProfile();
  if (profile.role !== "admin") {
    return { ok: false, message: "Only admins can update downloaded badges." };
  }

  const parsed = z
    .object({
      adIds: z.array(z.string().uuid()).min(1, "Select at least one creative.").max(500, "Select at most 500 creatives at a time."),
      downloaded: z.boolean()
    })
    .safeParse({ adIds, downloaded });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  const uniqueAdIds = Array.from(new Set(parsed.data.adIds));
  const admin = createSupabaseAdminClient();
  const { data: existingAds, error: adsError } = await admin.from("ads").select("id").in("id", uniqueAdIds);
  if (adsError) return { ok: false, message: adsError.message };

  const existingAdIds = (existingAds ?? []).map((ad) => ad.id);
  if (!existingAdIds.length) return { ok: false, message: "None of the selected creatives were found." };

  let downloadedTagId: string | undefined;
  if (parsed.data.downloaded) {
    const { data: downloadedTag, error: tagError } = await admin
      .from("tags")
      .upsert({ name: "downloaded" }, { onConflict: "name" })
      .select("id")
      .single();
    if (tagError || !downloadedTag) return { ok: false, message: tagError?.message ?? "Downloaded tag could not be created." };
    downloadedTagId = downloadedTag.id;

    const { error } = await admin.from("ad_tags").upsert(
      existingAdIds.map((adId) => ({ ad_id: adId, tag_id: downloadedTag.id })),
      { onConflict: "ad_id,tag_id", ignoreDuplicates: true }
    );
    if (error) return { ok: false, message: error.message };
  } else {
    const { data: downloadedTag, error: tagError } = await admin
      .from("tags")
      .select("id")
      .eq("name", "downloaded")
      .maybeSingle();
    if (tagError) return { ok: false, message: tagError.message };
    downloadedTagId = downloadedTag?.id;

    if (downloadedTagId) {
      const { error } = await admin
        .from("ad_tags")
        .delete()
        .in("ad_id", existingAdIds)
        .eq("tag_id", downloadedTagId);
      if (error) return { ok: false, message: error.message };
    }
  }

  await admin.from("audit_logs").insert(existingAdIds.map((adId) => ({
    actor_id: profile.id,
    action: parsed.data.downloaded ? "bulk_downloaded_badge_added" : "bulk_downloaded_badge_removed",
    target_type: "ad",
    target_id: adId,
    metadata: { downloaded_tag_id: downloadedTagId ?? null }
  })));
  revalidatePath("/dashboard");
  revalidatePath("/library"); invalidateLibraryCache();
  revalidatePath("/campaigns");
  revalidatePath("/campaigns/[id]", "page");
  return { ok: true, count: existingAdIds.length, downloaded: parsed.data.downloaded };
}

export async function addComment(adId: string, body: string) {
  const profile = await requireProfile();
  const parsed = z.object({ adId: z.string().uuid(), body: z.string().trim().min(1).max(4000) }).safeParse({
    adId,
    body
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid comment." };
  }

  const admin = createSupabaseAdminClient();
  const [{ data: ad }, { data: collaborators }] = await Promise.all([
    admin.from("ads").select("id,creator_id,editor_id").eq("id", parsed.data.adId).maybeSingle(),
    admin.from("ad_collaborators").select("profile_id").eq("ad_id", parsed.data.adId)
  ]);
  if (!ad) {
    return { ok: false, message: "Ad not found." };
  }
  const collaboratorIds = (collaborators ?? []).map((row) => row.profile_id);
  if (!hasAdAccess(profile, ad, collaboratorIds)) {
    return { ok: false, message: "You do not have access to this ad." };
  }

  const mentions = extractMentions(parsed.data.body);

  const { error } = await admin.from("comments").insert({
    ad_id: parsed.data.adId,
    author_id: profile.id,
    body: parsed.data.body,
    mentions
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  // Anyone tagged is notified — the comment composer only offers active users to @mention.
  const { data: mentionCandidates } = mentions.length
    ? await admin.from("profiles").select("*").eq("active", true)
    : { data: [] };
  const mentionedProfiles = (mentionCandidates ?? []).filter((candidate) =>
    profileMentionHandles(candidate).some((handle) => mentions.includes(handle))
  );

  for (const recipient of mentionedProfiles ?? []) {
    await createNotification(admin, {
      recipient: recipient as Profile,
      adId: parsed.data.adId,
      title: `${profile.name} mentioned you`,
      body: parsed.data.body
    });
  }

  await logActivity(parsed.data.adId, profile.id, "commented", { mentions });
  revalidatePath(`/ads/${parsed.data.adId}`);

  return { ok: true };
}

export async function grantAdAccess(adId: string, profileId: string) {
  const profile = await requireProfile();
  if (!canReview(profile.role)) {
    return { ok: false, message: "Only admins and managers can grant access to a creative." };
  }

  const parsed = z.object({ adId: z.string().uuid(), profileId: z.string().uuid() }).safeParse({ adId, profileId });
  if (!parsed.success) {
    return { ok: false, message: "Invalid request." };
  }

  const admin = createSupabaseAdminClient();
  const { data: ad } = await admin.from("ads").select("id,name").eq("id", parsed.data.adId).maybeSingle();
  if (!ad) {
    return { ok: false, message: "Ad not found." };
  }

  const { data: recipient } = await admin.from("profiles").select("id,name,email").eq("id", parsed.data.profileId).maybeSingle();
  if (!recipient) {
    return { ok: false, message: "User not found." };
  }

  const { error } = await admin
    .from("ad_collaborators")
    .upsert({ ad_id: parsed.data.adId, profile_id: parsed.data.profileId, granted_by: profile.id }, { onConflict: "ad_id,profile_id" });
  if (error) {
    return { ok: false, message: error.message };
  }

  await createNotification(admin, {
    recipient: recipient as Profile,
    adId: parsed.data.adId,
    title: "You've been given access",
    body: `${profile.name} granted you access to ${ad.name}.`
  });

  await logActivity(parsed.data.adId, profile.id, "granted_access", { profile_id: parsed.data.profileId });
  revalidatePath(`/ads/${parsed.data.adId}`);

  return { ok: true };
}

export async function addAnnotation(payload: {
  adId: string;
  kind: "video_timestamp" | "script_inline";
  body: string;
  timestampSeconds?: number | null;
  scriptAnchor?: string | null;
}) {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only reviewers can add annotations." };
  }

  const parsed = z
    .object({
      adId: z.string().uuid(),
      kind: z.enum(["video_timestamp", "script_inline"]),
      body: z.string().trim().min(1).max(4000),
      timestampSeconds: z.number().int().min(0).nullable().optional(),
      scriptAnchor: z.string().trim().max(500).nullable().optional()
    })
    .safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid annotation." };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("annotations").insert({
    ad_id: parsed.data.adId,
    author_id: profile.id,
    kind: parsed.data.kind,
    body: parsed.data.body,
    timestamp_seconds: parsed.data.timestampSeconds ?? null,
    script_anchor: parsed.data.scriptAnchor ?? null
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  await logActivity(parsed.data.adId, profile.id, "annotated", {
    kind: parsed.data.kind,
    timestampSeconds: parsed.data.timestampSeconds
  });
  revalidatePath(`/ads/${parsed.data.adId}`);

  return { ok: true };
}

export async function resolveAnnotation(annotationId: string) {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only reviewers can resolve review notes." };
  }
  const parsedId = z.string().uuid().safeParse(annotationId);
  if (!parsedId.success) return { ok: false, message: "Invalid review note." };

  const admin = createSupabaseAdminClient();
  const { data: annotation, error: findError } = await admin
    .from("annotations")
    .select("id,ad_id,resolved_at")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (findError || !annotation) return { ok: false, message: findError?.message ?? "Review note not found." };

  const { error } = await admin
    .from("annotations")
    .update({ resolved_at: annotation.resolved_at ? null : new Date().toISOString() })
    .eq("id", annotation.id);
  if (error) return { ok: false, message: error.message };

  await logActivity(annotation.ad_id, profile.id, annotation.resolved_at ? "annotation_reopened" : "annotation_resolved", {
    annotation_id: annotation.id
  });
  revalidatePath(`/ads/${annotation.ad_id}`);
  return { ok: true };
}

export async function pauseEditingTimer(adId: string, reason: string) {
  const profile = await requireProfile();
  const parsed = z.object({ adId: z.string().uuid(), reason: z.string().trim().min(1, "A pause reason is required.").max(1000) }).safeParse({ adId, reason });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };

  const admin = createSupabaseAdminClient();
  const { data: ad, error: adError } = await admin.from("ads").select("editor_id,production_stage,name").eq("id", parsed.data.adId).maybeSingle();
  if (adError || !ad) return { ok: false, message: adError?.message ?? "Ad not found." };
  if (profile.role !== "editor" || ad.editor_id !== profile.id) {
    return { ok: false, message: "Only the assigned editor can pause the timer." };
  }
  if (!(["editing", "changes_requested"] as string[]).includes(ad.production_stage)) {
    return { ok: false, message: "Timer can only be paused while actively editing." };
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("editor_time_logs")
    .update({ session_ended_at: now, is_active: false, pause_reason: parsed.data.reason })
    .eq("ad_id", parsed.data.adId)
    .eq("editor_id", profile.id)
    .eq("is_active", true);
  if (error) return { ok: false, message: error.message };

  await logActivity(parsed.data.adId, profile.id, "timer_paused", { reason: parsed.data.reason });
  revalidateAdPaths(parsed.data.adId);
  return { ok: true };
}

export async function resumeEditingTimer(adId: string) {
  const profile = await requireProfile();
  const parsedId = z.string().uuid().safeParse(adId);
  if (!parsedId.success) return { ok: false, message: "Invalid ad id." };

  const admin = createSupabaseAdminClient();
  const { data: ad, error: adError } = await admin.from("ads").select("*").eq("id", parsedId.data).maybeSingle();
  if (adError || !ad) return { ok: false, message: adError?.message ?? "Ad not found." };
  if (profile.role !== "editor" || ad.editor_id !== profile.id) {
    return { ok: false, message: "Only the assigned editor can resume the timer." };
  }
  if ((ad as Ad).editing_freeze === "frozen") {
    return { ok: false, message: "Editing is frozen for this creative by a manager. You can resume once it is unfrozen." };
  }
  if (!(["editing", "changes_requested"] as string[]).includes(ad.production_stage)) {
    return { ok: false, message: "Timer can only be resumed while actively editing." };
  }

  // Prevent double-resume: check there's no active session already
  const { data: existingActive } = await admin
    .from("editor_time_logs")
    .select("id")
    .eq("ad_id", parsedId.data)
    .eq("editor_id", profile.id)
    .eq("is_active", true)
    .maybeSingle();
  if (existingActive) return { ok: false, message: "Timer is already running." };

  const { error } = await admin.from("editor_time_logs").insert({
    ad_id: parsedId.data,
    editor_id: profile.id,
    session_started_at: new Date().toISOString(),
    is_active: true
  });
  if (error) return { ok: false, message: error.message };

  await logActivity(parsedId.data, profile.id, "timer_resumed", {});
  revalidateAdPaths(parsedId.data);
  return { ok: true };
}

async function syncTags(adId: string, rawTags: string[]) {
  const admin = createSupabaseAdminClient();
  const tags = Array.from(new Set(rawTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)));
  const { error } = await admin.rpc("sync_ad_tags_atomic", { p_ad_id: adId, p_tags: tags });
  return error?.message ?? null;
}

function friendlyAdSaveError(error: { code?: string; message: string }) {
  if (error.code === "23505") {
    return "An ad with this name already exists in the selected campaign.";
  }

  return error.message;
}

async function editorConcurrencyError(admin: ReturnType<typeof createSupabaseAdminClient>, editorId: string) {
  const binReady = await isRecycleBinReady();
  const [{ count, error }, { data: settings, error: settingsError }, exclusions] = await Promise.all([
    liveOnly(admin
      .from("ads")
      .select("id", { count: "exact", head: true })
      .eq("editor_id", editorId)
      .in("production_stage", inProgressEditingStages), binReady),
    admin.from("app_settings").select("max_concurrent_edits").eq("id", 1).single(),
    // Creatives that are explicitly unfrozen (override) or frozen (paused by manager) do not count toward the limit.
    liveOnly(admin
      .from("ads")
      .select("id", { count: "exact", head: true })
      .eq("editor_id", editorId)
      .in("production_stage", inProgressEditingStages)
      .in("editing_freeze", ["unfrozen", "frozen"]), binReady)
  ]);

  if (error) return error.message;
  if (settingsError) return settingsError.message;
  const excluded = exclusions.error ? 0 : exclusions.count ?? 0;
  const maxConcurrentEdits = settings?.max_concurrent_edits ?? 2;
  if (Math.max(0, (count ?? 0) - excluded) >= maxConcurrentEdits) {
    return `You already have ${maxConcurrentEdits} videos in progress. Submit one before starting another.`;
  }
  return null;
}

function validateGoogleDriveUrl(value: string | undefined, label: string) {
  if (!value?.trim()) return `Add the ${label} URL.`;
  try {
    const url = new URL(value);
    if (url.hostname !== "drive.google.com" && url.hostname !== "docs.google.com") {
      return `Use a Google Drive ${label} URL.`;
    }
  } catch {
    return `Use a valid ${label} URL.`;
  }
  return null;
}

async function notifySubmissionReviewers(ad: Ad, submitter: Profile) {
  const admin = createSupabaseAdminClient();
  const recipientIds = [ad.creator_id].filter((id): id is string => Boolean(id));
  const { data: finalReviewers } = await admin.from("profiles").select("id").in("role", ["admin", "manager"]).eq("active", true);
  recipientIds.push(...(finalReviewers ?? []).map((reviewer) => reviewer.id));
  await notifyUserIds(
    admin,
    Array.from(new Set(recipientIds)),
    ad.id,
    "Edited video ready for review",
    `${submitter.name} submitted ${ad.name}. The content creator can review it, and a manager or admin can approve it directly.`
  );
}

async function notifyFinalReviewers(admin: ReturnType<typeof createSupabaseAdminClient>, ad: Ad, body: string) {
  const { data: reviewers } = await admin.from("profiles").select("id").in("role", ["admin", "manager"]).eq("active", true);
  await notifyUserIds(admin, (reviewers ?? []).map((reviewer) => reviewer.id), ad.id, "Final approval required", body);
}

async function notifyUserIds(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userIds: string[],
  adId: string,
  title: string,
  body: string
) {
  if (!userIds.length) return;
  const { data: recipients } = await admin.from("profiles").select("*").in("id", Array.from(new Set(userIds))).eq("active", true);
  for (const recipient of recipients ?? []) {
    await createNotification(admin, { recipient: recipient as Profile, adId, title, body });
  }
}

async function logActivity(adId: string, actorId: string, action: string, metadata: Record<string, unknown>) {
  const admin = createSupabaseAdminClient();
  const normalizedMetadata = metadata.production_stage && !metadata.new_stage
    ? { ...metadata, new_stage: metadata.production_stage }
    : metadata;
  await admin.from("activity_logs").insert({
    ad_id: adId,
    actor_id: actorId,
    action,
    metadata: normalizedMetadata
  });
}

function revalidateAdPaths(adId: string) {
  revalidatePath("/dashboard"); invalidateDashboardCache();
  revalidatePath("/library"); invalidateLibraryCache();
  revalidatePath(`/ads/${adId}`);
  revalidatePath("/analytics");
  revalidatePath("/campaigns");
}

function notificationTitle(decision: "approve" | "request_changes", status: string) {
  if (decision === "approve" && status === "approved") {
    return "Ad approved";
  }
  if (decision === "approve") {
    return "Ad advanced to final approval";
  }
  if (decision === "request_changes") {
    return "Changes requested";
  }
  return "Changes requested";
}

export async function getNextAdName(creatorId: string): Promise<string> {
  await requireProfile();
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("name")
    .eq("id", creatorId)
    .maybeSingle();

  const rawName = profile?.name ?? "";
  const prefix = rawName.replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase();
  if (!prefix) return "AD0001";

  // Find all ads whose name matches PREFIX#### pattern for this user
  const { data: existing } = await admin
    .from("ads")
    .select("name")
    .ilike("name", `${prefix}%`);

  const max = (existing ?? []).reduce((acc, { name }) => {
    const suffix = name.slice(prefix.length);
    const num = parseInt(suffix, 10);
    return !isNaN(num) && String(num).padStart(4, "0") === suffix ? Math.max(acc, num) : acc;
  }, 0);

  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export async function bulkAssignCampaign(adIds: string[], campaignId: string) {
  const profile = await requireProfile();
  const settings = await getAppSettings();

  if (!canBulkAddToCampaign(profile.role, settings)) {
    return { ok: false, message: "You do not have permission to bulk assign creatives to campaigns." };
  }

  if (!Array.isArray(adIds) || adIds.length === 0) {
    return { ok: false, message: "No creatives selected." };
  }

  if (!campaignId) {
    return { ok: false, message: "Please select a target campaign." };
  }

  const admin = createSupabaseAdminClient();

  // Validate target campaign
  const binReadyForCampaign = await isRecycleBinReady();
  const { data: campaign, error: campaignError } = await liveOnly(admin
    .from("campaigns")
    .select("id, name, active")
    .eq("id", campaignId), binReadyForCampaign)
    .maybeSingle();

  if (campaignError || !campaign) {
    return { ok: false, message: campaignError?.message ?? "Selected campaign not found." };
  }

  // Fetch the target ads
  const { data: adsToUpdate, error: fetchError } = await admin
    .from("ads")
    .select("id, name, campaign_id")
    .in("id", adIds);

  if (fetchError || !adsToUpdate || adsToUpdate.length === 0) {
    return { ok: false, message: fetchError?.message ?? "Selected creatives not found." };
  }

  const now = new Date().toISOString();
  let updatedCount = 0;
  const errors: string[] = [];
  const updatedAdIds: string[] = [];

  for (const ad of adsToUpdate) {
    if (ad.campaign_id === campaignId) {
      updatedCount++;
      continue;
    }

    // Resolve name clash if ad with lower(name) exists in target campaign
    let targetName = ad.name;
    const { data: conflicting } = await admin
      .from("ads")
      .select("id")
      .eq("campaign_id", campaignId)
      .ilike("name", targetName)
      .neq("id", ad.id)
      .maybeSingle();

    if (conflicting) {
      targetName = `${ad.name} (${Math.floor(Math.random() * 900) + 100})`;
    }

    // If creative already belongs to another campaign, clone it so it can exist in multiple campaigns
    if (ad.campaign_id) {
      const { data: sourceAd, error: fetchFullError } = await admin
        .from("ads")
        .select("*")
        .eq("id", ad.id)
        .single();

      if (fetchFullError || !sourceAd) {
        errors.push(`Failed to load source creative ${ad.name}: ${fetchFullError?.message ?? "Not found"}`);
        continue;
      }

      // Prepare cloned ad payload
      const { id: _oldId, created_at: _cAt, updated_at: _uAt, deleted_at: _dAt, ...restOfAd } = sourceAd as Record<string, unknown>;
      const clonePayload = {
        ...restOfAd,
        name: targetName,
        campaign_id: campaignId,
        created_at: now,
        updated_at: now
      };

      const { data: insertedAd, error: insertError } = await admin
        .from("ads")
        .insert(clonePayload)
        .select("id")
        .single();

      if (insertError || !insertedAd) {
        errors.push(`Failed to add creative ${ad.name} to campaign: ${insertError?.message ?? "Insert failed"}`);
      } else {
        // Copy existing tags from source ad to the newly added creative
        try {
          const { data: tagsToCopy } = await admin
            .from("ad_tags")
            .select("tag_id")
            .eq("ad_id", ad.id);

          if (tagsToCopy && tagsToCopy.length > 0) {
            await admin.from("ad_tags").insert(
              tagsToCopy.map((t) => ({
                ad_id: insertedAd.id,
                tag_id: t.tag_id
              }))
            );
          }
        } catch (tagErr) {
          console.warn("Non-fatal: failed to duplicate tags for campaign ad copy:", tagErr);
        }

        updatedCount++;
        updatedAdIds.push(insertedAd.id);
      }
    } else {
      // Creative had no previous campaign; assign it directly
      const { error: updateError } = await admin
        .from("ads")
        .update({
          campaign_id: campaignId,
          name: targetName,
          updated_at: now
        })
        .eq("id", ad.id);

      if (updateError) {
        errors.push(`Failed to update ${ad.name}: ${updateError.message}`);
      } else {
        updatedCount++;
        updatedAdIds.push(ad.id);
      }
    }
  }

  if (updatedAdIds.length > 0) {
    try {
      await admin.from("audit_logs").insert(
        updatedAdIds.map((id) => ({
          actor_id: profile.id,
          action: "bulk_assigned_campaign",
          target_type: "ad",
          target_id: id,
          metadata: {
            new_campaign_id: campaignId,
            campaign_name: campaign.name
          }
        }))
      );
    } catch (auditErr) {
      console.warn("Non-fatal issue inserting audit log:", auditErr);
    }
  }

  revalidatePath("/library"); invalidateLibraryCache();
  revalidatePath("/dashboard");
  revalidatePath("/campaigns");
  revalidatePath("/campaigns/[id]", "page");
  revalidatePath(`/campaigns/${campaignId}`);

  if (updatedCount === 0 && errors.length > 0) {
    return { ok: false, message: errors[0] };
  }

  return {
    ok: true,
    count: updatedCount,
    message: `Successfully assigned ${updatedCount} creative${updatedCount === 1 ? "" : "s"} to "${campaign.name}".`
  };
}
