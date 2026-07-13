"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, X } from "lucide-react";
import { deleteAd } from "@/app/actions/ads";
import { Button } from "@/components/ui/button";

export function DeleteAdButton({
  adId,
  adName,
  compact = false,
  redirectAfterDelete = false
}: {
  adId: string;
  adName: string;
  compact?: boolean;
  redirectAfterDelete?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function remove() {
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await deleteAd(adId);
        if (!response.ok) {
          setMessage(response.message ?? "Unable to delete this ad.");
          return;
        }

        setOpen(false);
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
        className={compact ? "size-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700" : "text-rose-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"}
        title={`Delete ${adName}`}
        onClick={() => { setMessage(null); setOpen(true); }}
      >
        <Trash2 className="size-4" aria-hidden />
        {compact ? <span className="sr-only">Delete ad</span> : "Delete ad"}
      </Button>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby={`delete-ad-${adId}`}>
          <section className="w-full max-w-md rounded-lg bg-white shadow-float">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 id={`delete-ad-${adId}`} className="text-lg font-semibold text-slate-950">Delete ad permanently?</h2>
                <p className="mt-1 text-sm text-slate-500">This will delete <span className="font-medium text-slate-700">{adName}</span>.</p>
              </div>
              <Button size="icon" variant="ghost" className="size-9" title="Close" disabled={isPending} onClick={() => setOpen(false)}><X className="size-5" aria-hidden /></Button>
            </div>
            <div className="p-5">
              <p className="text-sm leading-6 text-slate-600">Versions, feedback, comments, annotations, and activity associated with this ad will also be deleted. This cannot be undone.</p>
              {message ? <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">{message}</p> : null}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
              <Button variant="secondary" disabled={isPending} onClick={() => setOpen(false)}>Keep ad</Button>
              <Button variant="danger" disabled={isPending} onClick={remove}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}Delete permanently</Button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
