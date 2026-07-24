import type { ActivityLog, AdWithRelations, EditorTimeLog, Profile } from "@/lib/types";

export type EditorStat = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  assigned: number;               // currently active (ready_for_edit | editing | changes_requested)

  // Started — split into two buckets
  startedInPeriod: number;        // assigned within range AND editing started within range
  startedBacklog: number;         // assigned BEFORE range but editing started within range

  // Completed — split into two buckets
  completedInPeriod: number;      // assigned within range AND approved within range
  completedBacklog: number;       // assigned BEFORE range but approved within range

  /** Kept as convenience totals (sum of the two buckets above) */
  started: number;
  completed: number;

  totalSeconds: number;           // sum of all editor_time_log sessions within the date range
  avgTurnaroundHours: number | null; // average wall-clock hours from editing_started_at to final_approved_at
  avgRevisions: number;           // average number of change_requested cycles to get to approval
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
};

const activeStages = new Set(["ready_for_edit", "editing", "changes_requested"]);

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
  const hasPeriod = startMs > 0 || endMs < Infinity;

  // Pre-build per-editor, per-ad time totals — filtered by date range
  const editorAdSeconds: Record<string, Record<string, number>> = {};
  const editorTotalSeconds: Record<string, number> = {};

  for (const log of timeLogs) {
    const logStartMs = new Date(log.session_started_at).getTime();
    if (logStartMs < startMs || logStartMs > endMs) continue;

    const logEndMs = log.session_ended_at ? new Date(log.session_ended_at).getTime() : now;
    const seconds = Math.max(0, Math.floor((logEndMs - logStartMs) / 1000));

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

  return editors
    .filter((p) => p.role === "editor")
    .map((editor) => {
      const editorAds = ads.filter((ad) => ad.editor_id === editor.id);

      // Assigned = current snapshot — NOT date-filtered (it's a "right now" value)
      const assigned = editorAds.filter((ad) =>
        activeStages.has(ad.production_stage)
      ).length;

      // Helper: was this ad assigned to the editor within the date range?
      // "Assigned" timestamp = raw_footage_shared_at (handed to editor) or editing_started_at fallback
      function assignedInPeriod(ad: AdWithRelations): boolean {
        const assignedAt =
          ad.raw_footage_shared_at
            ? new Date(ad.raw_footage_shared_at).getTime()
            : ad.editing_started_at
            ? new Date(ad.editing_started_at).getTime()
            : null;
        if (assignedAt === null) return false;
        return assignedAt >= startMs && assignedAt <= endMs;
      }

      // ─── STARTED split ───────────────────────────────────────────────
      // A video counts as "started" if editing_started_at is within the range
      const startedAds = editorAds.filter((ad) => {
        if (!ad.editing_started_at) return false;
        const ms = new Date(ad.editing_started_at).getTime();
        return ms >= startMs && ms <= endMs;
      });
      const startedInPeriod = startedAds.filter((ad) => assignedInPeriod(ad)).length;
      const startedBacklog  = startedAds.filter((ad) => !assignedInPeriod(ad)).length;
      const started = startedAds.length;

      // ─── COMPLETED split ─────────────────────────────────────────────
      // A video counts as "completed" if final_approved_at is within the range
      const completedAds = editorAds.filter((ad) => {
        const approvedAt = ad.final_approved_at ?? ad.approved_at;
        if (!approvedAt) return false;
        const ms = new Date(approvedAt).getTime();
        return ms >= startMs && ms <= endMs;
      });
      const completedInPeriod = completedAds.filter((ad) => {
        if (!hasPeriod) return true;
        return assignedInPeriod(ad);
      }).length;
      const completedBacklog  = completedAds.filter((ad) => {
        if (!hasPeriod) return false;
        return !assignedInPeriod(ad);
      }).length;
      const completed = completedAds.length;

      const totalSeconds = editorTotalSeconds[editor.id] ?? 0;
      const adSecondsMap = editorAdSeconds[editor.id] ?? {};

      // ─── AVG TURNAROUND ──────────────────────────────────────────────
      // Wall-clock hours from editing_started_at to final_approved_at for completed ads
      const turnaroundHoursList: number[] = completedAds.flatMap((ad) => {
        const approvedAt = ad.final_approved_at ?? ad.approved_at;
        const editStart  = ad.editing_started_at;
        if (!approvedAt || !editStart) return [];
        const hours = (new Date(approvedAt).getTime() - new Date(editStart).getTime()) / 3_600_000;
        return hours >= 0 ? [hours] : [];
      });
      const avgTurnaroundHours =
        turnaroundHoursList.length > 0
          ? turnaroundHoursList.reduce((s, v) => s + v, 0) / turnaroundHoursList.length
          : null;

      // ─── AVG REVISIONS ───────────────────────────────────────────────
      // Use activity log counts; fall back to (version_count - 1) when logs are absent
      const totalRevisions = completedAds.reduce((sum, ad) => {
        // Prefer the activity-log count; if zero, try version_count as a fallback
        const fromLogs = adRevisionCount[ad.id] ?? 0;
        const fromVersions = Math.max(0, (ad.version_count ?? 1) - 1);
        return sum + Math.max(fromLogs, fromVersions);
      }, 0);
      const avgRevisions =
        completed > 0 ? Math.round((totalRevisions / completed) * 10) / 10 : 0;

      // Show all ads that have time logs in range OR are currently active
      const adsWithLogs: AdTimeSummary[] = editorAds
        .filter((ad) => adSecondsMap[ad.id] !== undefined || activeStages.has(ad.production_stage))
        .map((ad) => {
          const fromLogs = adRevisionCount[ad.id] ?? 0;
          const fromVersions = Math.max(0, (ad.version_count ?? 1) - 1);
          return {
            adId: ad.id,
            adName: ad.name,
            stage: ad.production_stage,
            status: ad.status,
            totalSeconds: adSecondsMap[ad.id] ?? 0,
            revisions: Math.max(fromLogs, fromVersions),
            isActive: activeStages.has(ad.production_stage),
            startedAt: ad.editing_started_at,
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
        started,
        completed,
        totalSeconds,
        avgTurnaroundHours,
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
