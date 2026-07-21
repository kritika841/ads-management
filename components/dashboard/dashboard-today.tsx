"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, Gauge, ListChecks } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { InfoTip } from "@/components/ui/info-tip";
import { ProductionStageBadge } from "@/components/workflow/production-stage";
import { EditorTimelineChart } from "@/components/dashboard/editor-timeline-chart";
import type { DashboardSummaryModel } from "@/lib/dashboard-summary";
import type { QueueKey } from "@/lib/work-queues";
import { cn, formatDateOnly, formatDurationHours } from "@/lib/utils";

export function DashboardToday({ model, onSelectQueue }: { model: DashboardSummaryModel; onSelectQueue: (queue: QueueKey) => void }) {
  return (
    <section className="mt-6" aria-labelledby="today-heading">
      <div>
        <p className="text-xs font-semibold uppercase text-primary">{model.eyebrow}</p>
        <h2 id="today-heading" className="mt-1 text-xl font-semibold text-foreground">{model.title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{model.description}</p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {model.tiles.map((tile) => (
          <article
            key={tile.key}
            className={cn(
              "group relative flex min-h-24 items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3 text-left shadow-soft transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-ring/40 hover:shadow-float dark:shadow-none",
              tile.tone === "urgent" ? "border-destructive/30" : tile.tone === "attention" ? "border-warning/30" : "border-border"
            )}
          >
            <button type="button" className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label={`${tile.label}: ${tile.count}`} onClick={() => tile.queue ? onSelectQueue(tile.queue) : document.getElementById("priority-work")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
            <div className="pointer-events-none min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-muted-foreground">{tile.label}</p>
                <InfoTip text={tile.help} className="pointer-events-auto z-10" />
              </div>
              <p className={cn("mt-1 text-3xl font-semibold", tile.tone === "urgent" && tile.count ? "text-destructive" : "text-foreground")}>{tile.count}</p>
            </div>
            <ArrowRight className="size-4 shrink-0 text-border transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
          </article>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
        <section id="priority-work" className="panel scroll-mt-24 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
            <span className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground"><ListChecks className="size-[18px]" aria-hidden /></span>
            <div><h3 className="text-sm font-semibold text-foreground">{model.priorityTitle}</h3><p className="text-xs text-muted-foreground">Ordered by deadline and urgency</p></div>
          </div>
          {model.priorities.length ? <div className="divide-y divide-border">{model.priorities.map((item) => (
            <Link key={item.id} href={`/ads/${item.id}`} className="grid gap-3 px-4 py-3 transition hover:bg-muted sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium text-foreground">{item.name}</p><ProductionStageBadge stage={item.stage} className="h-6 px-2 text-[11px]" /></div><p className="mt-1 truncate text-xs text-muted-foreground">{item.campaign} · {item.reason}</p></div>
              <div className="flex items-center justify-between gap-4 sm:justify-end"><span className={cn("inline-flex items-center gap-1 text-xs font-medium", item.deadlineState === "overdue" ? "text-destructive" : item.deadlineState === "today" ? "text-warning" : "text-muted-foreground")}><CalendarClock className="size-3.5" aria-hidden />{item.deadline ? formatDateOnly(item.deadline) : `${formatDurationHours(item.waitingHours)} waiting`}</span><ArrowRight className="size-4 text-border" aria-hidden /></div>
            </Link>
          ))}</div> : <div className="px-5 py-10 text-center text-sm text-muted-foreground">{model.priorityEmpty}</div>}
        </section>

        {model.kind === "reviewer" ? (
          <div>
            <EditorWorkload rows={model.workloads} />
            {model.timeline && model.timeline.length > 0 ? (
              <EditorTimelineChart data={model.timeline} profiles={model.workloads} />
            ) : null}
          </div>
        ) : (
          <ProductionSnapshot rows={model.production} kind={model.kind} />
        )}
      </div>
    </section>
  );
}

function ProductionSnapshot({ rows, kind }: { rows: DashboardSummaryModel["production"]; kind: DashboardSummaryModel["kind"] }) {
  return <section className="panel overflow-hidden"><div className="flex items-center gap-3 border-b border-border px-4 py-3.5"><span className="flex size-9 items-center justify-center rounded-md bg-accent text-primary"><Gauge className="size-[18px]" aria-hidden /></span><div><h3 className="text-sm font-semibold text-foreground">{kind === "editor" ? "My workload" : "Production snapshot"}</h3><p className="text-xs text-muted-foreground">Current totals</p></div></div><div className="grid grid-cols-2 gap-px bg-border">{rows.map((row) => <div key={row.label} className="min-h-24 bg-card p-4"><p className="text-2xl font-semibold text-foreground">{row.count}</p><p className="mt-1 text-xs text-muted-foreground">{row.label}</p></div>)}</div></section>;
}

function EditorWorkload({ rows }: { rows: DashboardSummaryModel["workloads"] }) {
  return <section className="panel overflow-hidden"><div className="flex items-center gap-3 border-b border-border px-4 py-3.5"><span className="flex size-9 items-center justify-center rounded-md bg-accent text-primary"><Gauge className="size-[18px]" aria-hidden /></span><div><h3 className="text-sm font-semibold text-foreground">Editor workload</h3><p className="text-xs text-muted-foreground">Active assignments and available capacity</p></div></div>{rows.length ? <div className="max-h-72 divide-y divide-border overflow-y-auto">{rows.map((row) => { const ratio = row.capacity ? Math.min(100, Math.round((row.active / row.capacity) * 100)) : 0; return <div key={row.id} className="px-4 py-3"><div className="flex items-center gap-3"><Avatar name={row.name} src={row.avatarUrl} className="size-8" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-medium text-foreground">{row.name}</p><div className="flex flex-col items-end"><p className={cn("text-xs font-medium", row.active >= row.capacity ? "text-warning" : "text-muted-foreground")}>{row.active} of {row.capacity} active</p>{row.avgSecondsPerVideo !== undefined && row.avgSecondsPerVideo > 0 ? <p className="mt-0.5 text-[10px] text-muted-foreground">avg. {formatDurationHours(row.avgSecondsPerVideo / 3600)} / video</p> : null}</div></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", row.active >= row.capacity ? "bg-warning" : "bg-primary")} style={{ width: `${ratio}%` }} /></div></div></div></div>; })}</div> : <div className="px-5 py-10 text-center text-sm text-muted-foreground"><AlertTriangle className="mx-auto mb-2 size-5 text-border" aria-hidden />No active editors</div>}</section>;
}
