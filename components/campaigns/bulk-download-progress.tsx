"use client";

import React, { useCallback, useState } from "react";
import Link from "next/link";
import { Check, Download, ExternalLink, Loader2, SquareCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { downloadProgressLabel, downloadWithProgress, type DownloadProgress } from "@/lib/client-download";
import type { ExportJobSnapshot } from "@/lib/export-job-types";

function formatDownloadBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function useBulkDownload() {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDownloading, setIsDownloading] = useState(false);
  const [bulkDownloadProgress, setBulkDownloadProgress] = useState<DownloadProgress | null>(null);
  const [bulkExportJob, setBulkExportJob] = useState<ExportJobSnapshot | null>(null);
  const [bulkDownloadComplete, setBulkDownloadComplete] = useState(false);
  const [bulkDownloadCount, setBulkDownloadCount] = useState(0);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback(
    (id: string) => {
      return selectedIds.has(id);
    },
    [selectedIds]
  );

  const isAllSelected = useCallback(
    (ids: string[]) => {
      return ids.length > 0 && ids.every((id) => selectedIds.has(id));
    },
    [selectedIds]
  );

  const downloadZip = useCallback(
    async (prefix = "creatives") => {
      if (!selectedIds.size || isDownloading) return;
      const selectedCount = selectedIds.size;
      setIsDownloading(true);
      setBulkDownloadCount(selectedCount);
      setBulkDownloadProgress(null);
      setBulkExportJob(null);
      setBulkDownloadComplete(false);

      const filename = `${prefix}-${new Date().toISOString().slice(0, 10)}.zip`;

      try {
        const created = await fetch("/api/ads/export-jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: Array.from(selectedIds),
            source: "campaigns",
            title: `Campaign Export (${selectedCount} creatives)`
          })
        });

        if (!created.ok) {
          throw new Error(await created.text());
        }

        let job = (await created.json()) as ExportJobSnapshot;
        setBulkExportJob(job);

        while (job.phase === "preparing" || job.phase === "building") {
          await new Promise((resolve) => window.setTimeout(resolve, 500));
          const response = await fetch(`/api/ads/export-jobs/${job.id}`, { cache: "no-store" });
          if (!response.ok) throw new Error(await response.text());
          job = (await response.json()) as ExportJobSnapshot;
          setBulkExportJob(job);
        }

        if (job.phase !== "ready") {
          throw new Error(job.error || "The ZIP archive could not be prepared.");
        }

        await downloadWithProgress(`/api/ads/export-jobs/${job.id}/download`, filename, setBulkDownloadProgress);
        setBulkDownloadComplete(true);

        const included = job.files.filter((file) => file.state === "included").length;
        const includedIds = job.files
          .filter((file) => file.state === "included" && file.adId)
          .map((file) => file.adId as string);

        if (includedIds.length > 0) {
          try {
            await fetch("/api/ads/mark-downloaded", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids: includedIds })
            });
          } catch {
            // best effort
          }
        }

        toast({
          title: `${included} video${included === 1 ? "" : "s"} downloaded`,
          description: `ZIP archive "${filename}" saved to your downloads.`,
          tone: "success"
        });
      } catch (cause) {
        toast({
          title: "Bulk download failed",
          description: cause instanceof Error ? cause.message : "Network error — please try again.",
          tone: "error"
        });
      } finally {
        setIsDownloading(false);
      }
    },
    [selectedIds, isDownloading, toast]
  );

  const dismissDownload = useCallback(() => {
    setBulkExportJob(null);
    setBulkDownloadProgress(null);
    setBulkDownloadComplete(false);
  }, []);

  return {
    selectedIds,
    setSelectedIds,
    toggleSelect,
    selectAll,
    clearSelection,
    isSelected,
    isAllSelected,
    isDownloading,
    bulkDownloadProgress,
    bulkExportJob,
    bulkDownloadComplete,
    bulkDownloadCount,
    downloadZip,
    dismissDownload
  };
}

export function BulkDownloadProgress({
  job,
  progress,
  count,
  complete,
  onDismiss
}: {
  job: ExportJobSnapshot | null;
  progress: DownloadProgress | null;
  count: number;
  complete: boolean;
  onDismiss: () => void;
}) {
  const preparing = !progress && (job?.phase === "preparing" || job?.phase === "building");
  const readyToDownload = !progress && job?.phase === "ready";
  const failed = job?.phase === "failed";
  const included = job?.files.filter((file) => file.state === "included").length ?? 0;
  const skipped = job?.files.filter((file) => file.state === "skipped" || file.state === "failed").length ?? 0;
  const percent = progress?.percent ?? 0;

  const title = complete
    ? "ZIP download complete"
    : failed
    ? "ZIP preparation failed"
    : progress
    ? `Downloading final ZIP · ${included} video${included === 1 ? "" : "s"}`
    : readyToDownload
    ? "Final ZIP ready"
    : "Preparing final ZIP";

  const detail = progress
    ? downloadProgressLabel(progress)
    : readyToDownload
    ? "Starting your browser download…"
    : preparing
    ? `Preparing ${job?.requestedCount ?? count} selected creatives. The download meter starts once the exact ZIP size is ready.`
    : job?.error ?? "Starting…";

  return (
    <section
      className="my-3 rounded-xl border border-primary/30 bg-primary/5 p-4 shadow-xs"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            {complete ? (
              <Check className="size-4" aria-hidden />
            ) : (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            )}
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {detail}
              <span className="block mt-1 text-[11px] text-muted-foreground/90">
                {preparing ? "Zipping continues in the background if you close this tab. " : ""}The archive is saved for 3 days in{" "}
                <Link
                  href="/admin/settings#downloads"
                  className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
                >
                  Settings &gt; Download Logs <ExternalLink className="size-2.5" />
                </Link>
                .
              </span>
            </p>
            {job?.zipSizeBytes ? (
              <p className="mt-1 text-xs font-medium text-foreground">
                Final ZIP size: {formatDownloadBytes(job.zipSizeBytes)} · {included} included
                {skipped ? ` · ${skipped} skipped/failed` : ""}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {progress || complete ? (
            <span className="shrink-0 text-sm font-semibold text-primary">{`${percent}%`}</span>
          ) : null}
          {complete || failed ? (
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              onClick={onDismiss}
              aria-label="Dismiss download status"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      {progress || complete ? (
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="ZIP progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
    </section>
  );
}

export function BulkActionsBar({
  selectedCount,
  totalFilteredCount,
  onSelectAll,
  onClear,
  onDownloadZip,
  isDownloading,
  downloadPercent,
  onMarkDownloaded,
  onRemoveDownloaded,
  isUpdatingDownloaded,
  className
}: {
  selectedCount: number;
  totalFilteredCount: number;
  onSelectAll: () => void;
  onClear: () => void;
  onDownloadZip: () => void;
  isDownloading: boolean;
  downloadPercent?: number | null;
  onMarkDownloaded?: () => void;
  onRemoveDownloaded?: () => void;
  isUpdatingDownloaded?: boolean;
  className?: string;
}) {
  return (
    <div
      className={
        className ??
        "flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-2 text-xs transition-all shadow-xs"
      }
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-[11px]">
          {selectedCount}
        </span>
        <span className="font-semibold text-foreground">
          {selectedCount} selected
        </span>
        <span className="text-muted-foreground">·</span>
        <button
          type="button"
          onClick={onSelectAll}
          className="font-medium text-primary hover:underline"
        >
          Select all ({totalFilteredCount})
        </button>
        <span className="text-muted-foreground">·</span>
        <button
          type="button"
          onClick={onClear}
          className="font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          Clear
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {onMarkDownloaded ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={isDownloading || isUpdatingDownloaded || selectedCount === 0}
            onClick={onMarkDownloaded}
            className="h-8 gap-1 text-xs border-success/30 bg-success/10 text-success hover:bg-success/20 hover:text-success"
          >
            {isUpdatingDownloaded ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Check className="size-3" />
            )}
            Mark downloaded
          </Button>
        ) : null}

        {onRemoveDownloaded ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={isDownloading || isUpdatingDownloaded || selectedCount === 0}
            onClick={onRemoveDownloaded}
            className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Remove downloaded
          </Button>
        ) : null}

        <Button
          size="sm"
          disabled={isDownloading || selectedCount === 0}
          onClick={onDownloadZip}
          className="h-8 gap-1.5 shadow-xs"
        >
          {isDownloading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          {isDownloading && downloadPercent != null
            ? `Downloading ${downloadPercent}%`
            : "Download ZIP"}
        </Button>
      </div>
    </div>
  );
}
