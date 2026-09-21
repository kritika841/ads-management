"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, requireRole } from "@/lib/auth";
import { canonicalTaskName, dateInTargetTimeZone } from "@/lib/daily-targets";
import { createNotification } from "@/lib/notifications";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const targetTaskInput = z.object({ id: z.string().uuid().optional(), taskName: z.string().trim().min(1).max(120), quantity: z.number().int().min(0).max(10000), notes: z.string().trim().max(500).optional() });
const targetInput = z.object({ userId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), tasks: z.array(targetTaskInput).min(1).max(20) });
const progressInput = z.object({ id: z.string().uuid().optional(), userId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), taskName: z.string().trim().min(1).max(120), quantity: z.number().int().min(0).max(10000) });
const ruleInput = z.object({ id: z.string().uuid().optional().or(z.literal("")), userId: z.string().uuid(), taskName: z.string().trim().min(1).max(120), quantity: z.number().int().min(1).max(10000), notes: z.string().trim().max(500).optional(), startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), active: z.boolean() });
const daySettingInput = z.object({ userId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), mode: z.enum(["append", "auto_only"]) });
const subtractInput = z.object({ targetId: z.string().uuid(), amount: z.number().int().min(1).max(10000), reason: z.string().trim().min(1, "A reason is required when subtracting work.").max(500) });

export async function saveDailyTaskRule(input: z.infer<typeof ruleInput>) {
  const actor = await requireRole(["admin", "manager"]);
  const parsed = ruleInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid recurring task." };
  if (parsed.data.startsOn < dateInTargetTimeZone()) return { ok: false, message: "Recurring tasks can start today or a future date only." };
  const admin = createSupabaseAdminClient();
  const { data: person } = await admin.from("profiles").select("id,role,active").eq("id", parsed.data.userId).maybeSingle();
  if (!person?.active || !["editor", "content_creator"].includes(person.role)) return { ok: false, message: "Choose an active creator or editor." };
  const taskName = canonicalTaskName(person.role, parsed.data.taskName);
  const payload = { user_id: parsed.data.userId, task_name: taskName, target_quantity: parsed.data.quantity, notes: parsed.data.notes || null, starts_on: parsed.data.startsOn, ends_on: parsed.data.endsOn || null, active: parsed.data.active, created_by: actor.id };
  // The new form uses an empty id for a new rule; do not send that empty
  // string to the UUID column or Supabase will reject it as an invalid UUID.
  const query = parsed.data.id ? admin.from("daily_task_rules").update(payload).eq("id", parsed.data.id) : admin.from("daily_task_rules").insert(payload);
  const { error } = await query;
  if (error) return { ok: false, message: autoDelegatorMessage(error.message) };
  await admin.from("audit_logs").insert({ actor_id: actor.id, action: "saved_daily_task_rule", target_type: "daily_task_rule", target_id: parsed.data.id ?? null, metadata: parsed.data });
  revalidate();
  return { ok: true };
}

export async function saveDailyTargetDaySetting(input: z.infer<typeof daySettingInput>) {
  const actor = await requireRole(["admin", "manager"]); const parsed = daySettingInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid daily mode." };
  if (parsed.data.date < dateInTargetTimeZone()) return { ok: false, message: "This assignment is closed because the day has ended." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("daily_target_day_settings").upsert(
    { user_id: parsed.data.userId, target_date: parsed.data.date, mode: parsed.data.mode, created_by: actor.id },
    { onConflict: "user_id,target_date" },
  );
  if (error) return { ok: false, message: autoDelegatorMessage(error.message) };
  revalidate(); return { ok: true };
}

export async function subtractDailyTarget(input: z.infer<typeof subtractInput>) {
  const actor = await requireRole(["admin", "manager"]); const parsed = subtractInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "A reason is required when subtracting work." };
  const admin = createSupabaseAdminClient();
  const { data: target } = await admin.from("daily_team_targets").select("id,target_quantity,user_id,target_date,task_name,carried_from_target_id").eq("id", parsed.data.targetId).maybeSingle();
  if (!target) return { ok: false, message: "That target no longer exists." };
  if (target.target_date < dateInTargetTimeZone()) return { ok: false, message: "This assignment is closed because the day has ended." };
  if (target.carried_from_target_id) return { ok: false, message: "Carried-forward work cannot be subtracted. Update the original assignment before the day closes instead." };
  const nextQuantity = Math.max(0, target.target_quantity - parsed.data.amount);
  const { error } = await admin.from("daily_team_targets").update({ target_quantity: nextQuantity }).eq("id", target.id);
  if (error) return { ok: false, message: autoDelegatorMessage(error.message) };
  const { error: subtractionError } = await admin.from("daily_target_subtractions").insert({ target_id: target.id, amount: parsed.data.amount, reason: parsed.data.reason, actor_id: actor.id });
  if (subtractionError) return { ok: false, message: autoDelegatorMessage(subtractionError.message) };
  const { error: auditError } = await admin.from("audit_logs").insert({ actor_id: actor.id, action: "subtracted_daily_target", target_type: "daily_team_target", target_id: target.id, metadata: { ...parsed.data, previousQuantity: target.target_quantity, nextQuantity } });
  if (auditError) return { ok: false, message: auditError.message };
  revalidate(); return { ok: true };
}

export async function appendDailyTarget(input: z.infer<typeof targetInput>) {
  const actor = await requireRole(["admin", "manager"]);
  const parsed = targetInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid additional task." };
  const today = dateInTargetTimeZone();
  if (parsed.data.date !== today) return { ok: false, message: parsed.data.date > today ? "Additional work can only be assigned for today." : "This assignment is closed because the day has ended." };
  if (parsed.data.tasks.some((task) => task.id || task.quantity < 1)) return { ok: false, message: "Additional tasks must have a quantity of at least 1." };

  const admin = createSupabaseAdminClient();
  const { data: person, error: personError } = await admin.from("profiles").select("id,name,email,role,active").eq("id", parsed.data.userId).maybeSingle();
  if (personError || !person || !person.active || !["editor", "content_creator"].includes(person.role)) return { ok: false, message: "Choose an active creator or editor." };

  const tasks: Array<{ taskName: string; quantity: number; notes?: string }> = [];
  for (const task of parsed.data.tasks) {
    const taskName = canonicalTaskName(person.role, task.taskName);
    const { data: base, error: baseError } = await admin.from("daily_team_targets").select("id").eq("user_id", person.id).eq("target_date", today).eq("task_name", taskName).maybeSingle();
    if (baseError) return { ok: false, message: baseError.message };
    // Keep the automatic assignment intact. An overlap becomes its own line item
    // rather than overwriting the recurring task's quantity.
    const appendedName = base ? `${taskName.slice(0, 105)} — additional` : taskName;
    const { data: existing, error: existingError } = await admin.from("daily_team_targets").select("id,target_quantity").eq("user_id", person.id).eq("target_date", today).eq("task_name", appendedName).maybeSingle();
    if (existingError) return { ok: false, message: existingError.message };
    tasks.push({ taskName: appendedName, quantity: (existing?.target_quantity ?? 0) + task.quantity, notes: task.notes });
  }

  const normalizedNames = tasks.map((task) => task.taskName.toLocaleLowerCase());
  if (new Set(normalizedNames).size !== normalizedNames.length) return { ok: false, message: "Add each task type once, then save." };
  const { data: saved, error } = await admin.rpc("save_daily_target_batch", { p_actor_id: actor.id, p_user_id: person.id, p_target_date: today, p_tasks: tasks });
  if (error) return { ok: false, message: error.message };
  const { error: auditError } = await admin.from("audit_logs").insert({ actor_id: actor.id, action: "appended_daily_target", target_type: "daily_team_target", target_id: saved?.[0]?.id ?? null, metadata: { userId: person.id, date: today, tasks } });
  if (auditError) return { ok: false, message: auditError.message };
  await createNotification(admin, {
    recipient: person,
    title: "Daily workload updated",
    body: `${actor.name} added to your target for ${today}: ${tasks.map((task) => `${task.taskName} (${task.quantity})`).join(", ")}.`,
  });
  revalidate();
  return { ok: true };
}

export async function saveDailyTarget(input: z.infer<typeof targetInput>) {
  const actor = await requireRole(["admin", "manager"]);
  const parsed = targetInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid target." };
  if (parsed.data.date < dateInTargetTimeZone()) return { ok: false, message: "This assignment is closed because the day has ended." };
  const admin = createSupabaseAdminClient();
  const { data: person, error: personError } = await admin.from("profiles").select("id,name,email,role,active").eq("id", parsed.data.userId).maybeSingle();
  if (personError || !person || !person.active || !["editor", "content_creator"].includes(person.role)) return { ok: false, message: "Choose an active creator or editor." };
  const tasks = parsed.data.tasks.map((task) => ({ ...task, taskName: canonicalTaskName(person.role, task.taskName) }));
  const normalizedNames = tasks.map((task) => task.taskName.toLocaleLowerCase());
  if (new Set(normalizedNames).size !== normalizedNames.length) return { ok: false, message: "Each task in an assignment must be unique." };
  const { data: saved, error } = await admin.rpc("save_daily_target_batch", { p_actor_id: actor.id, p_user_id: parsed.data.userId, p_target_date: parsed.data.date, p_tasks: tasks });
  if (error) return { ok: false, message: error.message };
  await admin.from("audit_logs").insert({ actor_id: actor.id, action: "assigned_daily_target", target_type: "daily_team_target", target_id: saved?.[0]?.id ?? null, metadata: { ...parsed.data, tasks } });
  await createNotification(admin, {
    recipient: person,
    title: "Daily target assigned",
    body: `${actor.name} assigned your target for ${parsed.data.date}: ${tasks.map((task) => `${task.taskName} (${task.quantity})`).join(", ")}.`,
  });
  revalidate();
  return { ok: true, message: undefined };
}

export async function saveDailyProgress(input: z.infer<typeof progressInput>) {
  const actor = await requireProfile();
  const parsed = progressInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid completed-work entry." };
  if (parsed.data.date !== dateInTargetTimeZone()) return { ok: false, message: parsed.data.date > dateInTargetTimeZone() ? "Completed work cannot be logged for a future date." : "This assignment is closed because the day has ended." };
  const reviewer = actor.role === "admin" || actor.role === "manager";
  if (!reviewer && actor.id !== parsed.data.userId) return { ok: false, message: "You can only update your own work." };
  const admin = createSupabaseAdminClient();
  const { data: person, error: personError } = await admin.from("profiles").select("id,role,active").eq("id", parsed.data.userId).maybeSingle();
  if (personError || !person || !person.active || !["editor", "content_creator"].includes(person.role)) return { ok: false, message: "Choose an active creator or editor." };
  const taskName = canonicalTaskName(person.role, parsed.data.taskName);
  const { data: saved, error } = await admin.rpc("save_daily_target_progress", { p_actor_id: actor.id, p_target_id: parsed.data.id ?? null, p_user_id: parsed.data.userId, p_target_date: parsed.data.date, p_task_name: taskName, p_quantity: parsed.data.quantity });
  if (error) return { ok: false, message: error.message };
  await admin.from("audit_logs").insert({ actor_id: actor.id, action: "updated_daily_progress", target_type: "daily_team_target", target_id: saved?.id ?? null, metadata: { ...parsed.data, taskName } });
  revalidate();
  return { ok: true, message: undefined };
}

function revalidate() { revalidatePath("/targets"); revalidatePath("/dashboard"); }

function autoDelegatorMessage(message: string) {
  return message.includes("daily_task_rules") || message.includes("daily_target_day_settings") || message.includes("daily_target_subtractions")
    ? "Auto delegator is awaiting its database migration. The existing target sheet is unaffected; apply the delegator migration to activate recurring assignments."
    : message;
}
