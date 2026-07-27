"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCheck, Inbox } from "lucide-react";
import { clearAllNotifications, markAllNotificationsRead, markNotificationRead } from "@/app/actions/notifications";
import { savePushSubscription } from "@/app/actions/push";
import { runServerMutation } from "@/lib/client-action";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Notification } from "@/lib/types";
import { Button } from "@/components/ui/button";

export function NotificationBell({
  notifications: initialNotifications,
  userId,
  children
}: {
  notifications: Notification[];
  userId: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [locallyRead, setLocallyRead] = useState(() => new Set<string>());
  const [realtimeNotifs, setRealtimeNotifs] = useState<Notification[]>([]);
  const [clearedAt, setClearedAt] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const missedChimes = useRef(0);
  const notifPermission = useRef<NotificationPermission | null>(null);
  const chimeAudioRef = useRef<HTMLAudioElement | null>(null);
  const prevUnreadCount = useRef(0);

  const notifications = useMemo(() => {
    const map = new Map<string, Notification>();
    for (const n of initialNotifications) map.set(n.id, n);
    for (const n of realtimeNotifs) map.set(n.id, n);
    let merged = Array.from(map.values());
    if (clearedAt) {
      merged = merged.filter(n => new Date(n.created_at).getTime() > clearedAt);
    }
    return merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [initialNotifications, realtimeNotifs, clearedAt]);

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.read_at && !locallyRead.has(n.id)),
    [locallyRead, notifications]
  );
  const unreadCount = unreadNotifications.length;

  // ── Reuses the single <audio> element unlocked on first user gesture.
  // A freshly-constructed Audio() called later (e.g. from a realtime event
  // while the tab is inactive) gets silently blocked by autoplay policy —
  // that's why notifications arrived with no sound. This element was
  // already "blessed" during a real click, so it's allowed to play anytime,
  // including in a background/inactive tab.
  function playChime() {
    const audio = chimeAudioRef.current;
    if (!audio) {
      console.warn("[AdFlow] playChime: audio not unlocked yet (no user gesture has happened)");
      return;
    }
    audio.currentTime = 0;
    audio.play().catch((e: Error) => {
      console.warn("[AdFlow] playChime failed:", e.name, e.message);
    });
  }

  // ── OS notification (system sound, works even in background)
  function fireOsNotification(title: string, body: string) {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    try {
      new Notification(title, { body, icon: "/favicon.ico", silent: false });
    } catch {
      // ignore
    }
  }

  // ── On first click: request OS notification permission AND unlock audio.
  // Playing (then immediately pausing) inside this real gesture is what
  // lets THIS SAME element autoplay later without another gesture.
  // We ALSO start an ultrasonic WebAudio oscillator to prevent the browser
  // from putting the tab to sleep in the background.
  useEffect(() => {
    let wakeContext: AudioContext | null = null;
    let wakeOsc: OscillatorNode | null = null;

    async function setupPushSubscription() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      try {
        const swReg = await navigator.serviceWorker.register("/sw.js");
        
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (vapidKey) {
          const padding = "=".repeat((4 - vapidKey.length % 4) % 4);
          const base64 = (vapidKey + padding).replace(/-/g, "+").replace(/_/g, "/");
          const rawData = window.atob(base64);
          const outputArray = new Uint8Array(rawData.length);
          for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
          }

          const subscription = await swReg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: outputArray
          });
          
          await savePushSubscription(subscription.toJSON());
        }
      } catch (err) {
        console.warn("[AdFlow] Push subscription failed:", err);
      }
    }

    function onFirstGesture() {
      if (typeof Notification !== "undefined") {
        if (Notification.permission === "default") {
          Notification.requestPermission().then((perm) => { 
            notifPermission.current = perm; 
            if (perm === "granted") {
              setupPushSubscription();
            }
          }).catch(() => {});
        } else if (Notification.permission === "granted") {
          setupPushSubscription();
        }
      }
      if (!chimeAudioRef.current) {
        const audio = new Audio("/notification.wav");
        audio.volume = 1;
        audio.play().then(() => {
          audio.pause();
          audio.currentTime = 0;
        }).catch((e: Error) => {
          console.warn("[AdFlow] audio unlock failed:", e.name, e.message);
        });
        chimeAudioRef.current = audio;
      }
      
      // Keep-awake hack for background tabs: plays an inaudible ultrasonic hum.
      // This forces Chrome/Safari to treat the background tab as an active media player,
      // preventing them from suspending the JS thread and killing the Supabase WebSocket.
      if (!wakeContext) {
        try {
          const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          wakeContext = new AudioContextClass();
          wakeOsc = wakeContext.createOscillator();
          const gainNode = wakeContext.createGain();
          gainNode.gain.value = 0.01;
          wakeOsc.frequency.value = 22000; // Ultrasonic
          wakeOsc.connect(gainNode);
          gainNode.connect(wakeContext.destination);
          wakeOsc.start();
        } catch (e) {
          console.warn("[AdFlow] Keep-awake audio failed:", e);
        }
      }
    }
    document.addEventListener("click", onFirstGesture, { once: true });
    return () => { 
      document.removeEventListener("click", onFirstGesture); 
      if (wakeOsc) { wakeOsc.stop(); wakeOsc.disconnect(); }
      if (wakeContext) { void wakeContext.close(); }
    };
  }, []);

  // ── Supabase realtime subscription
  useEffect(() => {
    if (!userId) return;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel("notif_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          console.log("[AdFlow] Realtime payload received:", payload.eventType);
          if (payload.eventType === "INSERT") {
            const newNotif = payload.new as Notification;
            setRealtimeNotifs(cur => [newNotif, ...cur]);
            playChime();
            if (document.visibilityState === "hidden") {
              missedChimes.current += 1;
              fireOsNotification(newNotif.title ?? "AdFlow", newNotif.body ?? "You have a new notification.");
            }
          } else if (payload.eventType === "UPDATE") {
            setRealtimeNotifs(cur => {
              const exists = cur.some(n => n.id === payload.new.id);
              if (exists) return cur.map(n => n.id === payload.new.id ? (payload.new as Notification) : n);
              return [payload.new as Notification, ...cur];
            });
          } else if (payload.eventType === "DELETE") {
            setRealtimeNotifs(cur => cur.filter(n => n.id !== payload.old.id));
          }
        }
      )
      .subscribe((status) => {
        console.log("[AdFlow] Supabase channel status:", status);
      });
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  // ── Play chime when coming back to tab with missed notifications
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible" && missedChimes.current > 0) {
        missedChimes.current = 0;
        playChime();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // ── Favicon badge + title badge + catch-up chime for sleeping tabs
  useEffect(() => {
    if ("setAppBadge" in navigator) {
      if (unreadCount > 0) navigator.setAppBadge(unreadCount).catch(() => {});
    }
    updateFaviconBadge(unreadCount);
    document.title = unreadCount > 0 ? `(${unreadCount}) AdFlow` : "AdFlow";
    
    // If the browser aggressively suspended the tab and killed the WebSocket, 
    // realtime-sync will catch up via router.refresh() when focused, bumping this count.
    // We play the chime here to guarantee a sound even if the WebSocket missed it.
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
    setLocallyRead(new Set(notifications.map((n) => n.id)));
    startTransition(async () => { await runServerMutation(() => markAllNotificationsRead()); });
  }

  function clearAll() {
    setClearedAt(Date.now());
    setRealtimeNotifs([]);
    startTransition(async () => { await runServerMutation(() => clearAllNotifications()); });
  }

  function handleBellClick() {
    setOpen((value) => !value);
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().then((perm) => { notifPermission.current = perm; }).catch(() => {});
    }
  }

  return (
    <div className="relative">
      <Button variant="ghost" size="icon" className="relative" onClick={handleBellClick} title="Notifications" aria-label="Notifications" aria-expanded={open}>
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
            <div className="flex items-center gap-3">
              {unreadCount ? (
                <button className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary disabled:opacity-50" disabled={isPending} onClick={markAllRead}>
                  <CheckCheck className="size-3.5" aria-hidden />
                  Mark all read
                </button>
              ) : null}
              {notifications.length ? (
                <button className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive hover:text-destructive/80 disabled:opacity-50" disabled={isPending} onClick={clearAll}>
                  Clear all
                </button>
              ) : null}
            </div>
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

function updateFaviconBadge(count: number) {
  if (typeof window === "undefined") return;
  const existingLinks = document.querySelectorAll("link[rel*='icon']");
  existingLinks.forEach(link => link.remove());
  const link = document.createElement("link");
  link.rel = "icon";
  if (count === 0) {
    link.type = "image/x-icon";
    link.href = "/favicon.ico";
  } else {
    link.type = "image/svg+xml";
    const text = count > 9 ? "9+" : count.toString();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0f172a"/><path d="M11 16h10M16 11v10" stroke="#64748b" stroke-width="3" stroke-linecap="round"/><circle cx="26" cy="6" r="8" fill="#ef4444"/><text x="26" y="10" font-family="sans-serif" font-weight="bold" font-size="12" fill="#ffffff" text-anchor="middle">${text}</text></svg>`;
    link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
  document.head.appendChild(link);
}
