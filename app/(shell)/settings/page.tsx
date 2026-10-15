import { requireProfile } from "@/lib/auth";
import { getUserPasswordStatus } from "@/lib/password-security";
import { UserSettingsClient } from "@/components/settings/user-settings-client";
import { getDownloadLogs } from "@/lib/download-logs";
import { getRetentionSettings } from "@/lib/retention-settings";

export const metadata = {
  title: "Settings - AdFlow",
  description: "Manage your AdFlow account credentials, password security, and download logs."
};

export default async function SettingsPage() {
  const profile = await requireProfile();
  const passwordStatus = await getUserPasswordStatus(profile.id, profile.created_at);
  const allLogs = await getDownloadLogs();
  const userLogs = profile.role === "admin" ? allLogs : allLogs.filter((log) => log.user_id === profile.id);
  const retentionSettings = await getRetentionSettings();

  return (
    <UserSettingsClient
      profile={profile}
      initialStatus={passwordStatus}
      downloadLogs={userLogs}
      retentionDays={retentionSettings.downloadDays}
    />
  );
}
