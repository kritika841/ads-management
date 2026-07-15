"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isStaleApplicationFailure } from "@/lib/chunk-load";

export default function ApplicationError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (isStaleApplicationFailure(error)) window.location.reload();
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-5">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-soft dark:shadow-none">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive"><AlertTriangle className="size-5" aria-hidden /></span>
        <h1 className="mt-4 text-lg font-semibold text-foreground">This page needs to reload</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">AdFlow was updated while this page was open. Reload to reconnect to the latest version.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="secondary" onClick={reset}>Try again</Button>
          <Button onClick={() => window.location.reload()}><RefreshCw className="size-4" aria-hidden />Reload</Button>
        </div>
      </section>
    </main>
  );
}
