import { SettingsClient } from "@/components/admin/settings-client";
import { requireRole } from "@/lib/auth";
import { getAppSettings, getAuditLogs, getCampaigns } from "@/lib/data";
import { getDownloadLogs } from "@/lib/download-logs";
import { getAnnouncementsWithStats } from "@/app/actions/announcements";
import { getAllUsersPasswordSecurityStatus } from "@/lib/password-security";
import { listRecycleBin, purgeExpiredRecycleBin, type RecycleBinSnapshot } from "@/lib/recycle-bin";

async function loadRecycleBin(): Promise<RecycleBinSnapshot | null> {
  try {
    await purgeExpiredRecycleBin().catch(() => undefined);
    return await listRecycleBin();
  } catch {
    return null;
  }
}

export default async function AdminSettingsPage() {
  const profile = await requireRole(["admin"]);
  const [settings, campaigns, auditLogs, downloadLogs, announcementsData, passwordStatuses, recycleBin] = await Promise.all([
    getAppSettings(),
    getCampaigns(),
    getAuditLogs(),
    getDownloadLogs().catch(() => []),
    getAnnouncementsWithStats().catch(() => ({ ok: true, announcements: [], allProfiles: [] })),
    getAllUsersPasswordSecurityStatus().catch(() => []),
    loadRecycleBin()
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
      recycleBin={recycleBin ?? undefined}
      profile={profile}
    />
  );
}

