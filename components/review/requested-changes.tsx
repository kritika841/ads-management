import { MessageSquareText } from "lucide-react";
import type { ResubmissionFeedbackItem } from "@/lib/resubmission";
import { formatDateTime } from "@/lib/utils";

export function RequestedChanges({ items, compact = false }: { items: ResubmissionFeedbackItem[]; compact?: boolean }) {
  return (
    <section className="rounded-md border border-warning/30 bg-warning/15/70 p-4">
      <div className="flex items-center gap-2 text-warning"><MessageSquareText className="size-4" aria-hidden /><h3 className="text-sm font-semibold">Requested changes</h3></div>
      {items.length ? (
        <div className="mt-3 space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-md border border-warning/25 bg-card px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="font-medium text-warning">{item.context}</span><span>{item.authorName} · {formatDateTime(item.createdAt)}</span></div>
              <p className={`mt-1.5 text-sm leading-5 text-muted-foreground ${compact ? "line-clamp-3" : ""}`}>{item.body}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-warning">No written change request was recorded. Review the discussion and annotations before resubmitting.</p>
      )}
    </section>
  );
}
