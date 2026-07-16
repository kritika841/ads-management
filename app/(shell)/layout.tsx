import { AppShell } from "@/components/app-shell";
import { SetupState } from "@/components/setup-state";
import { requireProfile } from "@/lib/auth";
import { getNotifications } from "@/lib/data";
import { hasSupabaseEnv } from "@/lib/supabase/server";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  if (!hasSupabaseEnv()) return <SetupState />;

  const profile = await requireProfile();
  const notifications = await getNotifications(profile.id);

  return <AppShell profile={profile} notifications={notifications}>{children}</AppShell>;
}
