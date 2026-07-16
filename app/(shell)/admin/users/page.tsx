import { AdminUsersClient } from "@/components/admin/admin-users-client";
import { requireRole } from "@/lib/auth";
import { getAds, getProfiles } from "@/lib/data";

export default async function AdminUsersPage() {
  const profile = await requireRole(["admin"]);
  const [profiles, ads] = await Promise.all([
    getProfiles(),
    getAds()
  ]);

  return <AdminUsersClient profiles={profiles} ads={ads} currentProfileId={profile.id} />;
}
