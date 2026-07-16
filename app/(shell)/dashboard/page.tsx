import { AppShell } from "@/components/app-shell";
import { HomeDashboard } from "@/components/dashboard/home-dashboard";
import { SetupState } from "@/components/setup-state";
import { requireProfile } from "@/lib/auth";
import { getAds, getAppSettings, getEditorWorkloads, getNotifications, getProfiles } from "@/lib/data";
import { buildDashboardSummary } from "@/lib/dashboard-summary";
import { hasSupabaseEnv } from "@/lib/supabase/server";

export default async function DashboardPage() {
  if (!hasSupabaseEnv()) {
    return <SetupState />;
  }

  const profile = await requireProfile();
  const [ads, profiles, notifications, editorWorkloads, settings] = await Promise.all([getAds(), getProfiles(), getNotifications(profile.id), getEditorWorkloads(), getAppSettings()]);
  const model = buildDashboardSummary({ role: profile.role, ads, profiles, editorWorkloads, editorCapacity: settings.max_concurrent_edits });

  return (
    <AppShell profile={profile} notifications={notifications}>
      <HomeDashboard model={model} />
    </AppShell>
  );
}
