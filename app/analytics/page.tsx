import { AppShell } from "@/components/app-shell";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { SetupState } from "@/components/setup-state";
import { requireRole } from "@/lib/auth";
import { buildOperationalAnalytics, resolveAnalyticsFilters, type AnalyticsFilterInput } from "@/lib/analytics";
import { getAllAdsForAnalytics, getAnalyticsActivityLogs, getAnalyticsReviewActions, getAppSettings, getCampaigns, getNotifications, getProducts, getProfiles } from "@/lib/data";
import { hasSupabaseEnv } from "@/lib/supabase/server";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<AnalyticsFilterInput> }) {
  if (!hasSupabaseEnv()) {
    return <SetupState />;
  }

  const [profile, query] = await Promise.all([requireRole(["admin", "manager"]), searchParams]);
  const [ads, profiles, products, campaigns, activities, reviews, settings, notifications] = await Promise.all([
    getAllAdsForAnalytics(),
    getProfiles(),
    getProducts(),
    getCampaigns(),
    getAnalyticsActivityLogs(),
    getAnalyticsReviewActions(),
    getAppSettings(),
    getNotifications(profile.id)
  ]);
  const model = buildOperationalAnalytics({ ads, profiles, activities, reviews, settings, filters: resolveAnalyticsFilters(query) });

  return (
    <AppShell profile={profile} notifications={notifications}>
      <AnalyticsDashboard model={model} profile={profile} products={products} campaigns={campaigns} profiles={profiles} />
    </AppShell>
  );
}
