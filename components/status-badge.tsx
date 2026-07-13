import { statusLabels, statusStyles } from "@/lib/constants";
import type { AdStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: AdStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold ring-1",
        statusStyles[status],
        className
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {statusLabels[status]}
    </span>
  );
}
