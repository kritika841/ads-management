"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  History,
  Layers,
  LogIn,
  LogOut,
  Monitor,
  Search,
  ShieldCheck,
  Timer,
  UserCheck,
  Users
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { formatAttendanceTime } from "@/lib/attendance-shared";
import {
  formatDateTimeIST,
  formatSessionDuration,
  formatTimeShort,
  type UserTimeSession,
  type UserSessionActivity
} from "@/lib/user-sessions-shared";
import { formatDateOnly, cn } from "@/lib/utils";
import type { WorkLogPersonOption } from "@/components/admin/work-log-client";
import type { WorkLogReport } from "@/lib/work-log";

const roleLabels: Record<string, string> = {
  content_creator: "Creator",
  editor: "Editor",
  manager: "Manager",
  admin: "Admin"
};

export function TimeLogSheet({
  people,
  reports,
  sessions,
  days,
  today,
  from,
  to,
  onOpenLightbox
}: {
  people: WorkLogPersonOption[];
  reports: Record<string, WorkLogReport>;
  sessions: UserTimeSession[];
  days: string[];
  today: string;
  from: string;
  to: string;
  onOpenLightbox?: (person: WorkLogPersonOption, date: string) => void;
}) {
  const [selectedPersonId, setSelectedPersonId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "idle_5m" | "completed">("all");
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});

  const toggleSession = (id: string) => {
    setExpandedSessions((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    for (const s of filteredSessions) {
      next[s.id] = true;
    }
    setExpandedSessions(next);
  };

  const collapseAll = () => {
    setExpandedSessions({});
  };

  // Filter sessions based on person, status, and search query
  const filteredSessions = useMemo(() => {
    return sessions.filter((session) => {
      if (selectedPersonId !== "all" && session.user_id !== selectedPersonId) {
        return false;
      }

      if (statusFilter === "active" && Boolean(session.session_ended_at)) {
        return false;
      }
      if (statusFilter === "idle_5m" && session.end_reason !== "idle_5m") {
        return false;
      }
      if (statusFilter === "completed" && !session.session_ended_at) {
        return false;
      }

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesUser = session.user_name.toLowerCase().includes(query);
        const matchesActivities = (session.activities || []).some(
          (act) => act.description.toLowerCase().includes(query) || (act.path && act.path.toLowerCase().includes(query))
        );
        if (!matchesUser && !matchesActivities) {
          return false;
        }
      }

      return true;
    });
  }, [sessions, selectedPersonId, statusFilter, searchQuery]);

  // Aggregate KPI summary metrics
  const stats = useMemo(() => {
    const totalSeconds = filteredSessions.reduce((acc, s) => acc + (s.duration_seconds || 0), 0);
    const idleCheckoutCount = filteredSessions.filter((s) => s.end_reason === "idle_5m").length;
    const activeNowCount = filteredSessions.filter((s) => !s.session_ended_at).length;
    const uniqueUsers = new Set(filteredSessions.map((s) => s.user_id)).size;

    return {
      totalSeconds,
      sessionCount: filteredSessions.length,
      idleCheckoutCount,
      activeNowCount,
      uniqueUsers
    };
  }, [filteredSessions]);

  // Group filtered sessions and days (newest days first)
  const sortedDays = useMemo(() => {
    return [...days].reverse();
  }, [days]);

  // Map of sessions by date and person
  const sessionsByDateAndPerson = useMemo(() => {
    const map = new Map<string, Map<string, UserTimeSession[]>>();
    for (const s of filteredSessions) {
      if (!map.has(s.date)) {
        map.set(s.date, new Map());
      }
      const dayMap = map.get(s.date)!;
      if (!dayMap.has(s.user_id)) {
        dayMap.set(s.user_id, []);
      }
      dayMap.get(s.user_id)!.push(s);
    }
    return map;
  }, [filteredSessions]);

  // People map for lookup
  const peopleMap = useMemo(() => {
    return new Map(people.map((p) => [p.id, p]));
  }, [people]);

  return (
    <div className="space-y-6">
      {/* Top Admin Notice & KPI Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI: Total Active App Time */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Total App Active Time
            </span>
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Clock className="size-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-foreground font-mono">
            {formatSessionDuration(stats.totalSeconds)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Combined active usage in range
          </p>
        </div>

        {/* KPI: Total App Sessions */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              App Access Sessions
            </span>
            <div className="flex size-8 items-center justify-center rounded-lg bg-accent/40 text-accent-foreground">
              <Monitor className="size-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-foreground font-mono">
            {stats.sessionCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {stats.activeNowCount > 0 ? (
              <span className="text-success font-medium flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-success animate-pulse" />
                {stats.activeNowCount} active right now
              </span>
            ) : (
              "Individual work intervals"
            )}
          </p>
        </div>

        {/* KPI: 5-Minute Inactive Checkouts */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              5m Idle Checkouts
            </span>
            <div className="flex size-8 items-center justify-center rounded-lg bg-warning/10 text-warning">
              <Timer className="size-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-foreground font-mono">
            {stats.idleCheckoutCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Auto-checked out after 5m idle
          </p>
        </div>

        {/* KPI: Active People Tracked */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Team Members Active
            </span>
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="size-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-foreground font-mono">
            {stats.uniqueUsers} <span className="text-sm font-normal text-muted-foreground">/ {people.length}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Creators, editors, managers & admin
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-soft sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {/* Person Selector */}
          <div className="w-56">
            <Select
              id="time-log-filter-person"
              value={selectedPersonId}
              onChange={(e) => setSelectedPersonId(e.target.value)}
            >
              <option value="all">All Team Members ({people.length})</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({roleLabels[p.role] ?? p.role})
                </option>
              ))}
            </Select>
          </div>

          {/* Status Filter */}
          <div className="flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium transition-colors",
                statusFilter === "all" ? "bg-primary text-primary-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("active")}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium transition-colors flex items-center gap-1",
                statusFilter === "active" ? "bg-primary text-primary-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="size-1.5 rounded-full bg-success" />
              Active Now
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("idle_5m")}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium transition-colors",
                statusFilter === "idle_5m" ? "bg-primary text-primary-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              5m Idle
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("completed")}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium transition-colors",
                statusFilter === "completed" ? "bg-primary text-primary-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Completed
            </button>
          </div>

          {/* Search Box */}
          <div className="relative min-w-56">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <Input
              id="time-log-search"
              placeholder="Search by action or page…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 text-xs h-8"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="text-xs h-8" onClick={expandAll}>
            Expand All
          </Button>
          <Button size="sm" variant="ghost" className="text-xs h-8" onClick={collapseAll}>
            Collapse All
          </Button>
        </div>
      </div>

      {/* Main Days & Sessions Feed */}
      {sortedDays.length === 0 || filteredSessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <History className="mx-auto size-10 text-muted-foreground/60" />
          <h3 className="mt-3 text-base font-semibold text-foreground">No Time Logs Found</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            {searchQuery || selectedPersonId !== "all" || statusFilter !== "all"
              ? "No sessions match your current filter criteria. Try resetting the filters or selecting another member."
              : "No user application sessions recorded yet in this date range. As users access the dashboard, their sessions and 5-minute idle checkouts will show up here automatically."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedDays.map((date) => {
            const daySessionsMap = sessionsByDateAndPerson.get(date);
            const isToday = date === today;

            // People who had activity or attendance on this day
            const relevantPeople = people.filter((p) => {
              if (selectedPersonId !== "all" && p.id !== selectedPersonId) return false;
              const hasSessions = daySessionsMap && daySessionsMap.has(p.id);
              const dayReport = reports[p.id]?.days.find((d) => d.date === date);
              const hasAttendance = Boolean(dayReport?.attendance?.checkInAt);
              return hasSessions || hasAttendance;
            });

            if (relevantPeople.length === 0) {
              return null;
            }

            return (
              <div key={date} className="rounded-xl border border-border bg-card shadow-soft overflow-hidden">
                {/* Date Header */}
                <div className="flex flex-wrap items-center justify-between border-b border-border bg-muted/30 px-5 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <Calendar className="size-4 text-primary" />
                    <span className="font-bold text-foreground text-sm">
                      {formatDateOnly(date)}
                    </span>
                    {isToday ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary border border-primary/20">
                        Today
                      </span>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {relevantPeople.length} {relevantPeople.length === 1 ? "member" : "members"} recorded
                  </span>
                </div>

                {/* Per-Person Section */}
                <div className="divide-y divide-border">
                  {relevantPeople.map((person) => {
                    const personSessions = daySessionsMap?.get(person.id) ?? [];
                    const dayReport = reports[person.id]?.days.find((d) => d.date === date);
                    const attendance = dayReport?.attendance;
                    const isAdmin = person.role === "admin";
                    const isCheckedIn = Boolean(attendance?.checkInAt);
                    const checkInTime = formatAttendanceTime(attendance?.checkInAt);
                    const checkOutTime = formatAttendanceTime(attendance?.checkOutAt);

                    const totalPersonSeconds = personSessions.reduce(
                      (acc, s) => acc + (s.duration_seconds || 0),
                      0
                    );

                    return (
                      <div key={person.id} className="p-5 space-y-4">
                        {/* Member Card Header */}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={person.name} src={person.avatar_url} className="size-9" />
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-bold text-foreground">{person.name}</h4>
                                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground border border-border">
                                  {roleLabels[person.role] ?? person.role}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Active app time: <strong className="text-foreground">{formatSessionDuration(totalPersonSeconds)}</strong> across {personSessions.length} {personSessions.length === 1 ? "session" : "sessions"}
                              </p>
                            </div>
                          </div>

                          {onOpenLightbox ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="text-xs h-7 gap-1"
                              onClick={() => onOpenLightbox(person, date)}
                            >
                              <Eye className="size-3" />
                              View Day Details
                            </Button>
                          ) : null}
                        </div>

                        {/* Official Attendance Comparison Box */}
                        <div className="rounded-lg border border-border bg-muted/20 p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                          <div className="flex items-center gap-2">
                            {isAdmin ? (
                              <ShieldCheck className="size-4 text-primary" />
                            ) : (
                              <UserCheck className="size-4 text-success" />
                            )}
                            <span className="font-semibold text-foreground">
                              Official Daily Attendance:
                            </span>
                          </div>

                          {isAdmin ? (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary border border-primary/20">
                                Exempt from Check-in (Admin)
                              </span>
                              <span>Usage sessions recorded automatically below</span>
                            </div>
                          ) : isCheckedIn ? (
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="flex items-center gap-1.5">
                                <LogIn className="size-3.5 text-success" />
                                Checked in: <strong className="text-foreground">{checkInTime} IST</strong>
                              </span>
                              {attendance?.checkOutAt ? (
                                <span className="flex items-center gap-1.5">
                                  <LogOut className="size-3.5 text-muted-foreground" />
                                  Checked out: <strong className="text-foreground">{checkOutTime} IST</strong>
                                </span>
                              ) : (
                                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                                  Currently Working
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-warning font-medium">
                              <AlertCircle className="size-3.5" />
                              No official check-in recorded for this day
                            </div>
                          )}
                        </div>

                        {/* Application Sessions List */}
                        {personSessions.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic pl-2">
                            No application sessions recorded on this day.
                          </p>
                        ) : (
                          <div className="space-y-2.5">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Recorded Application Sessions ({personSessions.length})
                            </p>
                            <div className="space-y-2">
                              {personSessions.map((session, index) => {
                                const isExpanded = Boolean(expandedSessions[session.id]);
                                const isActive = !session.session_ended_at;
                                const isIdleCheckout = session.end_reason === "idle_5m";
                                const durationFormatted = formatSessionDuration(session.duration_seconds);
                                const startTimeFormatted = formatTimeShort(session.session_started_at);
                                const endTimeFormatted = session.session_ended_at
                                  ? formatTimeShort(session.session_ended_at)
                                  : "Live";

                                return (
                                  <div
                                    key={session.id}
                                    className="rounded-lg border border-border bg-card transition-colors hover:border-primary/30"
                                  >
                                    {/* Session Header / Row */}
                                    <div
                                      className="flex flex-wrap items-center justify-between gap-3 p-3 cursor-pointer select-none"
                                      onClick={() => toggleSession(session.id)}
                                    >
                                      <div className="flex items-center gap-3">
                                        <button
                                          type="button"
                                          className="text-muted-foreground hover:text-foreground"
                                          aria-label={isExpanded ? "Collapse session" : "Expand session"}
                                        >
                                          {isExpanded ? (
                                            <ChevronDown className="size-4" />
                                          ) : (
                                            <ChevronRight className="size-4" />
                                          )}
                                        </button>
                                        <div className="flex items-center gap-2">
                                          <span className="font-semibold text-xs text-foreground">
                                            Session #{index + 1}
                                          </span>
                                          <span className="text-xs text-muted-foreground">
                                            {startTimeFormatted} → {endTimeFormatted} IST
                                          </span>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-2">
                                        <span className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-mono font-medium text-foreground">
                                          {durationFormatted}
                                        </span>

                                        {isActive ? (
                                          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                                            <span className="size-1.5 rounded-full bg-success animate-ping" />
                                            Active Now
                                          </span>
                                        ) : isIdleCheckout ? (
                                          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning" title="Checked out after 5 minutes of inactivity on dashboard">
                                            <Timer className="size-3" />
                                            Auto-Checked Out (5m Idle)
                                          </span>
                                        ) : (
                                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground border border-border">
                                            Completed
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    {/* Expandable Activity Feed */}
                                    {isExpanded ? (
                                      <div className="border-t border-border/80 bg-muted/10 p-3 text-xs space-y-2">
                                        <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider mb-2">
                                          Activity Timeline (What {person.name} Did):
                                        </p>
                                        {session.activities && session.activities.length > 0 ? (
                                          <div className="relative pl-4 space-y-2 before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-px before:bg-border">
                                            {session.activities.map((act, actIdx) => (
                                              <div key={actIdx} className="relative flex items-start gap-2">
                                                <span className={cn(
                                                  "absolute -left-4 top-1 size-2 rounded-full ring-2 ring-card",
                                                  act.type === "idle"
                                                    ? "bg-warning"
                                                    : act.type === "attendance"
                                                    ? "bg-success"
                                                    : "bg-primary"
                                                )} />
                                                <span className="font-mono text-muted-foreground whitespace-nowrap text-[11px]">
                                                  {formatTimeShort(act.timestamp)}
                                                </span>
                                                <div className="flex-1">
                                                  <span className="font-medium text-foreground">
                                                    {act.description}
                                                  </span>
                                                  {act.path ? (
                                                    <span className="ml-1.5 rounded bg-muted px-1.5 py-0.2 text-[10px] font-mono text-muted-foreground">
                                                      {act.path}
                                                    </span>
                                                  ) : null}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <p className="text-muted-foreground italic">
                                            No granular activity items logged for this session.
                                          </p>
                                        )}
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
