"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, X } from "lucide-react";
import { deleteAd } from "@/app/actions/ads";
import { runServerAction } from "@/lib/client-action";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function DeleteAdButton({
  adId,
  adName,
  compact = false,
  redirectAfterDelete = false,
  onDeleted
}: {
  adId: string;
  adName: string;
  compact?: boolean;
  redirectAfterDelete?: boolean;
  /** Lets a list remove the row immediately instead of waiting for the server refresh. */
  onDeleted?: (adId: string) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function remove() {
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await runServerAction(() => deleteAd(adId));
        if (!response.ok) {
          setMessage(response.message ?? "Unable to delete this ad.");
          return;
        }

        const moved = "movedToRecycleBin" in response && Boolean(response.movedToRecycleBin);
        toast({
          title: moved ? "Moved to Recycle Bin" : "Ad deleted",
          description: moved ? `${adName} can be restored from the Recycle Bin until it is purged.` : adName,
          tone: "success"
        });
        setOpen(false);
        onDeleted?.(adId);
        if (redirectAfterDelete) {
          router.push("/library");
        }
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to delete this ad.");
      }
    });
  }

  return (
    <>
      <Button
        size={compact ? "icon" : "sm"}
        variant={compact ? "ghost" : "secondary"}
        className={compact ? "size-8 text-destructive hover:bg-destructive/10 hover:text-destructive" : "text-destructive hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"}
        title={`Delete ${adName}`}
        onClick={() => { setMessage(null); setOpen(true); }}
      >
        <Trash2 className="size-4" aria-hidden />
        {compact ? <span className="sr-only">Delete ad</span> : "Delete ad"}
      </Button>

      {/* Portalled to <body>: the library cards lift with a CSS transform on hover, and a
          transformed ancestor becomes the containing block for `position: fixed`. Rendered
          inline, this overlay was clipped into the card, which flipped the card's hover state
          on and off every frame and made the whole panel shake. */}
      {open && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-950/45 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby={`delete-ad-${adId}`} onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget && !isPending) setOpen(false); }} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape" && !isPending) setOpen(false); }}>
          <section className="w-full max-w-md rounded-xl border border-border bg-card shadow-float dark:shadow-none">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 id={`delete-ad-${adId}`} className="text-lg font-semibold text-foreground">Move ad to Recycle Bin?</h2>
                <p className="mt-1 text-sm text-muted-foreground">This will delete <span className="font-medium text-muted-foreground">{adName}</span>.</p>
              </div>
              <Button size="icon" variant="ghost" className="size-9" title="Close" disabled={isPending} onClick={() => setOpen(false)}><X className="size-5" aria-hidden /></Button>
            </div>
            <div className="p-5">
              <p className="text-sm leading-6 text-muted-foreground">The ad, its video, script, versions, feedback and activity are kept in the Recycle Bin, where an admin or manager can restore them until the retention period ends. After that they are deleted permanently.</p>
              {message ? <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{message}</p> : null}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
              <Button variant="secondary" disabled={isPending} onClick={() => setOpen(false)}>Keep ad</Button>
              <Button variant="danger" disabled={isPending} onClick={remove}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}Delete</Button>
            </div>
          </section>
        </div>,
        document.body
      ) : null}
    </>
  );
}
