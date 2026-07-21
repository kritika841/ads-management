import { Clock, Play, Pause } from "lucide-react";
import type { EditorTimeLog } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDuration(totalSeconds: number) {
  if (totalSeconds <= 0) return "0s";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function sessionDurationSeconds(log: EditorTimeLog): number {
  const end = log.session_ended_at ? new Date(log.session_ended_at).getTime() : Date.now();
  return Math.max(0, Math.floor((end - new Date(log.session_started_at).getTime()) / 1000));
}

function totalActiveSeconds(logs: EditorTimeLog[]): number {
  return logs.reduce((acc, l) => acc + sessionDurationSeconds(l), 0);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EditingTimeDisplay({ timeLogs }: { timeLogs: EditorTimeLog[] }) {
  if (!timeLogs.length) {
    return (
      <section className="panel p-5" id="editing-time-panel">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="section-heading">Editing time</h2>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          No editing sessions recorded yet.
        </p>
      </section>
    );
  }

  const totalSeconds = totalActiveSeconds(timeLogs);
  const activeSession = timeLogs.find((l) => l.is_active) ?? null;
  const editorName = timeLogs[0].editor?.name ?? "Editor";
  const sessionCount = timeLogs.length;
  const pauseCount = timeLogs.filter((l) => l.pause_reason).length;

  return (
    <section className="panel overflow-hidden" id="editing-time-panel">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="section-heading">Editing time</h2>
        </div>
        {activeSession ? (
          <span className="flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
            <span className="size-1.5 animate-pulse rounded-full bg-success" />
            Live
          </span>
        ) : (
          <span className="rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning">
            Paused
          </span>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
        <div className="px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground">Total time</p>
          <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-foreground" suppressHydrationWarning>
            {formatDuration(totalSeconds)}
          </p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground">Sessions</p>
          <p className="mt-0.5 text-lg font-semibold text-foreground">{sessionCount}</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground">Pauses</p>
          <p className="mt-0.5 text-lg font-semibold text-foreground">{pauseCount}</p>
        </div>
      </div>

      {/* Session breakdown */}
      <div className="p-5">
        <p className="mb-3 text-xs font-semibold uppercase text-muted-foreground">
          {editorName}&apos;s sessions
        </p>
        <div className="space-y-2">
          {timeLogs.map((log, i) => {
            const dur = sessionDurationSeconds(log);
            return (
              <div
                key={log.id}
                className={`rounded-lg border px-4 py-3 ${log.is_active ? "border-success/30 bg-success/5" : log.pause_reason ? "border-warning/30 bg-warning/5" : "border-border bg-muted/40"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {log.is_active ? (
                      <Play className="size-3.5 text-success" aria-hidden />
                    ) : (
                      <Pause className="size-3.5 text-muted-foreground" aria-hidden />
                    )}
                    <span className="text-sm font-medium text-foreground">Session {i + 1}</span>
                    {log.is_active ? (
                      <span className="text-xs text-success">Active now</span>
                    ) : null}
                  </div>
                  <span className="font-mono text-sm font-semibold tabular-nums text-foreground" suppressHydrationWarning>
                    {formatDuration(dur)}
                  </span>
                </div>

                <div className="mt-1.5 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                  <span>Started: {formatDateTime(log.session_started_at)}</span>
                  {log.session_ended_at ? (
                    <span>Ended: {formatDateTime(log.session_ended_at)}</span>
                  ) : (
                    <span className="text-success">Still running…</span>
                  )}
                </div>

                {log.pause_reason ? (
                  <div className="mt-2 rounded-md bg-warning/10 px-2.5 py-1.5">
                    <p className="text-xs text-warning">
                      <span className="font-semibold">Pause reason: </span>
                      {log.pause_reason}
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
