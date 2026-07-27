import { AdminUsersClient } from "@/components/admin/admin-users-client";
import { requireRole } from "@/lib/auth";
import { getAds, getAllChangesRequestedLogs, getAllEditorTimeLogs, getProfiles } from "@/lib/data";

export default async function AdminUsersPage() {
  const profile = await requireRole(["admin"]);
  const [profiles, ads, timeLogs, activityLogs] = await Promise.all([
    getProfiles(),
    getAds(),
    getAllEditorTimeLogs(),
    getAllChangesRequestedLogs(),
  ]);

  return <AdminUsersClient profiles={profiles} ads={ads} timeLogs={timeLogs} activityLogs={activityLogs} currentProfileId={profile.id} />;
}

