"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Radio, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { compareUserSyncStates, parseUserSyncState, type UserSyncState } from "@/lib/sync-state";
import type { UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";

type ConnectionState = "connecting" | "live" | "updated" | "fallback" | "offline";

// Load-shedding constants. Every open tab runs this loop, so these values multiply by the
// number of concurrent users — keep them conservative. (Previously: fixed 5s poll + an RPC and
// a full server re-render for EVERY realtime event, which saturated the database mid-day.)
const POLL_WHEN_LIVE_MS = 60_000; // realtime pushes changes; polling is only a safety net
const POLL_FALLBACK_MS = 15_000; // realtime down → poll, but not aggressively
const MAX_BACKOFF_MS = 120_000; // cap for exponential backoff after failures
const EVENT_COALESCE_MS = 800; // bursts of realtime events → one sync check
const MIN_REFRESH_GAP_MS = 3_000; // never re-render server components more often than this
const jitter = (ms: number) => ms + Math.floor(Math.random() * Math.min(ms * 0.3, 5_000));

export function RealtimeSync({ userId, role }: { userId: string; role: UserRole }) {
  const router = useRouter();
  const lastSyncState = useRef<UserSyncState | null>(null);
  const checking = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeConnected = useRef(false);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [assignmentToastCount, setAssignmentToastCount] = useState(0);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;
    let failures = 0;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastRefreshAt = 0;
    let refreshPendingWhileHidden = false;

    const queueRefresh = () => {
      // Hidden tabs don't need fresh server HTML; defer until the user comes back.
      if (document.visibilityState !== "visible") {
        refreshPendingWhileHidden = true;
        return;
      }
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      const wait = Math.max(250, lastRefreshAt + MIN_REFRESH_GAP_MS - Date.now());
      refreshTimer.current = setTimeout(() => {
        if (!active) return;
        lastRefreshAt = Date.now();
        refreshPendingWhileHidden = false;
        startTransition(() => router.refresh());
      }, wait);
    };

    const scheduleNextPoll = () => {
      if (!active) return;
      if (pollTimer) clearTimeout(pollTimer);
      const base = realtimeConnected.current ? POLL_WHEN_LIVE_MS : POLL_FALLBACK_MS;
      const delay = failures > 0 ? Math.min(MAX_BACKOFF_MS, POLL_FALLBACK_MS * 2 ** failures) : base;
      pollTimer = setTimeout(() => void checkForUpdates(), jitter(delay));
    };

    // Collapse many realtime events (one user action touches ads + activity_logs + notifications)
    // into a single sync check, spread out with jitter so all tabs don't hit the DB at once.
    const queueCheck = () => {
      if (!active) return;
      if (coalesceTimer) return;
      coalesceTimer = setTimeout(() => {
        coalesceTimer = null;
        void checkForUpdates(true);
      }, jitter(EVENT_COALESCE_MS));
    };

    const markUpdated = () => {
      setState("updated");
      if (statusTimer.current) clearTimeout(statusTimer.current);
      statusTimer.current = setTimeout(() => setState(realtimeConnected.current ? "live" : "fallback"), 4_000);
    };
    const refreshDailyTargets = () => { if (!active) return; markUpdated(); queueRefresh(); };

    const checkForUpdates = async (fromEvent = false) => {
      if (!active) return;
      if (checking.current || !navigator.onLine || document.visibilityState !== "visible") {
        // Hidden/offline tabs do no DB work; visibility/online handlers trigger a catch-up check.
        scheduleNextPoll();
        return;
      }
      checking.current = true;
      try {
        const { data, error } = await supabase.rpc("get_user_sync_state");
        if (error) throw error;
        const current = parseUserSyncState(data);
        if (!current) throw new Error("Invalid sync state.");
        failures = 0;

        const comparison = compareUserSyncStates(lastSyncState.current, current, role);
        lastSyncState.current = current;
        if (comparison.newAssignmentCount > 0) {
          setAssignmentToastCount((count) => count + comparison.newAssignmentCount);
        }
        if (comparison.changed || (fromEvent && refreshPendingWhileHidden)) {
          markUpdated();
          queueRefresh();
        } else {
          setState(realtimeConnected.current ? "live" : "fallback");
        }
      } catch {
        // Back off exponentially so a struggling database is given room to recover instead of
        // being hammered by every open tab at once.
        failures = Math.min(failures + 1, 6);
        if (active) setState(navigator.onLine ? "fallback" : "offline");
      } finally {
        checking.current = false;
        scheduleNextPoll();
      }
    };

    const onAnnouncementChange = () => {
      if (!active) return;
      markUpdated();
      queueRefresh();
      window.dispatchEvent(new CustomEvent("adflow:announcement-updated"));
    };

    const channel = supabase
      .channel(`adflow-live-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ads" }, queueCheck)
      .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, queueCheck)
      .on("postgres_changes", { event: "*", schema: "public", table: "review_actions" }, queueCheck)
      .on("postgres_changes", { event: "*", schema: "public", table: "annotations" }, queueCheck)
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_logs" }, queueCheck)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_team_targets" }, refreshDailyTargets)
      .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, onAnnouncementChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "announcement_acknowledgements" }, onAnnouncementChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, queueCheck)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          realtimeConnected.current = true;
          setState("live");
          queueCheck();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          realtimeConnected.current = false;
          if (active) setState(navigator.onLine ? "fallback" : "offline");
          scheduleNextPoll(); // switch to the faster fallback cadence
        }
      });

    const checkVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (refreshPendingWhileHidden) queueRefresh();
      queueCheck();
    };
    const checkFocused = () => queueCheck();
    const checkOnline = () => {
      setState("connecting");
      failures = 0;
      queueCheck();
    };
    const markOffline = () => setState("offline");

    document.addEventListener("visibilitychange", checkVisible);
    window.addEventListener("focus", checkFocused);
    window.addEventListener("online", checkOnline);
    window.addEventListener("offline", markOffline);
    void checkForUpdates();

    return () => {
      active = false;
      if (pollTimer) clearTimeout(pollTimer);
      if (coalesceTimer) clearTimeout(coalesceTimer);
      document.removeEventListener("visibilitychange", checkVisible);
      window.removeEventListener("focus", checkFocused);
      window.removeEventListener("online", checkOnline);
      window.removeEventListener("offline", markOffline);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (statusTimer.current) clearTimeout(statusTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [role, router, userId]);

  const assignmentPopupRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (assignmentToastCount === 0) return;
    function onPointerDown(event: PointerEvent) {
      const popup = assignmentPopupRef.current;
      if (popup && event.target instanceof Node && popup.contains(event.target)) return;
      setAssignmentToastCount(0);
    }
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") setAssignmentToastCount(0); }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [assignmentToastCount]);

  const label = state === "updated" ? "Updated" : state === "offline" ? "Offline" : state === "connecting" ? "Connecting" : state === "fallback" ? "Auto-check" : "Live";
  return (
    <>
      <span
        className={cn(
          "hidden h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium sm:inline-flex",
          state === "offline" ? "bg-destructive/10 text-destructive" : state === "updated" ? "bg-accent text-accent-foreground" : "text-muted-foreground"
        )}
        title={state === "fallback" ? "Realtime unavailable; checking periodically" : "Dashboard updates automatically"}
      >
        <Radio className={cn("size-3.5", state === "live" && "text-success")} aria-hidden />
        {label}
      </span>

      {assignmentToastCount > 0 ? (
        <section ref={assignmentPopupRef} className="fixed right-4 top-20 z-50 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-primary/30 bg-popover text-popover-foreground p-4 shadow-float" role="status" aria-live="polite">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground"><Radio className="size-4" aria-hidden /></span>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-foreground">New editing assignment</p><p className="mt-1 text-sm text-muted-foreground">{assignmentToastCount === 1 ? "A new video is ready for you." : `${assignmentToastCount} new videos are ready for you.`}</p></div>
            <button type="button" className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-muted-foreground" title="Dismiss" onClick={() => setAssignmentToastCount(0)}><X className="size-4" aria-hidden /></button>
          </div>
          <Button className="mt-3 w-full" size="sm" onClick={() => { setAssignmentToastCount(0); router.push("/library?queue=new_assignments"); }}>View assignment<ArrowRight className="size-4" aria-hidden /></Button>
        </section>
      ) : null}
    </>
  );
}
