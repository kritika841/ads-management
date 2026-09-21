"use client";
/* eslint-disable @next/next/no-img-element */
import { Fragment, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Award, CheckCircle2, CircleDollarSign, Download, Gauge, Loader2, Megaphone, Pencil, Play, Plus, RefreshCw, Search, Target, Trash2, Trophy, Video, X } from "lucide-react";
import { deleteIncentiveCampaign, deactivateIncentiveCampaign, removeIncentiveCreative, saveIncentiveCampaign, updateCampaignDestination } from "@/app/actions/incentives";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { BatchLinkCreativesModal } from "@/components/incentives/batch-link-creatives-modal";
import { IncentivePerformance, type IncentivesPeriodSummary } from "@/components/incentives/incentive-performance";
import { MetricVisibilitySettings } from "@/components/incentives/metric-visibility-settings";
import { ReliableMetaVideo, type LiveMetaVideo } from "@/components/incentives/reliable-meta-video";
import { runServerAction } from "@/lib/client-action";
import { calculateMonthlyIncentive, evaluateIncentiveCreative, type IncentiveCampaign, type IncentiveCreative, type MetaAd } from "@/lib/incentives";
import type { HiddenMetricsByRole } from "@/lib/metric-visibility";
import type { Product, Profile } from "@/lib/types";
import { cn } from "@/lib/utils";
type EligibleAd = {
    id: string;
    name: string;
    product_id: string | null;
    creator_id: string | null;
    editor_id: string | null;
    thumbnail_url: string | null;
    drive_file_id: string | null;
    resolved_video_url: string | null;
    status: string;
    production_stage: string;
    creator?: {
        id: string;
        name: string;
    } | null;
    editor?: {
        id: string;
        name: string;
    } | null;
};
type TranscriptMapping = {
    mapping_key: string;
    meta_ad_id: string;
    meta_creative_id?: string | null;
    meta_video_id?: string | null;
    transcript?: string | null;
    transcript_language?: string | null;
    transcript_language_confidence?: number | null;
    transcript_source: string;
    transcript_status: string;
    transcript_error?: string | null;
    review_status?: string;
    reviewed_at?: string | null;
    review_note?: string | null;
    matched_ad_id: string | null;
    match_score: number | null;
    match_confidence: string;
    matched_tokens: number;
    transcript_token_count: number;
    script_token_count: number;
    mapped_at: string | null;
    ad?: LibraryAd | LibraryAd[];
};
type LibraryAd = {
    id: string;
    name: string;
    script_text?: string | null;
    thumbnail_url?: string | null;
    preview_url?: string | null;
    drive_file_id?: string | null;
    drive_url?: string | null;
    resolved_video_url?: string | null;
    product?: { name: string } | { name: string }[] | null;
};
type MappingMediaTarget = {
    kind: "meta" | "library";
    adId: string;
    name: string;
    thumbnailUrl?: string | null;
    thumbnailFallbackUrl?: string | null;
    previewUrl?: string | null;
    driveFileId?: string | null;
    creativeId?: string | null;
    videoId?: string | null;
};
export function IncentivesDashboard({
    campaigns,
    creatives,
    eligibleAds,
    metaAds,
    profile,
    products,
    syncRuns = [],
    transcriptMappings = [],
    campaignDestinations,
    hiddenMetricsByRole,
}: {
    campaigns: IncentiveCampaign[];
    creatives: IncentiveCreative[];
    eligibleAds: EligibleAd[];
    metaAds: MetaAd[];
    profile: Profile;
    products: Product[];
    syncRuns?: Array<Record<string, unknown>>;
    transcriptMappings?: TranscriptMapping[];
    campaignDestinations?: Record<string, { destination: string; campaignName?: string | null }>;
    hiddenMetricsByRole?: HiddenMetricsByRole;
}) {
    const router = useRouter();
    const reviewer = profile.role === "admin" || profile.role === "manager";
    const [message, setMessage] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [section, setSection] = useState<"overview" | "winning" | "losing" | "active" | "paused" | "testing" | "settings" | "mapping" | null>(null);
    const [overviewPeriod, setOverviewPeriod] = useState<IncentivesPeriodSummary>({ from: dashboardToday(), to: dashboardToday(), totalSpend: 0 });
    const roleHiddenMetrics = profile.role === "admin"
        ? []
        : profile.role === "manager"
        ? (hiddenMetricsByRole?.manager ?? [])
        : (hiddenMetricsByRole?.content_creator ?? hiddenMetricsByRole?.editor ?? []);
    const isSpendHidden = roleHiddenMetrics.includes("spend");
    useEffect(() => {
        const applyHash = () => {
            const raw = window.location.hash.replace(/^#/, "").toLowerCase();
            const valid = ["overview", "winning", "losing", "active", "paused", "testing", "settings", "mapping"] as const;
            setSection((valid as readonly string[]).includes(raw) ? (raw as (typeof valid)[number]) : "overview");
        };
        applyHash();
        window.addEventListener("hashchange", applyHash);
        return () => window.removeEventListener("hashchange", applyHash);
    }, []);
    const updateOverviewPeriod = useCallback((summary: IncentivesPeriodSummary) => setOverviewPeriod((current) => current.from === summary.from && current.to === summary.to && current.totalSpend === summary.totalSpend ? current : summary), []);
    async function syncMeta() {
        setSyncing(true);
        setMessage(null);
        try {
            const response = await fetch("/api/incentives/sync", { method: "POST" });
            const payload = await response.json();
            if (!response.ok)
                throw new Error(payload.error ?? "Sync failed.");
            setMessage(payload.message ?? `Imported ${payload.catalogAds ?? 0} Meta ads, auto-tagged ${payload.autoMatched ?? 0}, added ${payload.autoLinked ?? 0} to incentives, and updated ${payload.synced ?? 0} tracked creatives.`);
            router.refresh();
        }
        catch (cause) {
            setMessage(cause instanceof Error ? cause.message : "Sync failed.");
        }
        finally {
            setSyncing(false);
        }
    }
    return (<main className="page-container">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><h1 className="text-2xl font-semibold text-foreground">Ads performance</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Track ad performance, creative spend, and Meta ad outcomes.</p></div>
        <div className="flex flex-wrap gap-2">
          {reviewer ? <Button variant="secondary" onClick={syncMeta} disabled={syncing}>{syncing ? <Loader2 className="size-4 animate-spin"/> : <RefreshCw className="size-4"/>}Sync Meta</Button> : null}
        </div>
      </div>
      {message ? <div className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{message}</div> : null}

      {section === null ? <section className="panel mt-6 flex min-h-48 items-center justify-center text-sm text-muted-foreground">Loading creative performance…</section> : null}
      {section === "overview" && !isSpendHidden ? <section className="mt-6 max-w-xs overflow-hidden rounded-xl border border-border bg-card">
        <Kpi icon={CircleDollarSign} label="Total spend" value={money(overviewPeriod.totalSpend)} detail={periodLabel(overviewPeriod.from, overviewPeriod.to)}/>
      </section> : null}

      {section === "overview" || section === "winning" || section === "losing" || section === "active" || section === "paused" || section === "testing" ? <IncentivePerformance profile={profile} hiddenMetricsByRole={hiddenMetricsByRole} creatives={creatives} metaAds={metaAds} libraryAds={eligibleAds} products={products.map((product) => ({ id: product.id, name: product.name }))} reviewer={reviewer} mode={section === "overview" ? "all" : section === "winning" ? "winner" : section === "losing" ? "loser" : section} campaignDestinations={campaignDestinations} onPeriodChange={section === "overview" ? updateOverviewPeriod : undefined}/> : null}
      {section === "settings" ? (
        reviewer && profile.role === "admin" ? (
          <div className="mt-6 space-y-6">
            <MetricVisibilitySettings initialHiddenMetrics={hiddenMetricsByRole} />
            <CampaignSettingsView metaAds={metaAds} initialDestinations={campaignDestinations} />
          </div>
        ) : (
          <section className="panel mt-6 p-6 text-sm text-muted-foreground">
            Settings are only available to administrators.
          </section>
        )
      ) : null}
      {section === "mapping" ? <TranscriptMappingView mappings={transcriptMappings} metaAds={metaAds} reviewer={reviewer}/> : null}
    </main>);
}
function TranscriptMappingView({ mappings, metaAds, reviewer }: {
    mappings: TranscriptMapping[];
    metaAds: MetaAd[];
    reviewer: boolean;
}) {
    const [filter, setFilter] = useState<"all" | "mapped" | "unmapped">("all");
    const [rematching, setRematching] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const router = useRouter();
    const metaById = useMemo(() => new Map(metaAds.map((ad) => [ad.id, ad])), [metaAds]);
    const visible = mappings.filter((mapping) => filter === "all" || (filter === "mapped" ? Boolean(mapping.matched_ad_id) : !mapping.matched_ad_id));
    if (!reviewer)
        return <section className="panel mt-5 p-6 text-sm text-muted-foreground">Transcript mapping is available to admins and managers.</section>;
    return <><div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Only approved Creative Library scripts are considered. A link is created only for a high-confidence, clearly separated transcript match.</p><Button size="sm" variant="secondary" disabled={rematching} onClick={async () => { setRematching(true); setMessage(null); try {
        const response = await fetch("/api/incentives/transcript-mapping/rematch", { method: "POST" });
        const payload = await response.json();
        if (!response.ok)
            throw new Error(payload.error ?? "Rematch failed.");
        setMessage(`Checked ${payload.reviewed} transcripts against ${payload.approvedScripts} approved scripts; linked ${payload.matched}.`);
        router.refresh();
    }
    catch (cause) {
        setMessage(cause instanceof Error ? cause.message : "Rematch failed.");
    }
    finally {
        setRematching(false);
    } }}>{rematching ? <Loader2 className="size-4 animate-spin"/> : <RefreshCw className="size-4"/>}Rematch approved scripts</Button>{message ? <p className="w-full text-xs text-muted-foreground">{message}</p> : null}</div><DetailedTranscriptMappingTable mappings={visible} metaAds={metaAds} filter={filter} onFilter={setFilter}/></>;
}
function DetailedTranscriptMappingTable({ mappings, metaAds, filter, onFilter }: {
    mappings: TranscriptMapping[];
    metaAds: MetaAd[];
    filter: "all" | "mapped" | "unmapped";
    onFilter: (filter: "all" | "mapped" | "unmapped") => void;
}) {
    const [expanded, setExpanded] = useState<string | null>(null);
    const [preview, setPreview] = useState<MappingMediaTarget | null>(null);
    const metaById = useMemo(() => new Map(metaAds.map((ad) => [ad.id, ad])), [metaAds]);
    const reason = (mapping: TranscriptMapping) => mapping.transcript_source === "exact_creative_id" ? "Exact creative ID" : mapping.review_status === "confirmed_unmatched" ? "Confirmed unmatched" : mapping.review_status === "confirmed_match" ? "Reviewed match" : mapping.matched_ad_id ? "High-confidence approved script" : mapping.transcript_status !== "available" ? "No usable transcript" : (mapping.match_score ?? 0) < 0.28 ? "Below 28% threshold" : mapping.matched_tokens < 3 ? "Fewer than 3 shared tokens" : "Needs review";
    return <><section className="panel mt-5 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><div><h2 className="section-heading">Creative mapping audit</h2><p className="mt-1 text-xs text-muted-foreground">Verbatim transcript matched against the approved Creative Library script. Click either thumbnail to play or inspect the source creative.</p></div><div className="flex gap-1 rounded-lg bg-muted p-1">{([['all', 'All'], ['mapped', 'Mapped'], ['unmapped', 'Unmapped']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => onFilter(value)} className={cn("rounded-md px-3 py-1.5 text-xs font-medium", filter === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>{label}</button>)}</div></div>{mappings.length ? <div className="overflow-x-auto"><table className="min-w-[1650px] w-full text-left text-sm"><thead className="bg-muted/70 text-xs text-muted-foreground"><tr><th className="px-4 py-3">Meta ad / creative</th><th className="px-4 py-3">Creative Library result / ID</th><th className="px-4 py-3">Shared tokens</th><th className="px-4 py-3">Decision</th><th className="px-4 py-3">Transcript status</th><th className="px-4 py-3"/></tr></thead><tbody className="divide-y divide-border">{mappings.map((mapping, index) => { const meta = metaById.get(mapping.meta_ad_id); const libraryAd = Array.isArray(mapping.ad) ? mapping.ad[0] : mapping.ad; const product = Array.isArray(libraryAd?.product) ? libraryAd.product[0] : libraryAd?.product; const key = mapping.mapping_key || `${mapping.meta_ad_id}:${index}`; const isOpen = expanded === key;
            const metaTarget: MappingMediaTarget = { kind: "meta", adId: mapping.meta_ad_id, name: meta?.name ?? `Meta ad ${mapping.meta_ad_id}`, thumbnailUrl: meta?.thumbnail_url, creativeId: mapping.meta_creative_id ?? meta?.creative_id, videoId: mapping.meta_video_id };
            const libraryTarget: MappingMediaTarget | null = libraryAd ? { kind: "library", adId: libraryAd.id, name: libraryAd.name, thumbnailUrl: libraryAd.drive_file_id ? `/api/ads/${libraryAd.id}/thumbnail` : libraryAd.thumbnail_url, thumbnailFallbackUrl: libraryAd.drive_file_id ? libraryAd.thumbnail_url : null, previewUrl: libraryAd.preview_url ?? libraryAd.resolved_video_url ?? libraryAd.drive_url, driveFileId: libraryAd.drive_file_id, creativeId: libraryAd.id } : null; return <Fragment key={key}><tr className="bg-card align-top"><td className="px-4 py-3"><button type="button" className="flex items-center gap-3 text-left" onClick={() => setPreview(metaTarget)}><MediaThumb src={metaTarget.thumbnailUrl}/><div><p className="max-w-64 truncate font-medium">{metaTarget.name}</p><p className="font-mono text-[10px] text-muted-foreground">Ad {mapping.meta_ad_id}</p><p className="font-mono text-[10px] text-muted-foreground">Creative {metaTarget.creativeId ?? "—"}</p><span className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary"><Play className="size-3"/>Open preview</span></div></button></td><td className="px-4 py-3">{libraryTarget ? <button type="button" className="flex items-center gap-3 text-left" onClick={() => setPreview(libraryTarget)}><MediaThumb src={libraryTarget.thumbnailUrl} fallbackSrc={libraryTarget.thumbnailFallbackUrl}/><div><p className="max-w-64 truncate font-medium text-success">{libraryTarget.name}</p><p className="text-xs text-muted-foreground">{product?.name ?? "Creative Library"}</p><p className="font-mono text-[10px] text-muted-foreground">Matched creative ID {libraryTarget.adId}</p><span className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary"><Play className="size-3"/>Open preview</span></div></button> : <span className="text-muted-foreground">No automatic match</span>}</td><td className="px-4 py-3 tabular-nums"><p>{mapping.matched_tokens} shared</p><p className="text-xs text-muted-foreground">{mapping.transcript_token_count} transcript · {mapping.script_token_count} script</p></td><td className="px-4 py-3"><span className={cn("rounded-full px-2 py-1 text-xs font-medium", mapping.matched_ad_id ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{reason(mapping)}</span></td><td className="px-4 py-3 text-xs text-muted-foreground">{mapping.transcript_status === "available" ? `Available${mapping.transcript_language ? ` · ${mapping.transcript_language}` : ""}` : mapping.transcript_error ?? mapping.transcript_status}</td><td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => setExpanded(isOpen ? null : key)}>{isOpen ? "Hide" : "Details"}</Button></td></tr>{isOpen ? <tr className="bg-muted/20"><td colSpan={6} className="px-4 py-4"><div className="grid gap-4 lg:grid-cols-2"><div><p className="text-xs font-medium text-muted-foreground">Verbatim multilingual transcript{mapping.transcript_language ? ` · ${mapping.transcript_language}` : ""}</p><p className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-card p-3 text-xs leading-5">{mapping.transcript || "No transcript stored."}</p></div><div><p className="text-xs font-medium text-muted-foreground">Creative Library script · matched ad ID {libraryAd?.id ?? "—"}</p><p className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-card p-3 text-xs leading-5">{libraryAd?.script_text || "No approved script passed the matching threshold."}</p></div></div></td></tr> : null}</Fragment>; })}</tbody></table></div> : <div className="px-5 py-10 text-center text-sm text-muted-foreground">No creative mapping records match this filter.</div>}</section>{preview ? <MappingMediaPreview target={preview} onClose={() => setPreview(null)}/> : null}</>;
}
function MediaThumb({ src, fallbackSrc }: {
    src?: string | null;
    fallbackSrc?: string | null;
}) { const [failed, setFailed] = useState(false); const displayed = failed ? fallbackSrc : src; return <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">{displayed ? <img src={displayed} alt="" className="size-full object-cover" onError={() => { if (!failed && fallbackSrc) setFailed(true); }}/> : <Video className="size-4 text-muted-foreground"/>}</span>; }
function MappingMediaPreview({ target, onClose }: {
    target: MappingMediaTarget;
    onClose: () => void;
}) {
    const libraryMediaUrl = target.kind === "library" && target.driveFileId ? `/api/ads/${target.adId}/media?fileId=${encodeURIComponent(target.driveFileId)}` : null;
    const [resolved, setResolved] = useState<LiveMetaVideo | null>(null);
    return <Modal open labelledBy="mapping-preview-title" onClose={onClose}><section className="mx-auto max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-card shadow-float"><div className="flex items-start justify-between border-b border-border p-5"><div><h2 id="mapping-preview-title" className="text-lg font-semibold">{target.name}</h2><p className="mt-1 font-mono text-xs text-muted-foreground">{target.kind === "meta" ? `Meta ad ${target.adId} · Creative ${resolved?.creativeId ?? target.creativeId ?? "—"} · Video ${resolved?.videoId ?? target.videoId ?? "resolving"}` : `Creative Library ad ${target.adId}`}</p></div><Button size="icon" variant="ghost" onClick={onClose} title="Close"><X className="size-5"/></Button></div><div className="space-y-4 p-5"><div className="flex min-h-64 items-center justify-center overflow-hidden rounded-lg border border-border bg-neutral-950">{target.kind === "meta" ? <ReliableMetaVideo adId={target.adId} creativeId={target.creativeId} videoId={target.videoId} onResolved={setResolved}/> : libraryMediaUrl ? <video src={libraryMediaUrl} controls autoPlay muted preload="auto" playsInline className="max-h-[32rem] w-full object-contain"/> : <p className="text-sm text-destructive">No playable Creative Library video is attached.</p>}</div>{target.kind === "meta" && resolved ? <a className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted" href={resolved.downloadUrl} target="_blank" rel="noreferrer"><Download className="size-4"/>Download exact Meta video</a> : target.kind === "library" ? <a className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted" href={`/api/ads/${target.adId}/download`} target="_blank" rel="noreferrer"><Download className="size-4"/>Download creative</a> : null}</div></section></Modal>;
}
function SyncActivity({ runs }: {
    runs: Array<Record<string, unknown>>;
}) { return <section className="panel mt-5 overflow-hidden"><div className="border-b border-border px-5 py-4"><h2 className="section-heading">Meta Sync Activity</h2><p className="mt-1 text-xs text-muted-foreground">Recent imports, matches, and errors.</p></div>{runs.length ? <div className="divide-y divide-border">{runs.map((run) => <div key={String(run.id)} className="grid gap-2 px-5 py-3 text-xs sm:grid-cols-6"><span className="text-foreground">{String(run.status ?? "Unknown")}</span><span className="text-muted-foreground">{String(run.started_at ?? "—")}</span><span className="text-muted-foreground">{String(run.rows_fetched ?? 0)} rows</span><span className="text-muted-foreground">{String(run.matched_creatives ?? 0)} matched</span><span className="text-muted-foreground">{String(run.unmatched_creatives ?? 0)} unmatched</span><span className="text-destructive">{String(run.error_message ?? "—")}</span></div>)}</div> : <div className="px-5 py-6 text-sm text-muted-foreground">No sync history yet. Sync Meta data to see the latest run.</div>}</section>; }
function MetaAdCatalog({ ads, linkedIds }: {
    ads: MetaAd[];
    linkedIds: Set<string>;
}) {
    const [query, setQuery] = useState("");
    const filtered = ads.filter((ad) => !query.trim() || `${ad.name} ${ad.campaign_name ?? ""} ${ad.adset_name ?? ""} ${ad.id}`.toLowerCase().includes(query.trim().toLowerCase()));
    return <section className="panel mt-5 overflow-hidden"><div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="section-heading">Meta ad catalog</h2><p className="mt-1 text-xs text-muted-foreground">All ads in account · performance for the latest 30 days · AdFlow tags auto-assign creator and editor</p></div><div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Meta ads"/></div></div>{filtered.length ? <div className="max-h-[480px] overflow-auto"><table className="min-w-[900px] w-full text-left text-sm"><thead className="sticky top-0 bg-muted text-xs text-muted-foreground"><tr><th className="px-5 py-3 font-medium">Meta ad</th><th className="px-4 py-3 font-medium">Campaign / ad set</th><th className="px-4 py-3 font-medium">Delivery</th><th className="px-4 py-3 font-medium">Spend</th><th className="px-4 py-3 font-medium">Purchases</th><th className="px-4 py-3 font-medium">CPA</th><th className="px-4 py-3 font-medium">Incentive</th></tr></thead><tbody className="divide-y divide-border">{filtered.map((ad) => { const linked = linkedIds.has(ad.id); return <tr key={ad.id} className="bg-card"><td className="px-5 py-3"><div className="flex items-center gap-3"><div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">{ad.thumbnail_url ? <img src={ad.thumbnail_url} alt="" className="size-full object-cover"/> : <Megaphone className="size-4 text-muted-foreground"/>}</div><div className="min-w-0"><p className="max-w-72 truncate font-medium text-foreground">{ad.name}</p><p className="font-mono text-[10px] text-muted-foreground">{ad.detected_tag ? `AdFlow ${ad.detected_tag}` : ad.id}</p></div></div></td><td className="px-4 py-3"><p className="max-w-56 truncate text-foreground">{ad.campaign_name ?? "—"}</p><p className="max-w-56 truncate text-xs text-muted-foreground">{ad.adset_name ?? "—"}</p></td><td className="px-4 py-3 text-xs text-muted-foreground">{ad.effective_status ?? ad.status ?? "Unknown"}</td><td className="px-4 py-3 tabular-nums text-foreground">{money(ad.spend)}</td><td className="px-4 py-3 tabular-nums text-foreground">{ad.purchases}</td><td className="px-4 py-3 tabular-nums text-foreground">{ad.cpa == null ? "—" : money(ad.cpa)}</td><td className="px-4 py-3"><span className={cn("rounded-full px-2 py-1 text-xs font-medium", linked ? "bg-success/15 text-success" : ad.matched_ad_id ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>{linked ? "Auto tracked" : ad.matched_ad_id ? "Tag matched" : "Available"}</span></td></tr>; })}</tbody></table></div> : <div className="flex min-h-40 flex-col items-center justify-center text-center"><Megaphone className="size-6 text-border"/><p className="mt-3 text-sm font-medium text-muted-foreground">{ads.length ? "No matching Meta ads" : "No Meta ads imported yet"}</p><p className="mt-1 text-xs text-muted-foreground">Use Sync Meta to import the account’s existing ads.</p></div>}</section>;
}
function Kpi({ icon: Icon, label, value, detail, positive }: {
    icon: typeof Target;
    label: string;
    value: string;
    detail: string;
    positive?: boolean;
}) { return <div className="bg-card p-5"><div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon className={cn("size-4", positive && "text-success")}/>{label}</div><p className={cn("mt-2 text-2xl font-semibold", positive ? "text-success" : "text-foreground")}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>; }
function CampaignCard({ campaign, creatives, reviewer, onEdit, onTrack, onDeactivate, onDelete }: {
    campaign: IncentiveCampaign;
    creatives: IncentiveCreative[];
    reviewer: boolean;
    onEdit: () => void;
    onTrack: () => void;
    onDeactivate: () => void;
    onDelete: () => void;
}) {
    const winners = creatives.filter((item) => item.evaluation_status === "winner").length;
    return <article className={cn("panel overflow-hidden", !campaign.active && "opacity-65")}><div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4"><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-base font-semibold text-foreground">{campaign.name}</h2><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", campaign.active ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>{campaign.active ? "Active" : "Paused"}</span></div><p className="mt-1 text-xs text-muted-foreground">{campaign.product?.name ?? "Product"} · submissions {campaign.starts_on}{campaign.ends_on ? ` to ${campaign.ends_on}` : " onward"}</p></div>{reviewer ? <div className="flex items-center gap-1"><Button size="icon" variant="ghost" className="size-8" title="Edit campaign" onClick={onEdit}><Pencil className="size-4"/></Button><Button size="sm" variant="ghost" className="text-warning" onClick={onDeactivate}>Deactivate</Button><Button size="icon" variant="ghost" className="size-8 text-destructive" title="Delete campaign" onClick={() => { if (confirm(`Delete campaign “${campaign.name}”? Its tracked creatives and metrics will also be deleted.`))
        onDelete(); }}><Trash2 className="size-4"/></Button></div> : null}</div><div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4"><Mini label="Target CPA" value={money(campaign.target_cpa)}/><Mini label="Testing" value={`${campaign.gate_days} + ${campaign.winner_window_days}d`}/><Mini label="Creator / win" value={money(campaign.creator_incentive_amount)}/><Mini label="Editor / win" value={money(campaign.editor_incentive_amount)}/></div><div className="flex items-center justify-between gap-3 px-5 py-4 text-xs text-muted-foreground"><div className="flex items-center gap-3"><span><strong className="text-foreground">{creatives.length}</strong> tracked</span><span><strong className="text-success">{winners}</strong> winners</span></div><Button size="sm" variant="ghost" onClick={onTrack}>Add creative</Button></div></article>;
}
function Mini({ label, value }: {
    label: string;
    value: string;
}) { return <div className="bg-card px-4 py-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold text-foreground">{value}</p></div>; }
function CreativeRow({ creative, reviewer, onMessage }: {
    creative: IncentiveCreative;
    reviewer: boolean;
    onMessage: (value: string) => void;
}) {
    const evaluation = evaluateIncentiveCreative(creative.campaign, creative.launched_on, creative.metrics);
    const totalWindowDays = creative.campaign.gate_days + creative.campaign.winner_window_days;
    const progress = Math.min(totalWindowDays, daysSince(creative.launched_on) + 1);
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    function remove() { if (!confirm(`Stop tracking “${creative.ad.name}”? Its incentive metrics will be removed.`))
        return; startTransition(async () => { const result = await runServerAction(() => removeIncentiveCreative(creative.id)); if (result.ok)
        router.refresh();
    else
        onMessage(result.message ?? "Unable to remove creative."); }); }
    return <tr className="bg-card"><td className="px-5 py-3"><div className="flex items-center gap-3"><div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">{creative.ad.thumbnail_url ? <img src={creative.ad.thumbnail_url} alt="" className="size-full object-cover"/> : <Video className="size-4 text-muted-foreground"/>}</div><div className="min-w-0"><p className="max-w-52 truncate font-medium text-foreground">{creative.ad.name}</p><p className="text-xs text-muted-foreground">{creative.creator?.name ?? creative.ad.creator?.name ?? "No creator"} · {creative.editor?.name ?? creative.ad.editor?.name ?? "Editor not assigned"}</p><p className="font-mono text-[10px] text-muted-foreground">Meta {creative.meta_ad_id} · {creative.attribution_source === "auto" ? "Auto-tagged" : "Manual"}</p></div></div></td><td className="px-4 py-3"><p className="font-medium text-foreground">{creative.campaign.name}</p><p className="text-xs text-muted-foreground">{creative.campaign.product?.name}</p></td><td className="px-4 py-3"><p className="text-foreground">Day {progress} of {totalWindowDays}</p><p className="text-xs text-muted-foreground">Gate: {creative.campaign.gate_days} + extension {creative.campaign.winner_window_days} days · {creative.campaign.evaluation_mode}</p></td><td className="px-4 py-3 tabular-nums text-foreground">{money(creative.latest_spend)}</td><td className="px-4 py-3 tabular-nums text-foreground">{creative.latest_purchases}</td><td className="px-4 py-3"><p className={cn("font-medium tabular-nums", creative.latest_cpa != null && creative.latest_cpa <= creative.campaign.target_cpa ? "text-success" : "text-foreground")}>{creative.latest_cpa == null ? "—" : money(creative.latest_cpa)}</p><p className="text-xs text-muted-foreground">target {money(creative.campaign.target_cpa)}</p></td><td className="px-4 py-3"><StatusBadge status={creative.evaluation_status}/><p className="mt-1 text-[11px] text-muted-foreground">{evaluation.observedDays} days synced</p></td>{reviewer ? <td className="px-4 py-3"><Button size="icon" variant="ghost" className="size-8 text-destructive" title="Remove tracking" disabled={pending} onClick={remove}>{pending ? <Loader2 className="size-4 animate-spin"/> : <Trash2 className="size-4"/>}</Button></td> : null}</tr>;
}
function StatusBadge({ status }: {
    status: IncentiveCreative["evaluation_status"];
}) { const labels = { gate_testing: "Initial test", gate_passed: "Gate passed", winner: "Winner", failed: "Missed target" }; return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", status === "winner" ? "bg-success/15 text-success" : status === "failed" ? "bg-destructive/15 text-destructive" : status === "gate_passed" ? "bg-accent text-accent-foreground" : "bg-warning/15 text-warning")}>{status === "winner" ? <Trophy className="size-3"/> : status === "gate_passed" ? <CheckCircle2 className="size-3"/> : <Gauge className="size-3"/>}{labels[status]}</span>; }
function PayoutTable({ winners }: {
    winners: IncentiveCreative[];
}) {
    const payouts = useMemo(() => { const rows = new Map<string, {
        name: string;
        role: string;
        count: number;
        amount: number;
    }>(); for (const item of winners) {
        for (const [person, role, amount] of [[item.creator ?? item.ad.creator, "Creator", item.campaign.creator_incentive_amount], [item.editor ?? item.ad.editor, "Editor", item.campaign.editor_incentive_amount]] as const) {
            if (!person)
                continue;
            const key = `${role}:${person.id}`;
            const current = rows.get(key) ?? { name: person.name, role, count: 0, amount: 0 };
            current.count += 1;
            current.amount += amount;
            rows.set(key, current);
        }
    } return [...rows.values()].sort((a, b) => b.amount - a.amount); }, [winners]);
    return <section className="panel mt-5 overflow-hidden"><div className="border-b border-border px-5 py-4"><h2 className="section-heading">Monthly payout preview</h2><p className="mt-1 text-xs text-muted-foreground">Each line is incentive amount × winning ads for {monthLabel(new Date().toISOString().slice(0, 7))}</p></div><div className="divide-y divide-border">{payouts.map((row) => <div key={`${row.role}:${row.name}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-5 px-5 py-3 text-sm"><div><p className="font-medium text-foreground">{row.name}</p><p className="text-xs text-muted-foreground">{row.role}</p></div><p className="text-muted-foreground">{row.count} winner{row.count === 1 ? "" : "s"}</p><p className="min-w-24 text-right font-semibold text-success">{money(calculateMonthlyIncentive(row.count ? row.amount / row.count : 0, row.count))}</p></div>)}</div></section>;
}
function CampaignModal({ campaign, products, onClose }: {
    campaign: IncentiveCampaign | null;
    products: Product[];
    onClose: () => void;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({ name: campaign?.name ?? "", productId: campaign?.product_id ?? products.find((p) => p.active)?.id ?? "", dailySubmissionTarget: campaign?.daily_submission_target ?? 3, targetCpa: campaign?.target_cpa ?? 500, gateDays: campaign?.gate_days ?? 3, winnerWindowDays: campaign?.winner_window_days ?? 10, evaluationMode: campaign?.evaluation_mode ?? "cumulative", creatorIncentiveAmount: campaign?.creator_incentive_amount ?? 1000, editorIncentiveAmount: campaign?.editor_incentive_amount ?? 1000, startsOn: campaign?.starts_on ?? new Date().toISOString().slice(0, 10), endsOn: campaign?.ends_on ?? "", active: campaign?.active ?? true });
    const set = (key: string, value: string | number | boolean) => setForm((current) => ({ ...current, [key]: value }));
    function save() { setError(null); startTransition(async () => { const result = await runServerAction(() => saveIncentiveCampaign({ id: campaign?.id, ...form, evaluationMode: form.evaluationMode as "cumulative" | "daily" })); if (result.ok) {
        onClose();
        router.refresh();
    }
    else
        setError(result.message ?? "Unable to save campaign."); }); }
    return <Modal open labelledBy="campaign-title" onClose={onClose}><section className="mx-auto w-full max-w-3xl rounded-xl bg-card shadow-float"><ModalHead title={campaign ? "Edit incentive campaign" : "New incentive campaign"} subtitle="Every rule remains editable by an admin or manager." onClose={onClose}/><div className="grid gap-4 p-5 sm:grid-cols-2"><Field label="Campaign name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus/></Field><Field label="Product"><Select value={form.productId} onChange={(e) => set("productId", e.target.value)}>{products.filter((p) => p.active || p.id === campaign?.product_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field><Field label="Target CPA (₹)"><Input type="number" min="0.01" step="0.01" value={form.targetCpa} onChange={(e) => set("targetCpa", Number(e.target.value))}/></Field><Field label="Initial gate (days)" hint="CPA must qualify by the end of this period."><Input type="number" min="1" value={form.gateDays} onChange={(e) => set("gateDays", Number(e.target.value))}/></Field><Field label="Winner test window (days)" hint="7, 10, 15—or any value up to 90."><Input type="number" min={form.gateDays} max="90" value={form.winnerWindowDays} onChange={(e) => set("winnerWindowDays", Number(e.target.value))}/></Field><Field label="CPA evaluation"><Select value={form.evaluationMode} onChange={(e) => set("evaluationMode", e.target.value)}><option value="cumulative">Cumulative CPA</option><option value="daily">Every day under target</option></Select></Field><div className="grid grid-cols-2 gap-3"><Field label="Starts"><Input type="date" value={form.startsOn} onChange={(e) => set("startsOn", e.target.value)}/></Field><Field label="Ends" hint="Optional"><Input type="date" value={form.endsOn} onChange={(e) => set("endsOn", e.target.value)}/></Field></div><Field label="Creator incentive / winner (₹)"><Input type="number" min="0" step="0.01" value={form.creatorIncentiveAmount} onChange={(e) => set("creatorIncentiveAmount", Number(e.target.value))}/></Field><Field label="Editor incentive / winner (₹)"><Input type="number" min="0" step="0.01" value={form.editorIncentiveAmount} onChange={(e) => set("editorIncentiveAmount", Number(e.target.value))}/></Field><label className="flex items-center gap-3 text-sm text-foreground sm:col-span-2"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} className="size-4 accent-primary"/>Campaign is active</label>{error ? <p className="rounded-lg bg-muted px-3 py-2 text-sm text-destructive sm:col-span-2">{error}</p> : null}</div><ModalFoot onClose={onClose} onSave={save} pending={pending} saveLabel={campaign ? "Save changes" : "Create campaign"} disabled={!form.name || !form.productId}/></section></Modal>;
}
function ModalHead({ title, subtitle, onClose }: {
    title: string;
    subtitle: string;
    onClose: () => void;
}) { return <div className="flex h-16 items-center justify-between border-b border-border px-5"><div><h2 className="text-lg font-semibold text-foreground">{title}</h2><p className="text-xs text-muted-foreground">{subtitle}</p></div><Button size="icon" variant="ghost" onClick={onClose} title="Close"><X className="size-5"/></Button></div>; }
function ModalFoot({ onClose, onSave, pending, saveLabel, disabled }: {
    onClose: () => void;
    onSave: () => void;
    pending: boolean;
    saveLabel: string;
    disabled: boolean;
}) { return <div className="flex justify-end gap-2 border-t border-border px-5 py-4"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={onSave} disabled={pending || disabled}>{pending ? <Loader2 className="size-4 animate-spin"/> : null}{saveLabel}</Button></div>; }
function EmptyCampaign({ reviewer, onCreate }: {
    reviewer: boolean;
    onCreate: () => void;
}) { return <section className="panel mt-5 flex min-h-56 flex-col items-center justify-center text-center"><Award className="size-8 text-border"/><p className="mt-3 font-medium text-foreground">No incentive campaigns yet</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Create a product campaign to set CPA rules, testing windows, and payouts.</p>{reviewer ? <Button className="mt-4" onClick={onCreate}><Plus className="size-4"/>Create first campaign</Button> : null}</section>; }
function money(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value); }
function monthLabel(month: string) { return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }); }
function dashboardToday() { return new Date().toLocaleDateString("en-CA"); }
function periodLabel(from: string, to: string) { if (!from && !to) return "All-time reporting"; const start = from || to; const end = to || from; const days = Math.floor((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000) + 1; const formatter = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); return `${formatter.format(new Date(`${start}T00:00:00Z`))}${start === end ? "" : ` – ${formatter.format(new Date(`${end}T00:00:00Z`))}`} · ${days} day${days === 1 ? "" : "s"}`; }
function daysSince(date: string) { return Math.max(0, Math.floor((Date.now() - new Date(`${date}T00:00:00`).getTime()) / 86400000)); }
function qualificationDate(creative: IncentiveCreative) { if (creative.decision_source === "manual" && creative.decided_at) return creative.decided_at.slice(0, 10); const date = new Date(`${creative.launched_on}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + creative.campaign.winner_window_days - 1); return date.toISOString().slice(0, 10); }

function CampaignSettingsView({
  metaAds,
  initialDestinations = {}
}: {
  metaAds: MetaAd[];
  initialDestinations?: Record<string, { destination: string; campaignName?: string | null }>;
}) {
  const router = useRouter();
  const [destinations, setDestinations] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initialDestinations).map(([id, rec]) => [id, rec.destination]))
  );
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const campaigns = useMemo(() => {
    const map = new Map<string, { id: string; name: string; adsCount: number; totalSpend: number }>();
    for (const ad of metaAds) {
      if (!ad.campaign_id) continue;
      const existing = map.get(ad.campaign_id) ?? {
        id: ad.campaign_id,
        name: ad.campaign_name || "Unnamed campaign",
        adsCount: 0,
        totalSpend: 0
      };
      existing.adsCount += 1;
      existing.totalSpend += Number(ad.spend || 0);
      map.set(ad.campaign_id, existing);
    }
    return [...map.values()].sort((a, b) => b.totalSpend - a.totalSpend);
  }, [metaAds]);

  const filtered = useMemo(() => {
    if (!query) return campaigns;
    const q = query.toLowerCase();
    return campaigns.filter((c) => c.name.toLowerCase().includes(q) || c.id.includes(q));
  }, [campaigns, query]);

  async function handleDestinationChange(
    campaignId: string,
    campaignName: string,
    destination: "default" | "testing" | "winner" | "loser"
  ) {
    setSavingId(campaignId);
    setMessage(null);
    try {
      const result = await runServerAction(() =>
        updateCampaignDestination({ campaignId, campaignName, destination })
      );
      if (result.ok) {
        setDestinations((prev) => ({ ...prev, [campaignId]: destination }));
        const label =
          destination === "winner"
            ? "Winning creatives"
            : destination === "loser"
            ? "Losing creatives"
            : destination === "testing"
            ? "Testing creatives"
            : "Default / Auto";
        setMessage(`Campaign “${campaignName}” set to ${label}.`);
        router.refresh();
      } else {
        setMessage(result.message ?? "Failed to update campaign destination.");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="panel mt-6 overflow-hidden">
      <div className="border-b border-border p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="section-heading">Campaign routing & submenu settings</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Configure which submenu each Meta campaign&apos;s data appears in (Testing, Winning, or Losing). Admin only.
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search campaigns..."
            />
          </div>
        </div>
        {message ? (
          <div className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground">
            {message}
          </div>
        ) : null}
      </div>

      <div className="max-h-[600px] overflow-auto">
        <table className="min-w-[800px] w-full text-left text-sm">
          <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Meta campaign</th>
              <th className="px-4 py-3 font-medium">Ads count</th>
              <th className="px-4 py-3 font-medium">Total spend</th>
              <th className="px-4 py-3 font-medium">Submenu destination</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((campaign) => {
              const currentDest = destinations[campaign.id] || "default";
              const saving = savingId === campaign.id;
              return (
                <tr key={campaign.id} className="bg-card">
                  <td className="px-5 py-3">
                    <p className="font-medium text-foreground">{campaign.name}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">ID {campaign.id}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{campaign.adsCount} ads</td>
                  <td className="px-4 py-3 tabular-nums text-foreground">{money(campaign.totalSpend)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Select
                        className="h-8 min-w-44 text-xs"
                        value={currentDest}
                        disabled={saving}
                        onChange={(e) =>
                          handleDestinationChange(
                            campaign.id,
                            campaign.name,
                            e.target.value as "default" | "testing" | "winner" | "loser"
                          )
                        }
                      >
                        <option value="default">Default / Auto</option>
                        <option value="testing">Testing creatives</option>
                        <option value="winner">Winning creatives</option>
                        <option value="loser">Losing creatives</option>
                      </Select>
                      {saving ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

