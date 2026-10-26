import { AppShell } from "@/components/app-shell";
import { SetupState } from "@/components/setup-state";
import { requireProfile } from "@/lib/auth";
import { getAppSettings, getNotifications } from "@/lib/data";
import { hasSupabaseEnv } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { customSubmenuKey } from "@/lib/metric-visibility";

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

  const customSubmenus: Array<{ href: string; label: string }> = [];
  const submenuPlacements = Object.entries(settings.campaign_placements ?? {}).filter(([, p]) => p.mode === "submenu");
  if (submenuPlacements.length > 0) {
    try {
      const { data: rows } = await createSupabaseAdminClient()
        .from("incentive_campaigns")
        .select("id, name, active")
        .in("id", submenuPlacements.map(([id]) => id));
      for (const row of rows ?? []) {
        if (!row.active) continue;
        const allowed = settings.campaign_visible_users?.[row.id] ?? [];
        if (profile.role !== "admin" && allowed.length > 0 && !allowed.includes(profile.id)) continue;
        const hiddenForUser = (settings.hidden_campaigns_by_user?.[profile.id] ?? []).map((h) => h.toLowerCase().trim());
        if (profile.role !== "admin" && (hiddenForUser.includes(String(row.id).toLowerCase()) || hiddenForUser.includes(String(row.name ?? "").toLowerCase().trim()))) continue;
        const placement = settings.campaign_placements?.[row.id];
        customSubmenus.push({
          href: `/incentives#${customSubmenuKey(row.id)}`,
          label: placement?.submenu_label?.trim() || row.name
        });
      }
    } catch {
      // Non-fatal: sidebar simply omits custom submenus.
    }
  }

  return (
    <AppShell
      profile={profile}
      notifications={notifications}
      adsPerformanceNavItems={settings.ads_performance_nav_items}
      customSubmenus={customSubmenus}
    >
      {children}
    </AppShell>
  );
}
