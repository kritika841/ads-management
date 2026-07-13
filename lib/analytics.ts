import type { ActivityLog, AdWithRelations, AppSettings, ProductionStage, Profile, ReviewAction } from "@/lib/types";

export type AnalyticsRangePreset = "7d" | "30d" | "90d" | "this_month" | "last_month" | "custom";
export type AnalyticsTab = "overview" | "team" | "products";

export type AnalyticsFilterInput = {
  range?: string;
  from?: string;
  to?: string;
  product?: string;
  campaign?: string;
  creator?: string;
  editor?: string;
  tab?: string;
};

export type ResolvedAnalyticsFilters = {
  range: AnalyticsRangePreset;
  from: string;
  to: string;
  fromMs: number;
  toMs: number;
  previousFromMs: number;
  previousToMs: number;
  productId: string | null;
  campaignId: string | null;
  creatorId: string | null;
  editorId: string | null;
  tab: AnalyticsTab;
};

export type AnalyticsSlaTargets = {
  ready_for_edit: number;
  editing: number;
  creator_review: number;
  final_review: number;
  changes_requested: number;
};

export type AnalyticsMetric = {
  value: number | null;
  sample: number;
  delta: number | null;
};

export type AnalyticsDashboardModel = {
  filters: ResolvedAnalyticsFilters;
  slaTargets: AnalyticsSlaTargets;
  kpis: {
    approved: AnalyticsMetric;
    cycleHours: AnalyticsMetric;
    slaCompliance: AnalyticsMetric;
    firstPassRate: AnalyticsMetric;
    workInProgress: AnalyticsMetric;
    reworkRate: AnalyticsMetric;
  };
  flow: { bucket: string; created: number; handedOff: number; submitted: number; approved: number }[];
  stageTurnaround: { stage: TargetStage; label: string; medianHours: number | null; p75Hours: number | null; sample: number; compliance: number | null }[];
  liveWip: { stage: ProductionStage; label: string; count: number; medianAgeHours: number | null; breached: number; targetHours: number | null }[];
  deadlineHealth: { dueToday: number; dueSoon: number; overdue: number; approvedOnTimeRate: number | null; approvedOnTimeSample: number };
  bottlenecks: { id: string; name: string; product: string; campaign: string; owner: string; stage: ProductionStage; stageLabel: string; ageHours: number; targetHours: number | null; deadline: string | null; severity: "healthy" | "at_risk" | "breached" }[];
  editors: { id: string; name: string; avatarUrl: string | null; activeAssignments: number; inProgress: number; capacity: number; completed: number; medianEditHours: number | null; firstPassRate: number | null; avgRevisions: number | null; slaBreaches: number }[];
  creators: { id: string; name: string; avatarUrl: string | null; preparing: number; withEditor: number; needsReview: number; completedShoots: number; medianReviewHours: number | null; reworkRate: number | null }[];
  products: AggregateRow[];
  campaigns: AggregateRow[];
};

type AggregateRow = { id: string; name: string; started: number; wip: number; approved: number; approvalRate: number | null; medianCycleHours: number | null; firstPassRate: number | null; avgRevisions: number | null };
type TargetStage = "ready_for_edit" | "editing" | "creator_review" | "final_review" | "changes_requested";
type Period = { fromMs: number; toMs: number };
type StageEvent = { stage: ProductionStage; at: number };
type StageInterval = { adId: string; stage: ProductionStage; startedAt: number; endedAt: number; hours: number };

const IST_OFFSET_MS = 330 * 60_000;
const targetStages: TargetStage[] = ["ready_for_edit", "editing", "creator_review", "final_review", "changes_requested"];
const stageLabels: Record<ProductionStage, string> = {
  script_writing: "Script in progress",
  ready_to_shoot: "Ready to shoot",
  shoot_complete: "Shoot complete",
  ready_for_edit: "Waiting to start",
  editing: "Editing",
  creator_review: "Creator review",
  final_review: "Final review",
  changes_requested: "Requested revisions",
  approved: "Approved"
};

export function resolveAnalyticsFilters(input: AnalyticsFilterInput, now = new Date()): ResolvedAnalyticsFilters {
  const allowedRanges: AnalyticsRangePreset[] = ["7d", "30d", "90d", "this_month", "last_month", "custom"];
  const range = allowedRanges.includes(input.range as AnalyticsRangePreset) ? input.range as AnalyticsRangePreset : "30d";
  const today = formatIstDate(now.getTime());
  let from = shiftIstDate(today, -29);
  let to = today;

  if (range === "7d") from = shiftIstDate(today, -6);
  if (range === "90d") from = shiftIstDate(today, -89);
  if (range === "this_month") from = `${today.slice(0, 8)}01`;
  if (range === "last_month") {
    to = shiftIstDate(`${today.slice(0, 8)}01`, -1);
    from = `${to.slice(0, 8)}01`;
  }
  if (range === "custom" && isDateInput(input.from) && isDateInput(input.to) && input.from! <= input.to!) {
    from = input.from!;
    to = input.to!;
  }

  const fromMs = startOfIstDate(from);
  const toMs = endOfIstDate(to);
  const duration = toMs - fromMs + 1;
  const tabs: AnalyticsTab[] = ["overview", "team", "products"];
  return {
    range,
    from,
    to,
    fromMs,
    toMs,
    previousFromMs: fromMs - duration,
    previousToMs: fromMs - 1,
    productId: input.product || null,
    campaignId: input.campaign || null,
    creatorId: input.creator || null,
    editorId: input.editor || null,
    tab: tabs.includes(input.tab as AnalyticsTab) ? input.tab as AnalyticsTab : "overview"
  };
}

export function slaTargetsFromSettings(settings: AppSettings): AnalyticsSlaTargets {
  return {
    ready_for_edit: settings.assignment_start_sla_hours,
    editing: settings.editing_sla_hours,
    creator_review: settings.creator_review_sla_hours,
    final_review: settings.final_review_sla_hours,
    changes_requested: settings.revision_sla_hours
  };
}

export function buildOperationalAnalytics(params: {
  ads: AdWithRelations[];
  profiles: Profile[];
  activities: ActivityLog[];
  reviews: ReviewAction[];
  settings: AppSettings;
  filters: ResolvedAnalyticsFilters;
  now?: Date;
}): AnalyticsDashboardModel {
  const { profiles, settings, filters } = params;
  const nowMs = params.now?.getTime() ?? Date.now();
  const ads = params.ads.filter((ad) => matchesDimensions(ad, filters));
  const adIds = new Set(ads.map((ad) => ad.id));
  const activities = params.activities.filter((item) => item.ad_id && adIds.has(item.ad_id));
  const reviews = params.reviews.filter((item) => adIds.has(item.ad_id));
  const activitiesByAd = groupBy(activities, (item) => item.ad_id!);
  const reviewsByAd = groupBy(reviews, (item) => item.ad_id);
  const eventsByAd = new Map(ads.map((ad) => [ad.id, stageEvents(ad, activitiesByAd[ad.id] ?? [])]));
  const intervals = ads.flatMap((ad) => stageIntervals(ad.id, eventsByAd.get(ad.id) ?? []));
  const slaTargets = slaTargetsFromSettings(settings);
  const current: Period = { fromMs: filters.fromMs, toMs: filters.toMs };
  const previous: Period = { fromMs: filters.previousFromMs, toMs: filters.previousToMs };

  const approvedCurrent = approvedIn(ads, current);
  const approvedPrevious = approvedIn(ads, previous);
  const currentCycles = cycleHours(approvedCurrent);
  const previousCycles = cycleHours(approvedPrevious);
  const currentSla = slaCompliance(intervals, current, slaTargets);
  const previousSla = slaCompliance(intervals, previous, slaTargets);
  const currentFirstPass = firstPass(approvedCurrent, reviewsByAd);
  const previousFirstPass = firstPass(approvedPrevious, reviewsByAd);
  const currentRework = reworkRate(ads, eventsByAd, reviewsByAd, current);
  const previousRework = reworkRate(ads, eventsByAd, reviewsByAd, previous);
  const currentWip = ads.filter((ad) => ad.production_stage !== "approved").length;
  const previousWip = ads.filter((ad) => stageAt(eventsByAd.get(ad.id) ?? [], previous.toMs) !== "approved" && new Date(ad.created_at).getTime() <= previous.toMs).length;

  return {
    filters,
    slaTargets,
    kpis: {
      approved: metric(approvedCurrent.length, approvedCurrent.length, approvedCurrent.length - approvedPrevious.length),
      cycleHours: metric(median(currentCycles), currentCycles.length, difference(median(currentCycles), median(previousCycles))),
      slaCompliance: metric(currentSla.rate, currentSla.sample, difference(currentSla.rate, previousSla.rate)),
      firstPassRate: metric(currentFirstPass.rate, currentFirstPass.sample, difference(currentFirstPass.rate, previousFirstPass.rate)),
      workInProgress: metric(currentWip, currentWip, currentWip - previousWip),
      reworkRate: metric(currentRework.rate, currentRework.sample, difference(currentRework.rate, previousRework.rate))
    },
    flow: flowTrend(ads, eventsByAd, current),
    stageTurnaround: targetStages.map((stage) => {
      const samples = intervals.filter((item) => item.stage === stage && inPeriod(item.endedAt, current)).map((item) => item.hours);
      return { stage, label: stageLabels[stage], medianHours: median(samples), p75Hours: percentile(samples, 0.75), sample: samples.length, compliance: rate(samples.filter((hours) => hours <= slaTargets[stage]).length, samples.length) };
    }),
    liveWip: liveWip(ads, nowMs, slaTargets),
    deadlineHealth: deadlineHealth(ads, approvedCurrent, nowMs),
    bottlenecks: bottlenecks(ads, nowMs, slaTargets),
    editors: editorRows(profiles, ads, intervals, approvedCurrent, reviewsByAd, current, settings.max_concurrent_edits, slaTargets),
    creators: creatorRows(profiles, ads, intervals, reviewsByAd, current),
    products: aggregateRows(ads, approvedCurrent, reviewsByAd, current, "product"),
    campaigns: aggregateRows(ads, approvedCurrent, reviewsByAd, current, "campaign")
  };
}

function stageEvents(ad: AdWithRelations, activity: ActivityLog[]) {
  const events: StageEvent[] = activity.flatMap((item) => {
    const stage = item.metadata?.new_stage ?? item.metadata?.production_stage;
    return isProductionStage(stage) ? [{ stage, at: new Date(item.created_at).getTime() }] : [];
  });
  const seen = new Set(events.map((event) => event.stage));
  const fallback: [ProductionStage, string | null][] = [
    ["script_writing", ad.created_at],
    ["ready_to_shoot", ad.script_ready_at],
    ["shoot_complete", ad.shoot_completed_at],
    ["ready_for_edit", ad.raw_footage_shared_at],
    ["editing", ad.editing_started_at],
    ["creator_review", ad.submitted_at],
    ["final_review", ad.creator_reviewed_at],
    ["approved", ad.final_approved_at ?? ad.approved_at]
  ];
  for (const [stage, value] of fallback) {
    if (value && !seen.has(stage)) events.push({ stage, at: new Date(value).getTime() });
  }
  if (!events.some((event) => event.stage === ad.production_stage)) {
    events.push({ stage: ad.production_stage, at: new Date(ad.workflow_status_changed_at).getTime() });
  }
  return events.sort((a, b) => a.at - b.at).reduce<StageEvent[]>((result, event) => {
    const last = result[result.length - 1];
    if (!Number.isFinite(event.at) || (last && last.stage === event.stage)) return result;
    result.push(event);
    return result;
  }, []);
}

function stageIntervals(adId: string, events: StageEvent[]): StageInterval[] {
  return events.slice(0, -1).flatMap((event, index) => {
    const endedAt = events[index + 1].at;
    const hours = (endedAt - event.at) / 3_600_000;
    return hours >= 0 ? [{ adId, stage: event.stage, startedAt: event.at, endedAt, hours }] : [];
  });
}

function flowTrend(ads: AdWithRelations[], eventsByAd: Map<string, StageEvent[]>, period: Period) {
  const weekly = (period.toMs - period.fromMs) / 86_400_000 > 45;
  const buckets = new Map<string, { bucket: string; created: number; handedOff: number; submitted: number; approved: number }>();
  let cursor = period.fromMs;
  while (cursor <= period.toMs) {
    const key = weekly ? weekBucket(cursor) : formatIstDate(cursor);
    if (!buckets.has(key)) buckets.set(key, { bucket: key, created: 0, handedOff: 0, submitted: 0, approved: 0 });
    cursor += (weekly ? 7 : 1) * 86_400_000;
  }
  const add = (timestamp: number | null, field: "created" | "handedOff" | "submitted" | "approved") => {
    if (timestamp === null || !inPeriod(timestamp, period)) return;
    const key = weekly ? weekBucket(timestamp) : formatIstDate(timestamp);
    const bucket = buckets.get(key) ?? { bucket: key, created: 0, handedOff: 0, submitted: 0, approved: 0 };
    bucket[field] += 1;
    buckets.set(key, bucket);
  };
  for (const ad of ads) {
    const events = eventsByAd.get(ad.id) ?? [];
    add(new Date(ad.created_at).getTime(), "created");
    add(firstEvent(events, "ready_for_edit"), "handedOff");
    add(firstEvent(events, "creator_review"), "submitted");
    add(approvalTime(ad), "approved");
  }
  return Array.from(buckets.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
}

function liveWip(ads: AdWithRelations[], nowMs: number, targets: AnalyticsSlaTargets) {
  return Object.entries(groupBy(ads.filter((ad) => ad.production_stage !== "approved"), (ad) => ad.production_stage)).map(([stage, rows]) => {
    const typedStage = stage as ProductionStage;
    const ages = rows.map((ad) => Math.max(0, (nowMs - new Date(ad.workflow_status_changed_at).getTime()) / 3_600_000));
    const target = isTargetStage(typedStage) ? targets[typedStage] : null;
    return { stage: typedStage, label: stageLabels[typedStage], count: rows.length, medianAgeHours: median(ages), breached: target ? ages.filter((age) => age > target).length : 0, targetHours: target };
  }).sort((a, b) => productionOrder(a.stage) - productionOrder(b.stage));
}

function bottlenecks(ads: AdWithRelations[], nowMs: number, targets: AnalyticsSlaTargets): AnalyticsDashboardModel["bottlenecks"] {
  return ads.filter((ad) => ad.production_stage !== "approved").map((ad) => {
    const ageHours = Math.max(0, (nowMs - new Date(ad.workflow_status_changed_at).getTime()) / 3_600_000);
    const targetHours = isTargetStage(ad.production_stage) ? targets[ad.production_stage] : null;
    const ratio = targetHours ? ageHours / targetHours : 0;
    const severity: "healthy" | "at_risk" | "breached" = ratio > 1 ? "breached" : ratio >= 0.75 ? "at_risk" : "healthy";
    return { id: ad.id, name: ad.name, product: ad.product?.name ?? "No product", campaign: ad.campaign?.name ?? "No campaign", owner: ownerName(ad), stage: ad.production_stage, stageLabel: stageLabels[ad.production_stage], ageHours, targetHours, deadline: ad.deadline, severity };
  }).sort((a, b) => severityScore(b) - severityScore(a)).slice(0, 20);
}

function deadlineHealth(ads: AdWithRelations[], approved: AdWithRelations[], nowMs: number) {
  const today = formatIstDate(nowMs);
  const soon = shiftIstDate(today, 7);
  const active = ads.filter((ad) => ad.production_stage !== "approved" && ad.deadline);
  const withDeadline = approved.filter((ad) => ad.deadline && approvalTime(ad) !== null);
  const onTime = withDeadline.filter((ad) => approvalTime(ad)! <= endOfIstDate(ad.deadline!)).length;
  return {
    dueToday: active.filter((ad) => ad.deadline === today).length,
    dueSoon: active.filter((ad) => ad.deadline! > today && ad.deadline! <= soon).length,
    overdue: active.filter((ad) => ad.deadline! < today).length,
    approvedOnTimeRate: rate(onTime, withDeadline.length),
    approvedOnTimeSample: withDeadline.length
  };
}

function editorRows(profiles: Profile[], ads: AdWithRelations[], intervals: StageInterval[], approved: AdWithRelations[], reviews: Record<string, ReviewAction[]>, period: Period, capacity: number, targets: AnalyticsSlaTargets) {
  return profiles.filter((profile) => profile.role === "editor").map((profile) => {
    const rows = ads.filter((ad) => ad.editor_id === profile.id);
    const approvedRows = approved.filter((ad) => ad.editor_id === profile.id);
    const editSamples = intervals.filter((item) => item.stage === "editing" && inPeriod(item.endedAt, period) && rows.some((ad) => ad.id === item.adId));
    const ownedSla = intervals.filter((item) => ["ready_for_edit", "editing", "changes_requested"].includes(item.stage) && inPeriod(item.endedAt, period) && rows.some((ad) => ad.id === item.adId));
    const revisions = approvedRows.map(revisionCount);
    return { id: profile.id, name: profile.name, avatarUrl: profile.avatar_url, activeAssignments: rows.filter((ad) => ["ready_for_edit", "editing", "changes_requested"].includes(ad.production_stage)).length, inProgress: rows.filter((ad) => ["editing", "changes_requested"].includes(ad.production_stage)).length, capacity, completed: rows.filter((ad) => ad.submitted_at && inPeriod(new Date(ad.submitted_at).getTime(), period)).length, medianEditHours: median(editSamples.map((item) => item.hours)), firstPassRate: firstPass(approvedRows, reviews).rate, avgRevisions: average(revisions), slaBreaches: ownedSla.filter((item) => isTargetStage(item.stage) && item.hours > targets[item.stage]).length };
  });
}

function creatorRows(profiles: Profile[], ads: AdWithRelations[], intervals: StageInterval[], reviews: Record<string, ReviewAction[]>, period: Period) {
  return profiles.filter((profile) => profile.role === "content_creator").map((profile) => {
    const rows = ads.filter((ad) => ad.creator_id === profile.id);
    const reviewed = rows.filter((ad) => firstEventTime(ad, "creator_review") !== null && inPeriod(firstEventTime(ad, "creator_review")!, period));
    const changed = reviewed.filter((ad) => hasChanges(reviews[ad.id] ?? [])).length;
    return { id: profile.id, name: profile.name, avatarUrl: profile.avatar_url, preparing: rows.filter((ad) => ["script_writing", "ready_to_shoot", "shoot_complete"].includes(ad.production_stage)).length, withEditor: rows.filter((ad) => ["ready_for_edit", "editing", "changes_requested"].includes(ad.production_stage)).length, needsReview: rows.filter((ad) => ad.production_stage === "creator_review").length, completedShoots: rows.filter((ad) => ad.shoot_completed_at && inPeriod(new Date(ad.shoot_completed_at).getTime(), period)).length, medianReviewHours: median(intervals.filter((item) => item.stage === "creator_review" && inPeriod(item.endedAt, period) && rows.some((ad) => ad.id === item.adId)).map((item) => item.hours)), reworkRate: rate(changed, reviewed.length) };
  });
}

function aggregateRows(ads: AdWithRelations[], approved: AdWithRelations[], reviews: Record<string, ReviewAction[]>, period: Period, dimension: "product" | "campaign"): AggregateRow[] {
  const grouped = groupBy(ads, (ad) => dimension === "product" ? ad.product?.id ?? "unassigned" : ad.campaign?.id ?? "unassigned");
  return Object.entries(grouped).map(([id, rows]) => {
    const approvedRows = approved.filter((ad) => rows.some((row) => row.id === ad.id));
    const started = rows.filter((ad) => inPeriod(new Date(ad.created_at).getTime(), period)).length;
    const submittedRows = rows.filter((ad) => ad.submitted_at && inPeriod(new Date(ad.submitted_at).getTime(), period));
    const approvedFromSubmitted = submittedRows.filter((ad) => {
      const approvedAt = approvalTime(ad);
      return approvedAt !== null && inPeriod(approvedAt, period);
    }).length;
    return { id, name: dimension === "product" ? rows[0]?.product?.name ?? "Unassigned" : rows[0]?.campaign?.name ?? "Unassigned", started, wip: rows.filter((ad) => ad.production_stage !== "approved").length, approved: approvedRows.length, approvalRate: rate(approvedFromSubmitted, submittedRows.length), medianCycleHours: median(cycleHours(approvedRows)), firstPassRate: firstPass(approvedRows, reviews).rate, avgRevisions: average(approvedRows.map(revisionCount)) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function slaCompliance(intervals: StageInterval[], period: Period, targets: AnalyticsSlaTargets) {
  const samples = intervals.filter((item) => isTargetStage(item.stage) && inPeriod(item.endedAt, period));
  return { rate: rate(samples.filter((item) => item.hours <= targets[item.stage as TargetStage]).length, samples.length), sample: samples.length };
}

function firstPass(ads: AdWithRelations[], reviews: Record<string, ReviewAction[]>) {
  return { rate: rate(ads.filter((ad) => revisionCount(ad) === 0 && !hasChanges(reviews[ad.id] ?? [])).length, ads.length), sample: ads.length };
}

function reworkRate(ads: AdWithRelations[], events: Map<string, StageEvent[]>, reviews: Record<string, ReviewAction[]>, period: Period) {
  const reviewed = ads.filter((ad) => { const at = firstEvent(events.get(ad.id) ?? [], "creator_review") ?? (ad.submitted_at ? new Date(ad.submitted_at).getTime() : null); return at !== null && inPeriod(at, period); });
  return { rate: rate(reviewed.filter((ad) => hasChanges(reviews[ad.id] ?? []) || revisionCount(ad) > 0).length, reviewed.length), sample: reviewed.length };
}

function matchesDimensions(ad: AdWithRelations, filters: ResolvedAnalyticsFilters) {
  return (!filters.productId || ad.product_id === filters.productId) && (!filters.campaignId || ad.campaign_id === filters.campaignId) && (!filters.creatorId || ad.creator_id === filters.creatorId) && (!filters.editorId || ad.editor_id === filters.editorId);
}

function approvedIn(ads: AdWithRelations[], period: Period) { return ads.filter((ad) => { const at = approvalTime(ad); return at !== null && inPeriod(at, period); }); }
function approvalTime(ad: AdWithRelations) { const value = ad.final_approved_at ?? ad.approved_at; return value ? new Date(value).getTime() : null; }
function cycleHours(ads: AdWithRelations[]) { return ads.flatMap((ad) => { const approved = approvalTime(ad); const created = new Date(ad.created_at).getTime(); return approved !== null && approved >= created ? [(approved - created) / 3_600_000] : []; }); }
function firstEvent(events: StageEvent[], stage: ProductionStage) { return events.find((event) => event.stage === stage)?.at ?? null; }
function firstEventTime(ad: AdWithRelations, stage: ProductionStage) { if (stage === "creator_review" && ad.submitted_at) return new Date(ad.submitted_at).getTime(); return null; }
function hasChanges(reviews: ReviewAction[]) { return reviews.some((review) => review.decision === "request_changes" || review.decision === "reject"); }
function revisionCount(ad: AdWithRelations) { return Math.max(0, (ad.version_count ?? 0) - 1); }
function stageAt(events: StageEvent[], at: number) { return events.filter((event) => event.at <= at).at(-1)?.stage ?? null; }
function ownerName(ad: AdWithRelations) { if (["ready_for_edit", "editing", "changes_requested"].includes(ad.production_stage)) return ad.editor?.name ?? "Unassigned editor"; if (ad.production_stage === "final_review") return "Manager / Admin"; return ad.creator?.name ?? "Unassigned creator"; }
function severityScore(item: AnalyticsDashboardModel["bottlenecks"][number]) { const base = item.severity === "breached" ? 2_000 : item.severity === "at_risk" ? 1_000 : 0; return base + (item.targetHours ? item.ageHours / item.targetHours : item.ageHours / 100); }
function productionOrder(stage: ProductionStage) { return ["script_writing", "ready_to_shoot", "shoot_complete", "ready_for_edit", "editing", "changes_requested", "creator_review", "final_review", "approved"].indexOf(stage); }
function isTargetStage(stage: ProductionStage): stage is TargetStage { return targetStages.includes(stage as TargetStage); }
function isProductionStage(value: unknown): value is ProductionStage { return typeof value === "string" && productionOrder(value as ProductionStage) >= 0; }
function inPeriod(value: number, period: Period) { return value >= period.fromMs && value <= period.toMs; }
function metric(value: number | null, sample: number, delta: number | null): AnalyticsMetric { return { value, sample, delta }; }
function difference(current: number | null, previous: number | null) { return current === null || previous === null ? null : current - previous; }
function rate(numerator: number, denominator: number) { return denominator ? Math.round((numerator / denominator) * 100) : null; }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function median(values: number[]) { return percentile(values, 0.5); }
function percentile(values: number[], point: number) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const index = (sorted.length - 1) * point; const lower = Math.floor(index); const upper = Math.ceil(index); return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower); }
function groupBy<T>(items: T[], key: (item: T) => string) { return items.reduce<Record<string, T[]>>((groups, item) => { const value = key(item); (groups[value] ??= []).push(item); return groups; }, {}); }
function isDateInput(value: string | undefined) { return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00+05:30`).getTime())); }
function startOfIstDate(value: string) { return new Date(`${value}T00:00:00.000+05:30`).getTime(); }
function endOfIstDate(value: string) { return new Date(`${value}T23:59:59.999+05:30`).getTime(); }
function formatIstDate(value: number) { return new Date(value + IST_OFFSET_MS).toISOString().slice(0, 10); }
function shiftIstDate(value: string, days: number) { return formatIstDate(startOfIstDate(value) + days * 86_400_000); }
function weekBucket(value: number) { const local = new Date(value + IST_OFFSET_MS); const offset = (local.getUTCDay() + 6) % 7; local.setUTCDate(local.getUTCDate() - offset); return local.toISOString().slice(0, 10); }

// Kept for callers outside the redesigned dashboard.
export function averageApprovalHours(ads: Pick<AdWithRelations, "submitted_at" | "approved_at">[]) { const values = ads.flatMap((ad) => ad.submitted_at && ad.approved_at ? [(new Date(ad.approved_at).getTime() - new Date(ad.submitted_at).getTime()) / 3_600_000] : []).filter((value) => value >= 0); return average(values); }
export function approvalRate(approved: number, total: number) { return rate(approved, total) ?? 0; }
export function groupAdsByWeek(ads: Pick<AdWithRelations, "created_at" | "status">[]) { const buckets = new Map<string, { week: string; submitted: number; approved: number; rejected: number }>(); for (const ad of ads) { const key = weekBucket(new Date(ad.created_at).getTime()); const bucket = buckets.get(key) ?? { week: key, submitted: 0, approved: 0, rejected: 0 }; bucket.submitted += 1; if (ad.status === "approved" || ad.status === "published") bucket.approved += 1; if (ad.status === "rejected") bucket.rejected += 1; buckets.set(key, bucket); } return Array.from(buckets.values()).sort((a, b) => a.week.localeCompare(b.week)); }
