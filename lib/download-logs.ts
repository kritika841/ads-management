import { promises as fs } from "node:fs";
import path from "node:path";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type DownloadLogSource = "creative_library" | "campaigns" | "single_ad";
export type DownloadLogStatus = "preparing" | "building" | "ready" | "failed";

export type DownloadLog = {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  title: string;
  source: DownloadLogSource;
  campaign_id?: string | null;
  campaign_name?: string | null;
  creative_count: number;
  creative_ids: string[];
  creative_names: string[];
  status: DownloadLogStatus;
  zip_size_bytes: number | null;
  zip_file_path: string | null;
  zip_filename: string;
  error: string | null;
  download_count: number;
  last_downloaded_at: string | null;
  expires_at: string;
  created_at: string;
};

const RETENTION_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const LOCAL_STORE_FILE = path.join(process.cwd(), "data", "download-logs.json");

let supabaseTableAvailable: boolean | null = null;

function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function readLocalStore(): Promise<DownloadLog[]> {
  try {
    const raw = await fs.readFile(LOCAL_STORE_FILE, "utf-8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeLocalStore(logs: DownloadLog[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(LOCAL_STORE_FILE), { recursive: true });
    await fs.writeFile(LOCAL_STORE_FILE, JSON.stringify(logs, null, 2), "utf-8");
  } catch (cause) {
    console.error("Failed to write to local download-logs store:", cause);
  }
}

export async function createDownloadLog(input: {
  id: string;
  userId: string;
  userName: string;
  userRole: string;
  title: string;
  source?: DownloadLogSource;
  campaignId?: string | null;
  campaignName?: string | null;
  creativeCount: number;
  creativeIds: string[];
  creativeNames: string[];
  zipFilename: string;
  zipFilePath?: string | null;
}): Promise<DownloadLog> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RETENTION_MS);

  const log: DownloadLog = {
    id: input.id,
    user_id: input.userId,
    user_name: input.userName || "Admin",
    user_role: input.userRole || "admin",
    title: input.title,
    source: input.source || "creative_library",
    campaign_id: input.campaignId ?? null,
    campaign_name: input.campaignName ?? null,
    creative_count: input.creativeCount,
    creative_ids: input.creativeIds,
    creative_names: input.creativeNames,
    status: "preparing",
    zip_size_bytes: null,
    zip_file_path: input.zipFilePath ?? null,
    zip_filename: input.zipFilename,
    error: null,
    download_count: 0,
    last_downloaded_at: null,
    expires_at: expiresAt.toISOString(),
    created_at: now.toISOString(),
  };

  // 1. Always update local store
  const localLogs = await readLocalStore();
  const existingIdx = localLogs.findIndex((item) => item.id === log.id);
  if (existingIdx >= 0) {
    localLogs[existingIdx] = log;
  } else {
    localLogs.unshift(log);
  }
  await writeLocalStore(localLogs);

  // 2. Try Supabase if available
  if (isSupabaseConfigured() && supabaseTableAvailable !== false) {
    try {
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("download_logs").insert({
        id: log.id,
        user_id: log.user_id,
        user_name: log.user_name,
        user_role: log.user_role,
        title: log.title,
        source: log.source,
        campaign_id: log.campaign_id,
        campaign_name: log.campaign_name,
        creative_count: log.creative_count,
        creative_ids: log.creative_ids,
        creative_names: log.creative_names,
        status: log.status,
        zip_size_bytes: log.zip_size_bytes,
        zip_file_path: log.zip_file_path,
        zip_filename: log.zip_filename,
        error: log.error,
        download_count: log.download_count,
        last_downloaded_at: log.last_downloaded_at,
        expires_at: log.expires_at,
        created_at: log.created_at,
      });

      if (error) {
        if (error.code === "PGRST205" || error.message.includes("does not exist")) {
          supabaseTableAvailable = false;
        } else {
          console.warn("Could not insert download log to Supabase:", error.message);
        }
      } else {
        supabaseTableAvailable = true;
      }
    } catch (cause) {
      console.warn("Supabase download_logs insert error:", cause);
    }
  }

  return log;
}

export async function updateDownloadLog(
  id: string,
  patch: Partial<Omit<DownloadLog, "id" | "user_id" | "created_at">>
): Promise<DownloadLog | null> {
  // 1. Update local store
  const localLogs = await readLocalStore();
  const idx = localLogs.findIndex((item) => item.id === id);
  let updatedLog: DownloadLog | null = null;
  if (idx >= 0) {
    localLogs[idx] = { ...localLogs[idx], ...patch };
    updatedLog = localLogs[idx];
    await writeLocalStore(localLogs);
  }

  // 2. Update Supabase if available
  if (isSupabaseConfigured() && supabaseTableAvailable !== false) {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin
        .from("download_logs")
        .update(patch)
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error) {
        if (error.code === "PGRST205" || error.message.includes("does not exist")) {
          supabaseTableAvailable = false;
        }
      } else if (data) {
        supabaseTableAvailable = true;
        updatedLog = data as DownloadLog;
      }
    } catch {
      // ignore
    }
  }

  return updatedLog;
}

export async function getDownloadLogs(): Promise<DownloadLog[]> {
  // Trigger automatic cleanup of records older than 3 days
  await cleanupExpiredDownloadLogs().catch(() => undefined);

  if (isSupabaseConfigured() && supabaseTableAvailable !== false) {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin
        .from("download_logs")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && data) {
        supabaseTableAvailable = true;
        // Merge or sync with local store
        const localLogs = await readLocalStore();
        const map = new Map<string, DownloadLog>();
        for (const item of localLogs) map.set(item.id, item);
        for (const item of data as DownloadLog[]) map.set(item.id, item);
        const combined = Array.from(map.values()).sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        return combined;
      }
      if (error?.code === "PGRST205" || error?.message.includes("does not exist")) {
        supabaseTableAvailable = false;
      }
    } catch {
      // fallback
    }
  }

  const local = await readLocalStore();
  return local.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function getDownloadLogById(id: string): Promise<DownloadLog | null> {
  const localLogs = await readLocalStore();
  const local = localLogs.find((item) => item.id === id);
  if (local) return local;

  if (isSupabaseConfigured() && supabaseTableAvailable !== false) {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin
        .from("download_logs")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!error && data) return data as DownloadLog;
    } catch {
      // ignore
    }
  }
  return null;
}

export async function deleteDownloadLog(id: string): Promise<boolean> {
  const log = await getDownloadLogById(id);

  // 1. Delete physical ZIP file from disk if present
  if (log?.zip_file_path) {
    await fs.unlink(log.zip_file_path).catch(() => undefined);
  }

  // 2. Remove from local store
  const localLogs = await readLocalStore();
  const nextLogs = localLogs.filter((item) => item.id !== id);
  await writeLocalStore(nextLogs);

  // 3. Delete from Supabase
  if (isSupabaseConfigured() && supabaseTableAvailable !== false) {
    try {
      const admin = createSupabaseAdminClient();
      await admin.from("download_logs").delete().eq("id", id);
    } catch {
      // ignore
    }
  }

  return true;
}

export async function recordDownloadAccess(id: string): Promise<void> {
  const now = new Date().toISOString();
  const current = await getDownloadLogById(id);
  const count = (current?.download_count ?? 0) + 1;
  await updateDownloadLog(id, {
    download_count: count,
    last_downloaded_at: now,
  });
}

export async function cleanupExpiredDownloadLogs(): Promise<number> {
  const now = new Date().getTime();
  const localLogs = await readLocalStore();
  const expired: DownloadLog[] = [];
  const active: DownloadLog[] = [];

  for (const log of localLogs) {
    const expiresAt = new Date(log.expires_at).getTime();
    if (expiresAt <= now) {
      expired.push(log);
    } else {
      active.push(log);
    }
  }

  // Delete physical files for expired logs
  for (const exp of expired) {
    if (exp.zip_file_path) {
      await fs.unlink(exp.zip_file_path).catch(() => undefined);
    }
    // Also remove from Supabase if table is present
    if (isSupabaseConfigured() && supabaseTableAvailable !== false) {
      try {
        const admin = createSupabaseAdminClient();
        await admin.from("download_logs").delete().eq("id", exp.id);
      } catch {
        // ignore
      }
    }
  }

  if (expired.length > 0) {
    await writeLocalStore(active);
  }

  return expired.length;
}
