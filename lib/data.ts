import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { activeEditorStages, inProgressEditingStages } from "@/lib/production-workflow";
import { sanitizeScriptHtml } from "@/lib/sanitize";
import type {
  ActivityLog,
  AdVersion,
  AdWithRelations,
  Annotation,
  AppSettings,
  AuditLog,
  Campaign,
  Comment,
  EditorTimeLog,
  Notification,
  Product,
  Profile,
  ReviewAction
} from "@/lib/types";

export async function getNotifications(userId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    throw error;
  }

  return (data ?? []) as Notification[];
}

export async function getCampaigns() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as Campaign[];
}

export async function getProducts() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as Product[];
}

export async function getProfiles() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as Profile[];
}

export async function getTags() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tags")
    .select("name")
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((tag) => tag.name);
}

export async function getEditorWorkloads() {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("ads")
    .select("editor_id,production_stage")
    .not("editor_id", "is", null)
    .in("production_stage", activeEditorStages);
  if (error) throw error;

  return (data ?? []).reduce<Record<string, number>>((counts, ad) => {
    if (ad.editor_id) counts[ad.editor_id] = (counts[ad.editor_id] ?? 0) + 1;
    return counts;
  }, {});
}

export async function getEditorInProgressCount(editorId: string) {
  const admin = createSupabaseAdminClient();
  const { count, error } = await admin
    .from("ads")
    .select("id", { count: "exact", head: true })
    .eq("editor_id", editorId)
    .in("production_stage", inProgressEditingStages);
  if (error) throw error;

  return count ?? 0;
}

export async function getAppSettings() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("app_settings").select("*").eq("id", 1).single();

  if (error) {
    throw error;
  }

  return data as AppSettings;
}

export async function getAds() {
  const supabase = await createSupabaseServerClient();
  const query = supabase
    .from("ads")
    .select(
      `
        *,
        creator:profiles!ads_creator_id_fkey(id,name,email,avatar_url,role),
        editor:profiles!ads_editor_id_fkey(id,name,email,avatar_url,role),
        campaign:campaigns(id,name),
        product:products(id,name,sku,image_url),
        ad_tags(tags(id,name))
      `
    )
    .order("updated_at", { ascending: false });

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return normalizeAds(data ?? []);
}

export async function getAllAdsForAnalytics() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ads")
    .select(
      `
        *,
        creator:profiles!ads_creator_id_fkey(id,name,email,avatar_url,role),
        editor:profiles!ads_editor_id_fkey(id,name,email,avatar_url,role),
        campaign:campaigns(id,name),
        product:products(id,name,sku,image_url),
        ad_tags(tags(id,name)),
        ad_versions(id)
      `
    )
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return normalizeAds(data ?? []);
}

export async function getAdDetail(adId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: ad, error } = await supabase
    .from("ads")
    .select(
      `
        *,
        creator:profiles!ads_creator_id_fkey(id,name,email,avatar_url,role),
        editor:profiles!ads_editor_id_fkey(id,name,email,avatar_url,role),
        campaign:campaigns(id,name),
        product:products(id,name,sku,image_url),
        ad_tags(tags(id,name))
      `
    )
    .eq("id", adId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!ad) {
    return null;
  }

  const detailResults = await Promise.all([
      supabase
        .from("ad_versions")
        .select("*")
        .eq("ad_id", adId)
        .order("version_number", { ascending: false }),
      supabase
        .from("comments")
        .select("*, author:profiles!comments_author_id_fkey(id,name,avatar_url,role)")
        .eq("ad_id", adId)
        .order("created_at", { ascending: true }),
      supabase
        .from("annotations")
        .select("*, author:profiles!annotations_author_id_fkey(id,name,avatar_url,role)")
        .eq("ad_id", adId)
        .order("created_at", { ascending: true }),
      supabase
        .from("review_actions")
        .select("*, reviewer:profiles!review_actions_reviewer_id_fkey(id,name,avatar_url,role)")
        .eq("ad_id", adId)
        .order("created_at", { ascending: false }),
      supabase
        .from("activity_logs")
        .select("*, actor:profiles!activity_logs_actor_id_fkey(id,name,avatar_url,role)")
        .eq("ad_id", adId)
        .order("created_at", { ascending: false }),
      supabase
        .from("ad_collaborators")
        .select("profile_id")
        .eq("ad_id", adId)
    ]);
  const detailError = detailResults.find((result) => result.error)?.error;
  if (detailError) {
    throw detailError;
  }

  const [versionsResult, commentsResult, annotationsResult, reviewsResult, activityResult, collaboratorsResult] = detailResults;

  return {
    ad: normalizeAds([ad])[0],
    versions: (versionsResult.data ?? []).map((version) => ({
      ...(version as AdVersion),
      script_html: sanitizeScriptHtml(version.script_html) || null
    })),
    comments: (commentsResult.data ?? []) as Comment[],
    annotations: (annotationsResult.data ?? []) as Annotation[],
    reviews: (reviewsResult.data ?? []) as ReviewAction[],
    activity: (activityResult.data ?? []) as ActivityLog[],
    collaboratorIds: ((collaboratorsResult.data ?? []) as { profile_id: string }[]).map((row) => row.profile_id)
  };
}

export async function getAuditLogs() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*, actor:profiles!audit_logs_actor_id_fkey(id,name,avatar_url,role)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw error;
  }

  return (data ?? []) as AuditLog[];
}

export async function getAnalyticsActivityLogs() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("activity_logs")
    .select("id,ad_id,actor_id,action,metadata,created_at")
    .not("ad_id", "is", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ActivityLog[];
}

export async function getAnalyticsReviewActions() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("review_actions")
    .select("id,ad_id,reviewer_id,decision,note,created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ReviewAction[];
}

function normalizeAds(rows: unknown[]) {
  return rows.map((row) => {
    const record = row as AdWithRelations & {
      ad_tags?: { tags?: { id: string; name: string } | null }[];
      ad_versions?: { id: string }[];
    };

    return {
      ...record,
      script_html: sanitizeScriptHtml(record.script_html) || null,
      version_count: record.ad_versions?.length ?? record.version_count,
      tags: (record.ad_tags ?? [])
        .map((item) => item.tags)
        .filter(Boolean) as { id: string; name: string }[]
    };
  }) as AdWithRelations[];
}

export async function getEditorTimeLogs(adId: string): Promise<EditorTimeLog[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("editor_time_logs")
    .select("*, editor:profiles!editor_time_logs_editor_id_fkey(id,name,avatar_url,role)")
    .eq("ad_id", adId)
    .order("session_started_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EditorTimeLog[];
}

export async function getEditorTotalSeconds(adId: string): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("get_editor_total_seconds", { p_ad_id: adId });
  if (error) throw error;
  return (data as number) ?? 0;
}

export type EditorTimelinePoint = { date: string; [editorId: string]: string | number };

export async function getEditorTimelineData(days: number): Promise<EditorTimelinePoint[]> {
  const admin = createSupabaseAdminClient();
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - days);
  
  const { data, error } = await admin
    .from("editor_time_logs")
    .select("editor_id, session_started_at, session_ended_at, is_active")
    .gte("session_started_at", threshold.toISOString())
    .order("session_started_at", { ascending: true });
    
  if (error) throw error;

  const grouped: Record<string, Record<string, number>> = {};
  for (const log of (data || [])) {
    const end = log.session_ended_at ? new Date(log.session_ended_at).getTime() : Date.now();
    const start = new Date(log.session_started_at).getTime();
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    
    // Group by local date string (YYYY-MM-DD)
    const dateKey = new Date(log.session_started_at).toISOString().split('T')[0];
    if (!grouped[dateKey]) grouped[dateKey] = {};
    grouped[dateKey][log.editor_id] = (grouped[dateKey][log.editor_id] || 0) + seconds;
  }

  // Ensure all dates in range exist
  const result: EditorTimelinePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().split('T')[0];
    const point: EditorTimelinePoint = { date: dateKey, ...grouped[dateKey] };
    result.push(point);
  }
  return result;
}

export async function getEditorAverageEditTimes(): Promise<Record<string, number>> {
  const admin = createSupabaseAdminClient();
  
  // Fetch all time logs for completed/approved ads, or just all inactive time logs.
  // To keep it simple and approximate the "average per video", we sum all time per ad, 
  // then average across distinct ads per editor.
  const { data, error } = await admin
    .from("editor_time_logs")
    .select("editor_id, ad_id, session_started_at, session_ended_at, is_active")
    .eq("is_active", false)
    .not("session_ended_at", "is", null);
    
  if (error) throw error;
  
  const adTotals: Record<string, Record<string, number>> = {};
  for (const log of (data || [])) {
    const start = new Date(log.session_started_at).getTime();
    const end = new Date(log.session_ended_at).getTime();
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    
    if (!adTotals[log.editor_id]) adTotals[log.editor_id] = {};
    adTotals[log.editor_id][log.ad_id] = (adTotals[log.editor_id][log.ad_id] || 0) + seconds;
  }
  
  const averages: Record<string, number> = {};
  for (const [editorId, ads] of Object.entries(adTotals)) {
    const adIds = Object.keys(ads);
    if (adIds.length === 0) continue;
    const totalSeconds = Object.values(ads).reduce((sum, s) => sum + s, 0);
    averages[editorId] = Math.floor(totalSeconds / adIds.length);
  }
  return averages;
}
