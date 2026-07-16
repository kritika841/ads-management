import { HomeDashboard } from "@/components/dashboard/home-dashboard";
import { requireProfile } from "@/lib/auth";
import { getAds, getAppSettings, getEditorWorkloads, getProfiles } from "@/lib/data";
import { buildDashboardSummary } from "@/lib/dashboard-summary";

export default async function DashboardPage() {
  const profile = await requireProfile();
  const [ads, profiles, editorWorkloads, settings] = await Promise.all([getAds(), getProfiles(), getEditorWorkloads(), getAppSettings()]);
  const model = buildDashboardSummary({ role: profile.role, ads, profiles, editorWorkloads, editorCapacity: settings.max_concurrent_edits });

  return <HomeDashboard model={model} />;
}
