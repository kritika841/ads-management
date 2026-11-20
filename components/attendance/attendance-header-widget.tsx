"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { Profile } from "@/lib/types";

type AttendanceState = {
  checkInTime: string | null;
  checkOutTime: string | null;
};

function formatShortISTTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

export function AttendanceHeaderWidget({ profile }: { profile: Profile }) {
  const { toast } = useToast();
  const [attendance, setAttendance] = useState<AttendanceState>({
    checkInTime: null,
    checkOutTime: null
  });
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const refreshAttendance = useCallback(async () => {
    try {
      const res = await fetch("/api/attendance", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setAttendance({
        checkInTime: data?.checkInTime ?? null,
        checkOutTime: data?.checkOutTime ?? null
      });
    } catch {
      // non-fatal
    } finally {
      setInitialized(true);
    }
  }, []);

  useEffect(() => {
    void refreshAttendance();
    const interval = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void refreshAttendance();
      }
    }, 2_500);
    const onFocusOrVisible = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void refreshAttendance();
      }
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("satmi-attendance");
      bc.onmessage = () => {
        void refreshAttendance();
      };
    } catch {}
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
      bc?.close();
    };
  }, [profile.id, refreshAttendance]);

  async function handleAction(action: "checkin" | "checkout") {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
        cache: "no-store"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: action === "checkin" ? "Check-in failed" : "Check-out failed",
          description: data?.error || "Unable to update attendance.",
          tone: "error"
        });
        return;
      }

      setAttendance({
        checkInTime: data?.checkInTime ?? null,
        checkOutTime: data?.checkOutTime ?? null
      });
      try {
        const ch = new BroadcastChannel("satmi-attendance");
        ch.postMessage({ type: "attendance-updated", userId: profile.id });
        ch.close();
      } catch {}
      toast({
        title: action === "checkin" ? "Checked in" : "Checked out",
        description:
          action === "checkin"
            ? `Checked in at ${formatShortISTTime(data?.checkInTime)} IST.`
            : `Checked out at ${formatShortISTTime(data?.checkOutTime)} IST.`,
        tone: "success"
      });
    } catch {
      toast({
        title: action === "checkin" ? "Check-in failed" : "Check-out failed",
        description: "Network error — please try again.",
        tone: "error"
      });
    } finally {
      setLoading(false);
    }
  }

  if (!initialized) {
    return (
      <Button
        type="button"
        size="sm"
        disabled
        className="gap-1 text-xs h-8 px-2 sm:px-3 bg-success/60 text-success-foreground border-0 whitespace-nowrap shrink-0"
      >
        <LogIn className="size-3.5 shrink-0" aria-hidden />
        <span className="hidden sm:inline">Check In</span>
      </Button>
    );
  }

  if (!attendance.checkInTime) {
    return (
      <Button
        type="button"
        size="sm"
        disabled={loading}
        onClick={() => handleAction("checkin")}
        className="gap-1 text-xs h-8 px-2 sm:px-3 bg-success hover:bg-success/90 text-success-foreground border-0 shadow-xs cursor-pointer whitespace-nowrap shrink-0"
        title="Check in for today"
      >
        <LogIn className="size-3.5 shrink-0" aria-hidden />
        <span className="hidden sm:inline">{loading ? "Checking in..." : "Check In"}</span>
        <span className="sm:hidden">{loading ? "..." : "In"}</span>
      </Button>
    );
  }

  if (!attendance.checkOutTime) {
    return (
      <Button
        type="button"
        size="sm"
        disabled={loading}
        onClick={() => handleAction("checkout")}
        className="gap-1 text-xs h-8 px-2 sm:px-3 bg-destructive hover:bg-destructive/90 text-destructive-foreground border-0 shadow-xs cursor-pointer whitespace-nowrap shrink-0"
        title={`Checked in at ${formatShortISTTime(attendance.checkInTime)} IST — Click to Check Out`}
      >
        <span className="size-2 rounded-full bg-destructive-foreground animate-pulse shrink-0" />
        <LogOut className="size-3.5 shrink-0" aria-hidden />
        <span className="hidden sm:inline">{loading ? "Checking out..." : "Check Out"}</span>
        <span className="sm:hidden">{loading ? "..." : "Out"}</span>
        <span className="hidden md:inline text-[10px] opacity-90 font-mono pl-0.5">
          In {formatShortISTTime(attendance.checkInTime)}
        </span>
      </Button>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 h-8 px-2 sm:px-2.5 rounded-lg border border-success/30 bg-success/10 text-success text-xs font-semibold whitespace-nowrap shrink-0"
      title={`Checked in: ${formatShortISTTime(attendance.checkInTime)} | Checked out: ${formatShortISTTime(attendance.checkOutTime)} (IST)`}
    >
      <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
      <span className="hidden sm:inline">Checked Out</span>
      <span className="sm:hidden">Done</span>
      <span className="hidden md:inline text-[10px] font-mono opacity-80">
        {formatShortISTTime(attendance.checkInTime)} – {formatShortISTTime(attendance.checkOutTime)}
      </span>
    </span>
  );
}
