"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCheck, Inbox } from "lucide-react";
import { markAllNotificationsRead, markNotificationRead } from "@/app/actions/notifications";
import { runServerMutation } from "@/lib/client-action";
import type { Notification } from "@/lib/types";
import { Button } from "@/components/ui/button";

export function NotificationBell({
  notifications,
  children
}: {
  notifications: Notification[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [locallyRead, setLocallyRead] = useState(() => new Set<string>());
  const [isPending, startTransition] = useTransition();
  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => !notification.read_at && !locallyRead.has(notification.id)),
    [locallyRead, notifications]
  );
  const unreadCount = unreadNotifications.length;
  const prevUnreadCount = useRef(unreadCount);

  useEffect(() => {
    if (unreadCount > prevUnreadCount.current) {
      playChime();
    }
    prevUnreadCount.current = unreadCount;
  }, [unreadCount]);

  function markOneRead(id: string) {
    setLocallyRead((current) => new Set(current).add(id));
    startTransition(async () => { await runServerMutation(() => markNotificationRead(id)); });
  }

  function markAllRead() {
    setLocallyRead(new Set(notifications.map((notification) => notification.id)));
    startTransition(async () => { await runServerMutation(() => markAllNotificationsRead()); });
  }

  return (
    <div className="relative">
      <Button variant="ghost" size="icon" className="relative" onClick={() => setOpen((value) => !value)} title="Notifications" aria-label="Notifications" aria-expanded={open}>
        {children}
        {unreadCount ? (
          <span className="absolute right-0.5 top-0.5 flex min-w-4 h-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white ring-2 ring-card">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div className="absolute right-0 top-12 z-50 w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-border bg-card shadow-float dark:shadow-none">
          <div className="flex h-12 items-center justify-between border-b border-border px-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Notifications</p>
              {unreadCount ? <p className="text-[11px] text-muted-foreground">{unreadCount} unread</p> : null}
            </div>
            {unreadCount ? (
              <button className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary disabled:opacity-50" disabled={isPending} onClick={markAllRead}>
                <CheckCheck className="size-3.5" aria-hidden />
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-[420px] overflow-y-auto p-2">
            {notifications.length ? (
              notifications.map((notification) => {
                const unread = !notification.read_at && !locallyRead.has(notification.id);
                return (
                  <Link
                    key={notification.id}
                    href={notification.ad_id ? `/ads/${notification.ad_id}` : "/dashboard"}
                    onClick={() => { setOpen(false); if (unread) markOneRead(notification.id); }}
                    className={`relative block rounded-md px-3 py-2.5 transition hover:bg-muted ${unread ? "bg-accent/60" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-foreground">{notification.title}</p>
                      <span suppressHydrationWarning className="shrink-0 text-[10px] text-muted-foreground">{relativeTime(notification.created_at)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 pr-3 text-xs leading-5 text-muted-foreground">{notification.body}</p>
                    {unread ? <span className="absolute bottom-3 right-3 size-1.5 rounded-full bg-primary" /> : null}
                  </Link>
                );
              })
            ) : (
              <div className="flex flex-col items-center px-3 py-10 text-center"><span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Inbox className="size-4" aria-hidden /></span><p className="mt-3 text-sm font-medium text-muted-foreground">All caught up</p><p className="mt-1 text-xs text-muted-foreground">No notifications yet.</p></div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function relativeTime(value: string) {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

let sharedAudioCtx: AudioContext | null = null;

function playChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    
    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioContextClass();
    }
    
    // Attempt to resume if suspended (e.g. autoplay policy restrictions)
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }

    const t = sharedAudioCtx.currentTime + 0.05; // Add slight delay for scheduling safety
    const osc = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(sharedAudioCtx.destination);
    
    osc.type = "sine";
    // Play a pleasant double chime (C6 then E6)
    osc.frequency.setValueAtTime(1046.50, t); // C6
    osc.frequency.setValueAtTime(1318.51, t + 0.1); // E6
    
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.05);
    gain.gain.linearRampToValueAtTime(0, t + 0.3);
    
    osc.start(t);
    osc.stop(t + 0.3);
  } catch (e) {
    console.error("Audio chime error:", e);
  }
}
