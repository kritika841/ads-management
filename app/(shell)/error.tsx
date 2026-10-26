"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, RefreshCw, House, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Transient failures (DB timeout, deploy restart, network blip) usually clear within seconds.
// Retry silently with backoff before ever showing an error card to the user.
const AUTO_RETRY_DELAYS_MS = [1_500, 4_000, 10_000];
const RETRY_STATE_KEY = "adflow_shell_error_retries";
const RETRY_WINDOW_MS = 60_000;

function readRetryCount() {
  try {
    const raw = sessionStorage.getItem(RETRY_STATE_KEY);
    if (!raw) return 0;
    const { count, at } = JSON.parse(raw) as { count: number; at: number };
    return Date.now() - at > RETRY_WINDOW_MS ? 0 : count;
  } catch {
    return 0;
  }
}

function writeRetryCount(count: number) {
  try {
    sessionStorage.setItem(RETRY_STATE_KEY, JSON.stringify({ count, at: Date.now() }));
  } catch {
    // storage unavailable — retries still bounded by in-memory flow
  }
}

export default function ShellError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [autoRecovering, setAutoRecovering] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // reset() alone only re-renders on the client with the SAME failed server payload.
  // router.refresh() re-requests the Server Components; both must run in one transition.
  const recover = useCallback(() => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }, [reset, router]);

  useEffect(() => {
    console.error("[ShellError] Uncaught error inside shell layout:", error);

    const attempt = readRetryCount();
    if (attempt >= AUTO_RETRY_DELAYS_MS.length || !navigator.onLine) {
      setAutoRecovering(false);
      return;
    }
    setAutoRecovering(true);
    timer.current = setTimeout(() => {
      writeRetryCount(attempt + 1);
      recover();
    }, AUTO_RETRY_DELAYS_MS[attempt]);

    const onOnline = () => recover();
    window.addEventListener("online", onOnline);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("online", onOnline);
    };
  }, [error, recover]);

  const handleHardRefresh = () => {
    setRetrying(true);
    const url = new URL(window.location.href);
    url.searchParams.set("_v", Date.now().toString());
    window.location.replace(url.toString());
  };

  const handleReset = () => {
    setRetrying(true);
    writeRetryCount(0);
    recover();
    setTimeout(() => setRetrying(false), 2000);
  };

  if (autoRecovering) {
    return (
      <div className="page-container flex items-center justify-center py-16" role="status" aria-live="polite">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          Reconnecting…
        </div>
      </div>
    );
  }

  return (
    <div className="page-container py-12">
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-card p-6 text-center shadow-soft">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="size-6" aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Unable to load this section</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A temporary network or database delay occurred while loading this view. Your data is safe.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={handleReset} disabled={retrying} className="gap-2">
            <RefreshCw className={`size-4 ${retrying ? "animate-spin" : ""}`} aria-hidden />
            Try again
          </Button>
          <Button variant="secondary" onClick={handleHardRefresh} disabled={retrying} className="gap-2">
            Hard refresh
          </Button>
          <Button
            variant="ghost"
            onClick={() => window.location.assign("/dashboard")}
            disabled={retrying}
            className="gap-2 border border-border"
          >
            <House className="size-4" aria-hidden />
            Home
          </Button>
        </div>
        {error?.digest && (
          <p className="mt-4 text-xs font-mono text-muted-foreground/60 select-all">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
