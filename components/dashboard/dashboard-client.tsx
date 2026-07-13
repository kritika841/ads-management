"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowRight, CalendarClock, Check, Eye, Filter, Grid2X2, ListFilter, Loader2, Plus, Search, Table2, UserCheck, Video, X } from "lucide-react";
import { assignEditor, reviewAd } from "@/app/actions/ads";
import { AdPreviewModal } from "@/components/dashboard/ad-preview-modal";
import { DeleteAdButton } from "@/components/dashboard/delete-ad-button";
import { CreatorItemForm } from "@/components/workflow/creator-item-form";
import { ProductionStageBadge } from "@/components/workflow/production-stage";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { platforms } from "@/lib/constants";
import { canDeleteAd } from "@/lib/permissions";
import { creatorEditableStages, isFinalMediaVisible, productionStageLabels, productionStages, workflowWaitingLabel } from "@/lib/production-workflow";
import type { AdStatus, AdWithRelations, Campaign, Product, Profile } from "@/lib/types";
import { cn, dateOnlyDaysFromToday, formatDateOnly } from "@/lib/utils";
import { matchesQueue, queueForRole, queuesForRole, type QueueKey } from "@/lib/work-queues";

type ViewMode = "grid" | "table";

export function DashboardClient({ profile, ads, campaigns, products, profiles, availableTags, editorWorkloads, initialQueue }: { profile: Profile; ads: AdWithRelations[]; campaigns: Campaign[]; products: Product[]; profiles: Profile[]; availableTags: string[]; editorWorkloads: Record<string, number>; initialQueue: QueueKey }) {
  const router = useRouter();
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
  const [view, setView] = useState<ViewMode>("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAd, setEditingAd] = useState<AdWithRelations | null>(null);
  const [previewAd, setPreviewAd] = useState<AdWithRelations | null>(null);
  const [cancelAd, setCancelAd] = useState<AdWithRelations | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [actionMessage, setActionMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [actingAdId, setActingAdId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const editors = profiles.filter((item) => item.role === "editor");
  const creators = profiles.filter((item) => item.role === "content_creator");
  const canCreate = profile.role === "content_creator" || profile.role === "admin" || profile.role === "manager";

  useEffect(() => {
    const saved = window.localStorage.getItem("adflow-dashboard-view");
    if (saved === "grid" || saved === "table") setView(saved);
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("q") ?? "");
    setStage(params.get("stage") ?? "all");
    setEditor(params.get("editor") ?? "all");
    setCreator(params.get("creator") ?? "all");
    setCampaign(params.get("campaign") ?? "all");
    setProduct(params.get("product") ?? "all");
    setPlatform(params.get("platform") ?? "all");
    setTag(params.get("tag") ?? "all");
    setDeadline(params.get("deadline") ?? "all");
    setSort(params.get("sort") ?? "all");
  }, []);
  useEffect(() => { window.localStorage.setItem("adflow-dashboard-view", view); }, [view]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const values = { q: query, stage, editor, creator, campaign, product, platform, tag, deadline, sort };
    for (const [key, value] of Object.entries(values)) {
      if (!value || value === "all") url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    window.history.replaceState(null, "", url);
  }, [campaign, creator, deadline, editor, platform, product, query, sort, stage, tag]);
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

  function clearFilters() {
    setStage("all"); setEditor("all"); setCreator("all"); setCampaign("all"); setProduct("all");
    setPlatform("all"); setTag("all"); setDeadline("all"); setSort("all");
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
    setActionMessage(null); setActingAdId(ad.id);
    startTransition(async () => {
      const response = await reviewAd(ad.id, decision, note);
      if (!response.ok) setActionMessage({ tone: "error", text: response.message ?? "Unable to save review." });
      else { setActionMessage({ tone: "success", text: decision === "approve" ? `${ad.name} was approved.` : `Changes requested for ${ad.name}.` }); setCancelAd(null); setCancelReason(""); router.refresh(); }
      setActingAdId(null);
    });
  }

  function assign(ad: AdWithRelations, editorId: string, deadline: string) {
    setActionMessage(null); setActingAdId(ad.id);
    startTransition(async () => {
      const response = await assignEditor(ad.id, editorId, deadline || null);
      if (!response.ok) setActionMessage({ tone: "error", text: response.message ?? "Unable to assign editor." });
      else { setActionMessage({ tone: "success", text: `${ad.name} assigned and moved to editing.` }); router.refresh(); }
      setActingAdId(null);
    });
  }

  return <main className="page-container">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-2xl font-semibold text-foreground">Creative library</h1><p className="mt-1 text-sm text-muted-foreground">Your work, organized by what needs attention next.</p></div>{canCreate ? <Button onClick={() => openCreatorForm()}><Plus className="size-4" aria-hidden />Add creative</Button> : null}</div>

    <div className="mt-6 overflow-x-auto pb-1"><div className="inline-flex min-w-max rounded-md border border-border bg-card p-1 shadow-sm">{queueOptions.map((option) => <button key={option.key} className={cn("flex h-9 items-center gap-2 rounded px-3 text-sm font-medium transition", queue === option.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")} onClick={() => selectQueue(option.key)}>{option.label}<span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", queue === option.key ? "bg-primary-foreground/15" : "bg-muted text-muted-foreground")}>{ads.filter((ad) => matchesQueue(ad, option.key)).length}</span></button>)}</div></div>

    <section className="panel mt-4 p-3"><div className="flex flex-col gap-2 lg:flex-row"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input ref={searchRef} className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ads, scripts, people, products, or tags" /></div><Button variant={filtersOpen || filtersActive ? "primary" : "secondary"} onClick={() => setFiltersOpen((current) => !current)}><Filter className="size-4" aria-hidden />Filters{filtersActive ? <span className="size-1.5 rounded-full bg-current" /> : null}</Button><div className="flex rounded-md border border-border bg-muted p-1"><Button size="icon" variant={view === "grid" ? "secondary" : "ghost"} className="size-8" title="Grid view" onClick={() => setView("grid")}><Grid2X2 className="size-4" aria-hidden /></Button><Button size="icon" variant={view === "table" ? "secondary" : "ghost"} className="size-8" title="Table view" onClick={() => setView("table")}><Table2 className="size-4" aria-hidden /></Button></div></div>{filtersOpen ? <div className="mt-3 border-t border-border pt-3"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><FilterSelect label="Status" value={stage} onChange={setStage} options={productionStages.map((item) => ({ value: item, label: productionStageLabels[item] }))} />{profile.role === "admin" || profile.role === "manager" ? <><FilterSelect label="Editor" value={editor} onChange={setEditor} options={editors.map((item) => ({ value: item.id, label: item.name }))} /><FilterSelect label="Creator" value={creator} onChange={setCreator} options={creators.map((item) => ({ value: item.id, label: item.name }))} /></> : null}<FilterSelect label="Campaign" value={campaign} onChange={setCampaign} options={campaigns.map((item) => ({ value: item.id, label: item.name }))} /><FilterSelect label="Product" value={product} onChange={setProduct} options={products.map((item) => ({ value: item.id, label: item.name }))} /><FilterSelect label="Platform" value={platform} onChange={setPlatform} options={platforms.map((item) => ({ value: item, label: item }))} /><FilterSelect label="Tag" value={tag} onChange={setTag} options={availableTags.map((item) => ({ value: item, label: `#${item}` }))} /><FilterSelect label="Deadline" value={deadline} onChange={setDeadline} options={[{ value: "overdue", label: "Overdue" }, { value: "today", label: "Due today" }, { value: "soon", label: "Due in 3 days" }]} /><FilterSelect label="Sort" value={sort} onChange={setSort} options={[{ value: "deadline", label: "Deadline first" }, { value: "waiting", label: "Waiting longest" }, { value: "oldest", label: "Oldest created" }]} /></div>{filtersActive ? <div className="mt-3 flex justify-end"><Button size="sm" variant="ghost" onClick={clearFilters}><X className="size-3.5" aria-hidden />Clear filters</Button></div> : null}</div> : null}</section>

    {actionMessage ? <div className={cn("mt-3 flex items-center justify-between rounded-md border px-3 py-2 text-sm", actionMessage.tone === "success" ? "border-success/30 bg-success/15 text-success" : "border-destructive/30 bg-destructive/10 text-destructive")} role={actionMessage.tone === "error" ? "alert" : "status"}><span>{actionMessage.text}</span><button title="Dismiss" onClick={() => setActionMessage(null)}><X className="size-4" aria-hidden /></button></div> : null}

    <div className="mt-4 flex items-center justify-between"><p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{filteredAds.length}</span> items</p></div>
    {filteredAds.length ? view === "grid" ? <section className="mt-3 grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">{filteredAds.map((ad) => <WorkflowCard key={ad.id} ad={ad} profile={profile} editors={editors} editorWorkloads={editorWorkloads} pending={isPending && actingAdId === ad.id} onPreview={() => setPreviewAd(ad)} onEdit={() => openCreatorForm(ad)} onApprove={() => decide(ad, "approve")} onRequestChanges={() => setCancelAd(ad)} onAssignEditor={(editorId, deadline) => assign(ad, editorId, deadline)} />)}</section> : <WorkflowTable ads={filteredAds} profile={profile} pendingId={actingAdId} onApprove={(ad) => decide(ad, "approve")} onRequestChanges={setCancelAd} /> : <EmptyQueue canCreate={canCreate} onCreate={() => openCreatorForm()} />}

    {formOpen ? <div className="fixed inset-0 z-50 overflow-y-auto bg-neutral-950/45 p-0 backdrop-blur-[2px] sm:p-6" role="dialog" aria-modal="true" aria-labelledby="creator-form-title"><section className="mx-auto min-h-full w-full bg-card shadow-float sm:min-h-0 sm:max-w-5xl sm:rounded-xl"><div className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-card px-5 sm:rounded-t-lg"><div><h2 id="creator-form-title" className="text-lg font-semibold text-foreground">{editingAd ? "Update creative" : "Add creative"}</h2><p className="text-xs text-muted-foreground">Set the current preparation status and save.</p></div><Button size="icon" variant="ghost" title="Close" onClick={() => { setFormOpen(false); setEditingAd(null); }}><X className="size-5" aria-hidden /></Button></div><div className="p-5"><CreatorItemForm profile={profile} creators={creators} editors={editors} campaigns={campaigns.filter((item) => item.active)} products={products.filter((item) => item.active)} initialAd={editingAd} availableTags={availableTags} editorWorkloads={editorWorkloads} onSaved={() => { setFormOpen(false); setEditingAd(null); router.refresh(); }} /></div></section></div> : null}

    {cancelAd ? <div className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-950/45 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="changes-title"><section className="w-full max-w-lg rounded-xl border border-border bg-card shadow-float dark:shadow-none"><div className="flex items-start justify-between border-b border-border px-5 py-4"><div><h2 id="changes-title" className="text-lg font-semibold text-foreground">Request changes</h2><p className="mt-1 text-sm text-muted-foreground">Tell the assigned editor exactly what must change.</p></div><Button size="icon" variant="ghost" className="size-9" title="Close" onClick={() => setCancelAd(null)}><X className="size-5" aria-hidden /></Button></div><div className="p-5"><Textarea className="min-h-32" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Required changes" /></div><div className="flex justify-end gap-2 border-t border-border px-5 py-4"><Button variant="secondary" onClick={() => setCancelAd(null)}>Keep in review</Button><Button variant="danger" disabled={isPending || !cancelReason.trim()} onClick={() => decide(cancelAd, "request_changes", cancelReason.trim())}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <X className="size-4" aria-hidden />}Send changes</Button></div></section></div> : null}
    <AdPreviewModal ad={previewAd} onClose={() => setPreviewAd(null)} />
  </main>;
}

function WorkflowCard({ ad, profile, editors, editorWorkloads, pending, onPreview, onEdit, onApprove, onRequestChanges, onAssignEditor }: { ad: AdWithRelations; profile: Profile; editors: Profile[]; editorWorkloads: Record<string, number>; pending: boolean; onPreview: () => void; onEdit: () => void; onApprove: () => void; onRequestChanges: () => void; onAssignEditor: (editorId: string, deadline: string) => void }) {
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
      {canPreview ? (
        <button className="relative block aspect-video w-full overflow-hidden bg-neutral-950" onClick={onPreview} aria-label={`Preview ${ad.name}`}>
          {thumbnail ? <CardThumbnail src={thumbnail} name={ad.name} /> : <MediaPlaceholder label="Final video submitted" />}
          <span className="absolute left-3 top-3 max-w-[75%]"><ProductionStageBadge stage={ad.production_stage} /></span>
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
          <div className="flex gap-0.5">{canDeleteAd(profile.role) ? <DeleteAdButton adId={ad.id} adName={ad.name} compact /> : null}{canPreview ? <button className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" title="Preview" onClick={onPreview}><Eye className="size-4" aria-hidden /></button> : null}</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 border-y border-border py-3"><Person label="Creator" person={ad.creator} /><Person label="Editor" person={ad.editor} /></div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs"><span className="font-medium text-muted-foreground" suppressHydrationWarning>{workflowWaitingLabel(ad.workflow_status_changed_at)}</span><Deadline deadline={ad.deadline} status={ad.status} /></div>
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

function MediaPlaceholder({ label }: { label: string }) {
  return <span className="flex size-full flex-col items-center justify-center gap-2 bg-muted text-sm text-muted-foreground"><span className="flex size-11 items-center justify-center rounded-full border border-border bg-card"><Video className="size-5" aria-hidden /></span>{label}</span>;
}

function WorkflowTable({ ads, profile, pendingId, onApprove, onRequestChanges }: { ads: AdWithRelations[]; profile: Profile; pendingId: string | null; onApprove: (ad: AdWithRelations) => void; onRequestChanges: (ad: AdWithRelations) => void }) {
  const reviewer = profile.role === "admin" || profile.role === "manager";
  return <section className="panel mt-3 overflow-x-auto"><table className="w-full min-w-[920px] text-left text-sm"><thead className="border-b border-border bg-muted text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Creative</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Creator</th><th className="px-4 py-3">Editor</th><th className="px-4 py-3">Waiting</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-border">{ads.map((ad) => { const reviewable = reviewer && (ad.production_stage === "creator_review" || ad.production_stage === "final_review"); return <tr key={ad.id} className="hover:bg-muted"><td className="px-4 py-3"><Link href={`/ads/${ad.id}`} className="font-medium text-foreground hover:text-primary">{ad.name}</Link><p className="text-xs text-muted-foreground">{ad.campaign?.name}</p></td><td className="px-4 py-3"><ProductionStageBadge stage={ad.production_stage} className="bg-muted text-muted-foreground shadow-none" /></td><td className="px-4 py-3">{ad.creator?.name ?? "Unassigned"}</td><td className="px-4 py-3">{ad.editor?.name ?? "Unassigned"}</td><td className="px-4 py-3 text-muted-foreground" suppressHydrationWarning>{workflowWaitingLabel(ad.workflow_status_changed_at)}</td><td className="px-4 py-3"><div className="flex justify-end gap-2">{reviewable ? <><Button size="sm" disabled={pendingId === ad.id} onClick={() => onApprove(ad)}>Approve</Button><Button size="sm" variant="secondary" onClick={() => onRequestChanges(ad)}>Changes</Button></> : <Link href={`/ads/${ad.id}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground">Open<ArrowRight className="size-3.5" aria-hidden /></Link>}{canDeleteAd(profile.role) ? <DeleteAdButton adId={ad.id} adName={ad.name} compact /> : null}</div></td></tr>; })}</tbody></table></section>;
}

function Person({ label, person }: { label: string; person: AdWithRelations["creator"] }) { return <div className="flex min-w-0 items-center gap-2"><Avatar className="size-7" name={person?.name ?? "Unassigned"} src={person?.avatar_url} /><div className="min-w-0"><p className="text-[10px] font-medium uppercase text-muted-foreground">{label}</p><p className="truncate text-xs font-medium text-muted-foreground">{person?.name ?? "Unassigned"}</p></div></div>; }
function Deadline({ deadline, status }: { deadline: string | null; status: AdStatus }) { if (!deadline) return <span className="text-muted-foreground">No deadline</span>; const days = dateOnlyDaysFromToday(deadline); const active = status !== "approved" && status !== "published"; return <span className={cn("inline-flex items-center gap-1", active && days < 0 ? "text-destructive" : "text-muted-foreground")}><CalendarClock className="size-3.5" aria-hidden />{active && days < 0 ? `${Math.abs(days)}d overdue` : formatDateOnly(deadline)}</span>; }
function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) { return <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">{label}</span><Select value={value} onChange={(event) => onChange(event.target.value)}><option value="all">{label === "Sort" ? "Recently updated" : `All ${label.toLowerCase()}`}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label>; }
function EmptyQueue({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) { return <div className="mt-6 flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-center"><span className="flex size-12 items-center justify-center rounded-full bg-muted"><ListFilter className="size-5 text-muted-foreground" aria-hidden /></span><h2 className="mt-3 text-base font-semibold text-foreground">Nothing in this queue</h2><p className="mt-1 text-sm text-muted-foreground">Items will appear here when they reach this status.</p>{canCreate ? <Button className="mt-4" onClick={onCreate}><Plus className="size-4" aria-hidden />Add creative</Button> : null}</div>; }
