"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Loader2, LogIn, LogOut } from "lucide-react";
import {
  checkInAttendance,
  checkOutAttendance,
  getTodayAttendanceStatus,
  type TodayAttendanceStatus
} from "@/app/actions/attendance";
import { Button } from "@/components/ui/button";
import { formatAttendanceTime } from "@/lib/attendance-shared";
import { runServerAction } from "@/lib/client-action";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AttendanceHeaderWidget({ profile }: { profile: Profile }) {
  const [status, setStatus] = useState<TodayAttendanceStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAdmin = profile.role === "admin";

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      try {
        const res = await getTodayAttendanceStatus();
        if (active) {
          setStatus(res);
        }

      } catch (err) {
        console.warn("Could not load attendance status in header:", err);
      }
    }

    async function touchActivity() {
      if (!isAdmin) {
        try {
          const { recordAttendanceActivityTouch } = await import("@/app/actions/attendance");
          await recordAttendanceActivityTouch();
        } catch {
          // non-fatal
        }
      }
    }

    void loadStatus();
    void touchActivity();

    // Re-check status every 60s and touch activity periodically
    const interval = setInterval(() => {
      void loadStatus();
      void touchActivity();
    }, 60000);

    const handleFocus = () => {
      void touchActivity();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [profile.id, isAdmin]);


  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  if (isAdmin) {
    return null;
  }

  const isCheckedIn = Boolean(status?.record?.check_in_at && !status?.record?.check_out_at);
  const isCheckedOut = Boolean(status?.record?.check_out_at);
  const checkInTime = formatAttendanceTime(status?.record?.check_in_at);
  const checkOutTime = formatAttendanceTime(status?.record?.check_out_at);

  async function handleCheckOut() {
    setPending(true);
    try {
      const res = await runServerAction(() => checkOutAttendance());
      if (res.ok) {
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                checkedIn: false,
                isCheckedOut: true,
                record: res.record ?? null
              }
            : null
        );
        setOpen(false);
      }
    } finally {
      setPending(false);
    }
  }

  async function handleReCheckIn() {
    setPending(true);
    try {
      const res = await runServerAction(() => checkInAttendance());
      if (res.ok) {
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                checkedIn: true,
                isCheckedOut: false,
                record: res.record ?? null
              }
            : null
        );
        setOpen(false);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors shadow-2xs",
          isCheckedIn
            ? "border-success/30 bg-success/10 text-success hover:bg-success/20"
            : isCheckedOut
            ? "border-border bg-muted/60 text-muted-foreground hover:bg-muted"
            : "border-warning/30 bg-warning/10 text-warning hover:bg-warning/20"
        )}
        title="Daily Attendance Status"
        aria-expanded={open}
      >
        <span
          className={cn(
            "size-2 rounded-full",
            isCheckedIn ? "bg-success animate-pulse" : isCheckedOut ? "bg-muted-foreground/60" : "bg-warning"
          )}
        />
        <Clock className="size-3.5 opacity-80" />
        <span className="hidden sm:inline">
          {isCheckedIn ? `In: ${checkInTime}` : isCheckedOut ? `Out: ${checkOutTime}` : "Check In"}
        </span>
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-card p-4 shadow-float animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between border-b border-border pb-2.5 mb-3">
            <p className="text-xs font-bold text-foreground">Attendance Status</p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                isCheckedIn
                  ? "bg-success/15 text-success"
                  : isCheckedOut
                  ? "bg-muted text-muted-foreground"
                  : "bg-warning/15 text-warning"
              )}
            >
              {isCheckedIn ? "Checked In" : isCheckedOut ? "Checked Out" : "Not Checked In"}
            </span>
          </div>

          <div className="space-y-1.5 text-xs text-muted-foreground mb-4">
            <div className="flex justify-between">
              <span>Check-in:</span>
              <span className="font-semibold text-foreground">{checkInTime !== "—" ? `${checkInTime} IST` : "—"}</span>
            </div>
            {isCheckedOut || status?.record?.check_out_at ? (
              <div className="flex justify-between">
                <span>Check-out:</span>
                <span className="font-semibold text-foreground">{checkOutTime !== "—" ? `${checkOutTime} IST` : "—"}</span>
              </div>
            ) : null}
          </div>

          {isCheckedIn ? (
            <Button
              size="sm"
              variant="secondary"
              className="w-full text-xs font-semibold text-destructive hover:bg-destructive/10"
              disabled={pending}
              onClick={handleCheckOut}
            >
              {pending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <LogOut className="mr-1.5 size-3.5" />}
              Check Out Now
            </Button>
          ) : (
            <Button
              size="sm"
              className="w-full text-xs font-semibold"
              disabled={pending}
              onClick={handleReCheckIn}
            >
              {pending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <LogIn className="mr-1.5 size-3.5" />}
              {isCheckedOut ? "Check In Again" : "Check In Now"}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
