import { AppShell } from "@/components/app-shell";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { SetupState } from "@/components/setup-state";
import { requireProfile } from "@/lib/auth";
import { getAds, getCampaigns, getEditorWorkloads, getNotifications, getProducts, getProfiles, getTags } from "@/lib/data";
import { hasSupabaseEnv } from "@/lib/supabase/server";
import { createMediaAccessToken } from "@/lib/media-token";
import { queueForRole, queuesForRole } from "@/lib/work-queues";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ queue?: string | string[] }> }) {
  if (!hasSupabaseEnv()) return <SetupState />;

  const [profile, query] = await Promise.all([requireProfile(), searchParams]);
  const requestedQueue = Array.isArray(query.queue) ? query.queue[0] : query.queue;
  const initialQueue = queueForRole(profile.role, requestedQueue) ?? queuesForRole(profile.role)[0].key;
  const [ads, campaigns, products, profiles, tags, notifications, editorWorkloads] = await Promise.all([
    getAds(), getCampaigns(), getProducts(), getProfiles(), getTags(), getNotifications(profile.id), getEditorWorkloads()
  ]);

  const mediaTokens = Object.fromEntries(
    ads.flatMap((ad) => ad.drive_file_id ? [[ad.id, createMediaAccessToken(ad.id, ad.drive_file_id)]] : [])
  );

  return <AppShell profile={profile} notifications={notifications}><DashboardClient profile={profile} ads={ads} campaigns={campaigns} products={products} profiles={profiles} availableTags={tags} editorWorkloads={editorWorkloads} initialQueue={initialQueue} mediaTokens={mediaTokens} /></AppShell>;
}
