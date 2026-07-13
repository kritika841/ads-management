import { productionStageLabels } from "@/lib/production-workflow";
import type { ProductionStage } from "@/lib/types";
import { cn } from "@/lib/utils";

const stageStyles: Record<ProductionStage, string> = {
  script_writing: "border-slate-200 bg-slate-100 text-slate-700",
  ready_to_shoot: "border-sky-200 bg-sky-50 text-sky-800",
  shoot_complete: "border-cyan-200 bg-cyan-50 text-cyan-800",
  ready_for_edit: "border-teal-200 bg-teal-50 text-teal-800",
  editing: "border-blue-200 bg-blue-50 text-blue-800",
  changes_requested: "border-orange-200 bg-orange-50 text-orange-800",
  creator_review: "border-amber-200 bg-amber-50 text-amber-800",
  final_review: "border-indigo-200 bg-indigo-50 text-indigo-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800"
};

export function ProductionStageBadge({ stage, className }: { stage: ProductionStage; className?: string }) {
  return (
    <span className={cn("inline-flex h-7 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold", stageStyles[stage], className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden />
      <span className="truncate">{productionStageLabels[stage]}</span>
    </span>
  );
}
