import type { Profile } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function createNotification(
  supabase: SupabaseClient,
  params: {
    recipient: Pick<Profile, "id" | "email">;
    adId?: string | null;
    title: string;
    body: string;
  }
) {
  await supabase.from("notifications").insert({
    user_id: params.recipient.id,
    ad_id: params.adId ?? null,
    title: params.title,
    body: params.body
  });
}
