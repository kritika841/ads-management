import { describe, expect, it } from "vitest";
import type { ActivityLog, EditorTimeLog } from "@/lib/types";
import {
  buildWorkLogReport,
  enumerateDays,
  formatWorkLogDuration,
  normalizeWorkLogRange,
  type WorkLogAd
} from "@/lib/work-log";

const creator = { id: "c1", name: "Cara", role: "content_creator" };
const editor = { id: "e1", name: "Eli", role: "editor" };
const admin = { id: "a1", name: "Admin", role: "admin" };
const manager = { id: "m1", name: "Mia", role: "manager" };

const ads: WorkLogAd[] = [
  { id: "ad1", name: "Hook A", creator_id: "c1", editor_id: "e1", production_stage: "creator_review", created_at: "2026-10-06T05:00:00Z" },
  { id: "ad2", name: "Hook B", creator_id: "c1", editor_id: null, production_stage: "script_writing", created_at: "2026-10-06T06:00:00Z" },
  { id: "ad3", name: "Mgr Hook", creator_id: "m1", editor_id: null, production_stage: "ready_to_shoot", created_at: "2026-10-06T07:00:00Z" }
];

let counter = 0;
function log(adId: string, actorId: string | null, action: string, at: string, metadata: Record<string, unknown> = {}): ActivityLog {
  counter += 1;
  return { id: `l${counter}`, ad_id: adId, actor_id: actorId, action, metadata, created_at: at };
}

const logs: ActivityLog[] = [
  log("ad1", "c1", "creator_item_created", "2026-10-06T05:00:00Z", { production_stage: "ready_for_edit" }),
  log("ad2", "c1", "creator_item_created", "2026-10-06T06:00:00Z", { production_stage: "script_writing" }),
  log("ad1", "a1", "editor_assigned", "2026-10-06T07:00:00Z", { production_stage: "ready_for_edit" }),
  log("ad1", "e1", "editing_started", "2026-10-06T08:00:00Z", { production_stage: "editing" }),
  log("ad1", "e1", "edited_video_submitted", "2026-10-06T10:00:00Z", { production_stage: "creator_review" }),
  log("ad1", "a1", "final_changes_requested_to_editor", "2026-10-07T04:00:00Z", { production_stage: "changes_requested", note: "tighten intro" }),
  log("ad1", "e1", "timer_paused", "2026-10-06T09:00:00Z"),
  // Admin adds a creative on behalf of the manager.
  log("ad3", "a1", "creator_item_created", "2026-10-06T07:00:00Z", { production_stage: "ready_to_shoot" })
];

const timeLogs: EditorTimeLog[] = [
  { id: "t1", ad_id: "ad1", editor_id: "e1", session_started_at: "2026-10-06T08:00:00Z", session_ended_at: "2026-10-06T09:30:00Z", pause_reason: null, is_active: false, created_at: "2026-10-06T08:00:00Z" },
  // Session straddling the IST midnight at 2026-10-06T18:30Z.
  { id: "t2", ad_id: "ad1", editor_id: "e1", session_started_at: "2026-10-06T18:00:00Z", session_ended_at: "2026-10-06T19:00:00Z", pause_reason: null, is_active: false, created_at: "2026-10-06T18:00:00Z" }
];

const base = { ads, logs, timeLogs, nowMs: Date.parse("2026-10-07T12:00:00Z") };

describe("work log report", () => {
  it("counts a creator's new submissions and status changes for one day", () => {
    const report = buildWorkLogReport({ ...base, person: creator, from: "2026-10-06", to: "2026-10-06" });
    expect(report.summary.newSubmissions).toBe(2);
    expect(report.summary.creativesTouched).toBe(2);
    expect(report.summary.stageCounts.script_writing).toBe(1);
    // The editor's later transitions on the creator's creative show up as status changes.
    expect(report.summary.stageCounts.editing).toBe(1);
    expect(report.summary.stageCounts.creator_review).toBe(1);
    expect(report.creatives.find((c) => c.adId === "ad1")?.newInRange).toBe(true);
  });

  it("splits a range by IST day and ignores bookkeeping entries", () => {
    const report = buildWorkLogReport({ ...base, person: editor, from: "2026-10-06", to: "2026-10-07" });
    expect(report.days.map((d) => d.date)).toEqual(["2026-10-06", "2026-10-07"]);
    expect(report.summary.newSubmissions).toBe(1);
    expect(report.summary.stageCounts.changes_requested).toBe(1);
    const all = report.creatives.flatMap((c) => c.events).map((e) => e.action);
    expect(all).not.toContain("timer_paused");
    // 11:30 IST work on the 6th (+30 min before IST midnight), the remaining 30 min falls on the 7th.
    expect(report.days[0].editingSeconds).toBe(90 * 60 + 30 * 60);
    expect(report.days[1].editingSeconds).toBe(30 * 60);
    expect(report.summary.editingSeconds).toBe(150 * 60);
  });

  it("limits a single-day window to that IST day", () => {
    const report = buildWorkLogReport({ ...base, person: editor, from: "2026-10-07", to: "2026-10-07" });
    expect(report.summary.newSubmissions).toBe(0);
    expect(report.summary.stageCounts.changes_requested).toBe(1);
    const change = report.creatives[0].events.find((e) => e.action === "final_changes_requested_to_editor");
    expect(change?.direction).toBe("on_their_work");
    expect(change?.actorName).toBe(null);
    expect(change?.note).toBe("tighten intro");
  });

  it("credits a creative added on behalf of a manager to that manager", () => {
    const managerReport = buildWorkLogReport({ ...base, person: manager, from: "2026-10-06", to: "2026-10-06" });
    expect(managerReport.summary.newSubmissions).toBe(1);
    expect(managerReport.creatives[0].roles).toEqual(["creator"]);
    const adminReport = buildWorkLogReport({ ...base, person: admin, from: "2026-10-06", to: "2026-10-06" });
    expect(adminReport.summary.newSubmissions).toBe(1);
  });

  it("reports nothing for a person with no work", () => {
    const report = buildWorkLogReport({ ...base, person: { id: "x", name: "Nobody", role: "editor" }, from: "2026-10-01", to: "2026-10-05" });
    expect(report.summary.creativesTouched).toBe(0);
    expect(report.summary.editingSeconds).toBe(0);
    expect(report.creatives).toEqual([]);
  });

  it("accurately tracks totalEvents and timeSessions without double counting", () => {
    const report = buildWorkLogReport({ ...base, person: creator, from: "2026-10-06", to: "2026-10-06" });
    // Cara has 2 new creative submissions, and 3 status movements on her creatives by others (5 events total)
    expect(report.days[0].newSubmissions).toBe(2);
    expect(report.days[0].totalEvents).toBe(5);
    expect(report.summary.newSubmissions).toBe(2);
    expect(report.summary.totalEvents).toBe(5);

    const editorReport = buildWorkLogReport({ ...base, person: editor, from: "2026-10-06", to: "2026-10-07" });
    // On ad1, 4 events on the 6th (creation, assignment, started editing, submission) and 1 on the 7th (changes requested)
    expect(editorReport.days[0].totalEvents).toBe(4);
    expect(editorReport.days[1].totalEvents).toBe(1);
    expect(editorReport.summary.totalEvents).toBe(5);
    // Eli has 2 sessions overlapping with the 6th
    expect(editorReport.days[0].timeSessions.length).toBeGreaterThan(0);
  });
});

describe("work log ranges", () => {
  it("defaults to today and swaps reversed dates", () => {
    const now = Date.parse("2026-10-07T12:00:00Z");
    expect(normalizeWorkLogRange(null, null, now)).toEqual({ from: "2026-10-07", to: "2026-10-07" });
    expect(normalizeWorkLogRange("2026-10-05", "2026-10-02", now)).toEqual({ from: "2026-10-02", to: "2026-10-05" });
    expect(normalizeWorkLogRange("garbage", "2026-10-03", now)).toEqual({ from: "2026-10-03", to: "2026-10-03" });
  });

  it("caps very long ranges", () => {
    const range = normalizeWorkLogRange("2020-01-01", "2026-10-07");
    expect(enumerateDays(range.from, range.to).length).toBe(92);
  });

  it("formats durations", () => {
    expect(formatWorkLogDuration(0)).toBe("—");
    expect(formatWorkLogDuration(30)).toBe("<1m");
    expect(formatWorkLogDuration(3600)).toBe("1h");
    expect(formatWorkLogDuration(5400)).toBe("1h 30m");
  });
});

describe("categorizeWorkLogAction", () => {
  it("accurately categorizes newly submitted actions", async () => {
    const { categorizeWorkLogAction } = await import("@/lib/work-log");
    expect(categorizeWorkLogAction("creator_item_created")).toBe("newly_submitted");
    expect(categorizeWorkLogAction("edited_video_submitted")).toBe("newly_submitted");
    expect(categorizeWorkLogAction("reviewer_uploaded_final_clip")).toBe("newly_submitted");
  });

  it("accurately categorizes resubmitted actions", async () => {
    const { categorizeWorkLogAction } = await import("@/lib/work-log");
    expect(categorizeWorkLogAction("edited_video_resubmitted")).toBe("resubmitted");
    expect(categorizeWorkLogAction("creator_routed_changes_to_review")).toBe("resubmitted");
    expect(categorizeWorkLogAction("creator_routed_changes_to_editor")).toBe("resubmitted");
  });

  it("accurately categorizes revision requested actions", async () => {
    const { categorizeWorkLogAction } = await import("@/lib/work-log");
    expect(categorizeWorkLogAction("final_changes_requested")).toBe("revision_requested");
    expect(categorizeWorkLogAction("final_changes_requested_to_editor")).toBe("revision_requested");
    expect(categorizeWorkLogAction("final_changes_requested_to_creator")).toBe("revision_requested");
    expect(categorizeWorkLogAction("creator_changes_requested")).toBe("revision_requested");
    expect(categorizeWorkLogAction("creator_requested_changes")).toBe("revision_requested");
  });

  it("accurately categorizes approval actions", async () => {
    const { categorizeWorkLogAction } = await import("@/lib/work-log");
    expect(categorizeWorkLogAction("final_approval_granted")).toBe("approved");
    expect(categorizeWorkLogAction("manager_approved")).toBe("approved");
    expect(categorizeWorkLogAction("creator_approved_edit")).toBe("approved");
  });

  it("categorizes others as other", async () => {
    const { categorizeWorkLogAction } = await import("@/lib/work-log");
    expect(categorizeWorkLogAction("editing_started")).toBe("other");
    expect(categorizeWorkLogAction("editor_assigned")).toBe("other");
  });
});

