import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { activeEditorStages, inProgressEditingStages } from "@/lib/production-workflow";
import { sanitizeScriptHtml } from "@/lib/sanitize";
import { DEFAULT_HIDDEN_METRICS, type HiddenMetricsByRole } from "@/lib/metric-visibility";
import { readMetricVisibilityFile } from "@/lib/metric-visibility-server";
import type {
  ActivityLog,
  AdVersion,
  AdWithRelations,
  Annotation,
  AppSettings,
  AuditLog,
  Campaign,
  Comment,
  DailyTarget,
  DailyTaskRule,
  DailyTargetDaySetting,
  EditorTimeLog,
  Notification,
  Product,
  Profile,
  ReviewAction,
  ReviewSubmissionType
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

export async function getDailyTargets(startDate: string, endDate: string) {
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("materialize_daily_task_rules", { p_start: startDate, p_end: endDate });
  const [{ data, error }, { data: settings, error: settingsError }] = await Promise.all([
    supabase.from("daily_team_targets").select("*").gte("target_date", startDate).lte("target_date", endDate).order("target_date"),
    supabase.from("daily_target_day_settings").select("user_id,target_date,mode").gte("target_date", startDate).lte("target_date", endDate),
  ]);
  if (error) throw error;
  // “Automatic tasks only” is a view of the day, not a destructive update.
  // Keep appended targets in the database so changing back to append restores them.
  if (settingsError?.code === "PGRST205") return (data ?? []) as DailyTarget[];
  if (settingsError) throw settingsError;
  const isSunday = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
  };
  const automaticOnly = new Set((settings ?? []).filter((setting) => setting.mode === "auto_only").map((setting) => `${setting.user_id}:${setting.target_date}`));
  return (data ?? []).filter((target) => {
    if (target.assigned_by && automaticOnly.has(`${target.user_id}:${target.target_date}`)) return false;
    if (isSunday(target.target_date) && (target.carried_from_target_id || target.task_name.toLowerCase().includes("(carried forward)") || !target.assigned_by)) {
      return false;
    }
    return true;
  }) as DailyTarget[];
}

export async function getDailyTaskRules() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("daily_task_rules").select("*").order("active", { ascending: false }).order("task_name");
  // Keep the existing target sheet usable while a deployment is waiting for
  // the optional auto-delegator migration to be applied.
  if (error?.code === "PGRST205") return [];
  if (error) throw error;
  return (data ?? []) as DailyTaskRule[];
}

export async function getDailyTargetDaySettings(startDate: string, endDate: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("daily_target_day_settings").select("*").gte("target_date", startDate).lte("target_date", endDate);
  if (error?.code === "PGRST205") return [];
  if (error) throw error;
  return (data ?? []) as DailyTargetDaySetting[];
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

  const fileMetrics = await readMetricVisibilityFile();
  const record = data as AppSettings & {
    allow_manager_final_approval?: boolean;
    two_step_approval?: boolean;
    hidden_metrics_by_role?: HiddenMetricsByRole;
  };
  const hiddenMetrics = record.hidden_metrics_by_role || fileMetrics || DEFAULT_HIDDEN_METRICS;

  return {
    ...record,
    allow_manager_final_approval: record.allow_manager_final_approval !== undefined
      ? record.allow_manager_final_approval
      : !record.two_step_approval,
    hidden_metrics_by_role: {
      content_creator: hiddenMetrics.content_creator ?? [],
      editor: hiddenMetrics.editor ?? [],
      manager: hiddenMetrics.manager ?? []
    }
  } as AppSettings;
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
        ad_tags(tags(id,name)),
        review_actions(id,decision,note,created_at,reviewer:profiles!review_actions_reviewer_id_fkey(id,name,role)),
        activity_logs(id,action,actor_id,metadata,created_at)
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
  const normalizedAd = normalizeAds([{ ...ad, activity_logs: activityResult.data, review_actions: reviewsResult.data }])[0];
  const latestChangeAction = (reviewsResult.data ?? []).find((r: { decision: string }) => r.decision === "request_changes");
  if (latestChangeAction && !normalizedAd.latest_change_request) {
    normalizedAd.latest_change_request = {
      id: latestChangeAction.id,
      note: latestChangeAction.note,
      created_at: latestChangeAction.created_at,
      reviewer: latestChangeAction.reviewer
    };
  }

  return {
    ad: normalizedAd,
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
      review_actions?: { id: string; decision: string; note: string | null; created_at: string; reviewer?: Pick<Profile, "id" | "name" | "role"> | null }[];
      activity_logs?: { id: string; action: string; actor_id?: string | null; metadata?: Record<string, unknown> | null; created_at: string }[];
    };

    const changeReviews = (record.review_actions ?? [])
      .filter((action) => action.decision === "request_changes")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const latestChange = changeReviews[0] ? {
      id: changeReviews[0].id,
      note: changeReviews[0].note,
      created_at: changeReviews[0].created_at,
      reviewer: changeReviews[0].reviewer
    } : null;

    let reviewSubmissionType: ReviewSubmissionType | undefined;
    const changeLogs = (record.activity_logs ?? [])
      .filter((log) => {
        const stage = (log.metadata as Record<string, unknown> | null)?.production_stage;
        return (
          stage === "creator_changes_requested" ||
          stage === "changes_requested" ||
          log.action.includes("changes_requested") ||
          log.action.includes("requested_changes")
        );
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const hasAnyChangeRequested = changeReviews.length > 0 || changeLogs.length > 0;
    if (!hasAnyChangeRequested) {
      reviewSubmissionType = "new";
    } else {
      const latestLog = changeLogs[0];
      const logStage = (latestLog?.metadata as Record<string, unknown> | null)?.production_stage;
      if (
        logStage === "creator_changes_requested" ||
        latestLog?.action === "final_changes_requested_to_creator" ||
        latestLog?.action === "creator_changes_requested"
      ) {
        reviewSubmissionType = "creator_resubmission";
      } else if (
        logStage === "changes_requested" ||
        latestLog?.action === "final_changes_requested_to_editor" ||
        latestLog?.action === "creator_requested_changes" ||
        latestLog?.action === "final_changes_requested"
      ) {
        reviewSubmissionType = "editor_resubmission";
      } else if (latestChange?.reviewer?.role === "content_creator") {
        reviewSubmissionType = "editor_resubmission";
      } else {
        reviewSubmissionType = "editor_resubmission";
      }
    }

    return {
      ...record,
      script_html: sanitizeScriptHtml(record.script_html) || null,
      version_count: record.ad_versions?.length ?? record.version_count,
      latest_change_request: latestChange,
      review_submission_type: reviewSubmissionType,
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

export async function getAllEditorTimeLogs(): Promise<EditorTimeLog[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("editor_time_logs")
    .select("*, editor:profiles!editor_time_logs_editor_id_fkey(id,name,avatar_url,role)")
    .order("session_started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EditorTimeLog[];
}

export async function getAllActivityLogs(): Promise<ActivityLog[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("activity_logs")
    .select("id, ad_id, action, metadata, created_at, actor_id")
    .not("ad_id", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ActivityLog[];
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
