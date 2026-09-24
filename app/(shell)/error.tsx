"use client";

import { useEffect, useState } from "react";
import { AlertCircle, RefreshCw, House } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ShellError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    console.error("[ShellError] Uncaught error inside shell layout:", error);
  }, [error]);

  const handleHardRefresh = () => {
    setRetrying(true);
    const url = new URL(window.location.href);
    url.searchParams.set("_v", Date.now().toString());
    window.location.replace(url.toString());
  };

  const handleReset = () => {
    setRetrying(true);
    reset();
    setTimeout(() => setRetrying(false), 2000);
  };

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
