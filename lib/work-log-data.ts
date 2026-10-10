import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ActivityLog, EditorTimeLog } from "@/lib/types";
import { workLogRangeBoundsMs, type WorkLogAd } from "@/lib/work-log";
import { getAttendanceForRange } from "@/lib/attendance";

const PAGE_SIZE = 1000;
const MAX_PAGES = 30;
const ID_CHUNK = 100;

type Page<T> = { data: T[] | null; error: { message: string } | null };

/** PostgREST caps responses at 1000 rows, so page through larger ranges. */
async function fetchAllPages<T>(query: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await query(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

/** Loads only what the work log needs for the date range (activity, editing sessions, creatives, and attendance). */
export async function getWorkLogData(from: string, to: string) {
  const admin = createSupabaseAdminClient();
  const { start, end } = workLogRangeBoundsMs(from, to);
  const startIso = new Date(start).toISOString();
  const endIso = new Date(end).toISOString();

  const [logs, timeLogs, attendanceLogs] = await Promise.all([
    fetchAllPages<ActivityLog>((a, b) =>
      admin
        .from("activity_logs")
        .select("id, ad_id, actor_id, action, metadata, created_at")
        .not("ad_id", "is", null)
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .order("created_at", { ascending: true })
        .range(a, b) as unknown as PromiseLike<Page<ActivityLog>>
    ),
    fetchAllPages<EditorTimeLog>((a, b) =>
      admin
        .from("editor_time_logs")
        .select("id, ad_id, editor_id, session_started_at, session_ended_at, pause_reason, is_active, created_at")
        .lt("session_started_at", endIso)
        .or(`session_ended_at.gte.${startIso},session_ended_at.is.null`)
        .order("session_started_at", { ascending: true })
        .range(a, b) as unknown as PromiseLike<Page<EditorTimeLog>>
    ),
    getAttendanceForRange(from, to)
  ]);

  const adIds = Array.from(new Set([...logs.map((log) => log.ad_id), ...timeLogs.map((log) => log.ad_id)].filter((id): id is string => Boolean(id))));
  const ads: WorkLogAd[] = [];
  for (let i = 0; i < adIds.length; i += ID_CHUNK) {
    const { data, error } = await admin
      .from("ads")
      .select("id, name, creator_id, editor_id, production_stage, created_at")
      .in("id", adIds.slice(i, i + ID_CHUNK));
    if (error) throw new Error(error.message);
    ads.push(...((data ?? []) as WorkLogAd[]));
  }

  return { logs, timeLogs, ads, attendanceLogs };
}
