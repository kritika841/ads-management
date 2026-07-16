import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { requireRole } from "@/lib/auth";
import { buildOperationalAnalytics, resolveAnalyticsFilters, type AnalyticsFilterInput } from "@/lib/analytics";
import { getAllAdsForAnalytics, getAnalyticsActivityLogs, getAnalyticsReviewActions, getAppSettings, getCampaigns, getProducts, getProfiles } from "@/lib/data";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<AnalyticsFilterInput> }) {
  const [profile, query] = await Promise.all([requireRole(["admin", "manager"]), searchParams]);
  const [ads, profiles, products, campaigns, activities, reviews, settings] = await Promise.all([
    getAllAdsForAnalytics(),
    getProfiles(),
    getProducts(),
    getCampaigns(),
    getAnalyticsActivityLogs(),
    getAnalyticsReviewActions(),
    getAppSettings()
  ]);
  const model = buildOperationalAnalytics({ ads, profiles, activities, reviews, settings, filters: resolveAnalyticsFilters(query) });

  return <AnalyticsDashboard model={model} profile={profile} products={products} campaigns={campaigns} profiles={profiles} />;
}
