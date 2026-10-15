import { AppShell } from "@/components/app-shell";
import { SetupState } from "@/components/setup-state";
import { requireProfile } from "@/lib/auth";
import { getAppSettings, getNotifications } from "@/lib/data";
import { hasSupabaseEnv } from "@/lib/supabase/server";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  if (!hasSupabaseEnv()) return <SetupState />;

  const [profile, settings] = await Promise.all([
    requireProfile(),
    getAppSettings()
  ]);

  if (profile.role !== "admin") {
    try {
      const { recordActivityTouch } = await import("@/lib/attendance");
      await recordActivityTouch(profile.id, profile.role, Date.now(), profile.name);
    } catch {
      // Non-fatal
    }
  }

  const notifications = await getNotifications(profile.id);

  return (
    <AppShell
      profile={profile}
      notifications={notifications}
      adsPerformanceNavItems={settings.ads_performance_nav_items}
    >
      {children}
    </AppShell>
  );
}
