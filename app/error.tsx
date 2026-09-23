"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isStaleApplicationFailure } from "@/lib/chunk-load";

const RELOAD_KEY = "adflow_auto_reload_timestamp";

export default function ApplicationError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [reloading, setReloading] = useState(false);
  const isStale = isStaleApplicationFailure(error);

  const forceHardReload = () => {
    setReloading(true);
    // Bust browser HTTP cache by appending unique timestamp
    const url = new URL(window.location.href);
    url.searchParams.set("_v", Date.now().toString());
    window.location.replace(url.toString());
  };

  useEffect(() => {
    // Only attempt automatic hard-reload if this is genuinely a stale application failure
    // (e.g. ChunkLoadError or unrecognized server action after a deployment).
    if (!isStale) return;

    const lastReload = sessionStorage.getItem(RELOAD_KEY);
    const now = Date.now();

    if (!lastReload || now - Number(lastReload) > 15_000) {
      sessionStorage.setItem(RELOAD_KEY, String(now));
      forceHardReload();
    }
  }, [isStale]);

  if (isStale) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-5">
        <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-soft dark:shadow-none">
          <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <RefreshCw className="size-5" aria-hidden />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-foreground">Update Available</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            A new version of AdFlow was deployed while this tab was open. Reload to connect to the latest version.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="secondary" onClick={reset} disabled={reloading}>
              Try again
            </Button>
            <Button onClick={forceHardReload} disabled={reloading}>
              <RefreshCw className={`size-4 ${reloading ? "animate-spin" : ""}`} aria-hidden />
              {reloading ? "Reloading..." : "Reload page"}
            </Button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-5">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-soft dark:shadow-none">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-5" aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          An unexpected error occurred while loading this page.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => window.location.assign("/dashboard")}>
            Dashboard
          </Button>
          <Button onClick={reset} disabled={reloading}>
            Try again
          </Button>
        </div>
        {error?.digest ? (
          <p className="mt-4 text-xs font-mono text-muted-foreground/60 select-all">
            Reference: {error.digest}
          </p>
        ) : null}
      </section>
    </main>
  );
}
