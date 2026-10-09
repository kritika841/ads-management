"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LockOpen, Snowflake } from "lucide-react";
import { setEditingFreeze } from "@/app/actions/ads";
import { useToast } from "@/components/ui/toast";
import { runServerAction } from "@/lib/client-action";
import type { EditingFreezeState, ProductionStage } from "@/lib/types";
import { canToggleEditingFreeze } from "@/lib/production-workflow";
import { cn } from "@/lib/utils";

/** Small status pill for a creative whose editing was frozen/unfrozen by a manager or admin. */
export function EditingFreezeBadge({ state, className }: { state?: EditingFreezeState | null; className?: string }) {
  if (!state) return null;
  const frozen = state === "frozen";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        frozen ? "border-primary/40 bg-primary/10 text-primary" : "border-success/40 bg-success/10 text-success",
        className
      )}
      title={frozen ? "Editing is frozen by a manager or admin" : "Unfrozen by a manager or admin — editor limit does not apply"}
    >
      {frozen ? <Snowflake className="size-3" aria-hidden /> : <LockOpen className="size-3" aria-hidden />}
      {frozen ? "Frozen" : "Unfrozen"}
    </span>
  );
}

/**
 * Freeze / unfreeze control for managers and admins on in-production creatives.
 * "Unfrozen" is an explicit override of the editor's concurrent-edit limit.
 */
export function FreezeEditingToggle({
  adId,
  adName,
  stage,
  state,
  variant = "full",
  onChanged
}: {
  adId: string;
  adName: string;
  stage: ProductionStage;
  state?: EditingFreezeState | null;
  variant?: "full" | "compact";
  onChanged?: (state: EditingFreezeState, stage?: ProductionStage) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [current, setCurrent] = useState<EditingFreezeState | null>(state ?? null);
  const [currentStage, setCurrentStage] = useState<ProductionStage>(stage);
  const [isPending, startTransition] = useTransition();

  useEffect(() => setCurrent(state ?? null), [state]);
  useEffect(() => setCurrentStage(stage), [stage]);

  if (!canToggleEditingFreeze(currentStage)) return null;

  function change(next: EditingFreezeState) {
    if (isPending) return;
    // Allow clicking "unfrozen" if the creative is still waiting in ready_for_edit, so unfreezing can start editing
    if (current === next && !(next === "unfrozen" && currentStage === "ready_for_edit")) return;
    if (next === "frozen" && currentStage === "editing" && !window.confirm(`Freeze "${adName}"? The editor's timer will stop and they won't be able to continue until you unfreeze it.`)) return;
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      const response = await runServerAction(() => setEditingFreeze({ adId, state: next }));
      if (!response.ok) {
        setCurrent(previous);
        toast({ title: "Freeze not saved", description: response.message ?? "Unable to update editing.", tone: "error" });
        return;
      }
      const newStage = response.stage ?? (next === "unfrozen" && currentStage === "ready_for_edit" ? "editing" : currentStage);
      setCurrentStage(newStage);
      onChanged?.(next, newStage);
      toast({
        title: next === "frozen" ? "Editing frozen" : "Editing unfrozen",
        description: next === "frozen"
          ? `${adName} can't be edited until it is unfrozen.`
          : currentStage === "ready_for_edit"
            ? `${adName} unfrozen and moved to Editing for the assigned editor.`
            : `${adName} now bypasses the editor's concurrent-edit limit.`,
        tone: "success"
      });
      router.refresh();
    });
  }

  if (variant === "compact") {
    return (
      <div className="inline-flex items-center overflow-hidden rounded-md border border-border" role="group" aria-label={`Editing freeze for ${adName}`}>
        <button
          type="button"
          disabled={isPending}
          aria-pressed={current === "frozen"}
          title="Freeze editing"
          aria-label={`Freeze editing for ${adName}`}
          onClick={(event) => { event.stopPropagation(); change("frozen"); }}
          className={cn(
            "inline-flex size-7 items-center justify-center transition-colors disabled:opacity-60",
            current === "frozen" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"
          )}
        >
          {isPending && current === "frozen" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Snowflake className="size-3.5" aria-hidden />}
        </button>
        <button
          type="button"
          disabled={isPending}
          aria-pressed={current === "unfrozen"}
          title={currentStage === "ready_for_edit" ? "Unfreeze and start editing" : "Unfreeze editing (overrides the editor limit)"}
          aria-label={`Unfreeze editing for ${adName}`}
          onClick={(event) => { event.stopPropagation(); change("unfrozen"); }}
          className={cn(
            "inline-flex size-7 items-center justify-center border-l border-border transition-colors disabled:opacity-60",
            current === "unfrozen" ? "bg-success/15 text-success" : "text-muted-foreground hover:bg-muted"
          )}
        >
          {isPending && current === "unfrozen" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <LockOpen className="size-3.5" aria-hidden />}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="inline-flex overflow-hidden rounded-lg border border-border bg-card shadow-sm" role="group" aria-label="Editing freeze">
        <button
          type="button"
          disabled={isPending}
          aria-pressed={current === "frozen"}
          onClick={() => change("frozen")}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 px-3 text-sm font-medium transition-colors disabled:opacity-60",
            current === "frozen" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"
          )}
        >
          {isPending && current === "frozen" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Snowflake className="size-4" aria-hidden />}
          Freeze
        </button>
        <button
          type="button"
          disabled={isPending}
          aria-pressed={current === "unfrozen"}
          onClick={() => change("unfrozen")}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 border-l border-border px-3 text-sm font-medium transition-colors disabled:opacity-60",
            current === "unfrozen" ? "bg-success/15 text-success" : "text-muted-foreground hover:bg-muted"
          )}
        >
          {isPending && current === "unfrozen" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LockOpen className="size-4" aria-hidden />}
          Unfreeze
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {current === "frozen"
          ? "Editing is frozen. The editor can't start, resume or submit."
          : currentStage === "ready_for_edit"
            ? "Ready for edit: unfreezing starts editing immediately and bypasses concurrency limits."
            : current === "unfrozen"
              ? "Unfrozen: this creative ignores the editor's concurrent-edit limit."
              : "Default: the editor's concurrent-edit limit applies."}
      </p>
    </div>
  );
}
