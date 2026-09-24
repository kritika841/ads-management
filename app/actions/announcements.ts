"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import {
  AnnouncementAttachment,
  AnnouncementTargetType,
  createAnnouncementRecord,
  deleteAnnouncementRecord,
  getAllAnnouncements,
  getUnacknowledgedAnnouncements,
  getUserVisibleAnnouncements,
  recordAcknowledgement,
  updateAnnouncementStatus
} from "@/lib/announcements";
import { getProfiles } from "@/lib/data";

const attachmentSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
  url: z.string().trim().min(1),
  size: z.number().optional(),
  type: z.string().optional()
});

const createAnnouncementSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200),
  content: z.string().trim().min(1, "Message content is required.").max(10000),
  images: z.array(z.string().trim()).default([]),
  attachments: z.array(attachmentSchema).default([]),
  targetType: z.enum(["all", "roles", "users"]),
  targetRoles: z.array(z.enum(["content_creator", "editor", "manager"])).optional(),
  targetUserIds: z.array(z.string().min(1)).optional()
});

export async function createAnnouncement(payload: z.input<typeof createAnnouncementSchema>) {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only managers and administrators can make announcements." };
  }

  const parsed = createAnnouncementSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid announcement data." };
  }

  // Managers cannot target managers without admin privilege
  let resolvedTargetRoles = parsed.data.targetRoles ?? [];
  if (profile.role === "manager") {
    resolvedTargetRoles = resolvedTargetRoles.filter((r) => r !== "manager");
  }

  try {
    const record = await createAnnouncementRecord({
      title: parsed.data.title,
      content: parsed.data.content,
      images: parsed.data.images,
      attachments: parsed.data.attachments as AnnouncementAttachment[],
      authorId: profile.id,
      authorName: profile.name,
      authorRole: profile.role as "admin" | "manager",
      targetType: parsed.data.targetType as AnnouncementTargetType,
      targetRoles: resolvedTargetRoles,
      targetUserIds: parsed.data.targetUserIds
    });

    revalidatePath("/announcements");
    revalidatePath("/admin/settings");
    revalidatePath("/dashboard");
    return { ok: true, announcement: record };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : "Failed to create announcement." };
  }
}

export async function acknowledgeAnnouncement(announcementId: string) {
  const profile = await requireProfile();
  if (!announcementId) {
    return { ok: false, message: "Announcement ID required." };
  }

  try {
    const success = await recordAcknowledgement(announcementId, {
      id: profile.id,
      name: profile.name,
      role: profile.role
    });

    if (success) {
      revalidatePath("/announcements");
      revalidatePath("/admin/settings");
      revalidatePath("/dashboard");
      return { ok: true };
    }
    return { ok: false, message: "Failed to acknowledge announcement." };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : "Acknowledgement failed." };
  }
}

export async function archiveAnnouncement(announcementId: string) {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only managers and administrators can archive announcements." };
  }

  try {
    const success = await updateAnnouncementStatus(announcementId, "archived");
    if (success) {
      revalidatePath("/announcements");
      revalidatePath("/admin/settings");
      return { ok: true };
    }
    return { ok: false, message: "Failed to archive announcement." };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : "Archive failed." };
  }
}

export async function deleteAnnouncement(announcementId: string) {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only managers and administrators can delete announcements." };
  }

  try {
    const success = await deleteAnnouncementRecord(announcementId);
    if (success) {
      revalidatePath("/announcements");
      revalidatePath("/admin/settings");
      return { ok: true };
    }
    return { ok: false, message: "Failed to delete announcement." };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : "Delete failed." };
  }
}

export async function getPendingAnnouncements() {
  const profile = await requireProfile();
  const unacknowledged = await getUnacknowledgedAnnouncements({
    id: profile.id,
    role: profile.role
  });
  return unacknowledged;
}

export async function getAnnouncementsWithStats() {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Unauthorized", announcements: [], allProfiles: [] };
  }

  const [announcements, allProfiles] = await Promise.all([
    getAllAnnouncements(),
    getProfiles()
  ]);

  return {
    ok: true,
    announcements,
    allProfiles
  };
}

export async function unarchiveAnnouncement(announcementId: string) {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only managers and administrators can restore announcements." };
  }

  try {
    const success = await updateAnnouncementStatus(announcementId, "active");
    if (success) {
      revalidatePath("/announcements");
      revalidatePath("/admin/settings");
      return { ok: true };
    }
    return { ok: false, message: "Failed to unarchive announcement." };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : "Unarchive failed." };
  }
}

export async function getUserAnnouncements() {
  const profile = await requireProfile();
  const announcements = await getUserVisibleAnnouncements({
    id: profile.id,
    role: profile.role
  });
  return announcements;
}


