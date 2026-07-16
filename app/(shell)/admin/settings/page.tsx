import { SettingsClient } from "@/components/admin/settings-client";
import { requireRole } from "@/lib/auth";
import { getAppSettings, getAuditLogs, getCampaigns } from "@/lib/data";

export default async function AdminSettingsPage() {
  await requireRole(["admin"]);
  const [settings, campaigns, auditLogs] = await Promise.all([
    getAppSettings(),
    getCampaigns(),
    getAuditLogs()
  ]);

  return <SettingsClient settings={settings} campaigns={campaigns} auditLogs={auditLogs} />;
}
