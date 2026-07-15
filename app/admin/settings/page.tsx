import { AppShell } from "@/components/app-shell";
import { SettingsClient } from "@/components/admin/settings-client";
import { SetupState } from "@/components/setup-state";
import { requireRole } from "@/lib/auth";
import { getAppSettings, getAuditLogs, getCampaigns, getNotifications } from "@/lib/data";
import { hasSupabaseEnv } from "@/lib/supabase/server";

export default async function AdminSettingsPage() {
  if (!hasSupabaseEnv()) {
    return <SetupState />;
  }

  const profile = await requireRole(["admin"]);
  const [settings, campaigns, notifications, auditLogs] = await Promise.all([
    getAppSettings(),
    getCampaigns(),
    getNotifications(profile.id),
    getAuditLogs()
  ]);

  return (
    <AppShell profile={profile} notifications={notifications}>
      <SettingsClient settings={settings} campaigns={campaigns} auditLogs={auditLogs} />
    </AppShell>
  );
}
