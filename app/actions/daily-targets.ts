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

export async function saveDailyTarget(input: z.infer<typeof targetInput>) {
  const actor = await requireRole(["admin", "manager"]);
  const parsed = targetInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid target." };
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
  if (parsed.data.date > dateInTargetTimeZone()) return { ok: false, message: "Completed work cannot be logged for a future date." };
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
