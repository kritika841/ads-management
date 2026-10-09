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
      profile={profile}
      products={products}
      hiddenMetricsByRole={settings.hidden_metrics_by_role}
      managerCreativeScope={settings.manager_creative_scope ?? "all"}
      overviewMetrics={settings.overview_metrics}
      overrideAllUsers={settings.override_all_users}
      usersWithAllAdsAccess={settings.users_with_all_ads_access}
      hiddenCampaignsByUser={settings.hidden_campaigns_by_user}
      allProfiles={allProfiles}
      {...dashboard}
    />
  );
}

