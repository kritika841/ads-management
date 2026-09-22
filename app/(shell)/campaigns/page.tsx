import { requireProfile } from "@/lib/auth";
import { getCampaignsWithOverview } from "@/lib/data";
import { CampaignsDashboardClient } from "@/components/campaigns/campaigns-dashboard-client";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const [profile, campaignOverviews] = await Promise.all([
    requireProfile(),
    getCampaignsWithOverview()
  ]);

  return (
    <CampaignsDashboardClient
      profile={profile}
      campaignOverviews={campaignOverviews}
    />
  );
}
