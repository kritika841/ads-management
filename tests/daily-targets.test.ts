import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalTaskName, summarizeTargets } from "@/lib/daily-targets";
import type { DailyTarget, Profile } from "@/lib/types";

const hardeningMigration = readFileSync("supabase/migrations/20260903090000_harden_daily_targets.sql", "utf8");
const automaticProgressMigration = readFileSync("supabase/migrations/20260902090000_auto_daily_target_progress.sql", "utf8");
const creator = profile("creator", "content_creator");

describe("daily targets", () => {
  it("allows a missed day to be recovered in the monthly total without changing that day to green", () => {
    const summary = summarizeTargets([creator], [
      target("one", "2026-09-01", "Script writing", 5, 3),
      target("two", "2026-09-02", "Script writing", 5, 7),
    ], "2026-09", "2026-09-30")[0];

    expect(summary.status).toBe("on_target");
    expect(summary.cells["2026-09-01"].status).toBe("missed");
    expect(summary.cells["2026-09-02"].status).toBe("complete");
  });

  it("does not let excess work in one task hide another task's daily shortage", () => {
    const summary = summarizeTargets([creator], [
      target("script", "2026-09-01", "Script writing", 5, 4),
      target("shoot", "2026-09-01", "Video shoots", 1, 2),
    ], "2026-09", "2026-09-02")[0];

    expect(summary.cells["2026-09-01"]).toMatchObject({ target: 6, completed: 6, status: "missed", shortTasks: ["Script writing"] });
  });

  it("canonicalizes predefined names and whitespace while preserving custom tasks", () => {
    expect(canonicalTaskName("editor", "  SOCIAL   MEDIA edits ")).toBe("Social media edits");
    expect(canonicalTaskName("content_creator", " Customer   testimonial ")).toBe("Customer testimonial");
  });

  it("makes batch assignment and manual progress atomic database operations", () => {
    expect(hardeningMigration).toContain("function public.save_daily_target_batch");
    expect(hardeningMigration).toContain("function public.save_daily_target_progress");
    expect(hardeningMigration).toContain("returns setof public.daily_team_targets language plpgsql");
    expect(hardeningMigration).toContain("grant execute on function public.save_daily_target_batch");
  });

  it("resets completion counters when an edited assignment changes identity", () => {
    expect(hardeningMigration).toContain("identity_changed := existing.user_id <> p_user_id");
    expect(hardeningMigration).toContain("manual_completed_quantity = case when identity_changed then 0");
    expect(hardeningMigration).toContain("auto_completed_quantity = case when identity_changed then 0");
    expect(hardeningMigration).toContain("completed_quantity = case when identity_changed then 0");
  });

  it("counts only an editor's first submission, not correction resubmissions", () => {
    expect(automaticProgressMigration).toContain("new.submitted_at is not null and (tg_op = 'INSERT' or old.submitted_at is null)");
  });
});

function profile(id: string, role: Profile["role"]): Profile {
  return { id, name: id, email: `${id}@example.com`, role, avatar_url: null, active: true, deleted_at: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
}

function target(id: string, date: string, taskName: string, assigned: number, completed: number): DailyTarget {
  return { id, user_id: creator.id, target_date: date, task_name: taskName, target_quantity: assigned, completed_quantity: completed, manual_completed_quantity: completed, auto_completed_quantity: 0, notes: null, assigned_by: null, created_at: `${date}T00:00:00.000Z`, updated_at: `${date}T00:00:00.000Z` };
}
