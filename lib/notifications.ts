import type { Profile } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import webPush from "web-push";

let webPushConfigured = false;
function configureWebPush() {
  if (webPushConfigured) return;
  try {
    webPush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:admin@example.com",
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );
    webPushConfigured = true;
  } catch (e) {
    console.warn("[WebPush] Could not configure web push:", e);
  }
}

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

  // Try to send Web Push directly to the recipient's registered devices
  try {
    configureWebPush();
    if (!webPushConfigured) return;

    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", params.recipient.id);

    if (subscriptions && subscriptions.length > 0) {
      const pushPayload = JSON.stringify({
        title: params.title,
        body: params.body,
        adId: params.adId ?? null,
      });

      await Promise.all(subscriptions.map(async (sub) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };
        try {
          await webPush.sendNotification(pushSubscription, pushPayload);
        } catch (e: unknown) {
          const err = e as { statusCode?: number };
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          }
        }
      }));
    }
  } catch (e) {
    console.error("[WebPush] Failed to send push notification:", e);
  }
}
