import { requireProfile } from "@/lib/auth";
import { getUserPasswordStatus } from "@/lib/password-security";
import { UserSettingsClient } from "@/components/settings/user-settings-client";

export const metadata = {
  title: "Account Settings - AdFlow",
  description: "Manage your AdFlow account credentials and password security."
};

export default async function SettingsPage() {
  const profile = await requireProfile();
  const passwordStatus = await getUserPasswordStatus(profile.id, profile.created_at);

  return <UserSettingsClient profile={profile} initialStatus={passwordStatus} />;
}
