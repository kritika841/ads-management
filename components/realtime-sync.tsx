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

    const queueRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => startTransition(() => router.refresh()), 250);
    };

    const markUpdated = () => {
      setState("updated");
      if (statusTimer.current) clearTimeout(statusTimer.current);
      statusTimer.current = setTimeout(() => setState(realtimeConnected.current ? "live" : "fallback"), 4_000);
    };

    const checkForUpdates = async () => {
      if (!active || checking.current || document.visibilityState !== "visible" || !navigator.onLine) return;
      checking.current = true;
      try {
        const { data, error } = await supabase.rpc("get_user_sync_state");
        if (error) throw error;
        const current = parseUserSyncState(data);
        if (!current) throw new Error("Invalid sync state.");

        const comparison = compareUserSyncStates(lastSyncState.current, current, role);
        lastSyncState.current = current;
        if (comparison.newAssignmentCount > 0) {
          setAssignmentToastCount((count) => count + comparison.newAssignmentCount);
        }
        if (comparison.changed) {
          markUpdated();
          queueRefresh();
        } else {
          setState(realtimeConnected.current ? "live" : "fallback");
        }
      } catch {
        if (active) setState(navigator.onLine ? "fallback" : "offline");
      } finally {
        checking.current = false;
      }
    };

    const channel = supabase
      .channel(`adflow-live-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ads" }, checkForUpdates)
      .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, checkForUpdates)
      .on("postgres_changes", { event: "*", schema: "public", table: "review_actions" }, checkForUpdates)
      .on("postgres_changes", { event: "*", schema: "public", table: "annotations" }, checkForUpdates)
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_logs" }, checkForUpdates)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, checkForUpdates)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          realtimeConnected.current = true;
          setState("live");
          void checkForUpdates();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          realtimeConnected.current = false;
          setState(navigator.onLine ? "fallback" : "offline");
        }
      });

    const interval = window.setInterval(() => void checkForUpdates(), 5_000);
    const checkVisible = () => {
      if (document.visibilityState === "visible") void checkForUpdates();
    };
    const checkFocused = () => void checkForUpdates();
    const checkOnline = () => {
      setState("connecting");
      void checkForUpdates();
    };
    const markOffline = () => setState("offline");

    document.addEventListener("visibilitychange", checkVisible);
    window.addEventListener("focus", checkFocused);
    window.addEventListener("online", checkOnline);
    window.addEventListener("offline", markOffline);
    void checkForUpdates();

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", checkVisible);
      window.removeEventListener("focus", checkFocused);
      window.removeEventListener("online", checkOnline);
      window.removeEventListener("offline", markOffline);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (statusTimer.current) clearTimeout(statusTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [role, router, userId]);

  const label = state === "updated" ? "Updated" : state === "offline" ? "Offline" : state === "connecting" ? "Connecting" : state === "fallback" ? "Auto-check" : "Live";
  return (
    <>
      <span
        className={cn(
          "hidden h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium sm:inline-flex",
          state === "offline" ? "bg-rose-50 text-rose-700" : state === "updated" ? "bg-teal-50 text-teal-700" : "text-slate-500"
        )}
        title={state === "fallback" ? "Realtime unavailable; checking every five seconds" : "Dashboard updates automatically"}
      >
        <Radio className={cn("size-3.5", state === "live" && "text-emerald-600")} aria-hidden />
        {label}
      </span>

      {assignmentToastCount > 0 ? (
        <section className="fixed right-4 top-20 z-50 w-[min(360px,calc(100vw-2rem))] rounded-lg border border-teal-200 bg-white p-4 shadow-float" role="status" aria-live="polite">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700"><Radio className="size-4" aria-hidden /></span>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-950">New editing assignment</p><p className="mt-1 text-sm text-slate-500">{assignmentToastCount === 1 ? "A new video is ready for you." : `${assignmentToastCount} new videos are ready for you.`}</p></div>
            <button type="button" className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Dismiss" onClick={() => setAssignmentToastCount(0)}><X className="size-4" aria-hidden /></button>
          </div>
          <Button className="mt-3 w-full" size="sm" onClick={() => { setAssignmentToastCount(0); router.push("/library?queue=new_assignments"); }}>View assignment<ArrowRight className="size-4" aria-hidden /></Button>
        </section>
      ) : null}
    </>
  );
}
