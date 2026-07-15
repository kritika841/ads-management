import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deadlineActiveStatuses, indiaDateString, indiaDayStartIso } from "@/lib/deadlines";
import { createNotification } from "@/lib/notifications";
import type { AppSettings, Profile } from "@/lib/types";

export async function GET(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) {
    return NextResponse.json({ error: "Deadline reminders are not configured." }, { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  const suppliedSecret = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  if (suppliedSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data: settings, error: settingsError } = await admin.from("app_settings").select("*").eq("id", 1).single();
  if (settingsError || !settings) {
    return NextResponse.json({ error: settingsError?.message ?? "Application settings are missing." }, { status: 500 });
  }
  const appSettings = settings as AppSettings;
  const now = new Date();
  const limitDate = indiaDateString(now, appSettings.deadline_reminder_days);

  const { data: ads, error } = await admin
    .from("ads")
    .select("*, creator:profiles!ads_creator_id_fkey(*), editor:profiles!ads_editor_id_fkey(*)")
    .not("deadline", "is", null)
    .lte("deadline", limitDate)
    .in("status", deadlineActiveStatuses);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const dueAds = ads ?? [];
  const { data: existingNotifications } = dueAds.length
    ? await admin
        .from("notifications")
        .select("user_id,ad_id")
        .in("title", ["Deadline approaching", "Deadline overdue"])
        .gte("created_at", indiaDayStartIso(now))
        .in("ad_id", dueAds.map((ad) => ad.id))
    : { data: [] };
  const alreadyNotified = new Set(
    (existingNotifications ?? []).map((notification) => `${notification.user_id}:${notification.ad_id}`)
  );
  let notified = 0;

  for (const ad of dueAds) {
    const recipients = [ad.creator, ad.editor].filter(
      (recipient): recipient is Profile => Boolean(recipient?.active)
    );
    const uniqueRecipients = Array.from(new Map(recipients.map((recipient) => [recipient.id, recipient])).values());

    for (const recipient of uniqueRecipients) {
      const notificationKey = `${recipient.id}:${ad.id}`;
      if (alreadyNotified.has(notificationKey)) {
        continue;
      }

      await createNotification(admin, {
        recipient,
        adId: ad.id,
        title: ad.deadline < indiaDateString(now) ? "Deadline overdue" : "Deadline approaching",
        body: ad.deadline < indiaDateString(now) ? `${ad.name} was due on ${ad.deadline}.` : `${ad.name} is due by ${ad.deadline}.`
      });
      alreadyNotified.add(notificationKey);
      notified += 1;
    }
  }

  return NextResponse.json({ notified });
}
