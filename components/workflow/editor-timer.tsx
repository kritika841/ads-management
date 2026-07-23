"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, Pause, Play, AlertCircle } from "lucide-react";
import { pauseEditingTimer, resumeEditingTimer } from "@/app/actions/ads";
import { runServerAction } from "@/lib/client-action";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import type { EditorTimeLog } from "@/lib/types";

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Sum seconds of all completed (closed) sessions */
function completedSeconds(logs: EditorTimeLog[]) {
  return logs
    .filter((l) => !l.is_active && l.session_ended_at)
    .reduce((acc, l) => {
      const diff = (new Date(l.session_ended_at!).getTime() - new Date(l.session_started_at).getTime()) / 1000;
      return acc + Math.max(0, Math.floor(diff));
    }, 0);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EditorTimer({ adId, timeLogs }: { adId: string; timeLogs: EditorTimeLog[] }) {
  const router = useRouter();
  const activeSession = timeLogs.find((l) => l.is_active) ?? null;
  const isPaused = !activeSession;

  // Live tick counter for the current session
  const [liveTick, setLiveTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!activeSession) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    const start = new Date(activeSession.session_started_at).getTime();
    const tick = () => setLiveTick(Math.floor((Date.now() - start) / 1000));
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [activeSession?.session_started_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalSeconds = completedSeconds(timeLogs) + liveTick;

  // Pause modal state
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handlePause() {
    if (!pauseReason.trim()) return;
    setErrorMsg(null);
    startTransition(async () => {
      const res = await runServerAction(() => pauseEditingTimer(adId, pauseReason));
      if (!res.ok) { setErrorMsg(res.message ?? "Unable to pause timer."); return; }
      setShowPauseModal(false);
      setPauseReason("");
      router.refresh();
    });
  }

  function handleResume() {
    setErrorMsg(null);
    startTransition(async () => {
      const res = await runServerAction(() => resumeEditingTimer(adId));
      if (!res.ok) { setErrorMsg(res.message ?? "Unable to resume timer."); return; }
      router.refresh();
    });
  }

  return (
    <>
      {/* Timer bar */}
      <div className="border-t border-border bg-muted/60 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className={`flex size-7 items-center justify-center rounded-full ${isPaused ? "bg-warning/20 text-warning" : "bg-success/20 text-success"}`}
              aria-hidden
            >
              <Clock className="size-3.5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">Editing time</p>
              <p className="font-mono text-lg font-semibold tabular-nums text-foreground" suppressHydrationWarning>
                {formatDuration(totalSeconds)}
              </p>
            </div>
            {isPaused ? (
              <span className="ml-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">Paused</span>
            ) : (
              <span className="ml-1 flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                <span className="size-1.5 animate-pulse rounded-full bg-success" />
                Running
              </span>
            )}
          </div>

          <div className="flex gap-2">
            {isPaused ? (
              <Button size="sm" variant="secondary" disabled={isPending} onClick={handleResume} id="resume-timer-btn">
                {isPending ? (
                  <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
                ) : (
                  <Play className="size-3.5" aria-hidden />
                )}
                Resume
              </Button>
            ) : (
              <Button size="sm" variant="secondary" disabled={isPending} onClick={() => { setShowPauseModal(true); setErrorMsg(null); }} id="pause-timer-btn">
                <Pause className="size-3.5" aria-hidden />
                Pause
              </Button>
            )}
          </div>
        </div>

        {errorMsg ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive" role="alert">
            <AlertCircle className="size-3.5" aria-hidden />
            {errorMsg}
          </p>
        ) : null}

        {/* Session history for editor */}
        {timeLogs.length > 1 || (timeLogs.length === 1 && timeLogs[0].session_ended_at) ? (
          <details className="mt-3 border-t border-border pt-3">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
              Session history ({timeLogs.length})
            </summary>
            <div className="mt-2 space-y-1.5">
              {timeLogs.map((log, i) => {
                const dur = log.session_ended_at
                  ? Math.max(0, Math.floor((new Date(log.session_ended_at).getTime() - new Date(log.session_started_at).getTime()) / 1000))
                  : liveTick;
                return (
                  <div key={log.id} className="rounded-md bg-card px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Session {i + 1}</span>
                      <span className="font-mono font-medium tabular-nums text-foreground">{formatDuration(dur)}</span>
                    </div>
                    {log.pause_reason ? (
                      <p className="mt-0.5 text-muted-foreground">
                        <span className="font-medium text-warning">Paused: </span>{log.pause_reason}
                      </p>
                    ) : log.is_active ? (
                      <p className="mt-0.5 text-success">Active now</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </details>
        ) : null}
      </div>

      {/* Pause modal */}
      {showPauseModal ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-950/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pause-timer-title"
        >
          <section className="w-full max-w-md rounded-xl border border-border bg-card shadow-float dark:shadow-none">
            <div className="border-b border-border px-5 py-4">
              <h2 id="pause-timer-title" className="text-lg font-semibold text-foreground">Pause editing timer</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Let the team know why you&apos;re stepping away. This note will be visible to your manager and admin.
              </p>
            </div>
            <div className="space-y-4 p-5">
              <Field label="Reason for pausing" hint="Required — describe why you're pausing.">
                <Textarea
                  id="pause-reason-input"
                  className="min-h-24"
                  value={pauseReason}
                  onChange={(e) => setPauseReason(e.target.value)}
                  placeholder="e.g. Taking a break, waiting for assets, end of shift…"
                  autoFocus
                />
              </Field>
              {errorMsg ? (
                <p className="text-sm text-destructive" role="alert">{errorMsg}</p>
              ) : null}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
              <Button variant="secondary" disabled={isPending} onClick={() => { setShowPauseModal(false); setPauseReason(""); }}>
                Cancel
              </Button>
              <Button disabled={isPending || !pauseReason.trim()} onClick={handlePause} id="confirm-pause-btn">
                {isPending ? (
                  <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
                ) : (
                  <Pause className="size-3.5" aria-hidden />
                )}
                Pause timer
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
