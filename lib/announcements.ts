import { promises as fs } from "node:fs";
import path from "node:path";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types";

export type AnnouncementTargetType = "all" | "roles" | "users";

export type AnnouncementAttachment = {
  id: string;
  name: string;
  url: string;
  size?: number;
  type?: string;
};

export type AnnouncementAcknowledgement = {
  user_id: string;
  user_name: string;
  user_role: string;
  acknowledged_at: string;
};

export type Announcement = {
  id: string;
  title: string;
  content: string;
  images: string[];
  attachments: AnnouncementAttachment[];
  author_id: string;
  author_name: string;
  author_role: "admin" | "manager";
  target_type: AnnouncementTargetType;
  target_roles: ("content_creator" | "editor" | "manager")[];
  target_user_ids: string[];
  status: "active" | "archived";
  show_popup?: boolean;
  created_at: string;
  updated_at: string;
  acknowledgements: AnnouncementAcknowledgement[];
};

const LOCAL_STORE_FILE = path.join(process.cwd(), "data", "announcements.json");
let supabaseTableAvailable: boolean | null = null;

function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function readLocalStore(): Promise<Announcement[]> {
  try {
    const raw = await fs.readFile(LOCAL_STORE_FILE, "utf-8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeLocalStore(announcements: Announcement[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(LOCAL_STORE_FILE), { recursive: true });
    await fs.writeFile(LOCAL_STORE_FILE, JSON.stringify(announcements, null, 2), "utf-8");
  } catch (cause) {
    console.error("Failed to write to local announcements store:", cause);
  }
}

async function checkSupabaseTable(): Promise<boolean> {
  if (supabaseTableAvailable !== null) return supabaseTableAvailable;
  if (!isSupabaseConfigured()) {
    supabaseTableAvailable = false;
    return false;
  }
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("announcements").select("id").limit(1);
    supabaseTableAvailable = !error;
    return supabaseTableAvailable;
  } catch {
    supabaseTableAvailable = false;
    return false;
  }
}

export async function getAllAnnouncements(): Promise<Announcement[]> {
  const hasDb = await checkSupabaseTable();
  if (hasDb) {
    try {
      const admin = createSupabaseAdminClient();
      const { data: rows, error } = await admin
        .from("announcements")
        .select(`
          *,
          acknowledgements:announcement_acknowledgements(*)
        `)
        .order("created_at", { ascending: false });

      if (!error && rows) {
        return rows.map((r) => ({
          id: r.id,
          title: r.title,
          content: r.content,
          images: Array.isArray(r.images) ? r.images : [],
          attachments: Array.isArray(r.attachments) ? r.attachments : [],
          author_id: r.author_id,
          author_name: r.author_name,
          author_role: r.author_role,
          target_type: r.target_type,
          target_roles: Array.isArray(r.target_roles) ? r.target_roles : [],
          target_user_ids: Array.isArray(r.target_user_ids) ? r.target_user_ids : [],
          status: r.status,
          show_popup: r.show_popup !== false,
          created_at: r.created_at,
          updated_at: r.updated_at,
          acknowledgements: Array.isArray(r.acknowledgements) ? r.acknowledgements : []
        }));
      }
    } catch (cause) {
      console.warn("Falling back to local store for announcements:", cause);
    }
  }

  const list = await readLocalStore();
  return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function createAnnouncementRecord(input: {
  title: string;
  content: string;
  images?: string[];
  attachments?: AnnouncementAttachment[];
  authorId: string;
  authorName: string;
  authorRole: "admin" | "manager";
  targetType: AnnouncementTargetType;
  targetRoles?: ("content_creator" | "editor" | "manager")[];
  targetUserIds?: string[];
  showPopup?: boolean;
}): Promise<Announcement> {
  const announcement: Announcement = {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    content: input.content.trim(),
    images: input.images ?? [],
    attachments: input.attachments ?? [],
    author_id: input.authorId,
    author_name: input.authorName,
    author_role: input.authorRole,
    target_type: input.targetType,
    target_roles: input.targetRoles ?? [],
    target_user_ids: input.targetUserIds ?? [],
    status: "active",
    show_popup: input.showPopup !== false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    acknowledgements: []
  };

  const hasDb = await checkSupabaseTable();
  if (hasDb) {
    try {
      const admin = createSupabaseAdminClient();
      const insertPayload: Record<string, unknown> = {
        id: announcement.id,
        title: announcement.title,
        content: announcement.content,
        images: announcement.images,
        attachments: announcement.attachments,
        author_id: announcement.author_id,
        author_name: announcement.author_name,
        author_role: announcement.author_role,
        target_type: announcement.target_type,
        target_roles: announcement.target_roles,
        target_user_ids: announcement.target_user_ids,
        status: announcement.status,
        show_popup: announcement.show_popup,
        created_at: announcement.created_at,
        updated_at: announcement.updated_at
      };
      let { error } = await admin.from("announcements").insert(insertPayload);
      if (error && (error.code === "PGRST204" || error.message.includes("show_popup"))) {
        delete insertPayload.show_popup;
        const retry = await admin.from("announcements").insert(insertPayload);
        error = retry.error;
      }
      if (!error) return announcement;
    } catch (cause) {
      console.warn("Failed to write announcement to Supabase, falling back to local file:", cause);
    }
  }

  const existing = await readLocalStore();
  existing.unshift(announcement);
  await writeLocalStore(existing);
  return announcement;
}

export function isUserTargetedByAnnouncement(
  announcement: Announcement,
  user: { id: string; role: UserRole } | string,
  role?: UserRole
): boolean {
  if (announcement.status !== "active" && (announcement.status as string) !== "published") return false;

  const userId = typeof user === "string" ? user : user.id;
  const userRole = typeof user === "string" ? (role ?? "content_creator") : user.role;

  if (announcement.target_type === "all") {
    return true;
  }

  if (announcement.target_type === "roles") {
    return Boolean(
      announcement.target_roles &&
      announcement.target_roles.includes(userRole as ("content_creator" | "editor" | "manager"))
    );
  }

  if (announcement.target_type === "users") {
    return Boolean(
      announcement.target_user_ids &&
      announcement.target_user_ids.includes(userId)
    );
  }

  return false;
}

export async function getUnacknowledgedAnnouncements(user: {
  id: string;
  role: UserRole;
}): Promise<Announcement[]> {
  const all = await getAllAnnouncements();
  return all.filter((announcement) => {
    if (!isUserTargetedByAnnouncement(announcement, user)) return false;
    if (announcement.show_popup === false) return false;
    const hasAcknowledged = announcement.acknowledgements.some((ack) => ack.user_id === user.id);
    return !hasAcknowledged;
  });
}

export async function getUserVisibleAnnouncements(user: {
  id: string;
  role: UserRole;
}): Promise<Announcement[]> {
  const all = await getAllAnnouncements();
  return all.filter((announcement) => {
    return isUserTargetedByAnnouncement(announcement, user);
  });
}

export async function recordAcknowledgement(
  announcementId: string,
  user: { id: string; name: string; role: string }
): Promise<boolean> {
  const hasDb = await checkSupabaseTable();
  const ackRecord: AnnouncementAcknowledgement = {
    user_id: user.id,
    user_name: user.name,
    user_role: user.role,
    acknowledged_at: new Date().toISOString()
  };

  if (hasDb) {
    try {
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("announcement_acknowledgements").upsert(
        {
          announcement_id: announcementId,
          user_id: user.id,
          user_name: user.name,
          user_role: user.role,
          acknowledged_at: ackRecord.acknowledged_at
        },
        { onConflict: "announcement_id,user_id" }
      );
      if (!error) return true;
    } catch (cause) {
      console.warn("Failed to record acknowledgement in Supabase, using local store:", cause);
    }
  }

  const list = await readLocalStore();
  const item = list.find((a) => a.id === announcementId);
  if (!item) return false;

  if (!item.acknowledgements.some((a) => a.user_id === user.id)) {
    item.acknowledgements.push(ackRecord);
    item.updated_at = new Date().toISOString();
    await writeLocalStore(list);
  }
  return true;
}

export async function updateAnnouncementStatus(
  announcementId: string,
  status: "active" | "archived"
): Promise<boolean> {
  const hasDb = await checkSupabaseTable();
  if (hasDb) {
    try {
      const admin = createSupabaseAdminClient();
      const { error } = await admin
        .from("announcements")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", announcementId);
      if (!error) return true;
    } catch (cause) {
      console.warn("Failed to update status in Supabase, using local store:", cause);
    }
  }

  const list = await readLocalStore();
  const item = list.find((a) => a.id === announcementId);
  if (!item) return false;
  item.status = status;
  item.updated_at = new Date().toISOString();
  await writeLocalStore(list);
  return true;
}

export async function deleteAnnouncementRecord(announcementId: string): Promise<boolean> {
  const hasDb = await checkSupabaseTable();
  if (hasDb) {
    try {
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("announcements").delete().eq("id", announcementId);
      if (!error) return true;
    } catch (cause) {
      console.warn("Failed to delete from Supabase, using local store:", cause);
    }
  }

  const list = await readLocalStore();
  const filtered = list.filter((a) => a.id !== announcementId);
  await writeLocalStore(filtered);
  return true;
}
