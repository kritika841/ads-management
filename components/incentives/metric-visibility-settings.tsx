"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, Loader2, SlidersHorizontal } from "lucide-react";
import { updateMetricVisibilitySettings } from "@/app/actions/admin";
import { runServerAction } from "@/lib/client-action";
import { Button } from "@/components/ui/button";
import {
  PERFORMANCE_METRIC_KEYS,
  PERFORMANCE_METRICS_INFO,
  type HiddenMetricsByRole,
  type PerformanceMetricKey
} from "@/lib/metric-visibility";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

export function MetricVisibilitySettings({
  initialHiddenMetrics
}: {
  initialHiddenMetrics?: HiddenMetricsByRole;
}) {
  const router = useRouter();
  const [hiddenMetricsByRole, setHiddenMetricsByRole] = useState<HiddenMetricsByRole>({
    content_creator: initialHiddenMetrics?.content_creator ?? [],
    editor: initialHiddenMetrics?.editor ?? [],
    manager: initialHiddenMetrics?.manager ?? []
  });
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function persistVisibility() {
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() =>
        updateMetricVisibilitySettings({ hiddenMetricsByRole })
      );
      setMessage(response.ok ? "Metric visibility settings saved." : response.message ?? "Failed to save settings.");
      if (response.ok) {
        router.refresh();
      }
    });
  }

  function toggleManagerMetric(metricKey: PerformanceMetricKey) {
    setHiddenMetricsByRole((prev) => {
      const current = prev.manager ?? [];
      const next = current.includes(metricKey)
        ? current.filter((m) => m !== metricKey)
        : [...current, metricKey];
      return { ...prev, manager: next };
    });
  }

  function showAllManagerMetrics() {
    setHiddenMetricsByRole((prev) => ({ ...prev, manager: [] }));
  }

  function hideAllManagerMetrics() {
    setHiddenMetricsByRole((prev) => ({ ...prev, manager: [...PERFORMANCE_METRIC_KEYS] }));
  }

  function toggleCreatorMetric(metricKey: PerformanceMetricKey) {
    setHiddenMetricsByRole((prev) => {
      const current = prev.content_creator ?? prev.editor ?? [];
      const next = current.includes(metricKey)
        ? current.filter((m) => m !== metricKey)
        : [...current, metricKey];
      return { ...prev, content_creator: next, editor: next };
    });
  }

  function showAllCreatorMetrics() {
    setHiddenMetricsByRole((prev) => ({ ...prev, content_creator: [], editor: [] }));
  }

  function hideAllCreatorMetrics() {
    setHiddenMetricsByRole((prev) => ({
      ...prev,
      content_creator: [...PERFORMANCE_METRIC_KEYS],
      editor: [...PERFORMANCE_METRIC_KEYS]
    }));
  }

  const managerHidden = hiddenMetricsByRole.manager ?? [];
  const managerVisibleCount = PERFORMANCE_METRIC_KEYS.length - managerHidden.length;

  const creatorHidden = hiddenMetricsByRole.content_creator ?? hiddenMetricsByRole.editor ?? [];
  const creatorVisibleCount = PERFORMANCE_METRIC_KEYS.length - creatorHidden.length;

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-border p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-primary" aria-hidden />
              <h2 className="section-heading">Ads performance metrics visibility</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Control which performance metrics are visible to Managers and Creators/Editors. Administrators always have full access to all metrics.
            </p>
          </div>
          <Button disabled={isPending} onClick={persistVisibility}>
            {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Save visibility settings
          </Button>
        </div>
        {message ? (
          <div className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground">
            {message}
          </div>
        ) : null}
      </div>

      <div className="border-b border-border bg-muted/40 p-4">
        <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Admin permissions:</span> Administrators always see all 10 metrics. Use the two options below to grant separate metric visibility permissions for Managers versus Creators &amp; Editors.
        </div>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-2">
        {/* Option 1: Manager Permissions */}
        <div className="flex flex-col rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  Option 1
                </span>
                <h3 className="mt-1.5 text-sm font-semibold text-foreground">Manager Permissions</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Control which metrics Managers can see in Ads performance.
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold shrink-0",
                  managerVisibleCount === PERFORMANCE_METRIC_KEYS.length
                    ? "bg-success/15 text-success"
                    : managerVisibleCount === 0
                    ? "bg-destructive/15 text-destructive"
                    : "bg-muted text-foreground"
                )}
              >
                {managerVisibleCount} of {PERFORMANCE_METRIC_KEYS.length} visible
              </span>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={showAllManagerMetrics}
                disabled={isPending}
                className="h-7 text-xs"
              >
                <Eye className="size-3" aria-hidden />
                Show all
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={hideAllManagerMetrics}
                disabled={isPending}
                className="h-7 text-xs"
              >
                <EyeOff className="size-3" aria-hidden />
                Hide all
              </Button>
            </div>
          </div>

          <div className="flex-1 space-y-2 p-4">
            {PERFORMANCE_METRIC_KEYS.map((key) => {
              const isHidden = (hiddenMetricsByRole.manager ?? []).includes(key);
              const info = PERFORMANCE_METRICS_INFO[key];
              return (
                <label
                  key={`manager-${key}`}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 transition select-none",
                    isHidden
                      ? "border-dashed border-border bg-muted/20 opacity-70"
                      : "border-border bg-card shadow-sm hover:border-primary/50"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => toggleManagerMetric(key)}
                      className="size-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                    />
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-foreground">{info.shortLabel}</span>
                      <p className="truncate text-[11px] text-muted-foreground">{info.label} &middot; {info.description}</p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      isHidden ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"
                    )}
                  >
                    {isHidden ? "Hidden" : "Visible"}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Option 2: Creator & Editor Permissions */}
        <div className="flex flex-col rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  Option 2
                </span>
                <h3 className="mt-1.5 text-sm font-semibold text-foreground">Creator &amp; Editor Permissions</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Control which metrics Creators and Editors can see in Ads performance.
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold shrink-0",
                  creatorVisibleCount === PERFORMANCE_METRIC_KEYS.length
                    ? "bg-success/15 text-success"
                    : creatorVisibleCount === 0
                    ? "bg-destructive/15 text-destructive"
                    : "bg-muted text-foreground"
                )}
              >
                {creatorVisibleCount} of {PERFORMANCE_METRIC_KEYS.length} visible
              </span>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={showAllCreatorMetrics}
                disabled={isPending}
                className="h-7 text-xs"
              >
                <Eye className="size-3" aria-hidden />
                Show all
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={hideAllCreatorMetrics}
                disabled={isPending}
                className="h-7 text-xs"
              >
                <EyeOff className="size-3" aria-hidden />
                Hide all
              </Button>
            </div>
          </div>

          <div className="flex-1 space-y-2 p-4">
            {PERFORMANCE_METRIC_KEYS.map((key) => {
              const creatorHidden = hiddenMetricsByRole.content_creator ?? hiddenMetricsByRole.editor ?? [];
              const isHidden = creatorHidden.includes(key);
              const info = PERFORMANCE_METRICS_INFO[key];
              return (
                <label
                  key={`creator-${key}`}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 transition select-none",
                    isHidden
                      ? "border-dashed border-border bg-muted/20 opacity-70"
                      : "border-border bg-card shadow-sm hover:border-primary/50"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => toggleCreatorMetric(key)}
                      className="size-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                    />
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-foreground">{info.shortLabel}</span>
                      <p className="truncate text-[11px] text-muted-foreground">{info.label} &middot; {info.description}</p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      isHidden ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"
                    )}
                  >
                    {isHidden ? "Hidden" : "Visible"}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
