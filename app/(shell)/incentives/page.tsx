import type { Metadata } from "next";
import { IncentivesDashboard } from "@/components/incentives/incentives-dashboard";
import { requireProfile } from "@/lib/auth";
import { getIncentiveDashboard } from "@/lib/incentive-data";
import { getAppSettings, getProducts } from "@/lib/data";

export const metadata: Metadata = {
  title: "Ads Performance | AdFlow",
  description: "Track ad performance, creative spend, and Meta ad outcomes."
};

export default async function IncentivesPage() {
  const profile = await requireProfile();
  const [dashboard, products, settings] = await Promise.all([
    getIncentiveDashboard(profile),
    getProducts(),
    getAppSettings()
  ]);
  return (
    <IncentivesDashboard
      profile={profile}
      products={products}
      hiddenMetricsByRole={settings.hidden_metrics_by_role}
      {...dashboard}
    />
  );
}

