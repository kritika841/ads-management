"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowRight, ArrowUp, CalendarClock, Check, ChevronsUpDown, Download, Eye, Filter, Grid2X2, ListFilter, Loader2, Play, Plus, Search, Square, SquareCheck, Table2, Tags, UserCheck, Video, X } from "lucide-react";
import { assignEditor, bulkAddTags, reviewAd } from "@/app/actions/ads";
import { AdPreviewModal } from "@/components/dashboard/ad-preview-modal";
import { DeleteAdButton } from "@/components/dashboard/delete-ad-button";
import { CreatorItemForm } from "@/components/workflow/creator-item-form";
import { ProductionStageBadge } from "@/components/workflow/production-stage";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { platforms } from "@/lib/constants";
import { runServerAction } from "@/lib/client-action";
import { canDeleteAd } from "@/lib/permissions";
import { readDashboardFilters, writeDashboardFilters, type DashboardView } from "@/lib/dashboard-filter-state";
import { creatorEditableStages, isFinalMediaVisible, productionStageLabels, productionStages, workflowStageAgeLabel } from "@/lib/production-workflow";
import type { AdStatus, AdWithRelations, Campaign, Product, Profile } from "@/lib/types";
import { cn, dateOnlyDaysFromToday, formatDateOnly } from "@/lib/utils";
import { matchesQueue, queueForRole, queuesForRole, type QueueKey } from "@/lib/work-queues";

const gridPageSize = 18;

export function DashboardClient({ profile, ads, campaigns, products, profiles, availableTags, editorWorkloads, initialQueue, mediaTokens }: { profile: Profile; ads: AdWithRelations[]; campaigns: Campaign[]; products: Product[]; profiles: Profile[]; availableTags: string[]; editorWorkloads: Record<string, number>; initialQueue: QueueKey; mediaTokens: Record<string, string> }) {
  const router = useRouter();
  const { toast } = useToast();
  const queueOptions = useMemo(() => queuesForRole(profile.role), [profile.role]);
  const [queue, setQueue] = useState<QueueKey>(initialQueue);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [editor, setEditor] = useState("all");
  const [creator, setCreator] = useState("all");
  const [campaign, setCampaign] = useState("all");
  const [product, setProduct] = useState("all");
  const [platform, setPlatform] = useState("all");
  const [tag, setTag] = useState("all");
  const [deadline, setDeadline] = useState("all");
  const [sort, setSort] = useState("all");
  const [view, setView] = useState<DashboardView>("grid");
  const [urlInitialized, setUrlInitialized] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAd, setEditingAd] = useState<AdWithRelations | null>(null);
  const [previewAd, setPreviewAd] = useState<AdWithRelations | null>(null);
  const [playingAdId, setPlayingAdId] = useState<string | null>(null);
  const [cancelAd, setCancelAd] = useState<AdWithRelations | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [actingAdId, setActingAdId] = useState<string | null>(null);
  const [visibleGridCount, setVisibleGridCount] = useState(gridPageSize);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [bulkTagModalOpen, setBulkTagModalOpen] = useState(false);
  const [isBulkTagging, setIsBulkTagging] = useState(false);
  const [isPending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const editors = profiles.filter((item) => item.role === "editor");
  const creators = profiles.filter((item) => item.role === "content_creator");
  const canCreate = profile.role === "content_creator" || profile.role === "admin" || profile.role === "manager";

  useEffect(() => {
    const saved = window.localStorage.getItem("adflow-dashboard-view");
    const state = readDashboardFilters(window.location.search, saved);
    setQuery(state.q); setStage(state.stage); setEditor(state.editor); setCreator(state.creator);
    setCampaign(state.campaign); setProduct(state.product); setPlatform(state.platform);
    setTag(state.tag); setDeadline(state.deadline); setSort(state.sort); setView(state.view);
    setUrlInitialized(true);
  }, []);
  useEffect(() => { window.localStorage.setItem("adflow-dashboard-view", view); }, [view]);
  useEffect(() => {
    if (!urlInitialized) return;
    const url = writeDashboardFilters(new URL(window.location.href), { q: query, stage, editor, creator, campaign, product, platform, tag, deadline, sort, view });
    window.history.replaceState(null, "", url);
  }, [campaign, creator, deadline, editor, platform, product, query, sort, stage, tag, urlInitialized, view]);
  useEffect(() => { setQueue(queueForRole(profile.role, initialQueue) ?? queueOptions[0].key); }, [initialQueue, profile.role, queueOptions]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key === "/" && !target?.isContentEditable && target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === "Escape" && !isPending) { setFormOpen(false); setEditingAd(null); setPreviewAd(null); setCancelAd(null); }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [isPending]);

  const filteredAds = useMemo(() => {
    const text = query.trim().toLowerCase();
    const filtered = ads
      .filter((ad) => matchesQueue(ad, queue))
      .filter((ad) => stage === "all" || ad.production_stage === stage)
      .filter((ad) => editor === "all" || ad.editor_id === editor)
      .filter((ad) => creator === "all" || ad.creator_id === creator)
      .filter((ad) => campaign === "all" || ad.campaign_id === campaign)
      .filter((ad) => product === "all" || ad.product_id === product)
      .filter((ad) => platform === "all" || ad.platforms.includes(platform as AdWithRelations["platforms"][number]))
      .filter((ad) => tag === "all" || ad.tags.some((item) => item.name === tag))
      .filter((ad) => {
        if (deadline === "all") return true;
        if (!ad.deadline || ad.status === "approved" || ad.status === "published") return false;
        const days = dateOnlyDaysFromToday(ad.deadline);
        if (deadline === "overdue") return days < 0;
        if (deadline === "today") return days === 0;
        return days >= 0 && days <= 3;
      })
      .filter((ad) => !text || `${ad.name} ${ad.script_text ?? ""} ${ad.creator?.name ?? ""} ${ad.editor?.name ?? ""} ${ad.campaign?.name ?? ""} ${ad.product?.name ?? ""} ${ad.tags.map((item) => item.name).join(" ")}`.toLowerCase().includes(text));
    return filtered.sort((a, b) => {
      if (sort === "deadline") return (a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31");
      if (sort === "waiting") return a.workflow_status_changed_at.localeCompare(b.workflow_status_changed_at);
      if (sort === "oldest") return a.created_at.localeCompare(b.created_at);
      return b.updated_at.localeCompare(a.updated_at);
    });
  }, [ads, campaign, creator, deadline, editor, platform, product, query, queue, sort, stage, tag]);

  const filtersActive = [stage, editor, creator, campaign, product, platform, tag, deadline, sort].some((value) => value !== "all");
  const gridFilterKey = [queue, query, stage, editor, creator, campaign, product, platform, tag, deadline, sort].join("|");
  const visibleGridAds = filteredAds.slice(0, visibleGridCount);
  const hasMoreGridAds = view === "grid" && visibleGridCount < filteredAds.length;

  useEffect(() => {
    setVisibleGridCount(gridPageSize);
    setPlayingAdId(null);
  }, [gridFilterKey]);

  useEffect(() => {
    if (!hasMoreGridAds) return;
    const target = loadMoreRef.current;
    if (!target) return;
    if (!("IntersectionObserver" in window)) {
      setVisibleGridCount(filteredAds.length);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisibleGridCount((current) => Math.min(current + gridPageSize, filteredAds.length));
    }, { rootMargin: "500px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredAds.length, hasMoreGridAds]);

  useEffect(() => {
    if (view !== "grid") return;
    const candidates = visibleGridAds.filter((ad) => ad.drive_file_id && mediaTokens[ad.id]).slice(0, 4);
    if (!candidates.length) return;
    const timer = window.setTimeout(() => {
      void Promise.allSettled(candidates.map((ad) => fetch(mediaUrl(ad, mediaTokens[ad.id], true))));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [mediaTokens, view, visibleGridAds]);

  const activeFilters = useMemo(() => {
    const labelFor = (items: { id: string; name: string }[], value: string) => items.find((item) => item.id === value)?.name ?? value;
    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (stage !== "all") chips.push({ key: "stage", label: `Status: ${productionStageLabels[stage as keyof typeof productionStageLabels] ?? stage}`, clear: () => setStage("all") });
    if (editor !== "all") chips.push({ key: "editor", label: `Editor: ${labelFor(editors, editor)}`, clear: () => setEditor("all") });
    if (creator !== "all") chips.push({ key: "creator", label: `Creator: ${labelFor(creators, creator)}`, clear: () => setCreator("all") });
    if (campaign !== "all") chips.push({ key: "campaign", label: `Campaign: ${labelFor(campaigns, campaign)}`, clear: () => setCampaign("all") });
    if (product !== "all") chips.push({ key: "product", label: `Product: ${labelFor(products, product)}`, clear: () => setProduct("all") });
    if (platform !== "all") chips.push({ key: "platform", label: `Platform: ${platform}`, clear: () => setPlatform("all") });
    if (tag !== "all") chips.push({ key: "tag", label: `Tag: #${tag}`, clear: () => setTag("all") });
    if (deadline !== "all") chips.push({ key: "deadline", label: `Deadline: ${deadline === "soon" ? "Due in 3 days" : deadline === "today" ? "Due today" : "Overdue"}`, clear: () => setDeadline("all") });
    if (sort !== "all") chips.push({ key: "sort", label: `Sort: ${sort === "deadline" ? "Deadline first" : sort === "waiting" ? "Waiting longest" : "Oldest created"}`, clear: () => setSort("all") });
    return chips;
  }, [campaign, campaigns, creator, creators, deadline, editor, editors, platform, product, products, sort, stage, tag]);

  function clearFilters(clearSearch = false) {
    setStage("all"); setEditor("all"); setCreator("all"); setCampaign("all"); setProduct("all");
    setPlatform("all"); setTag("all"); setDeadline("all"); setSort("all");
    if (clearSearch) setQuery("");
  }

  function openCreatorForm(ad?: AdWithRelations) {
    if (ad && !creatorEditableStages.includes(ad.production_stage as (typeof creatorEditableStages)[number])) { router.push(`/ads/${ad.id}`); return; }
    setEditingAd(ad ?? null); setFormOpen(true);
  }

  function selectQueue(nextQueue: QueueKey) {
    setQueue(nextQueue);
    const url = new URL(window.location.href);
    url.searchParams.set("queue", nextQueue);
    window.history.replaceState(null, "", url);
  }

  function decide(ad: AdWithRelations, decision: "approve" | "request_changes", note = "") {
    if (decision === "approve") {
      setActingAdId(ad.id);
      toast({
        title: "Approved",
        description: `${ad.name} will be approved in 5 seconds.`,
        tone: "success",
        duration: 5_000,
        action: { label: "Undo", onClick: () => setActingAdId(null) },
        onExpire: () => saveDecision(ad, decision, note)
      });
      return;
    }
    setActingAdId(ad.id);
    void saveDecision(ad, decision, note);
  }

  function saveDecision(ad: AdWithRelations, decision: "approve" | "request_changes", note = "") {
    startTransition(async () => {
      const response = await runServerAction(() => reviewAd(ad.id, decision, note));
      if (!response.ok) toast({ title: "Review not saved", description: response.message ?? "Unable to save review.", tone: "error" });
      else { toast({ title: decision === "approve" ? `${ad.name} approved` : "Changes requested", description: decision === "approve" ? "The creative is now approved." : `${ad.name} was returned to the editor.`, tone: "success" }); setCancelAd(null); setCancelReason(""); router.refresh(); }
      setActingAdId(null);
    });
  }

  function assign(ad: AdWithRelations, editorId: string, deadline: string) {
    setActingAdId(ad.id);
    startTransition(async () => {
      const response = await runServerAction(() => assignEditor(ad.id, editorId, deadline || null));
      if (!response.ok) toast({ title: "Assignment not saved", description: response.message ?? "Unable to assign editor.", tone: "error" });
      else { toast({ title: "Editor assigned", description: `${ad.name} moved to editing.`, tone: "success" }); router.refresh(); }
      setActingAdId(null);
    });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(filteredAds.map((ad) => ad.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function downloadZip() {
    if (!selectedIds.size || isDownloading) return;
    setIsDownloading(true);
    try {
      const ids = Array.from(selectedIds).join(",");
      const res = await fetch(`/api/ads/export-zip?ids=${encodeURIComponent(ids)}`);
      if (!res.ok) { toast({ title: "Download failed", description: "Could not create ZIP. Try again.", tone: "error" }); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `creatives-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: `${selectedIds.size} creative${selectedIds.size > 1 ? "s" : ""} downloaded`, tone: "success" });
    } catch {
      toast({ title: "Download failed", description: "Network error — please try again.", tone: "error" });
    } finally {
      setIsDownloading(false);
    }
  }

  async function downloadOne(ad: AdWithRelations) {
    if (downloadingIds.has(ad.id)) return;
    setDownloadingIds((current) => new Set(current).add(ad.id));
    try {
      const res = await fetch(`/api/ads/${ad.id}/download`);
      if (!res.ok) { toast({ title: "Download failed", description: `Could not download ${ad.name}. Try again.`, tone: "error" }); return; }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `${ad.name}.mp4`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: `${ad.name} downloaded`, tone: "success" });
    } catch {
      toast({ title: "Download failed", description: "Network error — please try again.", tone: "error" });
    } finally {
      setDownloadingIds((current) => { const next = new Set(current); next.delete(ad.id); return next; });
    }
  }

  async function submitBulkTags(tags: string[]) {
    setIsBulkTagging(true);
    try {
      const response = await runServerAction(() => bulkAddTags(Array.from(selectedIds), tags));
      if (!response.ok) {
        toast({ title: "Could not add tags", description: response.message ?? "Try again.", tone: "error" });
        return;
      }
      toast({ title: `Tags added to ${response.count} creative${response.count === 1 ? "" : "s"}`, tone: "success" });
      setBulkTagModalOpen(false);
      router.refresh();
    } finally {
      setIsBulkTagging(false);
    }
  }

  return <main className="page-container">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-2xl font-semibold text-foreground">Creative library</h1><p className="mt-1 text-sm text-muted-foreground">Your work, organized by what needs attention next.</p></div>{canCreate ? <Button onClick={() => openCreatorForm()}><Plus className="size-4" aria-hidden />Add creative</Button> : null}</div>

    <div className="mt-6 overflow-x-auto pb-1"><div className="inline-flex min-w-max rounded-md border border-border bg-card p-1 shadow-sm">{queueOptions.map((option) => <button key={option.key} className={cn("flex h-9 items-center gap-2 rounded px-3 text-sm font-medium transition", queue === option.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")} onClick={() => selectQueue(option.key)}>{option.label}<span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", queue === option.key ? "bg-primary-foreground/15" : "bg-muted text-muted-foreground")}>{ads.filter((ad) => matchesQueue(ad, option.key)).length}</span></button>)}</div></div>

    <section className="panel mt-4 p-3">
      <div className="flex flex-col gap-2 lg:flex-row"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input ref={searchRef} className="pl-9 pr-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ads, scripts, people, products, or tags" /><kbd className="pointer-events-none absolute right-2 top-1/2 hidden h-6 min-w-6 -translate-y-1/2 items-center justify-center rounded border border-border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground sm:inline-flex">/</kbd></div><Button variant={filtersOpen || filtersActive ? "primary" : "secondary"} onClick={() => setFiltersOpen((current) => !current)}><Filter className="size-4" aria-hidden />Filters{filtersActive ? <span className="size-1.5 rounded-full bg-current" /> : null}</Button><div className="flex rounded-lg border border-border bg-muted p-1"><Button size="icon" variant={view === "grid" ? "secondary" : "ghost"} className="size-8" title="Grid view" onClick={() => setView("grid")}><Grid2X2 className="size-4" aria-hidden /></Button><Button size="icon" variant={view === "table" ? "secondary" : "ghost"} className="size-8" title="Table view" onClick={() => setView("table")}><Table2 className="size-4" aria-hidden /></Button></div></div>
      {activeFilters.length || query ? <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">{query ? <FilterChip label={`Search: ${query}`} onRemove={() => setQuery("")} /> : null}{activeFilters.map((filter) => <FilterChip key={filter.key} label={filter.label} onRemove={filter.clear} />)}<button type="button" className="h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => clearFilters(true)}>Clear all</button></div> : null}
      {filtersOpen ? <div className="mt-3 border-t border-border pt-3"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><FilterSelect label="Status" value={stage} onChange={setStage} options={productionStages.map((item) => ({ value: item, label: productionStageLabels[item] }))} />{profile.role === "admin" || profile.role === "manager" ? <><FilterSelect label="Editor" value={editor} onChange={setEditor} options={editors.map((item) => ({ value: item.id, label: item.name }))} /><FilterSelect label="Creator" value={creator} onChange={setCreator} options={creators.map((item) => ({ value: item.id, label: item.name }))} /></> : null}<FilterSelect label="Campaign" value={campaign} onChange={setCampaign} options={campaigns.map((item) => ({ value: item.id, label: item.name }))} /><FilterSelect label="Product" value={product} onChange={setProduct} options={products.map((item) => ({ value: item.id, label: item.name }))} /><FilterSelect label="Platform" value={platform} onChange={setPlatform} options={platforms.map((item) => ({ value: item, label: item }))} /><FilterSelect label="Tag" value={tag} onChange={setTag} options={availableTags.map((item) => ({ value: item, label: `#${item}` }))} /><FilterSelect label="Deadline" value={deadline} onChange={setDeadline} options={[{ value: "overdue", label: "Overdue" }, { value: "today", label: "Due today" }, { value: "soon", label: "Due in 3 days" }]} /><FilterSelect label="Sort" value={sort} onChange={setSort} options={[{ value: "deadline", label: "Deadline first" }, { value: "waiting", label: "Waiting longest" }, { value: "oldest", label: "Oldest created" }]} /></div></div> : null}
    </section>

    <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
      <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{filteredAds.length}</span> items{view === "grid" && filteredAds.length > gridPageSize ? <span> · showing {visibleGridAds.length}</span> : null}</p>
      <div className="flex items-center gap-2">
        {selectedIds.size > 0 ? (
          <>
            <span className="text-sm font-medium text-foreground">{selectedIds.size} selected</span>
            <Button size="sm" variant="secondary" onClick={selectAll}>Select all {filteredAds.length}</Button>
            <Button size="sm" variant="secondary" onClick={clearSelection}>Clear</Button>
            <Button size="sm" variant="secondary" onClick={() => setBulkTagModalOpen(true)}>
              <Tags className="size-3.5" aria-hidden />
              Add tags
            </Button>
            <Button size="sm" disabled={isDownloading} onClick={downloadZip}>
              {isDownloading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
              Download ZIP
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={selectAll} disabled={!filteredAds.length}>
            <SquareCheck className="size-3.5" aria-hidden />
            Select all
          </Button>
        )}
      </div>
    </div>
    {filteredAds.length ? view === "grid" ? <><section className="mt-3 grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">{visibleGridAds.map((ad) => <WorkflowCard key={ad.id} ad={ad} mediaToken={mediaTokens[ad.id]} profile={profile} editors={editors} editorWorkloads={editorWorkloads} pending={actingAdId === ad.id} playing={playingAdId === ad.id} selected={selectedIds.has(ad.id)} downloading={downloadingIds.has(ad.id)} onToggleSelect={() => toggleSelect(ad.id)} onPlay={() => setPlayingAdId(ad.id)} onStopPlaying={() => setPlayingAdId(null)} onPlaybackError={() => { setPlayingAdId(null); toast({ title: "Video unavailable", description: `${ad.name} could not be played.`, tone: "error" }); }} onPreview={() => setPreviewAd(ad)} onDownload={() => downloadOne(ad)} onEdit={() => openCreatorForm(ad)} onApprove={() => decide(ad, "approve")} onRequestChanges={() => setCancelAd(ad)} onAssignEditor={(editorId, deadline) => assign(ad, editorId, deadline)} />)}</section>{hasMoreGridAds ? <div ref={loadMoreRef} className="flex h-20 items-center justify-center" role="status" aria-label="Loading more creatives"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden /><span className="sr-only">Loading more creatives</span></div> : null}</> : <WorkflowTable ads={filteredAds} profile={profile} pendingId={actingAdId} selectedIds={selectedIds} downloadingIds={downloadingIds} onToggleSelect={toggleSelect} onApprove={(ad) => decide(ad, "approve")} onRequestChanges={setCancelAd} onDownload={downloadOne} /> : <EmptyQueue canCreate={canCreate} onCreate={() => openCreatorForm()} />}

    {formOpen ? <Modal open labelledBy="creator-form-title" onClose={() => { setFormOpen(false); setEditingAd(null); }} className="p-0 sm:p-6"><section className="mx-auto min-h-full w-full bg-card shadow-float sm:min-h-0 sm:max-w-5xl sm:rounded-xl"><div className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-card px-5 sm:rounded-t-lg"><div><h2 id="creator-form-title" className="text-lg font-semibold text-foreground">{editingAd ? "Update creative" : "Add creative"}</h2><p className="text-xs text-muted-foreground">Set the current preparation status and save.</p></div><Button size="icon" variant="ghost" title="Close" onClick={() => { setFormOpen(false); setEditingAd(null); }}><X className="size-5" aria-hidden /></Button></div><div className="p-5"><CreatorItemForm profile={profile} creators={creators} editors={editors} campaigns={campaigns.filter((item) => item.active)} products={products.filter((item) => item.active)} initialAd={editingAd} availableTags={availableTags} editorWorkloads={editorWorkloads} onSaved={() => { setFormOpen(false); setEditingAd(null); router.refresh(); }} /></div></section></Modal> : null}

    {cancelAd ? <Modal open labelledBy="changes-title" onClose={() => setCancelAd(null)} className="flex items-center justify-center p-4"><section className="w-full max-w-lg rounded-xl border border-border bg-card shadow-float dark:shadow-none"><div className="flex items-start justify-between border-b border-border px-5 py-4"><div><h2 id="changes-title" className="text-lg font-semibold text-foreground">Request changes</h2><p className="mt-1 text-sm text-muted-foreground">Tell the assigned editor exactly what must change.</p></div><Button size="icon" variant="ghost" className="size-9" title="Close" onClick={() => setCancelAd(null)}><X className="size-5" aria-hidden /></Button></div><div className="p-5"><Textarea className="min-h-32" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Required changes" /></div><div className="flex justify-end gap-2 border-t border-border px-5 py-4"><Button variant="secondary" onClick={() => setCancelAd(null)}>Keep in review</Button><Button variant="danger" disabled={isPending || !cancelReason.trim()} onClick={() => decide(cancelAd, "request_changes", cancelReason.trim())}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <X className="size-4" aria-hidden />}Send changes</Button></div></section></Modal> : null}
    <AdPreviewModal ad={previewAd} onClose={() => setPreviewAd(null)} />
    {bulkTagModalOpen ? <BulkTagModal count={selectedIds.size} availableTags={availableTags} pending={isBulkTagging} onClose={() => setBulkTagModalOpen(false)} onSubmit={submitBulkTags} /> : null}
  </main>;
}

function BulkTagModal({ count, availableTags, pending, onClose, onSubmit }: { count: number; availableTags: string[]; pending: boolean; onClose: () => void; onSubmit: (tags: string[]) => void }) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const tagOptions = useMemo(() => Array.from(new Set([...availableTags, ...selectedTags])).filter(Boolean).sort(), [availableTags, selectedTags]);

  function addTag() {
    const tags = tagDraft.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (!tags.length) return;
    setSelectedTags((current) => Array.from(new Set([...current, ...tags])));
    setTagDraft("");
  }

  return (
    <Modal open labelledBy="bulk-tag-title" onClose={onClose} className="flex items-center justify-center p-4">
      <section className="w-full max-w-lg rounded-xl border border-border bg-card shadow-float dark:shadow-none">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="bulk-tag-title" className="text-lg font-semibold text-foreground">Add tags to {count} creative{count === 1 ? "" : "s"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">These tags are added alongside each creative&apos;s existing tags.</p>
          </div>
          <Button size="icon" variant="ghost" className="size-9" title="Close" onClick={onClose}><X className="size-5" aria-hidden /></Button>
        </div>
        <div className="p-5">
          <div className="flex flex-wrap gap-2">
            {tagOptions.map((tag) => (
              <button
                key={tag}
                type="button"
                className={cn("rounded-full border px-3 py-1.5 text-xs", selectedTags.includes(tag) ? "border-primary bg-accent text-primary" : "border-border text-muted-foreground")}
                onClick={() => setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}
              >
                #{tag}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <Tags className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input className="pl-9" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} placeholder="Add tag" />
            </div>
            <Button variant="secondary" disabled={!tagDraft.trim()} onClick={addTag}><Plus className="size-4" aria-hidden />Add</Button>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={pending || !selectedTags.length} onClick={() => onSubmit(selectedTags)}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Tags className="size-4" aria-hidden />}
            Add tags
          </Button>
        </div>
      </section>
    </Modal>
  );
}

function WorkflowCard({ ad, mediaToken, profile, editors, editorWorkloads, pending, playing, selected, downloading, onToggleSelect, onPlay, onStopPlaying, onPlaybackError, onPreview, onDownload, onEdit, onApprove, onRequestChanges, onAssignEditor }: { ad: AdWithRelations; mediaToken?: string; profile: Profile; editors: Profile[]; editorWorkloads: Record<string, number>; pending: boolean; playing: boolean; selected: boolean; downloading: boolean; onToggleSelect: () => void; onPlay: () => void; onStopPlaying: () => void; onPlaybackError: () => void; onPreview: () => void; onDownload: () => void; onEdit: () => void; onApprove: () => void; onRequestChanges: () => void; onAssignEditor: (editorId: string, deadline: string) => void }) {
  const [selectedEditor, setSelectedEditor] = useState("");
  const [selectedDeadline, setSelectedDeadline] = useState(ad.deadline ?? "");
  const mediaVisible = isFinalMediaVisible(ad.production_stage);
  const canPreview = mediaVisible && Boolean(ad.drive_file_id);
  const thumbnail = canPreview ? `/api/ads/${ad.id}/thumbnail?v=${encodeURIComponent(ad.drive_file_id!)}` : null;
  const reviewer = profile.role === "admin" || profile.role === "manager";
  const canFinalReview = reviewer && (ad.production_stage === "creator_review" || ad.production_stage === "final_review");
  const canAssignEditor = ad.production_stage === "shoot_complete" && (reviewer || (profile.role === "content_creator" && ad.creator_id === profile.id));
  const activeEditors = editors.filter((item) => item.active);
  const creatorEditable = creatorEditableStages.includes(ad.production_stage as (typeof creatorEditableStages)[number]) && (reviewer || (profile.role === "content_creator" && ad.creator_id === profile.id));
  const actionLabel = creatorEditable ? "Update" : profile.role === "editor" && ad.production_stage === "ready_for_edit" ? "Open assignment" : profile.role === "editor" && (ad.production_stage === "editing" || ad.production_stage === "changes_requested") ? "Submit video" : profile.role === "content_creator" && ad.production_stage === "creator_review" ? "Review edit" : "Open";
  return (
    <article className="group/card relative overflow-hidden rounded-xl border border-border bg-card shadow-soft transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-ring/40 hover:shadow-float dark:shadow-none dark:hover:border-ring/60">
      {pending ? <div className="absolute inset-0 z-20 flex items-center justify-center bg-card/75 backdrop-blur-[1px]" role="status"><span className="inline-flex items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-sm font-medium text-foreground shadow-soft dark:shadow-none"><Loader2 className="size-4 animate-spin text-primary" aria-hidden />Saving...</span></div> : null}
      <button type="button" onClick={(e) => { e.stopPropagation(); onToggleSelect(); }} aria-label={selected ? "Deselect" : "Select"} aria-pressed={selected} className={`absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-md border transition-all duration-150 ${selected ? "border-primary bg-primary text-primary-foreground opacity-100" : "border-border bg-card/80 text-muted-foreground opacity-0 group-hover/card:opacity-100"}`}>{selected ? <SquareCheck className="size-4" aria-hidden /> : <Square className="size-4" aria-hidden />}</button>
      {canPreview ? (
        playing ? <InlineCardVideo ad={ad} mediaToken={mediaToken} poster={thumbnail} onClose={onStopPlaying} onError={onPlaybackError} /> :
        <button className="relative block aspect-video w-full overflow-hidden bg-neutral-950" onPointerEnter={() => { if (mediaToken) void fetch(mediaUrl(ad, mediaToken, true)); }} onFocus={() => { if (mediaToken) void fetch(mediaUrl(ad, mediaToken, true)); }} onClick={onPlay} aria-label={`Play ${ad.name}`}>
          {thumbnail ? <CardThumbnail src={thumbnail} name={ad.name} /> : <MediaPlaceholder label="Final video submitted" />}
          <span className="absolute left-3 top-3 max-w-[75%]"><ProductionStageBadge stage={ad.production_stage} /></span>
          <span className="absolute left-1/2 top-1/2 inline-flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/65 text-white shadow-lg backdrop-blur-sm transition duration-200 group-hover/card:scale-105 group-hover/card:bg-black/80"><Play className="ml-0.5 size-5 fill-current" aria-hidden /></span>
        </button>
      ) : (
        <div className="relative aspect-video overflow-hidden bg-neutral-950">
          <MediaPlaceholder label={ad.production_stage === "ready_for_edit" ? "Editing has not started" : ad.production_stage === "editing" ? "Editing in progress" : "Video not available yet"} />
          <span className="absolute left-3 top-3 max-w-[75%]"><ProductionStageBadge stage={ad.production_stage} /></span>
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h2 className="truncate text-[15px] font-semibold text-foreground">{ad.name}</h2><p className="mt-0.5 truncate text-xs text-muted-foreground">{ad.campaign?.name ?? "No campaign"}</p></div>
          <div className="flex gap-0.5">{canDeleteAd(profile.role) ? <DeleteAdButton adId={ad.id} adName={ad.name} compact /> : null}{canPreview ? <button className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50" title="Download video" disabled={downloading} onClick={(e) => { e.stopPropagation(); onDownload(); }}>{downloading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}</button> : null}{canPreview ? <button className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" title="Preview" onClick={onPreview}><Eye className="size-4" aria-hidden /></button> : null}</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 border-y border-border py-3"><Person label="Creator" person={ad.creator} /><Person label="Editor" person={ad.editor} /></div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs"><span className="font-medium text-muted-foreground" suppressHydrationWarning>{workflowStageAgeLabel(ad.production_stage, ad.workflow_status_changed_at)}</span><Deadline deadline={ad.deadline} status={ad.status} /></div>
        {canFinalReview ? (
          <div className="mt-3 grid grid-cols-2 gap-2"><Button size="sm" disabled={pending} onClick={onApprove}>{pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}Approve</Button><Button size="sm" variant="secondary" onClick={onRequestChanges}>Changes</Button></div>
        ) : canAssignEditor ? (
          <div className="mt-3 space-y-2">
            <Select value={selectedEditor} onChange={(event) => setSelectedEditor(event.target.value)} aria-label="Choose editor">
              <option value="">Choose editor</option>
              {activeEditors.map((editor) => <option key={editor.id} value={editor.id}>{editor.name} · {editorWorkloads[editor.id] ?? 0} assigned</option>)}
            </Select>
            <Input type="date" value={selectedDeadline ?? ""} onChange={(event) => setSelectedDeadline(event.target.value)} aria-label="Deadline" />
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" disabled={!selectedEditor || !selectedDeadline || pending} title={!selectedDeadline ? "Choose a deadline before assigning" : undefined} onClick={() => onAssignEditor(selectedEditor, selectedDeadline)}>{pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <UserCheck className="size-3.5" aria-hidden />}Assign</Button>
              <Button size="sm" variant="secondary" onClick={onEdit}>Update</Button>
            </div>
          </div>
        ) : creatorEditable ? (
          <Button className="mt-3 w-full" size="sm" variant="secondary" onClick={onEdit}>{actionLabel}<ArrowRight className="size-3.5" aria-hidden /></Button>
        ) : (
          <Link href={`/ads/${ad.id}`} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-card text-sm font-medium text-foreground hover:bg-muted">{actionLabel}<ArrowRight className="size-3.5" aria-hidden /></Link>
        )}
      </div>
    </article>
  );
}

function CardThumbnail({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <MediaPlaceholder label="Thumbnail unavailable" />;
  return <Image src={src} alt={`${name} thumbnail`} fill sizes="(min-width: 1536px) 32vw, (min-width: 640px) 50vw, 100vw" className="object-cover" unoptimized onError={() => setFailed(true)} />;
}

function InlineCardVideo({ ad, mediaToken, poster, onClose, onError }: { ad: AdWithRelations; mediaToken?: string; poster: string | null; onClose: () => void; onError: () => void }) {
  const [buffering, setBuffering] = useState(true);
  return <div className="relative aspect-video w-full overflow-hidden bg-neutral-950"><video src={mediaUrl(ad, mediaToken)} poster={poster ?? undefined} className="size-full object-contain" controls autoPlay playsInline preload="auto" onCanPlay={() => setBuffering(false)} onPlaying={() => setBuffering(false)} onWaiting={() => setBuffering(true)} onError={onError} />{buffering ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25" role="status"><span className="inline-flex items-center gap-2 rounded-lg bg-black/70 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm"><Loader2 className="size-4 animate-spin" aria-hidden />Starting video...</span></div> : null}<button type="button" className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white backdrop-blur-sm transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label={`Stop playing ${ad.name}`} onClick={onClose}><X className="size-4" aria-hidden /></button></div>;
}

function mediaUrl(ad: AdWithRelations, token?: string, warm = false) {
  const params = new URLSearchParams({ fileId: ad.drive_file_id! });
  if (token) params.set("token", token);
  if (warm) params.set("warm", "1");
  return `/api/ads/${ad.id}/media?${params}`;
}

function MediaPlaceholder({ label }: { label: string }) {
  return <span className="flex size-full flex-col items-center justify-center gap-2 bg-muted text-sm text-muted-foreground"><span className="flex size-11 items-center justify-center rounded-full border border-border bg-card"><Video className="size-5" aria-hidden /></span>{label}</span>;
}

type TableSortKey = "name" | "status" | "creator" | "editor" | "waiting";
type TableSort = { key: TableSortKey; direction: "asc" | "desc" };

function WorkflowTable({ ads, profile, pendingId, selectedIds, downloadingIds, onToggleSelect, onApprove, onRequestChanges, onDownload }: { ads: AdWithRelations[]; profile: Profile; pendingId: string | null; selectedIds: Set<string>; downloadingIds: Set<string>; onToggleSelect: (id: string) => void; onApprove: (ad: AdWithRelations) => void; onRequestChanges: (ad: AdWithRelations) => void; onDownload: (ad: AdWithRelations) => void }) {
  const router = useRouter();
  const reviewer = profile.role === "admin" || profile.role === "manager";
  const [tableSort, setTableSort] = useState<TableSort>({ key: "waiting", direction: "asc" });
  const sortedAds = useMemo(() => [...ads].sort((a, b) => {
    const values = {
      name: [a.name, b.name],
      status: [productionStageLabels[a.production_stage], productionStageLabels[b.production_stage]],
      creator: [a.creator?.name ?? "", b.creator?.name ?? ""],
      editor: [a.editor?.name ?? "", b.editor?.name ?? ""],
      waiting: [a.workflow_status_changed_at, b.workflow_status_changed_at]
    } satisfies Record<TableSortKey, [string, string]>;
    const result = values[tableSort.key][0].localeCompare(values[tableSort.key][1]);
    return tableSort.direction === "asc" ? result : -result;
  }), [ads, tableSort]);
  const changeSort = (key: TableSortKey) => setTableSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });

  return <section className="panel mt-3 overflow-x-auto"><table className="w-full min-w-[960px] text-left text-sm"><thead className="border-b border-border bg-muted text-xs uppercase text-muted-foreground"><tr><th className="w-10 px-3 py-3" /><SortHeader label="Creative" sortKey="name" sort={tableSort} onSort={changeSort} /><SortHeader label="Status" sortKey="status" sort={tableSort} onSort={changeSort} /><SortHeader label="Creator" sortKey="creator" sort={tableSort} onSort={changeSort} /><SortHeader label="Editor" sortKey="editor" sort={tableSort} onSort={changeSort} /><SortHeader label="Time in status" sortKey="waiting" sort={tableSort} onSort={changeSort} /><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-border">{sortedAds.map((ad) => { const reviewable = reviewer && (ad.production_stage === "creator_review" || ad.production_stage === "final_review"); const isSelected = selectedIds.has(ad.id); const canDownload = isFinalMediaVisible(ad.production_stage) && Boolean(ad.drive_file_id); const isDownloadingRow = downloadingIds.has(ad.id); const open = () => router.push(`/ads/${ad.id}`); return <tr key={ad.id} className={`cursor-pointer transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${isSelected ? "bg-accent/40" : ""}`} role="link" tabIndex={0} onClick={open} onKeyDown={(event) => { if (event.key === "Enter") open(); }}><td className="px-3 py-3" onClick={(e) => { e.stopPropagation(); onToggleSelect(ad.id); }}><button type="button" aria-label={isSelected ? "Deselect" : "Select"} aria-pressed={isSelected} className={`flex size-7 items-center justify-center rounded-md border transition-colors ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-ring"}`}>{isSelected ? <SquareCheck className="size-4" aria-hidden /> : <Square className="size-4" aria-hidden />}</button></td><td className="px-4 py-3"><p className="font-medium text-foreground">{ad.name}</p><p className="text-xs text-muted-foreground">{ad.campaign?.name}</p></td><td className="px-4 py-3"><ProductionStageBadge stage={ad.production_stage} className="bg-muted text-muted-foreground shadow-none" /></td><td className="px-4 py-3">{ad.creator?.name ?? "Unassigned"}</td><td className="px-4 py-3">{ad.editor?.name ?? "Unassigned"}</td><td className="px-4 py-3 text-muted-foreground normal-case" suppressHydrationWarning>{workflowStageAgeLabel(ad.production_stage, ad.workflow_status_changed_at)}</td><td className="px-4 py-3"><div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>{reviewable ? <><Button size="sm" disabled={pendingId === ad.id} onClick={() => onApprove(ad)}>Approve</Button><Button size="sm" variant="secondary" onClick={() => onRequestChanges(ad)}>Changes</Button></> : <Button size="sm" variant="secondary" onClick={open}>Open<ArrowRight className="size-3.5" aria-hidden /></Button>}{canDownload ? <button className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50" title="Download video" disabled={isDownloadingRow} onClick={() => onDownload(ad)}>{isDownloadingRow ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}</button> : null}{canDeleteAd(profile.role) ? <DeleteAdButton adId={ad.id} adName={ad.name} compact /> : null}</div></td></tr>; })}</tbody></table></section>;
}

function SortHeader({ label, sortKey, sort, onSort }: { label: string; sortKey: TableSortKey; sort: TableSort; onSort: (key: TableSortKey) => void }) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
  return <th className="px-2 py-1" aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 font-semibold hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSort(sortKey)}>{label}<Icon className="size-3.5" aria-hidden /></button></th>;
}

function Person({ label, person }: { label: string; person: AdWithRelations["creator"] }) { return <div className="flex min-w-0 items-center gap-2"><Avatar className="size-7" name={person?.name ?? "Unassigned"} src={person?.avatar_url} /><div className="min-w-0"><p className="text-[10px] font-medium uppercase text-muted-foreground">{label}</p><p className="truncate text-xs font-medium text-muted-foreground">{person?.name ?? "Unassigned"}</p></div></div>; }
function Deadline({ deadline, status }: { deadline: string | null; status: AdStatus }) { if (!deadline) return <span className="text-muted-foreground">No deadline</span>; const days = dateOnlyDaysFromToday(deadline); const active = status !== "approved" && status !== "published"; return <span className={cn("inline-flex items-center gap-1", active && days < 0 ? "text-destructive" : "text-muted-foreground")}><CalendarClock className="size-3.5" aria-hidden />{active && days < 0 ? `${Math.abs(days)}d overdue` : formatDateOnly(deadline)}</span>; }
function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) { return <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">{label}</span><Select value={value} onChange={(event) => onChange(event.target.value)}><option value="all">{label === "Sort" ? "Recently updated" : `All ${label.toLowerCase()}`}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label>; }
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) { return <span className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-muted pl-2.5 pr-1 text-xs font-medium text-foreground">{label}<button type="button" className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground" aria-label={`Remove ${label} filter`} onClick={onRemove}><X className="size-3" aria-hidden /></button></span>; }
function EmptyQueue({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) { return <div className="mt-6 flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-center"><span className="flex size-12 items-center justify-center rounded-full bg-muted"><ListFilter className="size-5 text-muted-foreground" aria-hidden /></span><h2 className="mt-3 text-base font-semibold text-foreground">Nothing in this queue</h2><p className="mt-1 text-sm text-muted-foreground">Items will appear here when they reach this status.</p>{canCreate ? <Button className="mt-4" onClick={onCreate}><Plus className="size-4" aria-hidden />Add creative</Button> : null}</div>; }
