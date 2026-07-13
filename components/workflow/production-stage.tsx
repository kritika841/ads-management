import { productionStageLabels } from "@/lib/production-workflow";
import type { ProductionStage } from "@/lib/types";
import { cn } from "@/lib/utils";

const stageStyles: Record<ProductionStage, string> = {
  script_writing: "border-border bg-muted text-muted-foreground",
  ready_to_shoot: "border-primary/25 bg-accent text-accent-foreground",
  shoot_complete: "border-primary/30 bg-primary/10 text-primary",
  ready_for_edit: "border-primary/30 bg-primary/10 text-primary",
  editing: "border-primary/35 bg-primary/15 text-primary",
  changes_requested: "border-warning/30 bg-warning/15 text-warning",
  creator_review: "border-warning/30 bg-warning/15 text-warning",
  final_review: "border-primary/30 bg-accent text-accent-foreground",
  approved: "border-success/30 bg-success/15 text-success"
};

export function ProductionStageBadge({ stage, className }: { stage: ProductionStage; className?: string }) {
  return (
    <span className={cn("inline-flex h-7 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold", stageStyles[stage], className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden />
      <span className="truncate">{productionStageLabels[stage]}</span>
    </span>
  );
}
