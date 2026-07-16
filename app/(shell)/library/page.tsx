import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { requireProfile } from "@/lib/auth";
import { getAds, getCampaigns, getEditorWorkloads, getProducts, getProfiles, getTags } from "@/lib/data";
import { createMediaAccessToken } from "@/lib/media-token";
import { queueForRole, queuesForRole } from "@/lib/work-queues";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ queue?: string | string[] }> }) {
  const [profile, query] = await Promise.all([requireProfile(), searchParams]);
  const requestedQueue = Array.isArray(query.queue) ? query.queue[0] : query.queue;
  const initialQueue = queueForRole(profile.role, requestedQueue) ?? queuesForRole(profile.role)[0].key;
  const [ads, campaigns, products, profiles, tags, editorWorkloads] = await Promise.all([
    getAds(), getCampaigns(), getProducts(), getProfiles(), getTags(), getEditorWorkloads()
  ]);

  const mediaTokens = Object.fromEntries(
    ads.flatMap((ad) => ad.drive_file_id ? [[ad.id, createMediaAccessToken(ad.id, ad.drive_file_id)]] : [])
  );

  return <DashboardClient profile={profile} ads={ads} campaigns={campaigns} products={products} profiles={profiles} availableTags={tags} editorWorkloads={editorWorkloads} initialQueue={initialQueue} mediaTokens={mediaTokens} />;
}
