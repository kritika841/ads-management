import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalTaskName, summarizeTargets } from "@/lib/daily-targets";
import type { DailyTarget, Profile } from "@/lib/types";

const hardeningMigration = readFileSync("supabase/migrations/20260903090000_harden_daily_targets.sql", "utf8");
const automaticProgressMigration = readFileSync("supabase/migrations/20260902090000_auto_daily_target_progress.sql", "utf8");
const assignmentOnlyProgressMigration = readFileSync("supabase/migrations/20260907010000_require_assigned_daily_targets.sql", "utf8");
const targetActions = readFileSync("app/actions/daily-targets.ts", "utf8");
const downloadedBadgeMigration = readFileSync("supabase/migrations/20260908090000_preserve_downloaded_system_badge.sql", "utf8");
const carryForwardMigration = readFileSync("supabase/migrations/20260918090000_daily_target_carry_forward.sql", "utf8");
const carryForwardNameFixMigration = readFileSync("supabase/migrations/20260918100000_fix_daily_target_carry_task_name.sql", "utf8");
const carryForwardMergeMigration = readFileSync("supabase/migrations/20260918110000_merge_daily_target_carry_collisions.sql", "utf8");
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

  it("never creates pre-filled completion rows before a task is assigned", () => {
    expect(assignmentOnlyProgressMigration).toContain("if existing_id is null then return; end if;");
    expect(assignmentOnlyProgressMigration).not.toContain("insert into public.daily_team_targets");
  });

  it("notifies the assigned person after a daily target is saved", () => {
    expect(targetActions).toContain("await createNotification(admin");
    expect(targetActions).toContain('title: "Daily target assigned"');
    expect(targetActions.indexOf("await createNotification(admin")).toBeGreaterThan(targetActions.indexOf('admin.rpc("save_daily_target_batch"'));
  });

  it("preserves the downloaded system badge when ordinary creative tags change", () => {
    expect(downloadedBadgeMigration).toContain("and tag.name <> 'downloaded'");
    expect(downloadedBadgeMigration).toContain("lower(trim(value)) <> 'downloaded'");
  });

const noSundayCarryMigration = readFileSync("supabase/migrations/20260921140000_no_sunday_daily_targets_and_carry.sql", "utf8");

  it("carries yesterday's outstanding work through the current month, but not across a month boundary", () => {
    expect(carryForwardMigration).toContain("where target_date = carry_day - 1");
    expect(carryForwardMigration).toContain("target_quantity > completed_quantity");
    expect(carryForwardMigration).toContain("carry_day = date_trunc('month', carry_day)::date");
    expect(carryForwardMigration).toContain("while carry_day <= today loop");
    expect(carryForwardMigration).toContain("carried_from_target_id");
    expect(carryForwardNameFixMigration).toContain("daily_target_carry_task_name");
    expect(carryForwardMergeMigration).toContain("on conflict (user_id, target_date, task_name) do update");
  });

  it("never assigns or carries over tasks to Sunday and bridges Saturday work to Monday", () => {
    expect(noSundayCarryMigration).toContain("extract(isodow from carry_day) = 7");
    expect(noSundayCarryMigration).toContain("extract(isodow from day) between 1 and 6");
    expect(noSundayCarryMigration).toContain("target_date in (carry_day - 1, carry_day - 2)");
  });

  it("does not inflate monthly target or due target by summing carried-forward tasks", () => {
    const summary = summarizeTargets([creator], [
      target("one", "2026-09-01", "Script writing", 5, 3),
      target("two", "2026-09-02", "Script writing", 5, 5),
      {
        ...target("two_carried", "2026-09-02", "Script writing (carried forward)", 2, 2),
        carried_from_target_id: "one"
      }
    ], "2026-09", "2026-09-03")[0];

    // Total monthly target must be only the original assigned work (5 + 5 = 10), not 12
    expect(summary.target).toBe(10);
    // Total completed is 3 (day 1) + 5 (day 2 original) + 2 (day 2 carried) = 10
    expect(summary.completed).toBe(10);
    expect(summary.percent).toBe(100);
    expect(summary.status).toBe("on_target");

    // But day 2's specific cell target includes the carried workload (5 + 2 = 7)
    expect(summary.cells["2026-09-02"].target).toBe(7);
    expect(summary.cells["2026-09-02"].completed).toBe(7);
  });
});

function profile(id: string, role: Profile["role"]): Profile {
  return { id, name: id, email: `${id}@example.com`, role, avatar_url: null, active: true, deleted_at: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
}

function target(id: string, date: string, taskName: string, assigned: number, completed: number): DailyTarget {
  return { id, user_id: creator.id, target_date: date, task_name: taskName, target_quantity: assigned, completed_quantity: completed, manual_completed_quantity: completed, auto_completed_quantity: 0, notes: null, assigned_by: null, carried_from_target_id: null, created_at: `${date}T00:00:00.000Z`, updated_at: `${date}T00:00:00.000Z` };
}
