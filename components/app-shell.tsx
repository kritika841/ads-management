"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  Bell,
  House,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  ShieldCheck,
  Users,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Notification, Profile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { NotificationBell } from "@/components/notification-bell";
import { RealtimeSync } from "@/components/realtime-sync";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

export function AppShell({
  profile,
  notifications,
  children
}: {
  profile: Profile;
  notifications: Notification[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const workspaceLinks: NavItem[] = [
    { href: "/dashboard", label: "Home", icon: House },
    { href: "/library", label: "Creative library", icon: LayoutDashboard },
    ...(profile.role === "admin" || profile.role === "manager"
      ? [{ href: "/analytics", label: "Analytics", icon: BarChart3 }]
      : [])
  ];
  const adminLinks: NavItem[] =
    profile.role === "admin"
      ? [
          { href: "/admin/users", label: "People", icon: Users },
          { href: "/admin/products", label: "Products", icon: Package },
          { href: "/admin/settings", label: "Settings", icon: Settings },
          { href: "/admin/audit", label: "Audit log", icon: ShieldCheck }
        ]
      : [];
  const pageTitle = [...workspaceLinks, ...adminLinks].find((item) => isActivePath(pathname, item.href))?.label ??
    (pathname.startsWith("/ads/") ? "Ad review" : "AdFlow");

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] border-r border-border bg-card text-card-foreground lg:flex lg:flex-col">
        <SidebarContent
          profile={profile}
          pathname={pathname}
          workspaceLinks={workspaceLinks}
          adminLinks={adminLinks}
        />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="absolute inset-0 bg-neutral-950/35 backdrop-blur-[2px]"
            aria-label="Dismiss navigation"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-[min(288px,86vw)] flex-col border-r border-border bg-card text-card-foreground shadow-2xl">
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-3 top-3 z-10"
              title="Close navigation"
              onClick={() => setMobileOpen(false)}
            >
              <X className="size-5" aria-hidden />
            </Button>
            <SidebarContent
              profile={profile}
              pathname={pathname}
              workspaceLinks={workspaceLinks}
              adminLinks={adminLinks}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 h-16 border-b border-border/90 bg-card/95 text-card-foreground backdrop-blur">
          <div className="flex h-full items-center justify-between gap-4 px-4 lg:px-7">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                size="icon"
                variant="ghost"
                className="lg:hidden"
                title="Open navigation"
                onClick={() => setMobileOpen(true)}
              >
                <Menu className="size-5" aria-hidden />
              </Button>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{pageTitle}</p>
                <p className="hidden text-xs text-muted-foreground sm:block">{roleLabel(profile.role)} workspace</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <ThemeToggle />
              <RealtimeSync userId={profile.id} role={profile.role} />
              <NotificationBell notifications={notifications}>
                <Bell className="size-[18px]" aria-hidden />
              </NotificationBell>
              <div className="ml-1 flex items-center gap-2 rounded-md border border-border bg-card py-1 pl-1 pr-2">
                <Avatar name={profile.name} src={profile.avatar_url} className="size-8" />
                <div className="hidden min-w-0 leading-tight sm:block">
                  <div className="max-w-40 truncate text-sm font-medium text-foreground">{profile.name}</div>
                  <div className="max-w-40 truncate text-xs text-muted-foreground">{profile.email}</div>
                </div>
              </div>
            </div>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function SidebarContent({
  profile,
  pathname,
  workspaceLinks,
  adminLinks,
  onNavigate
}: {
  profile: Profile;
  pathname: string;
  workspaceLinks: NavItem[];
  adminLinks: NavItem[];
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="flex h-20 items-center border-b border-border px-5">
        <Link href="/dashboard" className="flex items-center gap-3" onClick={onNavigate}>
          <span className="flex size-10 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground shadow-sm">
            AF
          </span>
          <span className="min-w-0">
            <span className="block text-[17px] font-semibold leading-tight text-foreground">AdFlow</span>
            <span className="block text-xs text-muted-foreground">Creative operations</span>
          </span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-5">
        <NavGroup label="Workspace" items={workspaceLinks} pathname={pathname} onNavigate={onNavigate} />
        {adminLinks.length ? (
          <div className="mt-7">
            <NavGroup label="Administration" items={adminLinks} pathname={pathname} onNavigate={onNavigate} />
          </div>
        ) : null}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-md bg-muted p-2">
          <Avatar name={profile.name} src={profile.avatar_url} className="size-9" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium text-foreground">{profile.name}</p>
            <p className="truncate text-xs text-muted-foreground">{roleLabel(profile.role)}</p>
          </div>
          <form action="/auth/signout" method="post">
            <Button variant="ghost" size="icon" className="size-9" title="Sign out" type="submit">
              <LogOut className="size-4" aria-hidden />
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}

function NavGroup({
  label,
  items,
  pathname,
  onNavigate
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label={label}>
      <p className="px-3 text-[11px] font-semibold uppercase text-muted-foreground">{label}</p>
      <div className="mt-2 space-y-1">
        {items.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition",
                active
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className={cn("size-[18px]", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
}

function roleLabel(role: Profile["role"]) {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
