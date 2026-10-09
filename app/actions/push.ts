"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";

export async function savePushSubscription(subscription: PushSubscriptionJSON) {
  try {
    const profile = await requireProfile();
    const supabase = createSupabaseAdminClient();

    const { endpoint, keys } = subscription;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return { success: false, error: "Invalid push subscription" };
    }

    // Use upsert to handle duplicates (we have a UNIQUE constraint on endpoint)
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
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    console.warn("[Push] Error saving subscription:", message || err);
    return { success: false, error: message || "Failed to save push subscription" };
  }
}
