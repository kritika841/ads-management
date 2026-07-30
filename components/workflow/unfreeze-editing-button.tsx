"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Snowflake, X } from "lucide-react";
import { unfreezeForEditing } from "@/app/actions/ads";
import { runServerAction } from "@/lib/client-action";
import { Button } from "@/components/ui/button";
import type { AdWithRelations } from "@/lib/types";

export function UnfreezeEditingButton({ ad }: { ad: AdWithRelations }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() => unfreezeForEditing({ adId: ad.id }));
      if (!response.ok) {
        setMessage(response.message ?? "Unable to unfreeze editing.");
        return;
      }

      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setMessage(null); setOpen(true); }}>
        <Snowflake className="size-4" aria-hidden />
        Unfreeze for editing
      </Button>

      {open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-950/45 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby={`unfreeze-editing-${ad.id}`}>
          <section className="w-full max-w-md rounded-xl border border-border bg-card shadow-float dark:shadow-none">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 id={`unfreeze-editing-${ad.id}`} className="text-lg font-semibold text-foreground">Unfreeze editing?</h2>
                <p className="mt-1 text-sm text-muted-foreground">This lets the assigned editor start this creative even if they already have active work in progress.</p>
              </div>
              <Button size="icon" variant="ghost" className="size-9" title="Close" disabled={isPending} onClick={() => setOpen(false)}>
                <X className="size-5" aria-hidden />
              </Button>
            </div>
            <div className="p-5">
              <p className="text-sm leading-6 text-muted-foreground">The editor assignment will move to <span className="font-medium text-foreground">Editing</span> immediately and the timer will start. The normal concurrency limit is bypassed for this creative only.</p>
              {message ? <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{message}</p> : null}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
              <Button variant="secondary" disabled={isPending} onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={isPending} onClick={submit}>
                {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Snowflake className="size-4" aria-hidden />}
                Unfreeze for editing
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}