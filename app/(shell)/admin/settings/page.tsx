import { SettingsClient } from "@/components/admin/settings-client";
import { requireRole } from "@/lib/auth";
import { getAppSettings, getAuditLogs, getCampaigns } from "@/lib/data";
import { getDownloadLogs } from "@/lib/download-logs";

export default async function AdminSettingsPage() {
  await requireRole(["admin"]);
  const [settings, campaigns, auditLogs, downloadLogs] = await Promise.all([
    getAppSettings(),
    getCampaigns(),
    getAuditLogs(),
    getDownloadLogs().catch(() => [])
  ]);

  return (
    <SettingsClient
      settings={settings}
      campaigns={campaigns}
      auditLogs={auditLogs}
      downloadLogs={downloadLogs}
    />
  );
}
