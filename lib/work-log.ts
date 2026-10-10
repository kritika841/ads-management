import { productionStages } from "@/lib/production-workflow";
import type { ActivityLog, EditorTimeLog, ProductionStage } from "@/lib/types";

/**
 * Work log: everything a person (creator, editor, manager, admin) did — and
 * everything that happened to their creatives — inside a day or date range.
 * Pure functions only, so the report can be unit-tested and reused anywhere.
 */

export const WORK_LOG_TIME_ZONE = "Asia/Kolkata";
export const WORK_LOG_MAX_DAYS = 92;
const DAY_MS = 24 * 60 * 60 * 1000;
// Fixed offset (IST has no DST) so day boundaries are identical on server and client.
const IST_OFFSET = "+05:30";

export type WorkLogAd = {
  id: string;
  name: string;
  creator_id: string | null;
  editor_id: string | null;
  production_stage: ProductionStage;
  created_at: string;
};

export type WorkLogPerson = { id: string; name: string; role: string };

export type WorkLogActionKind = "submission" | "resubmission" | "update" | "review" | "assignment" | "progress" | "other";

export type WorkLogEvent = {
  id: string;
  adId: string;
  adName: string;
  at: string;
  action: string;
  label: string;
  kind: WorkLogActionKind;
  stage: ProductionStage | null;
  actorId: string | null;
  actorName: string | null;
  /** "by_person": the person did it. "on_their_work": someone else moved a creative they own. */
  direction: "by_person" | "on_their_work";
  note: string | null;
};

export type WorkLogTimeSession = {
  id: string;
  adId: string;
  adName: string;
  startedAt: string;
  endedAt: string | null;
  seconds: number;
  pauseReason: string | null;
};

export type WorkLogAttendance = {
  checkInAt: string | null;
  checkOutAt: string | null;
};

export type WorkLogDay = {
  date: string;
  newSubmissions: number;
  resubmissions: number;
  revisionsRequested: number;
  approvals: number;
  statusChanges: number;
  totalEvents: number;
  creativesTouched: number;
  editingSeconds: number;
  timeSessions: WorkLogTimeSession[];
  attendance?: WorkLogAttendance | null;
};

export type WorkLogCreative = {
  adId: string;
  name: string;
  currentStage: ProductionStage;
  roles: Array<"creator" | "editor">;
  /** True when the person newly submitted this creative inside the range. */
  newInRange: boolean;
  editingSeconds: number;
  lastActivityAt: string;
  events: WorkLogEvent[];
};

export type WorkLogSummary = {
  newSubmissions: number;
  resubmissions: number;
  revisionsRequested: number;
  approvals: number;
  updates: number;
  reviewsDone: number;
  statusChanges: number;
  totalEvents: number;
  creativesTouched: number;
  editingSeconds: number;
  /** Count of recorded status transitions, by the stage the creative moved into. */
  stageCounts: Record<ProductionStage, number>;
  /** Where the creatives worked on in this range stand right now. */
  currentStageCounts: Record<ProductionStage, number>;
};

export type WorkLogReport = {
  personId: string;
  from: string;
  to: string;
  summary: WorkLogSummary;
  days: WorkLogDay[];
  creatives: WorkLogCreative[];
};

const submissionActions = new Set(["creator_item_created", "edited_video_submitted", "reviewer_uploaded_final_clip"]);
// Bookkeeping entries that say nothing about the work itself.
const ignoredActions = new Set(["timer_paused", "timer_resumed", "granted_access"]);

const actionInfo: Record<string, { label: string; kind: WorkLogActionKind }> = {
  creator_item_created: { label: "Submitted new creative", kind: "submission" },
  edited_video_submitted: { label: "Submitted edited video", kind: "submission" },
  reviewer_uploaded_final_clip: { label: "Uploaded final clip", kind: "submission" },
  edited_video_resubmitted: { label: "Resubmitted edited video", kind: "resubmission" },
  creator_routed_changes_to_review: { label: "Resubmitted creative for review", kind: "resubmission" },
  creator_routed_changes_to_editor: { label: "Resubmitted creative to editor", kind: "resubmission" },
  creator_item_updated: { label: "Updated creative", kind: "update" },
  admin_creative_override: { label: "Edited creative (override)", kind: "update" },
  editor_assigned: { label: "Editor assigned", kind: "assignment" },
  editor_reassigned: { label: "Editor reassigned", kind: "assignment" },
  editing_started: { label: "Started editing", kind: "progress" },
  editor_unfrozen_for_editing: { label: "Editing resumed", kind: "progress" },
  creator_approved_edit: { label: "Approved the edit", kind: "review" },
  creator_requested_changes: { label: "Requested changes from editor", kind: "review" },
  manager_approved: { label: "Manager approved", kind: "review" },
  final_approval_granted: { label: "Final approval granted", kind: "review" },
  final_changes_requested: { label: "Changes requested", kind: "review" },
  final_changes_requested_to_editor: { label: "Changes requested from editor", kind: "review" },
  final_changes_requested_to_creator: { label: "Changes requested from creator", kind: "review" },
  creator_changes_requested: { label: "Changes requested from creator", kind: "review" },
  approved_ad_reopened: { label: "Approved creative reopened", kind: "review" },
  editor_unassigned: { label: "Editor removed", kind: "assignment" },
  editing_frozen: { label: "Editing frozen", kind: "progress" },
  frozen: { label: "Editing frozen", kind: "progress" },
  editing_unfrozen: { label: "Editing unfrozen", kind: "progress" },
  bulk_tagged: { label: "Tagged creative", kind: "other" },
  bulk_imported: { label: "Imported creative", kind: "other" },
  commented: { label: "Commented", kind: "other" }
};

export type WorkLogCategory = "newly_submitted" | "resubmitted" | "revision_requested" | "approved" | "other";

export function categorizeWorkLogAction(action: string): WorkLogCategory {
  if (
    action === "creator_item_created" ||
    action === "edited_video_submitted" ||
    action === "reviewer_uploaded_final_clip" ||
    actionInfo[action]?.kind === "submission"
  ) {
    return "newly_submitted";
  }
  if (
    action === "edited_video_resubmitted" ||
    action === "creator_routed_changes_to_review" ||
    action === "creator_routed_changes_to_editor" ||
    actionInfo[action]?.kind === "resubmission"
  ) {
    return "resubmitted";
  }
  if (
    action === "final_changes_requested" ||
    action === "final_changes_requested_to_editor" ||
    action === "final_changes_requested_to_creator" ||
    action === "creator_changes_requested" ||
    action === "creator_requested_changes"
  ) {
    return "revision_requested";
  }
  if (
    action === "final_approval_granted" ||
    action === "manager_approved" ||
    action === "creator_approved_edit"
  ) {
    return "approved";
  }
  return "other";
}

export function describeWorkLogAction(action: string): { label: string; kind: WorkLogActionKind } {
  const known = actionInfo[action];
  if (known) return known;
  const humanised = action.replace(/_/g, " ").trim();
  return { label: humanised ? humanised.charAt(0).toUpperCase() + humanised.slice(1) : "Activity", kind: "other" };
}

/** `YYYY-MM-DD` of the given instant in the app's time zone (IST). */
export function workLogDayKey(value: string | number | Date): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: WORK_LOG_TIME_ZONE }).format(new Date(value));
}

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function isValidDay(value: string | null | undefined): value is string {
  return Boolean(value && dateRe.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

function shiftDay(day: string, delta: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

export function dayBoundsMs(day: string) {
  const start = Date.parse(`${day}T00:00:00${IST_OFFSET}`);
  return { start, end: start + DAY_MS };
}

export function enumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to && days.length <= WORK_LOG_MAX_DAYS; day = shiftDay(day, 1)) days.push(day);
  return days;
}

/** Validates user-supplied dates: defaults to today, swaps reversed ranges and caps the length. */
export function normalizeWorkLogRange(from: string | null | undefined, to: string | null | undefined, nowMs: number = Date.now()) {
  const today = workLogDayKey(nowMs);
  let start = isValidDay(from) ? from : isValidDay(to) ? to : today;
  let end = isValidDay(to) ? to : start;
  if (start > end) [start, end] = [end, start];
  const earliest = shiftDay(end, -(WORK_LOG_MAX_DAYS - 1));
  if (start < earliest) start = earliest;
  return { from: start, to: end };
}

export function workLogRangeBoundsMs(from: string, to: string) {
  return { start: dayBoundsMs(from).start, end: dayBoundsMs(to).end };
}

function emptyStageCounts(): Record<ProductionStage, number> {
  return Object.fromEntries(productionStages.map((stage) => [stage, 0])) as Record<ProductionStage, number>;
}

function stageFromMetadata(metadata: Record<string, unknown> | null | undefined): ProductionStage | null {
  const stage = metadata?.production_stage;
  return typeof stage === "string" && (productionStages as string[]).includes(stage) ? (stage as ProductionStage) : null;
}

function overlapSeconds(log: EditorTimeLog, windowStart: number, windowEnd: number, nowMs: number) {
  const start = Date.parse(log.session_started_at);
  const end = log.session_ended_at ? Date.parse(log.session_ended_at) : nowMs;
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  const clippedStart = Math.max(start, windowStart);
  const clippedEnd = Math.min(end, windowEnd);
  return clippedEnd > clippedStart ? Math.floor((clippedEnd - clippedStart) / 1000) : 0;
}

export function buildWorkLogReport({
  person,
  from,
  to,
  ads,
  logs,
  timeLogs,
  attendanceLogs = [],
  actorNames = {},
  nowMs = Date.now()
}: {
  person: WorkLogPerson;
  from: string;
  to: string;
  ads: WorkLogAd[];
  logs: ActivityLog[];
  timeLogs: EditorTimeLog[];
  attendanceLogs?: Array<{ user_id: string; date: string; check_in_at: string; check_out_at: string | null }>;
  actorNames?: Record<string, string>;
  nowMs?: number;
}): WorkLogReport {
  const { start, end } = workLogRangeBoundsMs(from, to);
  const adById = new Map(ads.map((ad) => [ad.id, ad]));
  const dayList = enumerateDays(from, to);
  const days = new Map<string, WorkLogDay>(
    dayList.map((date) => [
      date,
      {
        date,
        newSubmissions: 0,
        resubmissions: 0,
        revisionsRequested: 0,
        approvals: 0,
        statusChanges: 0,
        totalEvents: 0,
        creativesTouched: 0,
        editingSeconds: 0,
        timeSessions: [],
        attendance: null
      }
    ])
  );

  const dayLatestActivity = new Map<string, number>();

  if (person.role !== "admin" && attendanceLogs && attendanceLogs.length > 0) {
    for (const att of attendanceLogs) {
      if (att.user_id === person.id) {
        const targetDay = days.get(att.date);
        if (targetDay) {
          targetDay.attendance = {
            checkInAt: att.check_in_at,
            checkOutAt: att.check_out_at
          };
        }
      }
    }
  }

  const dayCreatives = new Map<string, Set<string>>(dayList.map((date) => [date, new Set<string>()]));
  const summary: WorkLogSummary = {
    newSubmissions: 0,
    resubmissions: 0,
    revisionsRequested: 0,
    approvals: 0,
    updates: 0,
    reviewsDone: 0,
    statusChanges: 0,
    totalEvents: 0,
    creativesTouched: 0,
    editingSeconds: 0,
    stageCounts: emptyStageCounts(),
    currentStageCounts: emptyStageCounts()
  };

  const byAd = new Map<string, WorkLogEvent[]>();
  const newlySubmitted = new Set<string>();

  for (const log of logs) {
    if (!log.ad_id || ignoredActions.has(log.action)) continue;
    const at = Date.parse(log.created_at);
    if (Number.isNaN(at) || at < start || at >= end) continue;
    const ad = adById.get(log.ad_id);
    if (!ad) continue;

    const info = describeWorkLogAction(log.action);
    const category = categorizeWorkLogAction(log.action);
    const stage = stageFromMetadata(log.metadata);
    const byPerson = log.actor_id === person.id;
    const ownsCreative = ad.creator_id === person.id || ad.editor_id === person.id;
    // A creative submitted on someone's behalf (an admin adding for a manager) still
    // counts as that person's submission.
    const onBehalfSubmission = !byPerson && log.action === "creator_item_created" && ad.creator_id === person.id;
    if (!byPerson && !onBehalfSubmission && !(ownsCreative && stage)) continue;

    const note = typeof log.metadata?.note === "string" && log.metadata.note.trim() ? log.metadata.note.trim() : null;
    const event: WorkLogEvent = {
      id: log.id,
      adId: ad.id,
      adName: ad.name,
      at: log.created_at,
      action: log.action,
      label: info.label,
      kind: info.kind,
      stage,
      actorId: log.actor_id,
      actorName: log.actor?.name ?? (log.actor_id ? actorNames[log.actor_id] ?? null : null),
      direction: byPerson ? "by_person" : "on_their_work",
      note
    };
    byAd.set(ad.id, [...(byAd.get(ad.id) ?? []), event]);

    const dayKey = workLogDayKey(at);
    const day = days.get(dayKey);
    dayCreatives.get(dayKey)?.add(ad.id);

    if (byPerson || onBehalfSubmission) {
      dayLatestActivity.set(dayKey, Math.max(dayLatestActivity.get(dayKey) ?? 0, at));
    }

    // Track exact count of recorded events for this person on this day
    summary.totalEvents += 1;
    if (day) day.totalEvents += 1;


    const isSubmission = submissionActions.has(log.action) && (byPerson || onBehalfSubmission);
    if (isSubmission) {
      summary.newSubmissions += 1;
      newlySubmitted.add(ad.id);
      if (day) day.newSubmissions += 1;
    }
    if ((category === "resubmitted" || info.kind === "resubmission") && byPerson) {
      summary.resubmissions += 1;
      if (day) day.resubmissions += 1;
    }
    if (category === "revision_requested") {
      summary.revisionsRequested += 1;
      if (day) day.revisionsRequested += 1;
    }
    if (category === "approved") {
      summary.approvals += 1;
      if (day) day.approvals += 1;
    }
    if (info.kind === "update" && byPerson) summary.updates += 1;
    if (info.kind === "review" && byPerson) summary.reviewsDone += 1;
    if (stage) {
      summary.statusChanges += 1;
      summary.stageCounts[stage] += 1;
      if (day) day.statusChanges += 1;
    }
  }

  // Editing time (editors): clipped to the range and split across days.
  const editingByAd = new Map<string, number>();
  for (const log of timeLogs) {
    if (log.editor_id !== person.id) continue;
    const total = overlapSeconds(log, start, end, nowMs);
    if (!total) continue;
    summary.editingSeconds += total;
    editingByAd.set(log.ad_id, (editingByAd.get(log.ad_id) ?? 0) + total);

    const sessionEnd = log.session_ended_at ? Date.parse(log.session_ended_at) : (log.is_active ? nowMs : Date.parse(log.session_started_at));
    if (!Number.isNaN(sessionEnd)) {
      const sessionDayKey = workLogDayKey(sessionEnd);
      dayLatestActivity.set(sessionDayKey, Math.max(dayLatestActivity.get(sessionDayKey) ?? 0, sessionEnd));
    }

    for (const date of dayList) {
      const bounds = dayBoundsMs(date);
      const seconds = overlapSeconds(log, bounds.start, bounds.end, nowMs);
      if (seconds) {
        const day = days.get(date);
        if (day) {
          day.editingSeconds += seconds;
          day.timeSessions.push({
            id: log.id,
            adId: log.ad_id,
            adName: adById.get(log.ad_id)?.name ?? "Creative",
            startedAt: log.session_started_at,
            endedAt: log.session_ended_at,
            seconds,
            pauseReason: log.pause_reason
          });
        }
        dayCreatives.get(date)?.add(log.ad_id);
      }
    }
  }

  const touched = new Set<string>([...byAd.keys(), ...editingByAd.keys()]);
  const creatives: WorkLogCreative[] = [];
  for (const adId of touched) {
    const ad = adById.get(adId);
    if (!ad) continue;
    const events = (byAd.get(adId) ?? []).sort((a, b) => a.at.localeCompare(b.at));
    const roles: WorkLogCreative["roles"] = [];
    if (ad.creator_id === person.id) roles.push("creator");
    if (ad.editor_id === person.id) roles.push("editor");
    summary.currentStageCounts[ad.production_stage] += 1;
    creatives.push({
      adId,
      name: ad.name,
      currentStage: ad.production_stage,
      roles,
      newInRange: newlySubmitted.has(adId),
      editingSeconds: editingByAd.get(adId) ?? 0,
      lastActivityAt: events.at(-1)?.at ?? ad.created_at,
      events
    });
  }
  creatives.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  summary.creativesTouched = creatives.length;

  for (const [date, ids] of dayCreatives) {
    const day = days.get(date);
    if (day) day.creativesTouched = ids.size;
  }

  // Reconcile checkout for non-admin users:
  // The last activity stored in AdFlow before 12 AM becomes the checkout
  if (person.role !== "admin") {
    for (const day of days.values()) {
      if (day.attendance?.checkInAt) {
        const checkInMs = Date.parse(day.attendance.checkInAt);
        const bounds = dayBoundsMs(day.date);
        const lastActMs = dayLatestActivity.get(day.date) ?? 0;
        const recordedCheckoutMs = day.attendance.checkOutAt ? Date.parse(day.attendance.checkOutAt) : 0;

        const candidateCheckout = Math.max(
          lastActMs >= checkInMs && lastActMs < bounds.end ? lastActMs : 0,
          recordedCheckoutMs >= checkInMs && recordedCheckoutMs < bounds.end ? recordedCheckoutMs : 0
        );

        if (candidateCheckout > 0) {
          if (candidateCheckout === recordedCheckoutMs && day.attendance.checkOutAt) {
            // Preserved
          } else {
            day.attendance.checkOutAt = new Date(candidateCheckout).toISOString();
          }
        }

      }
    }
  }

  return { personId: person.id, from, to, summary, days: [...days.values()], creatives };
}


export function formatWorkLogDuration(seconds: number) {
  if (!seconds) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return minutes ? `${minutes}m` : "<1m";
}
