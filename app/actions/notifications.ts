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

  revalidatePath("/dashboard");
  revalidatePath("/library");
}

export async function markAllNotificationsRead() {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", profile.id)
    .is("read_at", null);

  revalidatePath("/dashboard");
  revalidatePath("/library");
  revalidatePath("/analytics");
  revalidatePath("/admin/users");
  revalidatePath("/admin/settings");
  revalidatePath("/admin/audit");
}
