"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

export async function savePushSubscription(subscription: PushSubscriptionJSON) {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const { endpoint, keys } = subscription;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new Error("Invalid push subscription");
  }

  // Use upsert or insert to handle duplicates (we have a UNIQUE constraint on endpoint)
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: profile.id,
        endpoint: endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      { onConflict: "endpoint" }
    );

  if (error) {
    console.error("[Push] Error saving subscription:", error);
    throw new Error("Failed to save push subscription");
  }

  return { success: true };
}
