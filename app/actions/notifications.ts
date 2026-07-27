"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

export async function markNotificationRead(notificationId: string) {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", profile.id);

  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead() {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", profile.id)
    .is("read_at", null);

  revalidatePath("/", "layout");
}

export async function clearAllNotifications() {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();

  await supabase
    .from("notifications")
    .delete()
    .eq("user_id", profile.id);

  revalidatePath("/", "layout");
}
