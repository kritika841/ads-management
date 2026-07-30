import type { ActivityLog, AdWithRelations, EditorTimeLog, Profile } from "@/lib/types";

type TimelineStage = "ready_for_edit" | "editing" | "creator_review" | "approved";
type AdTimeline = {
  readyForEdit: number[];
  editing: number[];
  creatorReview: number[];
  approved: number[];
};

export type EditorStat = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  assigned: number;               // videos assigned to this editor within the selected period

  startedInPeriod: number;        // editing started within the selected period
  startedBacklog: number;         // kept for compatibility; no longer displayed

  completedInPeriod: number;      // approved within the selected period
  completedBacklog: number;       // kept for compatibility; no longer displayed

  submittedInPeriod: number;      // sent to creator_review within the selected period, ad also assigned in period
  submittedBacklog: number;       // sent to creator_review within the selected period, but ad was assigned before the period

  started: number;
  completed: number;
  submitted: number;              // total lifetime videos submitted for review

  totalSeconds: number;           // sum of all editor_time_log sessions within the date range
  totalRevisions: number;         // total number of change_requested cycles for completed videos
  avgRevisions: number | null;    // average revisions per completed video
  idle: boolean;                  // no active assignments right now
  adsWithLogs: AdTimeSummary[];
};

export type AdTimeSummary = {
  adId: string;
  adName: string;
  stage: string;
  status: string;
  totalSeconds: number;
  revisions: number;   // number of times this ad went to changes_requested
  isActive: boolean;
  startedAt: string | null;
  periodState: "completed_in_period" | "started_in_period" | "backlog" | "other";
  productName: string | null;
};

const activeStages = new Set(["ready_for_edit", "editing", "changes_requested"]);
const assignmentActions = new Set(["editor_assigned", "editor_reassigned", "assign_editor", "reassign_editor", "assigned"]);

function assignedAtMs(ad: AdWithRelations): number | null {
  const value = ad.assigned_at ?? ad.raw_footage_shared_at ?? ad.editing_started_at ?? null;
  return value ? new Date(value).getTime() : null;
}

function timelineStageFromLog(log: ActivityLog): TimelineStage | null {
  const meta = log.metadata as Record<string, unknown> | null;
  const stage =
    (typeof meta?.new_stage === "string" ? meta.new_stage : null) ??
    (typeof meta?.production_stage === "string" ? meta.production_stage : null);

  if (stage === "ready_for_edit" || stage === "editing" || stage === "creator_review" || stage === "approved") {
    return stage;
  }

  if (log.action === "editor_assigned" || log.action === "editor_reassigned" || log.action === "assigned") {
    return "ready_for_edit";
  }
  if (log.action === "editing_started") {
    return "editing";
  }
  if (log.action === "edited_video_submitted" || log.action === "edited_video_resubmitted") {
    return "creator_review";
  }
  if (log.action === "final_approval_granted" || log.action === "approved") {
    return "approved";
  }

  return null;
}

function buildTimelines(activityLogs: ActivityLog[]): Record<string, AdTimeline> {
  const timelines: Record<string, AdTimeline> = {};

  for (const log of activityLogs) {
    if (!log.ad_id) continue;
    const stage = timelineStageFromLog(log);
    if (!stage) continue;

    const at = new Date(log.created_at).getTime();
    if (!Number.isFinite(at)) continue;

    if (!timelines[log.ad_id]) {
      timelines[log.ad_id] = { readyForEdit: [], editing: [], creatorReview: [], approved: [] };
    }

    if (stage === "ready_for_edit") timelines[log.ad_id].readyForEdit.push(at);
    if (stage === "editing") timelines[log.ad_id].editing.push(at);
    if (stage === "creator_review") timelines[log.ad_id].creatorReview.push(at);
    if (stage === "approved") timelines[log.ad_id].approved.push(at);
  }

  for (const timeline of Object.values(timelines)) {
    timeline.readyForEdit.sort((a, b) => a - b);
    timeline.editing.sort((a, b) => a - b);
    timeline.creatorReview.sort((a, b) => a - b);
    timeline.approved.sort((a, b) => a - b);
  }

  return timelines;
}

function latestAtOrBefore(values: number[], beforeMs: number): number | null {
  for (let index = values.length - 1; index >= 0; index--) {
    if (values[index] <= beforeMs) return values[index];
  }
  return null;
}

function stageAtOrFallback(ad: AdWithRelations, timelines: Record<string, AdTimeline>, adId: string, stage: TimelineStage): number | null {
  const timeline = timelines[adId];
  if (timeline) {
    const fromTimeline =
      stage === "ready_for_edit"
        ? latestAtOrBefore(timeline.readyForEdit, Infinity)
        : stage === "editing"
          ? latestAtOrBefore(timeline.editing, Infinity)
          : stage === "creator_review"
            ? latestAtOrBefore(timeline.creatorReview, Infinity)
            : latestAtOrBefore(timeline.approved, Infinity);
    if (fromTimeline !== null) return fromTimeline;
  }

  if (stage === "ready_for_edit") return assignedAtMs(ad);
  if (stage === "editing") return ad.editing_started_at ? new Date(ad.editing_started_at).getTime() : null;
  if (stage === "creator_review") return ad.submitted_at ? new Date(ad.submitted_at).getTime() : null;
  const approvedAt = ad.final_approved_at ?? ad.approved_at;
  return approvedAt ? new Date(approvedAt).getTime() : null;
}

/** Parse a Date as local midnight (YYYY-MM-DD -> 00:00:00 local). */
function localMidnightMs(d: Date): number {
  const iso = d.toISOString().slice(0, 10); // "YYYY-MM-DD"
  return new Date(`${iso}T00:00:00`).getTime();
}

/** Parse a Date as local end-of-day (YYYY-MM-DD -> 23:59:59.999 local). */
function localEndOfDayMs(d: Date): number {
  const iso = d.toISOString().slice(0, 10);
  return new Date(`${iso}T23:59:59.999`).getTime();
}

export function computeEditorStats(
  editors: Profile[],
  ads: AdWithRelations[],
  timeLogs: EditorTimeLog[],
  activityLogs: ActivityLog[],
  startDate?: Date | null,
  endDate?: Date | null
): EditorStat[] {
  const now = Date.now();
  // Use local midnight/end-of-day so that picking "today" in IST doesn't shift to UTC and miss sessions
  const startMs = startDate ? localMidnightMs(startDate) : 0;
  const endMs   = endDate   ? localEndOfDayMs(endDate)   : Infinity;
  // Pre-build per-editor, per-ad time totals
  const editorAdSeconds: Record<string, Record<string, number>> = {};
  const editorTotalSeconds: Record<string, number> = {};
  const editorAdLifetimeSeconds: Record<string, Record<string, number>> = {};

  for (const log of timeLogs) {
    const logStartMs = new Date(log.session_started_at).getTime();
    const logEndMs = log.session_ended_at ? new Date(log.session_ended_at).getTime() : now;
    const seconds = Math.max(0, Math.floor((logEndMs - logStartMs) / 1000));

    if (!editorAdLifetimeSeconds[log.editor_id]) editorAdLifetimeSeconds[log.editor_id] = {};
    editorAdLifetimeSeconds[log.editor_id][log.ad_id] =
      (editorAdLifetimeSeconds[log.editor_id][log.ad_id] ?? 0) + seconds;

    if (logStartMs < startMs || logStartMs > endMs) continue;

    if (!editorAdSeconds[log.editor_id]) editorAdSeconds[log.editor_id] = {};
    editorAdSeconds[log.editor_id][log.ad_id] =
      (editorAdSeconds[log.editor_id][log.ad_id] ?? 0) + seconds;

    editorTotalSeconds[log.editor_id] =
      (editorTotalSeconds[log.editor_id] ?? 0) + seconds;
  }

  // Count revision rounds per ad: activity_logs where stage transitioned to "changes_requested"
  // Handles both metadata shapes: { new_stage } and { production_stage }
  const adRevisionCount: Record<string, number> = {};
  for (const log of activityLogs) {
    if (!log.ad_id) continue;
    const meta = log.metadata as Record<string, unknown>;
    const isRevision =
      meta?.new_stage === "changes_requested" ||
      meta?.production_stage === "changes_requested" ||
      log.action === "changes_requested" ||
      log.action === "stage_changed_to_changes_requested";
    if (isRevision) {
      adRevisionCount[log.ad_id] = (adRevisionCount[log.ad_id] ?? 0) + 1;
    }
  }

  const timelines = buildTimelines(activityLogs);
  const adById = Object.fromEntries(ads.map((ad) => [ad.id, ad]));

  const adsAssignedInPeriod: Record<string, Set<string>> = {};
  for (const log of activityLogs) {
    if (!log.ad_id) continue;
    const stage = timelineStageFromLog(log);
    const meta = log.metadata as Record<string, unknown> | null;
    const targetEditorId = typeof meta?.editor_id === "string"
      ? meta.editor_id
      : typeof meta?.editorId === "string"
        ? meta.editorId
        : null;
    if (!targetEditorId) continue;
    if (!assignmentActions.has(log.action) && stage !== "ready_for_edit") continue;

    const at = new Date(log.created_at).getTime();
    if (!Number.isFinite(at)) continue;
    if (at < startMs || at > endMs) continue;

    (adsAssignedInPeriod[targetEditorId] ??= new Set()).add(log.ad_id);
  }

  return editors
    .filter((p) => p.role === "editor")
    .map((editor) => {
      const editorAds = ads.filter((ad) => ad.editor_id === editor.id);

    const assignedAdIdsThisPeriod = adsAssignedInPeriod[editor.id] ?? new Set<string>();
      const assigned = assignedAdIdsThisPeriod.size;
      // ─── STARTED ─────────────────────────────────────────────────────
      const startedAds = editorAds.flatMap((ad) => {
        const startedAt = stageAtOrFallback(ad, timelines, ad.id, "editing");
        if (startedAt === null) return [];
        return [{ ad, startedAt }];
      });
      const started = startedAds.length;
      const startedInPeriod = startedAds.filter(
        ({ ad, startedAt }) =>
          startedAt >= startMs && startedAt <= endMs && assignedAdIdsThisPeriod.has(ad.id)
      ).length;
      const startedBacklog = Math.max(0, started - startedInPeriod);
// ─── COMPLETED ───────────────────────────────────────────────────
      const completedAds = editorAds.flatMap((ad) => {
        if (ad.production_stage !== "approved" || ad.status !== "approved") return [];
        const completedAt = stageAtOrFallback(ad, timelines, ad.id, "approved");
        if (completedAt === null) return [];
        return [{ ad, completedAt }];
      });
     const completed = completedAds.length;
      const completedInPeriodAds = completedAds.filter(
        ({ ad, completedAt }) =>
          completedAt >= startMs && completedAt <= endMs && assignedAdIdsThisPeriod.has(ad.id)
      );
      const completedInPeriod = completedInPeriodAds.length;
      const completedBacklog = Math.max(0, completed - completedInPeriod);

     // ─── SUBMITTED FOR REVIEW ──────────────────────────────────────────
      const submittedAds = editorAds.flatMap((ad) => {
        const submittedAt = stageAtOrFallback(ad, timelines, ad.id, "creator_review");
        if (submittedAt === null) return [];
        return [{ ad, submittedAt }];
      });
      const submitted = submittedAds.length;
      const submittedInPeriodAds = submittedAds.filter(
        ({ ad, submittedAt }) =>
          submittedAt >= startMs && submittedAt <= endMs && assignedAdIdsThisPeriod.has(ad.id)
      );
      const submittedInPeriod = submittedInPeriodAds.length;
      const submittedInWindowRegardlessOfAssignment = submittedAds.filter(
        ({ submittedAt }) => submittedAt >= startMs && submittedAt <= endMs
      ).length;
      const submittedBacklog = Math.max(0, submittedInWindowRegardlessOfAssignment - submittedInPeriod);
      const totalSeconds = editorTotalSeconds[editor.id] ?? 0;
      const adSecondsMap = editorAdSeconds[editor.id] ?? {};

const revisionScope = completedAds;
      const totalRevisions = revisionScope.reduce((sum, ad) => {
        const fromLogs = adRevisionCount[ad.ad.id] ?? 0;
        const fromVersions = Math.max(0, (ad.ad.version_count ?? 1) - 1);
        return sum + Math.max(fromLogs, fromVersions);
      }, 0);
      const avgRevisions = revisionScope.length > 0 ? totalRevisions / revisionScope.length : null;
      // Show all ads that have time logs in range OR are currently active
      const adsWithLogs: AdTimeSummary[] = editorAds
        .filter((ad) => adSecondsMap[ad.id] !== undefined || activeStages.has(ad.production_stage))
        .map((ad) => {
          const fromLogs = adRevisionCount[ad.id] ?? 0;
          const fromVersions = Math.max(0, (ad.version_count ?? 1) - 1);
          const startedAt =
            stageAtOrFallback(ad, timelines, ad.id, "editing") ??
            stageAtOrFallback(ad, timelines, ad.id, "ready_for_edit");
          const completedAt = stageAtOrFallback(ad, timelines, ad.id, "approved");
const isStartedInPeriod = startedAt !== null && startedAt >= startMs && startedAt <= endMs && assignedAdIdsThisPeriod.has(ad.id);
          const isCompletedInPeriod = completedAt !== null && completedAt >= startMs && completedAt <= endMs && assignedAdIdsThisPeriod.has(ad.id);
          const periodState: AdTimeSummary["periodState"] = isCompletedInPeriod
            ? "completed_in_period"
            : isStartedInPeriod
              ? "started_in_period"
              : "backlog";
          return {
            adId: ad.id,
            adName: ad.name,
            stage: ad.production_stage,
            status: ad.status,
            totalSeconds: adSecondsMap[ad.id] ?? 0,
            revisions: Math.max(fromLogs, fromVersions),
            isActive: activeStages.has(ad.production_stage),
            startedAt: startedAt !== null ? new Date(startedAt).toISOString() : null,
            periodState,
            productName: ad.product?.name ?? null,
          };
        })
        .sort((a, b) => {
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
          return b.totalSeconds - a.totalSeconds;
        });

      return {
        id: editor.id,
        name: editor.name,
        email: editor.email,
        avatarUrl: editor.avatar_url,
        assigned,
        startedInPeriod,
        startedBacklog,
        completedInPeriod,
        completedBacklog,
        submittedInPeriod,
        submittedBacklog,
        started,
        completed,
        submitted,
        totalSeconds,
        totalRevisions,
        avgRevisions,
        idle: assigned === 0,
        adsWithLogs,
      };
    });
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  if (remainingMins === 0) return `${hours}h`;
  return `${hours}h ${remainingMins}m`;
}

/** Format a duration in hours (e.g. 1.5 → "1h 30m", 0.5 → "30m") */
export function formatHours(hours: number): string {
  if (hours < 1 / 60) return "< 1m";
  const totalMins = Math.round(hours * 60);
  if (totalMins < 60) return `${totalMins}m`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
