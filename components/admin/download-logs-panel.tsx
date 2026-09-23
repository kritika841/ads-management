"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Download,
  Trash2,
  RefreshCw,
  Clock,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FolderArchive,
  Search,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import type { DownloadLog } from "@/lib/download-logs";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (60 * 1000));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    return `${diffDays}d ago`;
  } catch {
    return dateString;
  }
}

function formatExpiry(expiresAtString: string): { label: string; isUrgent: boolean } {
  try {
    const expiresAt = new Date(expiresAtString).getTime();
    const now = Date.now();
    const diffMs = expiresAt - now;

    if (diffMs <= 0) return { label: "Expired", isUrgent: true };
    const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
    const diffDays = Math.floor(diffHours / 24);
    const remainingHours = diffHours % 24;

    if (diffDays > 0) {
      return {
        label: `${diffDays}d ${remainingHours}h left`,
        isUrgent: diffDays === 0
      };
    }
    return {
      label: `${Math.max(1, diffHours)}h left`,
      isUrgent: true
    };
  } catch {
    return { label: "3 days", isUrgent: false };
  }
}

export function DownloadLogsPanel({ initialLogs = [] }: { initialLogs?: DownloadLog[] }) {
  const { toast } = useToast();
  const [logs, setLogs] = useState<DownloadLog[]>(initialLogs);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ready" | "building" | "failed">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "creative_library" | "campaigns">("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchLogs = useCallback(async (quiet = false) => {
    if (!quiet) setIsRefreshing(true);
    try {
      const response = await fetch("/api/ads/export-jobs", { cache: "no-store" });
      if (response.ok) {
        const data: DownloadLog[] = await response.json();
        setLogs(data);
      }
    } catch {
      // silently handle poll errors
    } finally {
      if (!quiet) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (initialLogs.length > 0) {
      setLogs((current) => (current.length === 0 ? initialLogs : current));
    }
  }, [initialLogs]);

  // Poll automatically if any job is currently in "preparing" or "building" state
  useEffect(() => {
    const hasActiveJobs = logs.some((l) => l.status === "preparing" || l.status === "building");
    if (!hasActiveJobs) return;

    const interval = setInterval(() => {
      fetchLogs(true);
    }, 3000);

    return () => clearInterval(interval);
  }, [logs, fetchLogs]);

  // Handle manual deletion of a download log
  async function handleDelete(id: string, title: string) {
    if (!confirm(`Delete archive "${title}"? The stored ZIP file will be permanently removed from disk.`)) {
      return;
    }

    setDeletingId(id);
    try {
      const response = await fetch(`/api/ads/export-jobs/${id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      setLogs((prev) => prev.filter((log) => log.id !== id));
      toast({
        title: "Archive deleted",
        description: "Log record and stored ZIP file have been removed.",
        tone: "success"
      });
    } catch (cause) {
      toast({
        title: "Delete failed",
        description: cause instanceof Error ? cause.message : "Could not delete export log.",
        tone: "error"
      });
    } finally {
      setDeletingId(null);
    }
  }

  // Handle direct re-downloading from Settings
  async function handleDownload(log: DownloadLog) {
    if (log.status !== "ready") return;
    setDownloadingId(log.id);

    try {
      const link = document.createElement("a");
      link.href = `/api/ads/export-jobs/${log.id}/download`;
      link.download = log.zip_filename || `${log.title}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      toast({
        title: "Download started",
        description: `Downloading "${log.zip_filename}" from server storage.`,
        tone: "success"
      });

      // Update local download count indicator optimistically
      setLogs((prev) =>
        prev.map((item) =>
          item.id === log.id
            ? { ...item, download_count: (item.download_count || 0) + 1, last_downloaded_at: new Date().toISOString() }
            : item
        )
      );
    } catch (cause) {
      toast({
        title: "Download error",
        description: cause instanceof Error ? cause.message : "Unable to download file.",
        tone: "error"
      });
    } finally {
      setDownloadingId(null);
    }
  }

  // Calculate storage metrics
  const stats = useMemo(() => {
    const total = logs.length;
    const ready = logs.filter((l) => l.status === "ready").length;
    const inProgress = logs.filter((l) => l.status === "preparing" || l.status === "building").length;
    const totalBytes = logs.reduce((sum, l) => sum + (l.zip_size_bytes || 0), 0);
    return { total, ready, inProgress, totalBytes };
  }, [logs]);

  // Filtered log items
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (statusFilter !== "all" && log.status !== statusFilter) {
        if (statusFilter === "building" && (log.status === "preparing" || log.status === "building")) {
          // matches
        } else {
          return false;
        }
      }
      if (sourceFilter !== "all" && log.source !== sourceFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = log.title.toLowerCase().includes(query);
        const matchesCampaign = log.campaign_name?.toLowerCase().includes(query);
        const matchesCreatives = log.creative_names?.some((name) => name.toLowerCase().includes(query));
        if (!matchesTitle && !matchesCampaign && !matchesCreatives) {
          return false;
        }
      }
      return true;
    });
  }, [logs, statusFilter, sourceFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Total Archives</span>
            <FolderArchive className="size-4 text-primary" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-foreground">{stats.total}</span>
            <span className="text-xs text-muted-foreground">exports tracked</span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Ready for Download</span>
            <CheckCircle2 className="size-4 text-success" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-success">{stats.ready}</span>
            {stats.inProgress > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs text-warning">
                <Loader2 className="size-3 animate-spin" /> {stats.inProgress} building
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">available instantly</span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Storage Retained</span>
            <HardDrive className="size-4 text-primary" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-foreground">{formatBytes(stats.totalBytes)}</span>
            <span className="text-xs text-muted-foreground">on server disk</span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Retention Policy</span>
            <Clock className="size-4 text-warning" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-foreground">3 Days</span>
            <span className="text-xs text-muted-foreground">auto-purge stale ZIPs</span>
          </div>
        </div>
      </div>

      {/* Main Table Section */}
      <section className="panel overflow-hidden border border-border shadow-xs">
        <div className="border-b border-border p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <span>Download Logs</span>
              {stats.inProgress > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
                  <Loader2 className="size-3 animate-spin" /> Zipping in background
                </span>
              )}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pre-built creative ZIP archives. Archived on server for 3 days so you can re-download anytime without re-zipping.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fetchLogs()}
              disabled={isRefreshing}
              className="h-8 gap-1.5 text-xs"
            >
              <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Search archive, campaign, or creative..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs bg-background"
              />
            </div>

            <div className="flex items-center rounded-lg border border-border bg-background p-0.5">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition",
                  statusFilter === "all" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                All ({logs.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("ready")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition",
                  statusFilter === "ready" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Ready ({stats.ready})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("building")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition",
                  statusFilter === "building" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                In Progress ({stats.inProgress})
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Source:</span>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as "all" | "creative_library" | "campaigns")}
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus:outline-none"
            >
              <option value="all">All sources</option>
              <option value="creative_library">Creative Library</option>
              <option value="campaigns">Campaigns</option>
            </select>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-border bg-muted/60 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Archive / Scope</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">ZIP Size</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Downloads</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <FolderArchive className="mx-auto size-8 text-muted-foreground/50" />
                    <p className="mt-2 text-sm font-medium text-foreground">No download archives found</p>
                    <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                      Whenever you select and download creatives from the Creative Library or Campaigns,
                      the zipping process runs in the background and preserves the ZIP file here for 3 days.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isExpanded = expandedId === log.id;
                  const isBuilding = log.status === "preparing" || log.status === "building";
                  const isReady = log.status === "ready";
                  const isFailed = log.status === "failed";
                  const expiry = formatExpiry(log.expires_at);

                  return (
                    <React.Fragment key={log.id}>
                      <tr className={cn("transition hover:bg-muted/50", isExpanded && "bg-muted/30")}>
                        <td className="px-4 py-3.5">
                          <div className="flex items-start gap-2.5">
                            <div className="mt-0.5">
                              {isBuilding ? (
                                <span className="flex size-7 items-center justify-center rounded-lg bg-warning/15 text-warning">
                                  <Loader2 className="size-3.5 animate-spin" />
                                </span>
                              ) : isReady ? (
                                <span className="flex size-7 items-center justify-center rounded-lg bg-success/15 text-success">
                                  <CheckCircle2 className="size-3.5" />
                                </span>
                              ) : (
                                <span className="flex size-7 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
                                  <AlertCircle className="size-3.5" />
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-foreground text-xs sm:text-sm truncate max-w-[260px]">
                                  {log.title}
                                </span>
                                <span
                                  className={cn(
                                    "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                                    log.source === "campaigns"
                                      ? "bg-accent text-accent-foreground"
                                      : "bg-primary/10 text-primary"
                                  )}
                                >
                                  {log.source === "campaigns" ? "Campaigns" : "Library"}
                                </span>
                              </div>

                              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{log.creative_count} creative{log.creative_count === 1 ? "" : "s"}</span>
                                {log.creative_names && log.creative_names.length > 0 && (
                                  <>
                                    <span>·</span>
                                    <button
                                      type="button"
                                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                                      className="inline-flex items-center gap-0.5 text-primary hover:underline"
                                    >
                                      {isExpanded ? "Hide items" : "View items"}
                                      {isExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3.5">
                          {isBuilding ? (
                            <span className="inline-flex items-center gap-1.5 rounded-md bg-warning/10 px-2 py-1 text-xs font-medium text-warning">
                              <Loader2 className="size-3 animate-spin" />
                              Zipping...
                            </span>
                          ) : isReady ? (
                            <span className="inline-flex items-center gap-1.5 rounded-md bg-success/10 px-2 py-1 text-xs font-medium text-success">
                              <span className="size-1.5 rounded-full bg-success" />
                              Ready
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive"
                              title={log.error ?? "Export failed"}
                            >
                              <span className="size-1.5 rounded-full bg-destructive" />
                              Failed
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3.5 text-xs font-mono font-medium text-foreground">
                          {formatBytes(log.zip_size_bytes)}
                        </td>

                        <td className="px-4 py-3.5 text-xs text-muted-foreground">
                          <div>{formatRelativeTime(log.created_at)}</div>
                          <div className="text-[11px] text-muted-foreground/70">by {log.user_name}</div>
                        </td>

                        <td className="px-4 py-3.5 text-xs">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 font-medium",
                              expiry.isUrgent ? "text-warning font-semibold" : "text-muted-foreground"
                            )}
                          >
                            <Clock className="size-3" />
                            {expiry.label}
                          </span>
                        </td>

                        <td className="px-4 py-3.5 text-xs text-muted-foreground">
                          {log.download_count > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                              {log.download_count}x
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>

                        <td className="px-4 py-3.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {isReady && (
                              <Button
                                size="sm"
                                onClick={() => handleDownload(log)}
                                disabled={downloadingId === log.id}
                                className="h-8 gap-1.5 text-xs bg-primary text-primary-foreground shadow-xs hover:bg-primary/90"
                              >
                                {downloadingId === log.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Download className="size-3.5" />
                                )}
                                Download ZIP
                              </Button>
                            )}

                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
                              title="Delete archive and stored ZIP"
                              disabled={deletingId === log.id}
                              onClick={() => handleDelete(log.id, log.title)}
                            >
                              {deletingId === log.id ? (
                                <Loader2 className="size-3.5 animate-spin text-destructive" />
                              ) : (
                                <Trash2 className="size-3.5" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Creative Items Row */}
                      {isExpanded && log.creative_names && log.creative_names.length > 0 && (
                        <tr className="bg-muted/20">
                          <td colSpan={7} className="px-6 py-3 border-t border-border/50">
                            <div className="text-xs">
                              <p className="font-semibold text-foreground mb-1.5 flex items-center gap-1.5">
                                <Sparkles className="size-3.5 text-primary" />
                                Included Creatives ({log.creative_names.length}):
                              </p>
                              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-2">
                                {log.creative_names.map((name, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-flex items-center rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-mono text-foreground shadow-2xs"
                                  >
                                    {name}
                                  </span>
                                ))}
                              </div>
                              {log.error && (
                                <div className="mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                                  <strong>Error details:</strong> {log.error}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
