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

  const forceHardReload = () => {
    setReloading(true);
    // Bust browser HTTP cache by appending unique timestamp
    const url = new URL(window.location.href);
    url.searchParams.set("_v", Date.now().toString());
    window.location.replace(url.toString());
  };

  useEffect(() => {
    const lastReload = sessionStorage.getItem(RELOAD_KEY);
    const now = Date.now();
    const shouldAutoReload =
      isStaleApplicationFailure(error) ||
      Boolean(error.digest) ||
      error.message?.includes("Server Components");

    // Automatically recover once without blocking user on update
    if (shouldAutoReload && (!lastReload || now - Number(lastReload) > 15_000)) {
      sessionStorage.setItem(RELOAD_KEY, String(now));
      forceHardReload();
    }
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-5">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-soft dark:shadow-none">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-5" aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-foreground">This page needs to reload</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          AdFlow was updated while this page was open. Reload to reconnect to the latest version.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="secondary" onClick={reset} disabled={reloading}>
            Try again
          </Button>
          <Button onClick={forceHardReload} disabled={reloading}>
            <RefreshCw className={`size-4 ${reloading ? "animate-spin" : ""}`} aria-hidden />
            {reloading ? "Reloading..." : "Reload"}
          </Button>
        </div>
      </section>
    </main>
  );
}
