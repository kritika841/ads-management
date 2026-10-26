import type { Metadata } from "next";
import { IncentivesDashboard } from "@/components/incentives/incentives-dashboard";
import { requireProfile } from "@/lib/auth";
import { getIncentiveDashboard } from "@/lib/incentive-data";
import { getAppSettings, getProducts, getProfiles } from "@/lib/data";

export const metadata: Metadata = {
  title: "Ads Performance | AdFlow",
  description: "Track ad performance, creative spend, and Meta ad outcomes."
};

export default async function IncentivesPage() {
  const profile = await requireProfile();
  const [dashboard, products, settings, allProfiles] = await Promise.all([
    getIncentiveDashboard(profile),
    getProducts(),
    getAppSettings(),
    profile.role === "admin" ? getProfiles() : Promise.resolve([])
  ]);
  return (
    <IncentivesDashboard
      {...dashboard}
      profile={profile}
      products={products}
      hiddenMetricsByRole={settings.hidden_metrics_by_role}
      managerCreativeScope={settings.manager_creative_scope ?? "all"}
      overviewMetrics={settings.overview_metrics}
      overrideAllUsers={settings.override_all_users}
      usersWithAllAdsAccess={settings.users_with_all_ads_access}
      hiddenCampaignsByUser={settings.hidden_campaigns_by_user}
      hiddenCreativesByUser={settings.hidden_creatives_by_user}
      allowedCreativesByUser={settings.allowed_creatives_by_user}
      campaignVisibleUsers={settings.campaign_visible_users}
      adsPerformanceNavItems={settings.ads_performance_nav_items}
      campaignPlacements={settings.campaign_placements}
      allProfiles={allProfiles}
    />
  );
}

