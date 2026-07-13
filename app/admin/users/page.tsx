import { AppShell } from "@/components/app-shell";
import { AdminUsersClient } from "@/components/admin/admin-users-client";
import { SetupState } from "@/components/setup-state";
import { requireRole } from "@/lib/auth";
import { getAds, getNotifications, getProfiles } from "@/lib/data";
import { hasSupabaseEnv } from "@/lib/supabase/server";

export default async function AdminUsersPage() {
  if (!hasSupabaseEnv()) {
    return <SetupState />;
  }

  const profile = await requireRole(["admin"]);
  const [profiles, ads, notifications] = await Promise.all([
    getProfiles(),
    getAds(),
    getNotifications(profile.id)
  ]);

  return (
    <AppShell profile={profile} notifications={notifications}>
      <AdminUsersClient profiles={profiles} ads={ads} currentProfileId={profile.id} />
    </AppShell>
  );
}
