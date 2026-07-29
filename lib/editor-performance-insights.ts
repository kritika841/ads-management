import type { ActivityLog, AdWithRelations, AppSettings } from "@/lib/types";

export type EditorSlaBreach = {
  assignmentToStart: number;
  editing: number;
  creatorReview: number;
  finalReview: number;
  total: number;
};

export type AdTimelineStep = {
  kind: "assigned" | "editing_started" | "changes_requested" | "resubmitted" | "creator_review_approved" | "approved";
  label: string;
  at: string;
};

export type AdStageDurations = {
  assignmentToStart: number | null;
  editing: number | null;
  creatorReview: number | null;
  finalReview: number | null;
};

export type EditorTrendPoint = {
  bucket: string;
  started: number;
  completed: number;
  backlogStarted: number;
  backlogCleared: number;
  submissions: number;
  revisions: number;
  revisionRate: number | null;
};

export type EditorPerformanceInsights = {
  trends: EditorTrendPoint[];
  adTimelines: Record<string, AdTimelineStep[]>;
  adStageDurations: Record<string, AdStageDurations>;
  editorSlaBreaches: Record<string, EditorSlaBreach>;
};

type TimelineKind = AdTimelineStep["kind"];

type AdMilestones = {
  assignedAt: number | null;
  editingStartedAt: number | null;
  submittedAt: number | null;
  creatorDecisionAt: number | null;
  creatorApprovedAt: number | null;
  finalDecisionAt: number | null;
  finalApprovedAt: number | null;
  changeRequestedAt: number | null;
};

type TimelineEvent = {
  kind: TimelineKind;
  at: number;
};

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

const LABELS: Record<TimelineKind, string> = {
  assigned: "Assigned",
  editing_started: "Editing started",
  changes_requested: "Changes requested",
  resubmitted: "Resubmitted",
  creator_review_approved: "Creator review approved",
  approved: "Approved"
};

const ASSIGNMENT_ACTIONS = new Set(["editor_assigned", "editor_reassigned", "assigned"]);
const EDITING_STARTED_ACTIONS = new Set(["editing_started"]);
const CHANGES_REQUESTED_ACTIONS = new Set(["creator_requested_changes", "final_changes_requested", "approved_ad_reopened", "changes_requested", "stage_changed_to_changes_requested"]);
const RESUBMITTED_ACTIONS = new Set(["edited_video_submitted", "edited_video_resubmitted"]);
const CREATOR_APPROVED_ACTIONS = new Set(["creator_approved_edit"]);
const FINAL_APPROVED_ACTIONS = new Set(["final_approval_granted", "approved"]);

export function buildEditorPerformanceInsights(params: {
  ads: AdWithRelations[];
  activityLogs: ActivityLog[];
  settings: AppSettings;
  now?: Date;
  startDate?: Date | null;
  endDate?: Date | null;
}): EditorPerformanceInsights {
  const nowMs = params.now?.getTime() ?? Date.now();
  const chartEndMs = params.endDate?.getTime() ?? nowMs;
  const chartStartMs = params.startDate?.getTime() ?? (chartEndMs - 11 * 7 * DAY_MS);

  const logsByAd = groupBy(params.activityLogs.filter((log) => Boolean(log.ad_id)), (log) => log.ad_id as string);
  const adTimelines: Record<string, AdTimelineStep[]> = {};
  const adStageDurations: Record<string, AdStageDurations> = {};
  const editorSlaBreaches: Record<string, EditorSlaBreach> = {};
  const trendBuckets = buildTrendBuckets(chartStartMs, chartEndMs);
  const trendMap = new Map(trendBuckets.map((bucket) => [bucket.bucket, bucket]));

  for (const ad of params.ads) {
    const timeline = buildAdTimeline(ad, logsByAd[ad.id] ?? [], nowMs);
    adTimelines[ad.id] = timeline.steps;
    adStageDurations[ad.id] = timeline.durations;

    if (ad.editor_id) {
      const editorBreach = editorSlaBreaches[ad.editor_id] ?? {
        assignmentToStart: 0,
        editing: 0,
        creatorReview: 0,
        finalReview: 0,
        total: 0
      };

      if (breached(timeline.durations.assignmentToStart, params.settings.assignment_start_sla_hours)) editorBreach.assignmentToStart += 1;
      if (breached(timeline.durations.editing, params.settings.editing_sla_hours)) editorBreach.editing += 1;
      if (breached(timeline.durations.creatorReview, params.settings.creator_review_sla_hours)) editorBreach.creatorReview += 1;
      if (breached(timeline.durations.finalReview, params.settings.final_review_sla_hours)) editorBreach.finalReview += 1;
      editorBreach.total = editorBreach.assignmentToStart + editorBreach.editing + editorBreach.creatorReview + editorBreach.finalReview;
      editorSlaBreaches[ad.editor_id] = editorBreach;
    }

    const assignedAt = timeline.milestones.assignedAt;
    const editingStartedAt = timeline.milestones.editingStartedAt;
    const submittedAt = timeline.milestones.submittedAt;
    const finalApprovedAt = timeline.milestones.finalApprovedAt;

    const startedBucket = editingStartedAt === null ? null : weekBucketKey(editingStartedAt);
    const completedBucket = finalApprovedAt === null ? null : weekBucketKey(finalApprovedAt);

    if (startedBucket && trendMap.has(startedBucket)) {
      const bucketStart = weekBucketStartMs(startedBucket);
      const point = trendMap.get(startedBucket)!;
      point.started += 1;
      if (assignedAt !== null && assignedAt < bucketStart) point.backlogStarted += 1;
    }

    if (completedBucket && trendMap.has(completedBucket)) {
      const bucketStart = weekBucketStartMs(completedBucket);
      const point = trendMap.get(completedBucket)!;
      point.completed += 1;
      if (assignedAt !== null && assignedAt < bucketStart) point.backlogCleared += 1;
    }

    if (submittedAt !== null) {
      const submissionBucket = weekBucketKey(submittedAt);
      if (trendMap.has(submissionBucket)) {
        trendMap.get(submissionBucket)!.submissions += 1;
      }
    }

    for (const changeAt of timeline.events.filter((event) => event.kind === "changes_requested").map((event) => event.at)) {
      const bucket = weekBucketKey(changeAt);
      if (trendMap.has(bucket)) {
        trendMap.get(bucket)!.revisions += 1;
      }
    }
  }

  for (const point of trendBuckets) {
    point.revisionRate = point.submissions > 0 ? Math.round((point.revisions / point.submissions) * 1000) / 10 : null;
  }

  return {
    trends: trendBuckets,
    adTimelines,
    adStageDurations,
    editorSlaBreaches
  };
}

function buildAdTimeline(ad: AdWithRelations, activityLogs: ActivityLog[], nowMs: number) {
  const events: TimelineEvent[] = [];
  const milestones: AdMilestones = {
    assignedAt: null,
    editingStartedAt: null,
    submittedAt: null,
    creatorDecisionAt: null,
    creatorApprovedAt: null,
    finalDecisionAt: null,
    finalApprovedAt: null,
    changeRequestedAt: null
  };

  const push = (kind: TimelineKind, at: number) => {
    if (!Number.isFinite(at)) return;
    events.push({ kind, at });
  };

  const orderedLogs = [...activityLogs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  for (const log of orderedLogs) {
    const at = new Date(log.created_at).getTime();
    const meta = log.metadata as Record<string, unknown> | null;
    const stage = typeof meta?.new_stage === "string" ? meta.new_stage : typeof meta?.production_stage === "string" ? meta.production_stage : null;

    if (ASSIGNMENT_ACTIONS.has(log.action) || stage === "ready_for_edit") {
      milestones.assignedAt ??= at;
      push("assigned", at);
      continue;
    }

    if (EDITING_STARTED_ACTIONS.has(log.action) || stage === "editing") {
      milestones.editingStartedAt ??= at;
      push("editing_started", at);
      continue;
    }

    if (log.action === "creator_requested_changes") {
      milestones.creatorDecisionAt ??= at;
      milestones.changeRequestedAt ??= at;
      push("changes_requested", at);
      continue;
    }

    if (log.action === "final_changes_requested" || log.action === "approved_ad_reopened" || stage === "changes_requested") {
      milestones.changeRequestedAt ??= at;
      push("changes_requested", at);
      continue;
    }

    if (RESUBMITTED_ACTIONS.has(log.action) || stage === "creator_review") {
      milestones.submittedAt ??= at;
      push("resubmitted", at);
      continue;
    }

    if (CREATOR_APPROVED_ACTIONS.has(log.action) || stage === "final_review") {
      milestones.creatorDecisionAt ??= at;
      milestones.creatorApprovedAt ??= at;
      push("creator_review_approved", at);
      continue;
    }

    if (log.action === "final_approval_granted" || log.action === "approved") {
      milestones.finalDecisionAt ??= at;
      milestones.finalApprovedAt ??= at;
      push("approved", at);
      continue;
    }

    if (log.action === "final_changes_requested") {
      milestones.finalDecisionAt ??= at;
      push("changes_requested", at);
    }
  }

  if (milestones.assignedAt === null) milestones.assignedAt = toMs(ad.assigned_at ?? ad.raw_footage_shared_at ?? ad.workflow_status_changed_at);
  if (milestones.editingStartedAt === null) milestones.editingStartedAt = toMs(ad.editing_started_at);
  if (milestones.submittedAt === null) milestones.submittedAt = toMs(ad.submitted_at);
  if (milestones.creatorDecisionAt === null) milestones.creatorDecisionAt = toMs(ad.creator_reviewed_at);
  if (milestones.creatorApprovedAt === null) milestones.creatorApprovedAt = milestones.creatorDecisionAt;
  if (milestones.finalDecisionAt === null) milestones.finalDecisionAt = milestones.finalApprovedAt;
  if (milestones.finalApprovedAt === null) milestones.finalApprovedAt = toMs(ad.final_approved_at ?? ad.approved_at);

  const timelineEvents = dedupeAndSort(events).map((event) => ({
    kind: event.kind,
    label: LABELS[event.kind],
    at: new Date(event.at).toISOString()
  }));

  const durations: AdStageDurations = {
   assignmentToStart: durationHours(milestones.assignedAt, milestones.editingStartedAt, nowMs),
    editing: durationHours(milestones.editingStartedAt, milestones.submittedAt, nowMs),
    creatorReview: durationHours(milestones.submittedAt, milestones.creatorDecisionAt, nowMs),
    finalReview: durationHours(milestones.creatorApprovedAt, milestones.finalDecisionAt, nowMs)
  };

  return { steps: timelineEvents, events, milestones, durations };
}

function buildTrendBuckets(startMs: number, endMs: number): EditorTrendPoint[] {
  const buckets: EditorTrendPoint[] = [];
  const cursor = new Date(weekBucketStartMs(weekBucketKey(startMs)));
  const endKey = weekBucketKey(endMs);

  while (weekBucketKey(cursor.getTime()) <= endKey) {
    buckets.push({
      bucket: weekBucketKey(cursor.getTime()),
      started: 0,
      completed: 0,
      backlogStarted: 0,
      backlogCleared: 0,
      submissions: 0,
      revisions: 0,
      revisionRate: null
    });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return buckets;
}

function weekBucketKey(value: number): string {
  const local = new Date(value + IST_OFFSET_MS);
  const offset = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - offset);
  return local.toISOString().slice(0, 10);
}

function weekBucketStartMs(bucketKey: string): number {
  return new Date(`${bucketKey}T00:00:00.000+05:30`).getTime();
}

function durationHours(startMs: number | null, endMs: number | null, nowMs: number): number | null {
  if (startMs === null) return null;
  const resolvedEnd = endMs ?? nowMs;
  const hours = (resolvedEnd - startMs) / 3_600_000;
  return Number.isFinite(hours) && hours >= 0 ? Math.round(hours * 10) / 10 : null;
}

function breached(value: number | null, threshold: number): boolean {
  return value !== null && value > threshold;
}

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function dedupeAndSort(events: TimelineEvent[]): TimelineEvent[] {
  const seen = new Set<string>();
  return events
    .sort((a, b) => a.at - b.at)
    .filter((event) => {
      const key = `${event.kind}:${event.at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const value = key(item);
    (groups[value] ??= []).push(item);
    return groups;
  }, {});
}