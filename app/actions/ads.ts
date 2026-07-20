"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canReview, requireProfile } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasAdAccess } from "@/lib/ad-access";
import { canDeleteAd } from "@/lib/permissions";
import {
  activeEditorStages,
  creatorControlledStages,
  creatorEditableStages,
  inProgressEditingStages
} from "@/lib/production-workflow";
import { getDriveMetadata } from "@/lib/drive";
import { parseGoogleDriveVideoFileUrl } from "@/lib/drive-urls";
import { extractMentions, profileMentionHandles } from "@/lib/mentions";
import { createNotification } from "@/lib/notifications";
import { sanitizeScriptHtml } from "@/lib/sanitize";
import { validateReviewInput } from "@/lib/workflow";
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

  // Managers may assign themselves as the creator. In that case we skip the
  // content_creator role check and just verify their own active profile.
  const isManagerSelf = profile.role === "manager" && data.creatorId === profile.id;

  let creator: { id: string } | null = null;
  let creatorError: { message: string } | null = null;

  if (isManagerSelf) {
    const { data: managerProfile, error: managerError } = await admin
      .from("profiles")
      .select("id")
      .eq("id", profile.id)
      .eq("active", true)
      .maybeSingle();
    creator = managerProfile ?? null;
    creatorError = managerError ?? null;
  } else {
    const { data: creatorData, error: creatorErr } = await admin
      .from("profiles")
      .select("id")
      .eq("id", data.creatorId)
      .eq("role", "content_creator")
      .eq("active", true)
      .maybeSingle();
    creator = creatorData ?? null;
    creatorError = creatorErr ?? null;
  }

  if (creatorError || !creator) {
    return { ok: false, message: creatorError?.message ?? "Choose an active content creator." };
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

  let editorId: string | null = null;
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
  const patch = {
    name: data.name,
    campaign_id: data.campaignId,
    product_id: data.productId,
    creator_id: data.creatorId,
    editor_id: editorId,
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

  const concurrencyError = await editorConcurrencyError(admin, profile.id);
  if (concurrencyError) return { ok: false, message: concurrencyError };

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

  if (profile.role !== "content_creator" || ad.creator_id !== profile.id) {
    return { ok: false, message: "Only the assigned content creator can complete creator review." };
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

export async function reviewAd(adId: string, decision: "approve" | "request_changes", note: string) {
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
  if (!isAdminReopen && (ad.status !== "pending_review" || !["creator_review", "final_review"].includes(ad.production_stage))) {
    return { ok: false, message: "This video is not waiting for final review." };
  }

  const { error } = await admin.rpc("final_review_ad_atomic", {
    p_ad_id: adId,
    p_actor_id: profile.id,
    p_decision: decision,
    p_note: note.trim() || null
  });
  if (error) return { ok: false, message: error.message };

  const nextStatus = decision === "approve" ? "approved" : "changes_requested";

  const recipientIds = Array.from(new Set([ad.creator_id, ad.editor_id].filter((id): id is string => Boolean(id))));
  const { data: recipients } = recipientIds.length
    ? await admin
        .from("profiles")
        .select("*")
        .in("id", recipientIds)
    : { data: [] };

  for (const recipient of recipients ?? []) {
    await createNotification(admin, {
      recipient: recipient as Profile,
      adId,
      title: notificationTitle(decision, nextStatus),
      body: note || `${ad.name} is now ${nextStatus.replace("_", " ")}.`
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/library");
  revalidatePath(`/ads/${adId}`);
  revalidatePath("/analytics");

  return { ok: true };
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
  revalidatePath("/library");
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
  const { error: rpcError } = await admin.rpc("add_ad_tags_bulk", { p_ad_ids: allowedIds, p_tags: normalizedTags });
  if (rpcError) {
    return { ok: false, message: rpcError.message };
  }

  for (const adId of allowedIds) {
    await logActivity(adId, profile.id, "bulk_tagged", { tags: normalizedTags });
  }

  revalidatePath("/dashboard");
  revalidatePath("/library");

  return { ok: true, count: allowedIds.length };
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
  const [{ count, error }, { data: settings, error: settingsError }] = await Promise.all([
    admin
      .from("ads")
      .select("id", { count: "exact", head: true })
      .eq("editor_id", editorId)
      .in("production_stage", inProgressEditingStages),
    admin.from("app_settings").select("max_concurrent_edits").eq("id", 1).single()
  ]);

  if (error) return error.message;
  if (settingsError) return settingsError.message;
  const maxConcurrentEdits = settings?.max_concurrent_edits ?? 2;
  if ((count ?? 0) >= maxConcurrentEdits) {
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
  revalidatePath("/dashboard");
  revalidatePath("/library");
  revalidatePath(`/ads/${adId}`);
  revalidatePath("/analytics");
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
