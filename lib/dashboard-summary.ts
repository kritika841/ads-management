import type { AdWithRelations, ProductionStage, Profile, UserRole } from "@/lib/types";
import type { QueueKey } from "@/lib/work-queues";
import type { EditorTimelinePoint } from "@/lib/data";

export type DashboardSummaryTile = {
  key: string;
  label: string;
  count: number;
  queue: QueueKey | null;
  help: string;
  tone: "neutral" | "attention" | "urgent" | "success";
};

export type DashboardPriorityItem = {
  id: string;
  name: string;
  campaign: string;
  stage: ProductionStage;
  deadline: string | null;
  deadlineState: "overdue" | "today" | "soon" | "later" | "none";
  reason: string;
  waitingHours: number;
};

export type DashboardSummaryModel = {
  kind: "reviewer" | "creator" | "editor";
  eyebrow: string;
  title: string;
  description: string;
  tiles: DashboardSummaryTile[];
  priorityTitle: string;
  priorityEmpty: string;
  priorities: DashboardPriorityItem[];
  production: { label: string; count: number }[];
  workloads: { id: string; name: string; avatarUrl: string | null; active: number; capacity: number; avgSecondsPerVideo?: number }[];
  timeline?: EditorTimelinePoint[];
};

const activeEditorStages: ProductionStage[] = ["ready_for_edit", "editing", "changes_requested"];

export function buildDashboardSummary(params: {
  role: UserRole;
  ads: AdWithRelations[];
  profiles: Profile[];
  editorWorkloads: Record<string, number>;
  editorCapacity: number;
  now?: Date;
  editorAverageEditTimes?: Record<string, number>;
  timelineData?: EditorTimelinePoint[];
}): DashboardSummaryModel {
  const { role, ads, profiles, editorWorkloads, editorCapacity, editorAverageEditTimes, timelineData } = params;
  const now = params.now ?? new Date();
  const today = istDate(now);
  const openAds = ads.filter((ad) => ad.production_stage !== "approved");
  const overdue = openAds.filter((ad) => deadlineState(ad.deadline, today) === "overdue");
  const dueSoon = openAds.filter((ad) => ["today", "soon"].includes(deadlineState(ad.deadline, today)));
  const priorities = priorityItems(role, openAds, today, now.getTime());

  if (role === "content_creator") {
    return {
      kind: "creator",
      eyebrow: "Your work today",
      title: creatorHeading(openAds),
      description: "Move scripts and shoots forward, assign completed footage, and review edited videos.",
      tiles: [
        tile("preparing", "Preparing", countStages(ads, ["script_writing", "ready_to_shoot"]), "preparing", "Scripts and shoots that are still being prepared."),
        tile("assign", "Need an editor", countStages(ads, ["shoot_complete"]), "pending_editor_assign", "Completed shoots waiting for an editor and deadline.", "attention"),
        tile("review", "Need your review", countStages(ads, ["creator_review"]), "creator_review", "Edited videos waiting for your feedback.", "attention"),
        tile("overdue", "Overdue", overdue.length, null, "Open work that has passed its deadline.", overdue.length ? "urgent" : "neutral")
      ],
      priorityTitle: "My next actions",
      priorityEmpty: "You have no urgent production actions right now.",
      priorities,
      production: [
        { label: "Preparing", count: countStages(ads, ["script_writing", "ready_to_shoot", "shoot_complete"]) },
        { label: "With editor", count: countStages(ads, ["ready_for_edit", "editing", "changes_requested"]) },
        { label: "Awaiting final approval", count: countStages(ads, ["final_review"]) },
        { label: "Approved", count: countStages(ads, ["approved"]) }
      ],
      workloads: []
    };
  }

  if (role === "editor") {
    const active = countStages(ads, activeEditorStages);
    return {
      kind: "editor",
      eyebrow: "Your editing desk",
      title: editorHeading(ads),
      description: "Start new assignments, finish active edits, and handle requested changes before their deadlines.",
      tiles: [
        tile("new", "New assignments", countStages(ads, ["ready_for_edit"]), "new_assignments", "Assigned videos you have not started yet.", "attention"),
        tile("editing", "Editing now", countStages(ads, ["editing"]), "editing", "Videos currently being edited."),
        tile("changes", "Changes requested", countStages(ads, ["changes_requested"]), "changes", "Submitted videos that need another update.", "attention"),
        tile("deadlines", "Due soon or late", new Set([...dueSoon, ...overdue].map((ad) => ad.id)).size, null, "Open edits due within three days or already overdue.", overdue.length ? "urgent" : "neutral")
      ],
      priorityTitle: "My priority edits",
      priorityEmpty: "You have no edits needing immediate attention.",
      priorities,
      production: [
        { label: "Active workload", count: active },
        { label: "Available capacity", count: Math.max(0, editorCapacity - active) },
        { label: "Submitted", count: countStages(ads, ["creator_review", "final_review"]) },
        { label: "Approved", count: countStages(ads, ["approved"]) }
      ],
      workloads: []
    };
  }

  return {
    kind: "reviewer",
    eyebrow: "Team operations today",
    title: reviewerHeading(openAds),
    description: "Clear reviews, assign completed shoots, and balance editing work across the team.",
    tiles: [
      tile("review", "Need review", countStages(ads, ["creator_review", "final_review"]), "needs_review", "Videos waiting for manager or admin review.", "attention"),
      tile("assign", "Need an editor", countStages(ads, ["shoot_complete"]), "pending_editor_assign", "Completed shoots waiting for an editor and deadline.", "attention"),
      tile("changes", "Changes in progress", countStages(ads, ["changes_requested"]), "changes", "Videos returned to editors for updates."),
      tile("overdue", "Overdue", overdue.length, null, "Open work that has passed its deadline.", overdue.length ? "urgent" : "neutral")
    ],
    priorityTitle: "Needs attention",
    priorityEmpty: "Nothing needs urgent attention right now.",
    priorities,
    production: [],
    workloads: profiles
      .filter((profile) => profile.active && profile.role === "editor")
      .map((profile) => ({ 
        id: profile.id, 
        name: profile.name, 
        avatarUrl: profile.avatar_url, 
        active: editorWorkloads[profile.id] ?? 0, 
        capacity: editorCapacity,
        avgSecondsPerVideo: editorAverageEditTimes?.[profile.id]
      }))
      .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name)),
    timeline: timelineData
  };
}

function priorityItems(role: UserRole, ads: AdWithRelations[], today: string, nowMs: number) {
  const eligible = ads.filter((ad) => {
    if (role === "editor") return activeEditorStages.includes(ad.production_stage);
    if (role === "content_creator") return ["script_writing", "ready_to_shoot", "shoot_complete", "creator_review"].includes(ad.production_stage) || deadlineState(ad.deadline, today) === "overdue";
    return ["shoot_complete", "creator_review", "final_review", "changes_requested"].includes(ad.production_stage) || ["overdue", "today", "soon"].includes(deadlineState(ad.deadline, today)) || waitingHours(ad, nowMs) >= 24;
  });

  return eligible
    .map((ad) => ({
      id: ad.id,
      name: ad.name,
      campaign: ad.campaign?.name ?? "No campaign",
      stage: ad.production_stage,
      deadline: ad.deadline,
      deadlineState: deadlineState(ad.deadline, today),
      reason: priorityReason(role, ad, today),
      waitingHours: waitingHours(ad, nowMs)
    }))
    .sort((a, b) => priorityScore(a) - priorityScore(b) || compareDeadline(a.deadline, b.deadline) || b.waitingHours - a.waitingHours)
    .slice(0, 6);
}

function priorityReason(role: UserRole, ad: AdWithRelations, today: string) {
  const deadline = deadlineState(ad.deadline, today);
  if (deadline === "overdue") return "Past deadline";
  if (ad.production_stage === "changes_requested") return "Changes requested";
  if (deadline === "today") return "Due today";
  if (deadline === "soon") return "Due soon";
  if (ad.production_stage === "creator_review") return role === "content_creator" ? "Ready for your review" : "Waiting for review";
  if (ad.production_stage === "final_review") return "Waiting for final review";
  if (ad.production_stage === "shoot_complete") return "Assign an editor";
  if (ad.production_stage === "ready_for_edit") return "New assignment";
  if (ad.production_stage === "editing") return "Continue editing";
  if (ad.production_stage === "ready_to_shoot") return "Complete the shoot";
  return "Continue script";
}

function priorityScore(item: DashboardPriorityItem) {
  if (item.deadlineState === "overdue") return 0;
  if (item.stage === "changes_requested") return 1;
  if (item.deadlineState === "today") return 2;
  if (item.deadlineState === "soon") return 3;
  if (["creator_review", "final_review", "shoot_complete", "ready_for_edit"].includes(item.stage)) return 4;
  return 5;
}

function deadlineState(deadline: string | null, today: string): DashboardPriorityItem["deadlineState"] {
  if (!deadline) return "none";
  const days = dateDifference(deadline, today);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 3) return "soon";
  return "later";
}

function tile(key: string, label: string, count: number, queue: QueueKey | null, help: string, tone: DashboardSummaryTile["tone"] = "neutral"): DashboardSummaryTile {
  return { key, label, count, queue, help, tone };
}

function countStages(ads: AdWithRelations[], stages: ProductionStage[]) { return ads.filter((ad) => stages.includes(ad.production_stage)).length; }
function waitingHours(ad: AdWithRelations, nowMs: number) { return Math.max(0, (nowMs - new Date(ad.workflow_status_changed_at).getTime()) / 3_600_000); }
function compareDeadline(a: string | null, b: string | null) { return a === b ? 0 : !a ? 1 : !b ? -1 : a.localeCompare(b); }
function dateDifference(value: string, today: string) { return Math.round((Date.parse(`${value}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000); }
function istDate(value: Date) { return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata" }).format(value); }
function reviewerHeading(ads: AdWithRelations[]) { const reviews = countStages(ads, ["creator_review", "final_review"]); return reviews ? `${reviews} ${reviews === 1 ? "video needs" : "videos need"} review` : "The team review queue is clear"; }
function creatorHeading(ads: AdWithRelations[]) { const actions = countStages(ads, ["script_writing", "ready_to_shoot", "shoot_complete", "creator_review"]); return actions ? `${actions} ${actions === 1 ? "item needs" : "items need"} your action` : "Your production work is moving"; }
function editorHeading(ads: AdWithRelations[]) { const actions = countStages(ads, activeEditorStages); return actions ? `${actions} ${actions === 1 ? "edit needs" : "edits need"} your attention` : "Your editing queue is clear"; }
