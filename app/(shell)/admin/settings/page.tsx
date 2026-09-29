import { SettingsClient } from "@/components/admin/settings-client";
import { requireRole } from "@/lib/auth";
import { getAppSettings, getAuditLogs, getCampaigns } from "@/lib/data";
import { getDownloadLogs } from "@/lib/download-logs";
import { getAnnouncementsWithStats } from "@/app/actions/announcements";
import { getAllUsersPasswordSecurityStatus } from "@/lib/password-security";

export default async function AdminSettingsPage() {
  const profile = await requireRole(["admin"]);
  const [settings, campaigns, auditLogs, downloadLogs, announcementsData, passwordStatuses] = await Promise.all([
    getAppSettings(),
    getCampaigns(),
    getAuditLogs(),
    getDownloadLogs().catch(() => []),
    getAnnouncementsWithStats().catch(() => ({ ok: true, announcements: [], allProfiles: [] })),
    getAllUsersPasswordSecurityStatus().catch(() => [])
  ]);

  return (
    <SettingsClient
      settings={settings}
      campaigns={campaigns}
      auditLogs={auditLogs}
      downloadLogs={downloadLogs}
      announcements={announcementsData.announcements}
      allProfiles={announcementsData.allProfiles}
      passwordStatuses={passwordStatuses}
      profile={profile}
    />
  );
}

