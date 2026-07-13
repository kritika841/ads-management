import { AppShell } from "@/components/app-shell";
import { SettingsClient } from "@/components/admin/settings-client";
import { SetupState } from "@/components/setup-state";
import { requireRole } from "@/lib/auth";
import { getAppSettings, getCampaigns, getNotifications } from "@/lib/data";
import { hasSupabaseEnv } from "@/lib/supabase/server";

export default async function AdminSettingsPage() {
  if (!hasSupabaseEnv()) {
    return <SetupState />;
  }

  const profile = await requireRole(["admin"]);
  const [settings, campaigns, notifications] = await Promise.all([
    getAppSettings(),
    getCampaigns(),
    getNotifications(profile.id)
  ]);

  return (
    <AppShell profile={profile} notifications={notifications}>
      <SettingsClient settings={settings} campaigns={campaigns} />
    </AppShell>
  );
}
