"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FilePlus2,
  Film,
  Layers,
  Loader2,
  MessageSquareWarning,
  Repeat2,
  Users,
  X
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { ProductionStageBadge } from "@/components/workflow/production-stage";
import { productionStages } from "@/lib/production-workflow";
import type { ProductionStage } from "@/lib/types";
import { formatDateOnly, formatDateTime, cn } from "@/lib/utils";
import {
  categorizeWorkLogAction,
  enumerateDays,
  formatWorkLogDuration,
  workLogDayKey,
  type WorkLogCategory,
  type WorkLogCreative,
  type WorkLogEvent,
  type WorkLogReport,
  type WorkLogSummary
} from "@/lib/work-log";

export type WorkLogPersonOption = { id: string; name: string; role: string; avatar_url: string | null; active: boolean };

const roleLabels: Record<string, string> = { content_creator: "Creator", editor: "Editor", manager: "Manager", admin: "Admin" };
const roleOrder = ["content_creator", "editor", "manager", "admin"];

function shift(day: string, delta: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

function monthName(value: string) {
  try {
    return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}-01T00:00:00Z`));
  } catch {
    return value;
  }
}

function weekdayNarrow(value: string) {
  try {
    return new Intl.DateTimeFormat("en-IN", { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  } catch {
    return "";
  }
}

function emptySummary(): WorkLogSummary {
  const zero = Object.fromEntries(productionStages.map((stage) => [stage, 0])) as Record<ProductionStage, number>;
  return {
    newSubmissions: 0,
    resubmissions: 0,
    revisionsRequested: 0,
    approvals: 0,
    updates: 0,
    reviewsDone: 0,
    statusChanges: 0,
    totalEvents: 0,
    creativesTouched: 0,
    editingSeconds: 0,
    stageCounts: { ...zero },
    currentStageCounts: { ...zero }
  };
}

export function WorkLogClient({
  people,
  reports,
  from,
  to,
  today,
  selectedId
}: {
  people: WorkLogPersonOption[];
  reports: Record<string, WorkLogReport>;
  from: string;
  to: string;
  today: string;
  selectedId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [viewMode, setViewMode] = useState<"sheet" | "detail">("sheet");
  const [lightboxData, setLightboxData] = useState<{ person: WorkLogPersonOption; date: string } | null>(null);

  function navigate(next: { person?: string; from?: string; to?: string }) {
    const params = new URLSearchParams();
    const person = next.person ?? selectedId;
    if (person !== "all") params.set("person", person);
    params.set("from", next.from ?? from);
    params.set("to", next.to ?? to);
    startTransition(() => router.replace(`${pathname}?${params}`));
  }

  const currentMonthKey = from.slice(0, 7);
  const changeMonth = (offset: number) => {
    const [year, monthNum] = currentMonthKey.split("-").map(Number);
    const next = new Date(Date.UTC(year, monthNum - 1 + offset, 1));
    const nextMonth = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
    const count = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    navigate({
      from: `${nextMonth}-01`,
      to: `${nextMonth}-${String(count).padStart(2, "0")}`
    });
  };

  const presets: Array<{ label: string; from: string; to: string }> = [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: shift(today, -1), to: shift(today, -1) },
    { label: "Last 7 days", from: shift(today, -6), to: today },
    { label: "Last 30 days", from: shift(today, -29), to: today },
    { label: "This month", from: `${today.slice(0, 8)}01`, to: today }
  ];

  const sameDay = from === to;
  const rangeLabel = sameDay ? formatDateOnly(from) : `${formatDateOnly(from)} – ${formatDateOnly(to)}`;
  const selected = selectedId === "all" ? null : people.find((item) => item.id === selectedId) ?? null;
  const grouped = roleOrder.map((role) => ({ role, items: people.filter((item) => item.role === role) })).filter((group) => group.items.length);
  const allDays = useMemo(() => enumerateDays(from, to), [from, to]);

  const activeLightboxReport = lightboxData ? reports[lightboxData.person.id] : undefined;

  return (
    <div className="space-y-6" aria-busy={isPending}>
      {/* Top Filter and Date Control Panel */}
      <section className="panel flex flex-col gap-4 p-4 lg:flex-row lg:items-end">
        <label className="block min-w-[220px] space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Person</span>
          <Select id="work-log-person" value={selectedId} onChange={(event) => navigate({ person: event.target.value })}>
            <option value="all">Whole team</option>
            {grouped.map((group) => (
              <optgroup key={group.role} label={`${roleLabels[group.role] ?? group.role}s`}>
                {group.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.active ? "" : " (inactive)"}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">From</span>
          <Input id="work-log-from" type="date" value={from} max={to} onChange={(event) => event.target.value && navigate({ from: event.target.value, to: event.target.value > to ? event.target.value : to })} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">To</span>
          <Input id="work-log-to" type="date" value={to} min={from} onChange={(event) => event.target.value && navigate({ to: event.target.value, from: event.target.value < from ? event.target.value : from })} />
        </label>
        <div className="flex flex-wrap items-center gap-1.5 lg:ml-auto">
          {presets.map((preset) => {
            const active = preset.from === from && preset.to === to;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => navigate({ from: preset.from, to: preset.to })}
                className={cn(
                  "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-ring/50 hover:text-foreground"
                )}
              >
                {preset.label}
              </button>
            );
          })}
          {isPending ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" /> : null}
        </div>
      </section>

      {/* Calendar Month Navigation & View Mode Switcher */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border bg-card p-3 shadow-soft">
        <div className="flex items-center gap-1.5">
          <Button size="icon" variant="ghost" title="Previous month" onClick={() => changeMonth(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <div className="min-w-36 text-center">
            <p className="text-sm font-semibold text-foreground">{monthName(currentMonthKey)}</p>
            <p className="text-xs text-muted-foreground">Monthly calendar sheet</p>
          </div>
          <Button size="icon" variant="ghost" title="Next month" onClick={() => changeMonth(1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("sheet")}
              className={cn(
                "rounded-md px-3 py-1 font-medium transition-colors",
                viewMode === "sheet" ? "bg-primary text-primary-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Calendar Sheet
            </button>
            <button
              type="button"
              onClick={() => setViewMode("detail")}
              className={cn(
                "rounded-md px-3 py-1 font-medium transition-colors",
                viewMode === "detail" ? "bg-primary text-primary-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Detailed Timeline
            </button>
          </div>
        </div>
      </section>

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarDays className="size-4" aria-hidden />
        Showing {selected ? <span className="font-medium text-foreground">{selected.name}</span> : <span className="font-medium text-foreground">the whole team</span>} · {rangeLabel} <span className="text-xs">(IST)</span>
      </p>

      {/* Main View Area */}
      {viewMode === "sheet" ? (
        <TeamCalendarSheet
          people={selected ? [selected] : people}
          reports={reports}
          days={allDays}
          today={today}
          onOpenLightbox={(person, date) => setLightboxData({ person, date })}
        />
      ) : selected ? (
        <PersonDetail
          person={selected}
          report={reports[selected.id]}
          onOpenLightbox={(date) => setLightboxData({ person: selected, date })}
        />
      ) : (
        <TeamOverview people={people} reports={reports} onSelect={(id) => navigate({ person: id })} />
      )}

      {/* Interactive Day Details Lightbox */}
      {lightboxData ? (
        <WorkLogDayLightbox
          person={lightboxData.person}
          date={lightboxData.date}
          report={activeLightboxReport}
          onClose={() => setLightboxData(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Team Calendar Sheet - Pattern matching Daily Targets team target sheet.
 * Left column: Team Member (fixed 224px). Middle: Total count (fixed 128px). Right: Day 1..31 cells (strictly 50px each).
 * Clicking any cell opens the interactive Lightbox.
 */
function TeamCalendarSheet({
  people,
  reports,
  days,
  today,
  onOpenLightbox
}: {
  people: WorkLogPersonOption[];
  reports: Record<string, WorkLogReport>;
  days: string[];
  today: string;
  onOpenLightbox: (person: WorkLogPersonOption, date: string) => void;
}) {
  const rows = people.map((person) => {
    const report = reports[person.id];
    const summary = report?.summary ?? emptySummary();
    const dayMap = new Map((report?.days ?? []).map((d) => [d.date, d]));
    const totalActions = summary.totalEvents;
    const isEditor = person.role === "editor";
    return { person, summary, dayMap, totalActions, isEditor };
  });

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      <div className="border-b border-border px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="font-semibold text-foreground">Work Log Calendar Sheet</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Each cell displays total work done (new submissions, resubmissions, revisions and status changes). Click any day box to open detailed logs.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded bg-primary" /> Active work
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded bg-muted border border-border" /> No activity
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" /> Today
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table-fixed text-xs border-collapse">
          <colgroup>
            <col className="w-56 min-w-[224px] max-w-[224px]" />
            <col className="w-32 min-w-[128px] max-w-[128px]" />
            {days.map((date) => (
              <col key={date} className="w-[50px] min-w-[50px] max-w-[50px]" />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="sticky left-0 z-20 w-56 min-w-[224px] max-w-[224px] border-r border-border bg-muted px-4 py-3 text-left text-muted-foreground font-semibold">
                Team member
              </th>
              <th className="w-32 min-w-[128px] max-w-[128px] border-r border-border px-3 py-3 text-center text-muted-foreground font-semibold">
                Period Total
              </th>
              {days.map((date) => {
                const isToday = date === today;
                return (
                  <th
                    key={date}
                    className={cn(
                      "w-[50px] min-w-[50px] max-w-[50px] p-1 text-center border-r border-border/30",
                      isToday && "bg-primary/10 text-primary font-semibold"
                    )}
                  >
                    <span className="block text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      {weekdayNarrow(date)}
                    </span>
                    <span className="block text-xs font-bold leading-tight">
                      {Number(date.slice(-2))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ person, summary, dayMap, totalActions, isEditor }) => (
              <tr key={person.id} className="hover:bg-muted/20 transition-colors">
                {/* Sticky Team Member Column */}
                <td className="sticky left-0 z-10 w-56 min-w-[224px] max-w-[224px] border-r border-border bg-card px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={person.name} src={person.avatar_url} className="size-8 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">{person.name}</p>
                      <p className="text-[11px] text-muted-foreground">{roleLabels[person.role] ?? person.role}</p>
                    </div>
                  </div>
                </td>

                {/* Period Total Summary */}
                <td className="w-32 min-w-[128px] max-w-[128px] border-r border-border px-2 py-2 text-center align-middle">
                  <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold bg-primary/10 text-primary">
                    {totalActions > 0
                      ? `${totalActions} ${totalActions === 1 ? "action" : "actions"}`
                      : summary.editingSeconds > 0
                      ? formatWorkLogDuration(summary.editingSeconds)
                      : "0 actions"}
                  </span>
                  <p className="mt-1 font-semibold text-foreground text-xs">
                    {summary.creativesTouched} {summary.creativesTouched === 1 ? "creative" : "creatives"}
                  </p>
                  {isEditor && summary.editingSeconds > 0 && totalActions > 0 ? (
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                      {formatWorkLogDuration(summary.editingSeconds)}
                    </p>
                  ) : null}
                </td>

                {/* Day Cells - Exactly 44px by 44px uniform square boxes */}
                {days.map((date) => {
                  const day = dayMap.get(date);
                  const dayCount = day?.totalEvents ?? 0;
                  const dayEditing = day?.editingSeconds ?? 0;
                  const hasDayActivity = dayCount > 0 || dayEditing > 0;
                  const isToday = date === today;

                  let subLabel = "";
                  if (dayCount > 0 && isEditor && dayEditing > 0) {
                    subLabel = formatWorkLogDuration(dayEditing);
                  } else if (day && day.newSubmissions > 0) {
                    subLabel = `${day.newSubmissions} new`;
                  } else if (day && day.resubmissions > 0) {
                    subLabel = `${day.resubmissions} resub`;
                  } else if (day && day.revisionsRequested > 0) {
                    subLabel = `${day.revisionsRequested} rev`;
                  } else if (day && day.approvals > 0) {
                    subLabel = `${day.approvals} app`;
                  } else if (dayCount === 0 && dayEditing > 0) {
                    subLabel = "editing";
                  } else if (dayCount > 0) {
                    subLabel = "logs";
                  }

                  return (
                    <td
                      key={date}
                      className="w-[50px] min-w-[50px] max-w-[50px] p-1 text-center align-middle border-r border-border/30"
                    >
                      <button
                        type="button"
                        onClick={() => onOpenLightbox(person, date)}
                        title={`${person.name} on ${date}: ${dayCount} actions, ${day?.newSubmissions ?? 0} new, ${day?.resubmissions ?? 0} resubmitted${dayEditing ? `, ${formatWorkLogDuration(dayEditing)} editing` : ""}. Click for full logs.`}
                        className={cn(
                          "group relative flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg border text-[10px] transition-all duration-150 cursor-pointer mx-auto overflow-hidden",
                          hasDayActivity
                            ? "border-primary/40 bg-primary/10 text-primary font-semibold shadow-2xs hover:bg-primary/20 hover:border-primary hover:scale-105"
                            : "border-border/50 bg-muted/20 text-muted-foreground/40 hover:border-border hover:bg-muted/50 hover:text-muted-foreground",
                          isToday && !hasDayActivity && "border-primary/50 bg-primary/5 text-primary/70",
                          isToday && hasDayActivity && "ring-2 ring-primary/40"
                        )}
                      >
                        {isToday ? (
                          <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" title="Today" />
                        ) : null}
                        {hasDayActivity ? (
                          <>
                            <span className="text-xs font-bold leading-tight">
                              {dayCount > 0 ? dayCount : formatWorkLogDuration(dayEditing)}
                            </span>
                            <span className="text-[8px] font-medium opacity-80 leading-none truncate max-w-[36px] mt-0.5">
                              {subLabel}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs font-light text-muted-foreground/30 group-hover:text-muted-foreground/70">—</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Interactive Lightbox Dialog showing complete logs for a specific person on a specific day.
 */
function WorkLogDayLightbox({
  person,
  date,
  report,
  onClose
}: {
  person: WorkLogPersonOption;
  date: string;
  report?: WorkLogReport;
  onClose: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState<"all" | WorkLogCategory | "time_sessions">("all");

  const daySummary = report?.days.find((d) => d.date === date);
  const timeSessions = daySummary?.timeSessions ?? [];

  // Extract all events that occurred on this specific day for this person
  const dayEvents = useMemo(() => {
    if (!report?.creatives) return [];
    const events: Array<WorkLogEvent & { creativeName: string; currentStage: ProductionStage }> = [];

    for (const creative of report.creatives) {
      for (const event of creative.events) {
        if (workLogDayKey(event.at) === date) {
          events.push({
            ...event,
            creativeName: creative.name,
            currentStage: creative.currentStage
          });
        }
      }
    }

    return events.sort((a, b) => b.at.localeCompare(a.at));
  }, [report, date]);

  // Group events by category
  const categorized = useMemo(() => {
    const newlySubmitted = dayEvents.filter((e) => categorizeWorkLogAction(e.action) === "newly_submitted");
    const resubmitted = dayEvents.filter((e) => categorizeWorkLogAction(e.action) === "resubmitted");
    const revisionRequested = dayEvents.filter((e) => categorizeWorkLogAction(e.action) === "revision_requested");
    const approved = dayEvents.filter((e) => categorizeWorkLogAction(e.action) === "approved");
    const other = dayEvents.filter((e) => categorizeWorkLogAction(e.action) === "other");

    return {
      all: dayEvents,
      newly_submitted: newlySubmitted,
      resubmitted: resubmitted,
      revision_requested: revisionRequested,
      approved: approved,
      other: other
    };
  }, [dayEvents]);

  const filteredEvents = activeCategory === "all" || activeCategory === "time_sessions" ? dayEvents : categorized[activeCategory];
  const totalItemCount = dayEvents.length + timeSessions.length;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-950/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <section
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-border bg-card shadow-float overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-muted/20">
          <div className="flex items-center gap-3">
            <Avatar name={person.name} src={person.avatar_url} className="size-10" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-foreground">{person.name}</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground border border-border">
                  {roleLabels[person.role] ?? person.role}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Work Log for <span className="font-semibold text-foreground">{formatDateOnly(date)}</span> (IST)
              </p>
            </div>
          </div>
          <Button size="icon" variant="ghost" title="Close" onClick={onClose}>
            <X className="size-5" />
          </Button>
        </div>

        {/* Quick KPI summary badges for the day */}
        <div className="border-b border-border bg-card px-5 py-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 font-semibold text-primary">
            <FilePlus2 className="size-3.5" />
            {categorized.newly_submitted.length} Newly Submitted
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-purple-500/20 bg-purple-500/10 px-2.5 py-1 font-semibold text-purple-600 dark:text-purple-400">
            <Repeat2 className="size-3.5" />
            {categorized.resubmitted.length} Resubmitted
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/20 bg-warning/10 px-2.5 py-1 font-semibold text-warning">
            <MessageSquareWarning className="size-3.5" />
            {categorized.revision_requested.length} Sent for Revision
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-success/20 bg-success/10 px-2.5 py-1 font-semibold text-success">
            <CheckCircle2 className="size-3.5" />
            {categorized.approved.length} Approved
          </span>
          {daySummary && daySummary.editingSeconds > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 font-semibold text-foreground font-mono">
              <Clock className="size-3.5" />
              {formatWorkLogDuration(daySummary.editingSeconds)} Editing
            </span>
          ) : null}
        </div>

        {/* Category Tabs inside Lightbox */}
        <div className="border-b border-border bg-muted/30 px-5 pt-2 flex flex-wrap gap-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveCategory("all")}
            className={cn(
              "px-3 py-1.5 border-b-2 font-medium transition-colors text-xs",
              activeCategory === "all"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            All Logs ({dayEvents.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory("newly_submitted")}
            className={cn(
              "px-3 py-1.5 border-b-2 font-medium transition-colors text-xs",
              activeCategory === "newly_submitted"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            New ({categorized.newly_submitted.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory("resubmitted")}
            className={cn(
              "px-3 py-1.5 border-b-2 font-medium transition-colors text-xs",
              activeCategory === "resubmitted"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Resubmitted ({categorized.resubmitted.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory("revision_requested")}
            className={cn(
              "px-3 py-1.5 border-b-2 font-medium transition-colors text-xs",
              activeCategory === "revision_requested"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Revisions ({categorized.revision_requested.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory("approved")}
            className={cn(
              "px-3 py-1.5 border-b-2 font-medium transition-colors text-xs",
              activeCategory === "approved"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Approved ({categorized.approved.length})
          </button>
          {timeSessions.length > 0 ? (
            <button
              type="button"
              onClick={() => setActiveCategory("time_sessions")}
              className={cn(
                "px-3 py-1.5 border-b-2 font-medium transition-colors text-xs",
                activeCategory === "time_sessions"
                  ? "border-primary text-foreground font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Editing Sessions ({timeSessions.length})
            </button>
          ) : null}
        </div>

        {/* Body Event List */}
        <div className="overflow-y-auto p-5 space-y-3 flex-1">
          {/* Editing sessions on this day */}
          {(activeCategory === "all" || activeCategory === "time_sessions") && timeSessions.length > 0 ? (
            <div className="space-y-2 mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Editing Sessions ({timeSessions.length})
              </p>
              <ul className="space-y-2">
                {timeSessions.map((session) => (
                  <li
                    key={session.id}
                    className="rounded-lg border border-accent bg-accent/30 p-3 text-xs transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/ads/${session.adId}`}
                          className="font-semibold text-foreground hover:text-primary transition-colors inline-flex items-center gap-1"
                        >
                          <span>{session.adName}</span>
                          <ArrowUpRight className="size-3 text-muted-foreground" />
                        </Link>
                        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-foreground border border-border">
                          {formatWorkLogDuration(session.seconds)}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-muted-foreground">
                        {formatDateTime(session.startedAt).split(",")[1]?.trim() || session.startedAt}
                        {session.endedAt
                          ? ` – ${formatDateTime(session.endedAt).split(",")[1]?.trim() || session.endedAt}`
                          : " (ongoing)"}
                      </span>
                    </div>
                    {session.pauseReason ? (
                      <p className="mt-1 text-xs text-muted-foreground italic">
                        Pause reason: {session.pauseReason}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Activity Log Events */}
          {activeCategory !== "time_sessions" && filteredEvents.length > 0 ? (
            <ol className="space-y-3">
              {filteredEvents.map((event) => {
                const category = categorizeWorkLogAction(event.action);
                const isRevision = category === "revision_requested";
                const isApproval = category === "approved";
                const isNew = category === "newly_submitted";
                const isResub = category === "resubmitted";

                return (
                  <li
                    key={event.id}
                    className={cn(
                      "rounded-lg border p-3 text-xs transition-colors",
                      isRevision
                        ? "border-warning/30 bg-warning/5"
                        : isApproval
                        ? "border-success/30 bg-success/5"
                        : isNew
                        ? "border-primary/30 bg-primary/5"
                        : isResub
                        ? "border-purple-500/30 bg-purple-500/5"
                        : "border-border bg-card"
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/ads/${event.adId}`}
                          className="font-semibold text-foreground hover:text-primary transition-colors inline-flex items-center gap-1"
                        >
                          <span>{event.creativeName}</span>
                          <ArrowUpRight className="size-3 text-muted-foreground" />
                        </Link>
                        {event.stage ? (
                          <ProductionStageBadge stage={event.stage} className="h-5 px-1.5 text-[9px]" />
                        ) : null}
                      </div>
                      <span className="text-[11px] font-mono text-muted-foreground">
                        {formatDateTime(event.at).split(",")[1]?.trim() || formatDateTime(event.at)}
                      </span>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          isRevision
                            ? "bg-warning/15 text-warning font-semibold"
                            : isApproval
                            ? "bg-success/15 text-success font-semibold"
                            : isNew
                            ? "bg-primary/15 text-primary font-semibold"
                            : isResub
                            ? "bg-purple-500/15 text-purple-600 dark:text-purple-400 font-semibold"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {event.label}
                      </span>
                      {event.direction === "on_their_work" ? (
                        <span className="text-muted-foreground">
                          by <span className="font-medium text-foreground">{event.actorName ?? "Reviewer"}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">by {person.name}</span>
                      )}
                    </div>

                    {event.note ? (
                      <div className="mt-2 rounded border border-border/80 bg-background/80 p-2 text-xs text-foreground/90 italic">
                        “{event.note}”
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : activeCategory !== "time_sessions" && timeSessions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Film className="mx-auto size-8 opacity-40 mb-2" />
              <p className="text-sm font-medium text-foreground">No logs in this category</p>
              <p className="text-xs mt-1">There were no recorded actions in this filter on {formatDateOnly(date)}.</p>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3 flex items-center justify-between bg-muted/10">
          <p className="text-[11px] text-muted-foreground">
            {dayEvents.length} action{dayEvents.length === 1 ? "" : "s"}
            {timeSessions.length > 0 ? ` · ${timeSessions.length} editing session${timeSessions.length === 1 ? "" : "s"}` : ""} on this day
          </p>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </section>
    </div>
  );
}

function TeamOverview({ people, reports, onSelect }: { people: WorkLogPersonOption[]; reports: Record<string, WorkLogReport>; onSelect: (id: string) => void }) {
  const rows = people
    .map((person) => ({ person, summary: reports[person.id]?.summary ?? null }))
    .filter((row): row is { person: WorkLogPersonOption; summary: WorkLogSummary } => row.summary !== null)
    .sort((a, b) => (b.summary.newSubmissions - a.summary.newSubmissions) || (b.summary.statusChanges - a.summary.statusChanges));
  const totals = rows.reduce((acc, row) => {
    acc.newSubmissions += row.summary.newSubmissions;
    acc.resubmissions += row.summary.resubmissions;
    acc.statusChanges += row.summary.statusChanges;
    acc.editingSeconds += row.summary.editingSeconds;
    return acc;
  }, { newSubmissions: 0, resubmissions: 0, statusChanges: 0, editingSeconds: 0 });
  const idle = people.filter((person) => person.active && !reports[person.id]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<FilePlus2 className="size-4" />} label="New submissions" value={totals.newSubmissions} tone="primary" />
        <Kpi icon={<Repeat2 className="size-4" />} label="Resubmissions" value={totals.resubmissions} />
        <Kpi icon={<CheckCircle2 className="size-4" />} label="Status changes" value={totals.statusChanges} />
        <Kpi icon={<Clock className="size-4" />} label="Editing time" value={formatWorkLogDuration(totals.editingSeconds)} />
      </div>

      {rows.length ? (
        <section className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Person</th>
                  <th className="px-3 py-3 text-center font-semibold">New</th>
                  <th className="px-3 py-3 text-center font-semibold">Resubmitted</th>
                  <th className="px-3 py-3 text-center font-semibold">Status changes</th>
                  <th className="px-3 py-3 text-center font-semibold">Approved</th>
                  <th className="px-3 py-3 text-center font-semibold">Creatives</th>
                  <th className="px-3 py-3 text-center font-semibold">Editing time</th>
                  <th className="w-10 px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(({ person, summary }) => (
                  <tr key={person.id} className="cursor-pointer transition-colors hover:bg-muted" onClick={() => onSelect(person.id)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={person.name} src={person.avatar_url} className="size-8" />
                        <div>
                          <p className="font-medium text-foreground">{person.name}</p>
                          <p className="text-xs text-muted-foreground">{roleLabels[person.role] ?? person.role}</p>
                        </div>
                      </div>
                    </td>
                    <Cell value={summary.newSubmissions} strong />
                    <Cell value={summary.resubmissions} />
                    <Cell value={summary.statusChanges} />
                    <Cell value={summary.stageCounts.approved} />
                    <Cell value={summary.creativesTouched} />
                    <td className="px-3 py-3 text-center text-muted-foreground">{formatWorkLogDuration(summary.editingSeconds)}</td>
                    <td className="px-3 py-3 text-muted-foreground"><ChevronRight className="size-4" aria-hidden /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <EmptyState title="No activity in this period" hint="Try a wider date range to see what the team worked on." />
      )}

      {idle.length ? (
        <p className="text-xs text-muted-foreground">
          <Users className="mr-1.5 inline size-3.5" aria-hidden />
          No recorded work: {idle.map((person) => person.name).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function PersonDetail({
  person,
  report,
  onOpenLightbox
}: {
  person: WorkLogPersonOption;
  report?: WorkLogReport;
  onOpenLightbox?: (date: string) => void;
}) {
  const summary = report?.summary ?? emptySummary();
  const days = report?.days ?? [];
  const creatives = report?.creatives ?? [];
  const stagesWithChanges = productionStages.filter((stage) => summary.stageCounts[stage] > 0);
  const standing = productionStages.filter((stage) => summary.currentStageCounts[stage] > 0);
  const isEditor = person.role === "editor";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Avatar name={person.name} src={person.avatar_url} className="size-11" />
        <div>
          <h2 className="text-lg font-semibold text-foreground">{person.name}</h2>
          <p className="text-xs text-muted-foreground">{roleLabels[person.role] ?? person.role}{person.active ? "" : " · inactive"}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={<FilePlus2 className="size-4" />} label="New submissions" value={summary.newSubmissions} tone="primary" />
        <Kpi icon={<Repeat2 className="size-4" />} label="Resubmissions" value={summary.resubmissions} />
        <Kpi icon={<Film className="size-4" />} label="Creatives touched" value={summary.creativesTouched} />
        <Kpi icon={<CheckCircle2 className="size-4" />} label="Status changes" value={summary.statusChanges} />
        <Kpi icon={<MessageSquareWarning className="size-4" />} label="Reviews done" value={summary.reviewsDone} />
        <Kpi icon={<Clock className="size-4" />} label={isEditor ? "Editing time" : "Time tracked"} value={formatWorkLogDuration(summary.editingSeconds)} />
      </div>

      {summary.creativesTouched === 0 && summary.editingSeconds === 0 ? (
        <EmptyState title={`No recorded work for ${person.name}`} hint="Nothing was submitted or moved in this period. Try another date range." />
      ) : (
        <>
          <section className="panel p-4">
            <h3 className="text-sm font-semibold text-foreground">Status changes in this period</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Each time one of their creatives moved into a status.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {stagesWithChanges.length ? stagesWithChanges.map((stage) => (
                <span key={stage} className="inline-flex items-center gap-2">
                  <ProductionStageBadge stage={stage} />
                  <span className="-ml-1 text-sm font-semibold text-foreground">×{summary.stageCounts[stage]}</span>
                </span>
              )) : <span className="text-sm text-muted-foreground">No status changes recorded.</span>}
            </div>
            {standing.length ? (
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-xs font-medium text-muted-foreground">Where these creatives stand now</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {standing.map((stage) => (
                    <span key={stage} className="inline-flex items-center gap-2">
                      <ProductionStageBadge stage={stage} className="bg-muted text-muted-foreground" />
                      <span className="-ml-1 text-sm font-semibold text-foreground">{summary.currentStageCounts[stage]}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {days.length > 1 ? (
            <section className="panel overflow-hidden">
              <div className="border-b border-border px-4 py-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Day by day</h3>
                <span className="text-xs text-muted-foreground">Click a row to open day details lightbox</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-muted text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Date</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Actions</th>
                      <th className="px-3 py-2.5 text-center font-semibold">New</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Resubmitted</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Status changes</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Creatives</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Editing time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[...days].reverse().map((day) => {
                      const quiet = !day.totalEvents && !day.newSubmissions && !day.resubmissions && !day.statusChanges && !day.creativesTouched && !day.editingSeconds;
                      return (
                        <tr
                          key={day.date}
                          className={cn("cursor-pointer hover:bg-muted/50 transition-colors", quiet && "text-muted-foreground")}
                          onClick={() => onOpenLightbox?.(day.date)}
                        >
                          <td className="px-4 py-2.5 font-medium flex items-center gap-1.5">
                            <span>{formatDateOnly(day.date)}</span>
                            <ArrowUpRight className="size-3 text-muted-foreground opacity-60" />
                          </td>
                          <Cell value={day.totalEvents} strong />
                          <Cell value={day.newSubmissions} />
                          <Cell value={day.resubmissions} />
                          <Cell value={day.statusChanges} />
                          <Cell value={day.creativesTouched} />
                          <td className="px-3 py-2.5 text-center">{formatWorkLogDuration(day.editingSeconds)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Creatives worked on ({creatives.length})</h3>
            {creatives.map((creative) => <CreativeTimeline key={creative.adId} creative={creative} defaultOpen={creatives.length <= 6} />)}
          </section>
        </>
      )}
    </div>
  );
}

function CreativeTimeline({ creative, defaultOpen }: { creative: WorkLogCreative; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <article className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen((current) => !current)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
          {open ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <span className="truncate font-medium text-foreground">{creative.name}</span>
          {creative.newInRange ? <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">New</span> : null}
          {creative.roles.map((role) => <span key={role} className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{role === "creator" ? "Creator" : "Editor"}</span>)}
        </button>
        {creative.editingSeconds ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3.5" aria-hidden />{formatWorkLogDuration(creative.editingSeconds)}</span> : null}
        <ProductionStageBadge stage={creative.currentStage} />
        <Link href={`/ads/${creative.adId}`} className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground" title="Open creative"><ArrowUpRight className="size-4" aria-hidden /></Link>
      </div>
      {open ? (
        creative.events.length ? (
          <ol className="space-y-0 border-t border-border px-4 py-3">
            {creative.events.map((event) => (
              <li key={event.id} className="relative flex gap-3 pb-3 last:pb-0">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-foreground">{event.label}</span>
                    {event.stage ? <ProductionStageBadge stage={event.stage} className="h-5 px-2 text-[10px]" /> : null}
                    {event.direction === "on_their_work" ? <span className="text-xs text-muted-foreground">by {event.actorName ?? "someone else"}</span> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDateTime(event.at)}</p>
                  {event.note ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={event.note}>“{event.note}”</p> : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">Editing time logged; no status changes in this period.</p>
        )
      ) : null}
    </article>
  );
}

function Kpi({ icon, label, value, tone = "default" }: { icon: React.ReactNode; label: string; value: string | number; tone?: "default" | "primary" }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className={cn("flex size-7 items-center justify-center rounded-md", tone === "primary" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{icon}</span>
        {label}
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function Cell({ value, strong }: { value: number; strong?: boolean }) {
  return <td className={cn("px-3 py-3 text-center", value === 0 ? "text-muted-foreground" : strong ? "font-semibold text-foreground" : "text-foreground")}>{value}</td>;
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="panel flex flex-col items-center py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><CalendarDays className="size-5" aria-hidden /></span>
      <p className="mt-4 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
