"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, LogIn } from "lucide-react";
import { checkInAttendance, getTodayAttendanceStatus, type TodayAttendanceStatus } from "@/app/actions/attendance";
import { Button } from "@/components/ui/button";
import { runServerAction } from "@/lib/client-action";
import type { Profile } from "@/lib/types";

export function AttendancePromptModal({ profile }: { profile: Profile }) {
  const [status, setStatus] = useState<TodayAttendanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState("");
  const [currentDate, setCurrentDate] = useState("");

  // Admin users are completely exempt from the check-in prompt
  const isAdmin = profile.role === "admin";

  useEffect(() => {
    if (isAdmin) {
      setLoading(false);
      return;
    }

    let active = true;

    async function checkStatus() {
      try {
        const res = await getTodayAttendanceStatus();
        if (active) {
          setStatus(res);
          setLoading(false);
        }

      } catch (err) {
        if (active) {
          console.warn("Could not check attendance status:", err);
          setLoading(false);
        }
      }
    }

    void checkStatus();

    return () => {
      active = false;
    };
  }, [isAdmin, profile.id]);

  // Live IST clock
  useEffect(() => {
    function updateClock() {
      const now = new Date();
      try {
        const timeStr = new Intl.DateTimeFormat("en-IN", {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
          timeZone: "Asia/Kolkata"
        }).format(now);
        const dateStr = new Intl.DateTimeFormat("en-IN", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Asia/Kolkata"
        }).format(now);
        setCurrentTime(timeStr);
        setCurrentDate(dateStr);
      } catch {
        setCurrentTime(now.toLocaleTimeString());
        setCurrentDate(now.toLocaleDateString());
      }
    }

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  if (isAdmin || loading) {
    return null;
  }

  // If already checked in today (even if subsequently checked out), don't block
  if (status?.checkedIn) {
    return null;
  }

  async function handleCheckIn() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await runServerAction(() => checkInAttendance());
      if (!res.ok) {
        setError(res.message ?? "Check-in failed. Please try again.");
        setSubmitting(false);
        return;
      }
      setStatus((prev) => (prev ? { ...prev, checkedIn: true, record: res.record ?? null } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error during check-in.");
    } finally {
      setSubmitting(false);
    }
  }

  const roleTitle = profile.role.replace("_", " ");

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/25 dark:bg-black/45 backdrop-blur-md p-4 animate-in fade-in duration-200"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="attendance-prompt-title"
      aria-describedby="attendance-prompt-desc"
      onKeyDown={(e) => {
        // Prevent dismissing with Escape key
        if (e.key === "Escape") {
          e.preventDefault();
        }
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border/80 bg-card/95 p-6 shadow-2xl backdrop-blur-xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center">
          {/* Header Icon */}
          <div className="relative mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
            <Clock className="size-8 animate-pulse text-primary" aria-hidden />
            <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-success text-success-foreground shadow-xs">
              <LogIn className="size-3" />
            </span>
          </div>

          <span className="mb-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
            AdFlow Daily Attendance
          </span>

          <h2 id="attendance-prompt-title" className="text-xl font-bold text-foreground">
            Good to see you, {profile.name}!
          </h2>

          <p id="attendance-prompt-desc" className="mt-1 text-xs text-muted-foreground">
            Please check in to start your work session for today.
          </p>

          {/* Current Live Time Card */}
          <div className="my-5 w-full rounded-xl border border-border/70 bg-muted/40 p-4 text-center">
            <p className="text-2xl font-extrabold tracking-tight text-foreground font-mono">
              {currentTime || "12:00:00 AM"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground font-medium">
              {currentDate || "IST (India Standard Time)"}
            </p>
            <div className="mt-2.5 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/80">
              <span className="size-1.5 rounded-full bg-success animate-ping" />
              Role: <span className="font-semibold capitalize text-foreground">{roleTitle}</span>
            </div>
          </div>

          {error ? (
            <p className="mb-4 w-full rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          {/* Non-dismissable Check-in Action */}
          <Button
            size="md"
            className="w-full text-sm font-semibold shadow-md transition-all active:scale-[0.99] py-2.5"
            disabled={submitting}
            onClick={handleCheckIn}
          >

            {submitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Recording Check-In…
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 size-4" />
                Check In Now
              </>
            )}
          </Button>

          <p className="mt-3 text-[11px] text-muted-foreground/70">
            Session timestamp will be logged automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
