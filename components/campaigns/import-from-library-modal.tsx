"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, CalendarDays, CheckCircle2, FileSpreadsheet, Film, Filter, Library, Loader2, Play, RotateCcw, Search, Square, SquareCheck, Video, X } from "lucide-react";
import { bulkAssignCampaign } from "@/app/actions/ads";
import { listImportableCreatives, type ImportableCreative } from "@/app/actions/campaign-import";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { runServerAction } from "@/lib/client-action";
import { parseGoogleDriveUrl, resolveAdThumbnailUrl } from "@/lib/drive-urls";
import { productionStageLabels } from "@/lib/production-workflow";
import { cn, formatDate } from "@/lib/utils";

function CreativeThumb({
  item,
  onPlay
}: {
  item: ImportableCreative;
  onPlay: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const thumbUrl = resolveAdThumbnailUrl(item.thumbnail_url, item.drive_file_id);
  const hasVideo = Boolean(item.drive_file_id || item.drive_url);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onPlay();
      }}
      className="group/thumb relative size-12 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border bg-muted/60 shadow-xs hover:border-primary transition-all duration-150"
      title="Click to preview video"
    >
      {thumbUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl}
          alt={item.name}
          loading="lazy"
          className="size-full object-cover group-hover/thumb:scale-105 transition-transform duration-200"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center bg-muted text-muted-foreground p-1 text-center">
          <Film className="size-4 opacity-50" aria-hidden />
        </div>
      )}
      <div className={cn(
        "absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity",
        hasVideo ? "opacity-0 group-hover/thumb:opacity-100" : "opacity-0"
      )}>
        <Play className="size-4 fill-white text-white" aria-hidden />
      </div>
    </div>
  );
}

/**
 * Campaign-side counterpart of the Creative Library's bulk "Add to campaign": pick any number of
 * existing creatives and add them into this campaign in one go.
 */
export function ImportFromLibraryModal({
  campaignId,
  campaignName,
  onClose,
  onImported,
  onUseCsv
}: {
  campaignId: string;
  campaignName: string;
  onClose: () => void;
  onImported: () => void;
  /** Switch to the CSV import (new creatives from scripts). */
  onUseCsv?: () => void;
}) {
  const [creatives, setCreatives] = useState<ImportableCreative[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "unassigned">("all");
  const [creatorFilter, setCreatorFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [approvalFilter, setApprovalFilter] = useState<"all" | "approved" | "unapproved">("all");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "last_7_days" | "last_30_days" | "this_month" | "custom">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState<"created_desc" | "created_asc" | "approved_desc" | "name_asc">("created_desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [lightboxCreative, setLightboxCreative] = useState<ImportableCreative | null>(null);

  useEffect(() => {
    let cancelled = false;
    void runServerAction(() => listImportableCreatives(campaignId)).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setLoadError(response.message ?? "Unable to load creatives.");
        setCreatives([]);
        return;
      }
      setCreatives(response.creatives ?? []);
    });
    return () => { cancelled = true; };
  }, [campaignId]);

  // Unique lists for filter dropdowns
  const availableCreators = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of creatives ?? []) {
      if (item.creator_id && item.creator_name) {
        map.set(item.creator_id, item.creator_name);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [creatives]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const item of creatives ?? []) {
      for (const tag of item.tags) {
        set.add(tag);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [creatives]);

  const availableStages = useMemo(() => {
    const set = new Set<string>();
    for (const item of creatives ?? []) {
      if (item.production_stage) {
        set.add(item.production_stage);
      }
    }
    return Array.from(set);
  }, [creatives]);

  const hasActiveFilters =
    creatorFilter !== "all" ||
    tagFilter !== "all" ||
    stageFilter !== "all" ||
    approvalFilter !== "all" ||
    dateFilter !== "all" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    sortBy !== "created_desc";

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const msDay = 24 * 60 * 60 * 1000;

    const filtered = (creatives ?? []).filter((item) => {
      if (scope === "unassigned" && item.campaign_id) return false;
      if (creatorFilter !== "all" && item.creator_id !== creatorFilter) return false;
      if (tagFilter !== "all" && !item.tags.includes(tagFilter)) return false;
      if (stageFilter !== "all" && item.production_stage !== stageFilter) return false;
      if (approvalFilter === "approved" && !item.final_approved_at && !item.approved_at) return false;
      if (approvalFilter === "unapproved" && (item.final_approved_at || item.approved_at)) return false;

      // Date filtering
      const itemDateStr = item.created_at ? item.created_at.slice(0, 10) : "";
      const itemDateMs = item.created_at ? Date.parse(item.created_at) : 0;

      if (dateFilter === "today") {
        if (itemDateStr !== todayStr) return false;
      } else if (dateFilter === "last_7_days") {
        if (now.getTime() - itemDateMs > 7 * msDay) return false;
      } else if (dateFilter === "last_30_days") {
        if (now.getTime() - itemDateMs > 30 * msDay) return false;
      } else if (dateFilter === "this_month") {
        const monthPrefix = todayStr.slice(0, 7);
        if (!itemDateStr.startsWith(monthPrefix)) return false;
      } else if (dateFilter === "custom") {
        if (dateFrom && itemDateStr < dateFrom) return false;
        if (dateTo && itemDateStr > dateTo) return false;
      }

      // Standalone date picker inputs fallback
      if (dateFrom && itemDateStr < dateFrom) return false;
      if (dateTo && itemDateStr > dateTo) return false;

      if (!needle) return true;
      return (
        item.name.toLowerCase().includes(needle) ||
        Boolean(item.campaign_name?.toLowerCase().includes(needle)) ||
        Boolean(item.creator_name?.toLowerCase().includes(needle)) ||
        item.tags.some((t) => t.toLowerCase().includes(needle))
      );
    });

    // Date-wise and attribute sorting
    return filtered.sort((a, b) => {
      if (sortBy === "created_desc") {
        return Date.parse(b.created_at) - Date.parse(a.created_at);
      }
      if (sortBy === "created_asc") {
        return Date.parse(a.created_at) - Date.parse(b.created_at);
      }
      if (sortBy === "approved_desc") {
        const aApp = a.final_approved_at || a.approved_at || a.created_at;
        const bApp = b.final_approved_at || b.approved_at || b.created_at;
        return Date.parse(bApp) - Date.parse(aApp);
      }
      if (sortBy === "name_asc") {
        return a.name.localeCompare(b.name);
      }
      return 0;
    });
  }, [creatives, query, scope, creatorFilter, tagFilter, stageFilter, approvalFilter, dateFilter, dateFrom, dateTo, sortBy]);

  const allVisibleSelected = visible.length > 0 && visible.every((item) => selected.has(item.id));
  const movingFromOther = (creatives ?? []).filter((item) => selected.has(item.id) && item.campaign_id).length;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visible.forEach((item) => next.delete(item.id));
      else visible.forEach((item) => next.add(item.id));
      return next;
    });
  }

  function clearFilters() {
    setCreatorFilter("all");
    setTagFilter("all");
    setStageFilter("all");
    setApprovalFilter("all");
    setDateFilter("all");
    setDateFrom("");
    setDateTo("");
    setSortBy("created_desc");
    setQuery("");
  }

  async function submit() {
    if (!selected.size || pending) return;
    setPending(true);
    setError(null);
    const response = await runServerAction(() => bulkAssignCampaign(Array.from(selected), campaignId));
    setPending(false);
    if (!response.ok) {
      setError(response.message ?? "Unable to add creatives.");
      return;
    }
    setDone(selected.size);
    onImported();
  }

  const lightboxPreviewUrl = useMemo(() => {
    if (!lightboxCreative) return null;
    if (lightboxCreative.drive_file_id) {
      return `https://drive.google.com/file/d/${lightboxCreative.drive_file_id}/preview`;
    }
    if (lightboxCreative.drive_url) {
      return parseGoogleDriveUrl(lightboxCreative.drive_url)?.previewUrl ?? lightboxCreative.drive_url;
    }
    return null;
  }, [lightboxCreative]);

  return (
    <>
      <Modal open labelledBy="import-library-title" onClose={pending ? () => undefined : onClose} className="p-0 sm:p-6">
        <section className="mx-auto flex h-full w-full flex-col bg-card shadow-float sm:h-auto sm:max-h-[88vh] sm:max-w-4xl sm:rounded-xl dark:shadow-none" onClick={(event) => event.stopPropagation()}>
          <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 id="import-library-title" className="flex items-center gap-2 text-lg font-semibold text-foreground"><Library className="size-5 text-primary" aria-hidden />Import from Creative Library</h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">Select existing creatives to add to <span className="font-medium text-foreground">{campaignName}</span>.</p>
            </div>
            <Button size="icon" variant="ghost" title="Close" disabled={pending} onClick={onClose}><X className="size-5" aria-hidden /></Button>
          </header>

          {done !== null ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <CheckCircle2 className="size-10 text-success" aria-hidden />
              <p className="text-base font-semibold text-foreground">{done} creative{done === 1 ? "" : "s"} added to {campaignName}</p>
              <Button onClick={onClose}>Done</Button>
            </div>
          ) : (
            <>
              {/* Search and Scope bar */}
              <div className="flex flex-col gap-2 border-b border-border px-5 py-3 sm:flex-row sm:items-center">
                <label className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <input
                    id="import-library-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search by name, campaign, creator or tag"
                    className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </label>
                <div className="inline-flex overflow-hidden rounded-lg border border-border text-xs font-medium" role="group" aria-label="Scope">
                  {(["all", "unassigned"] as const).map((value) => (
                    <button key={value} type="button" aria-pressed={scope === value} onClick={() => setScope(value)} className={cn("h-9 px-3 transition-colors", scope === value ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted", value === "unassigned" && "border-l border-border")}>
                      {value === "all" ? "All creatives" : "No campaign"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filters bar: Creator, Tag, Stage, Approval, Date, Sort */}
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-5 py-2.5 text-xs">
                <span className="flex items-center gap-1 font-medium text-muted-foreground">
                  <Filter className="size-3.5" aria-hidden /> Filters:
                </span>

                {/* Creator Filter */}
                <select
                  value={creatorFilter}
                  onChange={(e) => setCreatorFilter(e.target.value)}
                  className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
                  aria-label="Filter by creator"
                >
                  <option value="all">All Creators ({availableCreators.length})</option>
                  {availableCreators.map((creator) => (
                    <option key={creator.id} value={creator.id}>{creator.name}</option>
                  ))}
                </select>

                {/* Tag Filter */}
                <select
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
                  aria-label="Filter by tag"
                >
                  <option value="all">All Tags ({availableTags.length})</option>
                  {availableTags.map((tag) => (
                    <option key={tag} value={tag}>#{tag}</option>
                  ))}
                </select>

                {/* Stage Filter */}
                <select
                  value={stageFilter}
                  onChange={(e) => setStageFilter(e.target.value)}
                  className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
                  aria-label="Filter by stage"
                >
                  <option value="all">All Stages ({availableStages.length})</option>
                  {availableStages.map((stage) => (
                    <option key={stage} value={stage}>{productionStageLabels[stage as keyof typeof productionStageLabels] ?? stage}</option>
                  ))}
                </select>

                {/* Approval Status Filter */}
                <select
                  value={approvalFilter}
                  onChange={(e) => setApprovalFilter(e.target.value as "all" | "approved" | "unapproved")}
                  className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
                  aria-label="Filter by approval status"
                >
                  <option value="all">All Approvals</option>
                  <option value="approved">Approved Only</option>
                  <option value="unapproved">Not Yet Approved</option>
                </select>

                {/* Date Filter */}
                <div className="flex items-center gap-1.5">
                  <CalendarDays className="size-3.5 text-muted-foreground ml-1" aria-hidden />
                  <select
                    value={dateFilter}
                    onChange={(e) => {
                      const next = e.target.value as typeof dateFilter;
                      setDateFilter(next);
                      if (next !== "custom") {
                        setDateFrom("");
                        setDateTo("");
                      }
                    }}
                    className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
                    aria-label="Filter by date"
                  >
                    <option value="all">All Dates</option>
                    <option value="today">Created Today</option>
                    <option value="last_7_days">Last 7 Days</option>
                    <option value="last_30_days">Last 30 Days</option>
                    <option value="this_month">This Month</option>
                    <option value="custom">Custom Date Range…</option>
                  </select>
                </div>

                {dateFilter === "custom" ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      placeholder="From"
                      aria-label="Date from"
                      className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                    <span className="text-muted-foreground">–</span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      placeholder="To"
                      aria-label="Date to"
                      className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                ) : null}

                {/* Sort By Dropdown */}
                <div className="flex items-center gap-1.5 ml-auto sm:ml-0">
                  <ArrowUpDown className="size-3.5 text-muted-foreground ml-1" aria-hidden />
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-foreground font-medium outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
                    aria-label="Sort creatives"
                  >
                    <option value="created_desc">Newest First</option>
                    <option value="created_asc">Oldest First</option>
                    <option value="approved_desc">Recently Approved</option>
                    <option value="name_asc">Name (A–Z)</option>
                  </select>
                </div>

                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline ml-auto"
                  >
                    <RotateCcw className="size-3" aria-hidden /> Reset filters
                  </button>
                ) : null}
              </div>

              <div className="min-h-[260px] flex-1 overflow-y-auto">
                {creatives === null ? (
                  <div className="flex h-60 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />Loading creatives…</div>
                ) : loadError ? (
                  <p className="m-5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{loadError}</p>
                ) : visible.length === 0 ? (
                  <p className="px-5 py-12 text-center text-sm text-muted-foreground">No creatives match the selected filters.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    <li className="sticky top-0 z-10 flex items-center justify-between bg-card/95 px-5 py-2 text-xs text-muted-foreground backdrop-blur-sm">
                      <button type="button" onClick={toggleAllVisible} className="inline-flex items-center gap-2 font-medium hover:text-foreground">
                        {allVisibleSelected ? <SquareCheck className="size-4 text-primary" aria-hidden /> : <Square className="size-4" aria-hidden />}
                        {allVisibleSelected ? "Deselect" : "Select"} all {visible.length} shown
                      </button>
                      <span className="text-[11px] text-muted-foreground">Showing {visible.length} of {creatives.length}</span>
                    </li>
                    {visible.map((item) => {
                      const isSelected = selected.has(item.id);
                      return (
                        <li key={item.id}>
                          <div
                            onClick={() => toggle(item.id)}
                            className={cn(
                              "flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors cursor-pointer",
                              isSelected ? "bg-primary/5" : "hover:bg-muted/60"
                            )}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggle(item.id);
                              }}
                              aria-pressed={isSelected}
                              aria-label={`Select ${item.name}`}
                              className="shrink-0"
                            >
                              {isSelected ? <SquareCheck className="size-4 text-primary" aria-hidden /> : <Square className="size-4 text-muted-foreground" aria-hidden />}
                            </button>

                            {/* Thumbnail with lightbox click */}
                            <CreativeThumb item={item} onPlay={() => setLightboxCreative(item)} />

                            {(() => {
                              const approvalDate = item.final_approved_at || item.approved_at;
                              return (
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium text-foreground">{item.name}</span>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                    <span className="truncate">
                                      {item.campaign_name ? `In ${item.campaign_name}` : "No campaign"}{item.creator_name ? ` · ${item.creator_name}` : ""}
                                    </span>
                                    {approvalDate ? (
                                      <span className="inline-flex items-center gap-1 font-medium text-success">
                                        <CheckCircle2 className="size-3" aria-hidden />
                                        Approved {formatDate(approvalDate)}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground/80">
                                        Created {formatDate(item.created_at)}
                                      </span>
                                    )}
                                  </div>
                                  {item.tags.length > 0 && (
                                    <span className="mt-1 flex flex-wrap gap-1">
                                      {item.tags.slice(0, 4).map((tag) => (
                                        <span key={tag} className="rounded bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground">#{tag}</span>
                                      ))}
                                      {item.tags.length > 4 && (
                                        <span className="text-[10px] text-muted-foreground">+{item.tags.length - 4}</span>
                                      )}
                                    </span>
                                  )}
                                </span>
                              );
                            })()}

                            <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {productionStageLabels[item.production_stage as keyof typeof productionStageLabels] ?? item.production_stage}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <footer className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground">
                  {onUseCsv ? <button type="button" onClick={onUseCsv} className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"><FileSpreadsheet className="size-3.5" aria-hidden />Import new creatives from CSV instead</button> : null}
                  {movingFromOther ? <p className="mt-1 text-primary">{movingFromOther} selected creative{movingFromOther === 1 ? " is" : "s are"} in another campaign and will be added to this campaign as well.</p> : null}
                  {error ? <p className="mt-1 text-destructive" role="alert">{error}</p> : null}
                </div>
                <div className="flex gap-2 sm:justify-end">
                  <Button variant="secondary" disabled={pending} onClick={onClose}>Cancel</Button>
                  <Button id="import-library-submit" disabled={!selected.size || pending} onClick={submit}>
                    {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    Add {selected.size || ""} to campaign
                  </Button>
                </div>
              </footer>
            </>
          )}
        </section>
      </Modal>

      {/* Video Lightbox Modal */}
      {lightboxCreative ? (
        <Modal open labelledBy="lightbox-title" onClose={() => setLightboxCreative(null)} className="p-0 sm:p-6 z-50">
          <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden border border-border bg-card shadow-float sm:rounded-xl dark:shadow-none" onClick={(e) => e.stopPropagation()}>
            <header className="flex min-h-14 items-center justify-between gap-4 border-b border-border px-5 py-3">
              <div className="min-w-0">
                <h3 id="lightbox-title" className="truncate text-base font-semibold text-foreground">{lightboxCreative.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {lightboxCreative.creator_name ? `By ${lightboxCreative.creator_name}` : "Creative Video"}
                  {lightboxCreative.campaign_name ? ` · ${lightboxCreative.campaign_name}` : ""}
                  {` · ${productionStageLabels[lightboxCreative.production_stage as keyof typeof productionStageLabels] ?? lightboxCreative.production_stage}`}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setLightboxCreative(null)} title="Close preview">
                <X className="size-5" aria-hidden />
              </Button>
            </header>

            <div className="relative aspect-video w-full bg-neutral-950 flex items-center justify-center">
              {lightboxPreviewUrl ? (
                <iframe
                  src={lightboxPreviewUrl}
                  title={lightboxCreative.name}
                  className="size-full border-0"
                  allow="autoplay; fullscreen"
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Video className="size-8" aria-hidden />
                  No video preview available for this creative
                </div>
              )}
            </div>

            {lightboxCreative.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-border px-5 py-3">
                {lightboxCreative.tags.map((tag) => (
                  <span key={tag} className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
