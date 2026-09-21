import type { DailyTarget, Profile } from "@/lib/types";

export const targetTimeZone = "Asia/Kolkata";
export type DailyTargetStatus = "complete" | "missed" | "in_progress" | "scheduled" | "unassigned";
export const creatorTaskOptions = ["Script writing", "Video shoots", "Raw clip generation"] as const;
export const editorTaskOptions = ["Ad video edits", "Social media edits"] as const;

export function taskOptionsForRole(role: Profile["role"] | undefined) {
  return role === "content_creator" ? creatorTaskOptions : role === "editor" ? editorTaskOptions : [];
}

export function canonicalTaskName(role: Profile["role"] | undefined, taskName: string) {
  const normalized = taskName.trim().replace(/\s+/g, " ");
  return taskOptionsForRole(role).find((option) => option.toLocaleLowerCase() === normalized.toLocaleLowerCase()) ?? normalized;
}

export function dateInTargetTimeZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: targetTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function monthBounds(month: string) {
  const safeMonth = /^\d{4}-\d{2}$/.test(month) ? month : dateInTargetTimeZone().slice(0, 7);
  const [year, monthNumber] = safeMonth.split("-").map(Number);
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { month: safeMonth, start: `${safeMonth}-01`, end: `${safeMonth}-${String(count).padStart(2, "0")}`, days: Array.from({ length: count }, (_, index) => `${safeMonth}-${String(index + 1).padStart(2, "0")}`) };
}

export function dailyStatus(target: number, completed: number, date: string, today: string): DailyTargetStatus {
  if (target === 0 && completed === 0) return "unassigned";
  if (completed >= target) return "complete";
  if (date > today) return "scheduled";
  if (date < today) return "missed";
  return "in_progress";
}

export function isCarriedTarget(item: DailyTarget): boolean {
  return Boolean(item.carried_from_target_id) || item.task_name.toLowerCase().includes("(carried forward)");
}

export function summarizeTargets(profiles: Profile[], targets: DailyTarget[], month: string, today = dateInTargetTimeZone()) {
  const bounds = monthBounds(month);
  const currentMonth = today.slice(0, 7);
  return profiles.map((profile) => {
    const records = targets.filter((target) => target.user_id === profile.id);
    const target = records.filter((item) => !isCarriedTarget(item)).reduce((sum, item) => sum + item.target_quantity, 0);
    const completed = records.reduce((sum, item) => sum + item.completed_quantity, 0);
    // Today remains open until the target timezone rolls over. Only closed days
    // count toward whether someone is below target, so an in-progress task never
    // makes a creator or editor look behind during the day.
    const due = records.filter((item) => item.target_date < today && !isCarriedTarget(item)).reduce((sum, item) => sum + item.target_quantity, 0);
    const dueCompleted = records.filter((item) => item.target_date < today).reduce((sum, item) => sum + item.completed_quantity, 0);
    const benchmark = bounds.month < currentMonth ? target : bounds.month === currentMonth ? due : 0;
    const completedBenchmark = bounds.month < currentMonth ? completed : bounds.month === currentMonth ? dueCompleted : 0;
    const status = target === 0 ? "unassigned" : bounds.month > currentMonth ? "scheduled" : completedBenchmark >= benchmark ? "on_target" : "below_target";
    const cells = Object.fromEntries(bounds.days.map((date) => {
      const daily = records.filter((item) => item.target_date === date);
      const dailyTarget = daily.reduce((sum, item) => sum + item.target_quantity, 0);
      const dailyCompleted = daily.reduce((sum, item) => sum + item.completed_quantity, 0);
      const assignedTasks = daily.filter((item) => item.target_quantity > 0);
      const shortTasks = assignedTasks.filter((item) => item.completed_quantity < item.target_quantity).map((item) => item.task_name);
      const status = assignedTasks.length && shortTasks.length
        ? date > today ? "scheduled" : date < today ? "missed" : "in_progress"
        : dailyStatus(dailyTarget, dailyCompleted, date, today);
      return [date, { target: dailyTarget, completed: dailyCompleted, status, shortTasks }];
    }));
    return { profile, target, completed, due, status, cells, percent: target ? Math.round((completed / target) * 100) : 0 };
  });
}
