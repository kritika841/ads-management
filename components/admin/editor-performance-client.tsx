"use client";

import { Fragment, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, Clock, Film, TrendingUp, User, Zap } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { computeEditorStats, formatDuration, formatHours, type EditorStat } from "@/lib/editor-performance";
import { productionStageLabels } from "@/lib/production-workflow";
import type { ActivityLog, AdWithRelations, EditorTimeLog, Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

export function EditorPerformanceClient({
  profiles,
  ads,
  timeLogs,
  activityLogs,
}: {
  profiles: Profile[];
  ads: AdWithRelations[];
  timeLogs: EditorTimeLog[];
  activityLogs: ActivityLog[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [startDateStr, setStartDateStr] = useState<string>("");
  const [endDateStr, setEndDateStr] = useState<string>("");

  const startDate = startDateStr ? new Date(startDateStr) : null;
  const endDate = endDateStr ? new Date(endDateStr) : null;
  const hasPeriod = Boolean(startDateStr || endDateStr);

  const stats = computeEditorStats(profiles, ads, timeLogs, activityLogs, startDate, endDate);

  const editors = profiles.filter((p) => p.role === "editor");

  if (editors.length === 0) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <User className="size-5" aria-hidden />
        </span>
        <p className="mt-4 text-sm font-medium text-foreground">No editors yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add editor accounts to start tracking their performance.
        </p>
      </div>
    );
  }

  const totalAssigned = stats.reduce((s, e) => s + e.assigned, 0);
  const totalCompleted = stats.reduce((s, e) => s + (hasPeriod ? e.completedInPeriod : e.completed), 0);
  const totalSeconds = stats.reduce((s, e) => s + e.totalSeconds, 0);
  const totalRevisionCount = stats.reduce((s, e) => s + e.totalRevisions, 0);
  const overallAvgRevisions = totalCompleted > 0 ? Math.round((totalRevisionCount / totalCompleted) * 10) / 10 : null;
  const idleCount = stats.filter((e) => e.idle).length;

  return (
    <div className="space-y-6">
      {/* Date Range Filter */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          From
          <input
            type="date"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            value={startDateStr}
            onChange={(e) => setStartDateStr(e.target.value)}
          />
        </label>
        <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          To
          <input
            type="date"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            value={endDateStr}
            onChange={(e) => setEndDateStr(e.target.value)}
          />
        </label>
      </div>

      {/* Summary KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Film className="size-4" />}
          label="Active assignments"
          value={totalAssigned}
          tone="default"
        />
        <KpiCard
          icon={<TrendingUp className="size-4" />}
          label="Completed"
          value={totalCompleted}
          tone="success"
        />
        <KpiCard
          icon={<Clock className="size-4" />}
          label="Total editing time"
          value={formatDuration(totalSeconds)}
          tone="default"
        />
        <KpiCard
          icon={<AlertCircle className="size-4" />}
          label="Idle editors"
          value={idleCount}
          tone={idleCount > 0 ? "warning" : "success"}
          subtitle={idleCount > 0 ? "No active assignments" : "All editors have work"}
        />
      </div>

      {/* Per-editor rows */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Editor
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Assigned
                </th>
                <th className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Started
                </th>
                <th className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Submitted
                </th>
                <th className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Completed
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Total time
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Avg revisions
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                <th className="w-8 px-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stats.map((stat) => (
                <Fragment key={stat.id}>
                  <tr
                    className={cn(
                      "transition-colors cursor-pointer",
                      expanded === stat.id ? "bg-accent/40" : "hover:bg-muted/50"
                    )}
                    onClick={() => setExpanded(expanded === stat.id ? null : stat.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={stat.name} src={stat.avatarUrl} className="size-8 shrink-0" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{stat.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{stat.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-semibold text-foreground">{stat.assigned}</span>
                    </td>
                    <td className="px-2 py-3 text-center">
                      <span className="font-semibold text-primary">{hasPeriod ? stat.startedInPeriod : stat.started}</span>
                    </td>
                    <td className="px-2 py-3 text-center">
                      <span className="font-semibold text-sky-600 dark:text-sky-400">{hasPeriod ? stat.submittedInPeriod : stat.submitted}</span>
                      {hasPeriod && stat.submittedBacklog > 0 && (
                        <p className="mt-0.5 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                          +{stat.submittedBacklog} backlog
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-3 text-center">
                      <span className="font-semibold text-success">{hasPeriod ? stat.completedInPeriod : stat.completed}</span>
                    </td>
                    {/* Total time */}
                    <td className="px-4 py-3 text-center font-mono text-xs text-foreground">
                      {formatDuration(stat.totalSeconds)}
                    </td>
                    {/* Avg revisions */}
                    <td className="px-4 py-3 text-center">
                      <span className={stat.avgRevisions !== null ? "font-semibold text-amber-600 dark:text-amber-400" : "text-foreground"}>
                        {stat.avgRevisions !== null ? stat.avgRevisions.toFixed(1) : "—"}
                      </span>
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3 text-center">
                      {stat.idle ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                          <Zap className="size-3" aria-hidden />
                          Idle
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] font-medium text-success">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-muted-foreground">
                      {expanded === stat.id ? (
                        <ChevronDown className="size-4" aria-hidden />
                      ) : (
                        <ChevronRight className="size-4" aria-hidden />
                      )}
                    </td>
                  </tr>
                  {expanded === stat.id && (
                    <tr key={`${stat.id}-detail`}>
                      <td colSpan={9} className="bg-muted/30 px-4 pb-4 pt-2">
                        <ExpandedEditorDetail stat={stat} hasPeriod={hasPeriod} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Overall avg revisions footer note */}
      {overallAvgRevisions !== null && (
        <p className="text-xs text-muted-foreground text-right">
          Overall average revisions per completed video: <span className="font-medium text-foreground">{overallAvgRevisions.toFixed(1)}</span>
        </p>
      )}
    </div>
  );
}

function ExpandedEditorDetail({ stat, hasPeriod }: { stat: EditorStat; hasPeriod: boolean }) {
  const visibleAds = stat.adsWithLogs.filter((ad) => ad.stage !== "ready_for_edit");

  if (visibleAds.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-center text-sm text-muted-foreground">
        {stat.idle
          ? "This editor currently has no videos assigned to them."
          : "No assigned videos to review yet."}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Assigned videos
      </p>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Video name</th>
              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Stage</th>
                <th className="px-3 py-2 text-center font-semibold text-muted-foreground">Time logged</th>
              <th className="px-3 py-2 text-center font-semibold text-muted-foreground">
                Revisions
                <span className="ml-1 font-normal text-muted-foreground/70">(submissions with changes)</span>
              </th>
              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Product</th>
              <th className="px-3 py-2 text-center font-semibold text-muted-foreground">Progress</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleAds.map((ad) => (
              <tr key={ad.adId} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <span className="font-medium text-foreground">{ad.adName}</span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {productionStageLabels[ad.stage as keyof typeof productionStageLabels] ?? ad.stage}
                </td>
                <td className="px-3 py-2 text-center font-mono">
                  {ad.totalSeconds > 0 ? formatDuration(ad.totalSeconds) : "—"}
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={ad.revisions > 0 ? "font-semibold text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
                    {ad.revisions > 0 ? ad.revisions : "—"}
                  </span>
                </td>
                <td className="px-3 py-2 text-left">
                  <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {ad.productName ?? "No product"}
                  </span>
                </td>
                <td className="px-3 py-2 text-center">
                  {ad.isActive ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      In progress
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Done
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Per-editor stats summary in detail panel */}
      {hasPeriod && (
        <div className="mt-3 grid grid-cols-3 gap-3">
          <MiniStat label="Started" value={stat.startedInPeriod} color="primary" />
          <MiniStat label="Submitted" value={stat.submittedInPeriod} color="sky" backlog={stat.submittedBacklog} />
          <MiniStat label="Completed" value={stat.completedInPeriod} color="success" />
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, color, backlog }: { label: string; value: number; color: "primary" | "success" | "amber" | "sky"; backlog?: number }) {
  const colorClass =
    color === "primary" ? "text-primary" :
    color === "success" ? "text-success" :
    color === "sky" ? "text-sky-600 dark:text-sky-400" :
    "text-amber-600 dark:text-amber-400";
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-lg font-bold", colorClass)}>{value}</p>
      {backlog !== undefined && backlog > 0 && (
        <p className="mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">+{backlog} backlog</p>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  tone,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone: "default" | "success" | "warning" | "error";
  subtitle?: string;
}) {
  const toneClasses: Record<string, string> = {
    default: "bg-muted/40 text-muted-foreground",
    success: "bg-success/10 text-success",
    warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    error: "bg-destructive/10 text-destructive",
  };
  const iconClasses: Record<string, string> = {
    default: "bg-muted text-muted-foreground",
    success: "bg-success/15 text-success",
    warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    error: "bg-destructive/15 text-destructive",
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span className={cn("flex size-8 items-center justify-center rounded-lg text-sm", iconClasses[tone])}>
          {icon}
        </span>
      </div>
      <p className={cn("mt-3 text-2xl font-bold", tone === "default" ? "text-foreground" : toneClasses[tone])}>
        {value}
      </p>
      {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
