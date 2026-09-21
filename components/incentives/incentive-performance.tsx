"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowDownUp, ArrowUp, Download, ExternalLink, Eye, Filter, Loader2, Search, X } from "lucide-react";
import { updateIncentiveDecision } from "@/app/actions/incentives";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { evaluateIncentiveCreative, isDiscontinuedMetaStatus, type IncentiveCreative, type IncentiveDecisionStatus, type MetaAd, type MetaAdAsset, type MetaDailyMetric } from "@/lib/incentives";
import { PERFORMANCE_METRIC_KEYS, PERFORMANCE_METRICS_INFO, type ConfigurableMetricRole, type HiddenMetricsByRole, type PerformanceMetricKey } from "@/lib/metric-visibility";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { runServerAction } from "@/lib/client-action";
import { useRouter } from "next/navigation";
import { CreativeDetailsModal } from "@/components/incentives/creative-details-modal";
import { ReliableMetaVideo, type LiveMetaVideo } from "@/components/incentives/reliable-meta-video";
import { mediaImages } from "@/app/live-media-images";
import { mediaVideos } from "@/app/live-media-videos";
import { metaCampaignTier } from "@/lib/meta-campaigns";
import {
    assetIdentifier as mediaIdentifier,
    mediaLabelRank,
    isCaptionLikeLabel as isCaptionLike,
    cleanMediaTitle,
} from "@/lib/meta-asset-labels";
type Product = {
    id: string;
    name: string;
};
type View = "creative" | "campaign" | "adset";
export type CreativeMode = "all" | "testing" | "scaling" | "winner" | "loser" | "active" | "paused";
type SortColumn = "creative" | "campaign" | "delivery" | "spend" | "impressions" | "reach" | "clicks" | "purchases" | "revenue" | "cpa" | "roas" | "ctr" | "cpm" | "newest" | "oldest";
type SortDirection = "asc" | "desc";
type MediaMetrics = {
    spend?: number;
    impressions?: number;
    reach?: number;
    clicks?: number;
    linkClicks?: number;
    purchases?: number;
    value?: number;
};
type MediaAsset = {
    key: string;
    type: "video" | "image";
    adId: string;
    adName?: string;
    campaign?: string;
    campaignId?: string;
    adSet?: string;
    adSetId?: string;
    creativeId?: string;
    id: string;
    videoId?: string;
    name?: string;
    url?: string;
    thumbnail?: string;
    dateRows?: Record<string, MediaMetrics>;
};
type AssetPreview = {
    ad: MetaAd;
    asset: MediaAsset;
    creative?: IncentiveCreative;
    libraryAd?: LibraryVideo;
};
type MetaPreview = {
    ad: MetaAd;
    creative?: IncentiveCreative;
    libraryAd?: LibraryVideo;
};
type LibraryVideo = {
    id: string;
    name: string;
    thumbnail_url: string | null;
    drive_file_id: string | null;
    resolved_video_url: string | null;
};
export type IncentivesPeriodSummary = {
    from: string;
    to: string;
    totalSpend: number;
};
const mediaAssets: readonly MediaAsset[] = [...(mediaImages as unknown as readonly MediaAsset[]), ...(mediaVideos as unknown as readonly MediaAsset[])];
function dashboardDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}
const dashboardToday = () => dashboardDate();
function libraryMediaUrl(ad?: Pick<LibraryVideo, "id" | "drive_file_id" | "resolved_video_url"> | IncentiveCreative["ad"]) {
    return ad?.drive_file_id ? `/api/ads/${ad.id}/media?fileId=${encodeURIComponent(ad.drive_file_id)}` : ad?.resolved_video_url ?? null;
}
function assetsForAd(ad: MetaAd) {
    const exact = mediaAssets.filter((asset) => asset.adId === ad.id && (!ad.creative_id || asset.creativeId === ad.creative_id));
    return exact.length ? exact : mediaAssets.filter((asset) => asset.adId === ad.id);
}
function periodMetrics(rows: MetaDailyMetric[] | undefined, from: string, to: string) {
    return (rows ?? []).filter((row) => (!from || row.metric_date >= from) && (!to || row.metric_date <= to)).reduce((total, row) => ({ spend: total.spend + row.spend, impressions: total.impressions + row.impressions, reach: total.reach + row.reach, clicks: total.clicks + row.clicks, linkClicks: total.linkClicks + row.link_clicks, purchases: total.purchases + row.purchases, revenue: total.revenue + row.revenue }), { spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, purchases: 0, revenue: 0 });
}

export function IncentivePerformance({
    creatives,
    metaAds,
    libraryAds = [],
    products,
    reviewer,
    mode = "all",
    onPeriodChange,
    campaignDestinations,
    profile,
    hiddenMetricsByRole
}: {
    creatives: IncentiveCreative[];
    metaAds: MetaAd[];
    libraryAds?: LibraryVideo[];
    products: Product[];
    reviewer: boolean;
    mode?: CreativeMode;
    onPeriodChange?: (summary: IncentivesPeriodSummary) => void;
    campaignDestinations?: Record<string, { destination: string; campaignName?: string | null }>;
    profile?: Profile;
    hiddenMetricsByRole?: HiddenMetricsByRole;
}) {
    const router = useRouter();
    const isEffectiveHidden = (metric: PerformanceMetricKey): boolean => {
        if (profile?.role === "admin") {
            return false;
        }
        if (profile?.role === "manager") {
            return hiddenMetricsByRole?.manager?.includes(metric) ?? false;
        }
        const roleHidden = hiddenMetricsByRole?.content_creator ?? hiddenMetricsByRole?.editor ?? [];
        return roleHidden.includes(metric);
    };
    const [view, setView] = useState<View>("creative");
    const [campaignFilter, setCampaignFilter] = useState("");
    const [adsetFilter, setAdsetFilter] = useState("");
    const [productFilter, setProductFilter] = useState("");
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [decisionFilter, setDecisionFilter] = useState("");
    const [incentiveFilter, setIncentiveFilter] = useState("");
    const [payoutFilter, setPayoutFilter] = useState("");
    const [dateFrom, setDateFrom] = useState(mode === "winner" || mode === "loser" || mode === "paused" ? "" : dashboardToday());
    const [dateTo, setDateTo] = useState(mode === "winner" || mode === "loser" || mode === "paused" ? "" : dashboardToday());
    const [sort, setSort] = useState<SortColumn>("spend");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
    const [refreshingToday, setRefreshingToday] = useState(false);
    const [updatingSelection, setUpdatingSelection] = useState(false);
    const [bulkError, setBulkError] = useState("");
    const [bulkMessage, setBulkMessage] = useState("");
    const [bulkOutcome, setBulkOutcome] = useState<IncentiveDecisionStatus | "">("");
    const [visibleCount, setVisibleCount] = useState(25);
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    // Kept as a no-op compatibility shim for the existing filter callbacks; creative rows now use infinite scrolling.
    const setPage = (_value: number) => undefined;
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [detail, setDetail] = useState<IncentiveCreative | null>(null);
    const [metaPreview, setMetaPreview] = useState<MetaPreview | null>(null);
    const [assetPreview, setAssetPreview] = useState<AssetPreview | null>(null);
    const autoRefreshAttempted = useRef(false);
    const refreshRetryUsed = useRef(false);
    const destinationMap = useMemo(() => Object.fromEntries(Object.entries(campaignDestinations ?? {}).map(([id, rec]) => [id, rec.destination])), [campaignDestinations]);
    const adById = useMemo(() => new Map(metaAds.map((ad) => [ad.id, ad])), [metaAds]);
    const campaignNames = useMemo(() => [...new Set(metaAds.map((ad) => ad.campaign_name).filter(Boolean) as string[])].sort(), [metaAds]);
    const adsetNames = useMemo(() => [...new Set(metaAds.map((ad) => ad.adset_name).filter(Boolean) as string[])].sort(), [metaAds]);
    const creativesByMetaAd = useMemo(() => {
        const grouped = new Map<string, IncentiveCreative[]>();
        for (const creative of creatives) grouped.set(creative.meta_ad_id, [...(grouped.get(creative.meta_ad_id) ?? []), creative]);
        return grouped;
    }, [creatives]);
    const creativesByLibraryAd = useMemo(() => {
        const grouped = new Map<string, IncentiveCreative[]>();
        for (const creative of creatives) grouped.set(creative.ad_id, [...(grouped.get(creative.ad_id) ?? []), creative]);
        return grouped;
    }, [creatives]);
    const relatedCreatives = (ad: MetaAd) => {
        const direct = creativesByMetaAd.get(ad.id) ?? [];
        const matched = ad.matched_ad_id ? creativesByLibraryAd.get(ad.matched_ad_id) ?? [] : [];
        return [...new Map([...direct, ...matched].map((creative) => [creative.id, creative])).values()];
    };
    const filtered = useMemo(() => creatives.filter((item) => {
        const meta = adById.get(item.meta_ad_id);
        const haystack = `${item.ad.name} ${item.meta_ad_id} ${meta?.creative_id ?? ""} ${meta?.campaign_name ?? ""} ${meta?.adset_name ?? ""} ${item.creator?.name ?? item.ad.creator?.name ?? ""} ${item.editor?.name ?? item.ad.editor?.name ?? ""} ${item.campaign.product?.name ?? ""}`.toLowerCase();
        const decision = item.decision_status ?? (item.evaluation_status === "winner" ? "winner" : "unreviewed");
        const passedWinnerCriteria = meetsWinnerCriteria(item);
        const discontinued = isDiscontinuedMetaStatus(meta?.effective_status ?? meta?.status);
        const delivery = normalizedStatus(meta?.effective_status ?? meta?.status);
        const tier = metaCampaignTier(meta?.campaign_id, destinationMap);
        const isBackfilled = Boolean(item.backfill_classified_at || item.decision_note?.startsWith("Backfilled "));
        const manualOverride = item.decision_source === "manual" && (decision === "winner" || decision === "loser");
        const isWinner = decision === "winner" && (manualOverride || passedWinnerCriteria || isBackfilled);
        const winningCandidate = passedWinnerCriteria || isWinner;
        const isLoser = decision === "loser" && (manualOverride || discontinued || isBackfilled);
        return (!query || haystack.includes(query.toLowerCase())) && (!campaignFilter || meta?.campaign_name === campaignFilter) && (!adsetFilter || meta?.adset_name === adsetFilter) && (!productFilter || item.campaign.product_id === productFilter) && (!statusFilter || delivery === statusFilter) && (!decisionFilter || (decisionFilter === "winner" ? isWinner : decision === decisionFilter)) && (!incentiveFilter || item.incentive_status === incentiveFilter) && (!payoutFilter || item.payout_status === payoutFilter) && (!dateFrom || item.launched_on >= dateFrom) && (!dateTo || item.launched_on <= dateTo) && (mode === "all" || (mode === "testing" && tier === "testing") || (mode === "scaling" && tier === "scaling") || (mode === "winner" && winningCandidate) || (mode === "loser" && isLoser) || (mode === "active" && delivery === "Active") || (mode === "paused" && delivery === "Paused"));
    }).sort((a, b) => compareCreatives(a, b, adById, sort, sortDirection, dateFrom, dateTo)), [adById, adsetFilter, campaignFilter, creatives, dateFrom, dateTo, decisionFilter, destinationMap, incentiveFilter, mode, payoutFilter, productFilter, query, sort, sortDirection, statusFilter]);
    const rows = filtered.slice(0, visibleCount);
    const aggregateAds = metaAds.filter((ad) => {
        const linked = relatedCreatives(ad);
        const outcome = metaAdOutcome(ad, linked, destinationMap);
        const listingMode = mode === "winner" || mode === "loser" ? "all" : mode;
        return matchesMetaAd(ad, { query, campaignFilter, adsetFilter, statusFilter, dateFrom, dateTo, mode: listingMode }, destinationMap)
            && matchesCreativeFilters(linked, { productFilter, decisionFilter, incentiveFilter, payoutFilter }, ad)
            && (mode !== "winner" || outcome === "winner")
            && (mode !== "loser" || outcome === "loser");
    });
    const selectionItems = useMemo(() => {
        if (mode === "all" || mode === "testing" || mode === "scaling" || mode === "active" || mode === "paused" || mode === "winner" || mode === "loser") {
            return [...new Map(aggregateAds.map((ad) => {
                const creative = relatedCreatives(ad)[0];
                const key = creative?.id ?? `meta:${ad.id}`;
                return [key, { key, metaAdId: ad.id, downloadAdId: creative?.ad_id }];
            })).values()];
        }
        return filtered.map((creative) => ({ key: creative.id, metaAdId: creative.meta_ad_id, downloadAdId: creative.ad_id }));
    }, [aggregateAds, filtered, mode]);
    const sortedAggregateAds = useMemo(() => [...aggregateAds].sort((a, b) => compareMetaAds(a, b, sort, sortDirection, dateFrom, dateTo)), [aggregateAds, dateFrom, dateTo, sort, sortDirection]);
    const aggregates = view === "creative" ? [] : aggregate(aggregateAds, view, filtered);
    const periodSummary = useMemo(() => ({
        from: dateFrom,
        to: dateTo,
        totalSpend: aggregateAds.reduce((total, ad) => total + (dateFrom || dateTo ? periodMetrics(ad.daily_metrics, dateFrom, dateTo).spend : ad.spend), 0)
    }), [aggregateAds, dateFrom, dateTo]);
    useEffect(() => { setVisibleCount(25); setSelected(new Set()); }, [query, campaignFilter, adsetFilter, productFilter, statusFilter, decisionFilter, incentiveFilter, payoutFilter, dateFrom, dateTo, sort, sortDirection, mode]);
    useEffect(() => { setCampaignFilter(""); setAdsetFilter(""); setProductFilter(""); setStatusFilter(""); setDecisionFilter(""); setIncentiveFilter(""); setPayoutFilter(""); setQuery(""); setDateFrom(mode === "winner" || mode === "loser" || mode === "paused" ? "" : dashboardToday()); setDateTo(mode === "winner" || mode === "loser" || mode === "paused" ? "" : dashboardToday()); }, [mode]);
    useEffect(() => { const node = loadMoreRef.current; if (!node || view !== "creative")
        return; const observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting)
        setVisibleCount((value) => Math.min(filtered.length, value + 25)); }, { rootMargin: "240px" }); observer.observe(node); return () => observer.disconnect(); }, [filtered.length, view]);
    useEffect(() => { onPeriodChange?.(periodSummary); }, [onPeriodChange, periodSummary]);
    const today = dashboardToday();
    const needsAssetRefresh = reviewer && dateFrom === today && dateTo === today && metaAds.some((ad) => (ad.assets?.length ?? 0) > 0 && ad.assets?.some((asset) => asset.source === "meta_creative" || /save(?:%20|\s)more|satmi(?:%20|\s)bundles/i.test(asset.asset_label) || /^(video|image) \d+$/i.test(asset.asset_label) || /^\d{8,}$/.test(asset.asset_label) || isCaptionLike(asset.asset_label) || (/\.(mp4|mov|m4v|webm).*\(\d{8,}\)$/i.test(asset.asset_label) && !/^(video|image)\b/i.test(asset.asset_label)) || !asset.daily_metrics?.some((metric) => metric.metric_date === today)));
    const needsTodayRefresh = reviewer && ((dateFrom === today && dateTo === today && metaAds.length > 0 && !metaAds.some((ad) => dashboardDate(new Date(ad.last_synced_at)) === today)) || needsAssetRefresh);
    useEffect(() => {
        if (!needsTodayRefresh || autoRefreshAttempted.current) return;
        autoRefreshAttempted.current = true;
        setRefreshingToday(true);
        fetch("/api/incentives/sync", { method: "POST" }).then((response) => {
            if (response.ok) router.refresh();
            else if (!refreshRetryUsed.current) {
                refreshRetryUsed.current = true;
                autoRefreshAttempted.current = false;
                window.setTimeout(() => router.refresh(), 1500);
            }
        }).finally(() => setRefreshingToday(false));
    }, [metaAds, needsTodayRefresh, router]);
    const setColumnSort = (column: SortColumn) => {
        if (sort === column) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
        else { setSort(column); setSortDirection(["creative", "campaign", "delivery", "newest", "oldest"].includes(column) ? "asc" : "desc"); }
    };
    const clear = () => { setCampaignFilter(""); setAdsetFilter(""); setProductFilter(""); setQuery(""); setStatusFilter(""); setDecisionFilter(""); setIncentiveFilter(""); setPayoutFilter(""); setDateFrom(mode === "paused" ? "" : dashboardToday()); setDateTo(mode === "paused" ? "" : dashboardToday()); setSort("spend"); setSortDirection("desc"); setSelected(new Set()); };
    const setQuickRange = (range: "today" | "yesterday" | "week" | "month" | "thisMonth") => {
        const now = new Date();
        const format = (date: Date) => dashboardDate(date);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const start = new Date(end);
        if (range === "yesterday") {
            start.setDate(start.getDate() - 1);
            end.setDate(end.getDate() - 1);
        }
        if (range === "week") {
            end.setDate(end.getDate() - 1);
            start.setDate(end.getDate() - 6);
        }
        if (range === "month")
            start.setDate(start.getDate() - 29);
        if (range === "thisMonth")
            start.setDate(1);
        setDateFrom(format(start));
        setDateTo(format(end));
        setPage(1);
    };
    const toggleAll = () => setSelected(selected.size === selectionItems.length ? new Set() : new Set(selectionItems.map((item) => item.key)));
    const invertSelection = () => setSelected((current) => new Set(selectionItems.filter((item) => !current.has(item.key)).map((item) => item.key)));
    const bulkDownload = () => { if (selected.size)
        window.open(`/api/ads/export-zip?ids=${encodeURIComponent(selectionItems.filter((item) => selected.has(item.key)).flatMap((item) => item.downloadAdId ? [item.downloadAdId] : []).join(","))}`, "_blank", "noopener,noreferrer"); };
    const selectedDownloadCount = selectionItems.filter((item) => selected.has(item.key) && item.downloadAdId).length;
    const selectedMetaAdIds = [...new Set(selectionItems.filter((item) => selected.has(item.key)).map((item) => item.metaAdId))];
    const updateSelectedOutcomes = async (outcome: IncentiveDecisionStatus | null) => {
        if (!selectedMetaAdIds.length)
            return;
        setBulkError("");
        setBulkMessage("");
        setBulkOutcome("");
        setUpdatingSelection(true);
        let result: { ok: boolean; count?: number; message?: string };
        try {
            const response = await fetch("/api/incentives/outcomes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: selectedMetaAdIds, outcome })
            });
            result = await response.json() as { ok: boolean; count?: number; message?: string };
        } catch {
            result = { ok: false, message: "Could not reach the app server. Please try again." };
        }
        setUpdatingSelection(false);
        if (!result.ok) {
            setBulkError(result.message ?? "Unable to update the selected ad outcomes.");
            return;
        }
        setSelected(new Set());
        const label = outcome ? outcome.replaceAll("_", " ") : "no manual outcome";
        setBulkMessage(`${result.count ?? selectedMetaAdIds.length} ad${(result.count ?? selectedMetaAdIds.length) === 1 ? "" : "s"} saved as ${label}.`);
        router.refresh();
    };
    return <section className="panel mt-5 overflow-hidden">
    <div className="border-b border-border p-4"><h2 className="section-heading">{mode === "testing" ? "Testing creatives" : mode === "scaling" ? "Scaling / winner creatives" : mode === "all" ? "Creative performance" : `${mode[0].toUpperCase()}${mode.slice(1)} creatives`}</h2><p className="mt-1 text-xs text-muted-foreground">Creative-level performance for the selected reporting period.</p></div>
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-4 py-2"><span className="self-center text-xs font-medium text-muted-foreground">Quick range</span>{([['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Last 7 days'], ['month', 'Last 30 days'], ['thisMonth', 'This month']] as const).map(([range, label]) => <Button key={range} size="sm" variant="secondary" onClick={() => setQuickRange(range)}>{label}</Button>)}{refreshingToday ? <span className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin"/>Refreshing today&apos;s Meta media metrics…</span> : null}{mode === "paused" && !isEffectiveHidden("spend") ? <span className="ml-auto text-xs font-medium text-muted-foreground">All-time spend <span className="ml-1 text-foreground">{money(metaAds.filter((ad) => normalizedStatus(ad.effective_status ?? ad.status) === "Paused").reduce((total, ad) => total + ad.spend, 0))}</span></span> : null}</div>
    {mode !== "paused" ? <div className="grid gap-3 border-b border-border bg-muted/30 p-4 md:grid-cols-3 lg:grid-cols-6"><div className="relative lg:col-span-2"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input className="pl-9" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search ads, IDs, people, products"/></div><Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} aria-label="From date"/><Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} aria-label="To date"/><Select value={campaignFilter} onChange={(e) => { setCampaignFilter(e.target.value); setPage(1); }}><option value="">All campaigns</option>{campaignNames.map((name) => <option key={name}>{name}</option>)}</Select><Select value={adsetFilter} onChange={(e) => { setAdsetFilter(e.target.value); setPage(1); }}><option value="">All ad sets</option>{adsetNames.map((name) => <option key={name}>{name}</option>)}</Select><Select value={productFilter} onChange={(e) => { setProductFilter(e.target.value); setPage(1); }}><option value="">All products</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</Select><Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}><option value="">All delivery</option><option value="Active">Active</option><option value="Learning">Learning</option><option value="Paused">Paused</option></Select><Select value={decisionFilter} onChange={(e) => { setDecisionFilter(e.target.value); setPage(1); }}><option value="">All results</option><option value="unreviewed">Unreviewed</option><option value="winner">Winner</option><option value="loser">Loser</option><option value="needs_iteration">Needs iteration</option><option value="keep_testing">Keep testing</option></Select><Select value={incentiveFilter} onChange={(e) => { setIncentiveFilter(e.target.value); setPage(1); }}><option value="">All incentive</option><option value="eligible">Eligible</option><option value="pending_testing">Pending testing</option><option value="failed_cpa">Failed CPA target</option><option value="approved_for_payout">Approved for payout</option><option value="paid">Paid</option></Select><Select value={payoutFilter} onChange={(e) => { setPayoutFilter(e.target.value); setPage(1); }}><option value="">All payout</option><option value="not_ready">Not ready</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="paid">Paid</option></Select><div className="flex gap-2 lg:col-span-1"><Button className="flex-1" variant="secondary" onClick={clear}><Filter className="size-3.5"/>Reset</Button>{reviewer ? <Button className="flex-1" variant="secondary" onClick={invertSelection}>Invert selection</Button> : null}</div></div> : null}
    {view === "creative" && (selected.size || bulkMessage) ? <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-accent/30 px-4 py-2 text-xs">{selected.size ? <><div><span>{selectedMetaAdIds.length} ad{selectedMetaAdIds.length === 1 ? "" : "s"} selected</span><p className="mt-0.5 text-muted-foreground">Ad outcomes are independent of incentive tracking, campaign rules, and payouts.</p></div><div className="flex flex-wrap items-center gap-2">{reviewer ? <label className="inline-flex items-center gap-2"><span className="sr-only">Set selected ad outcome</span><Select className="h-8 min-w-44 text-xs" value={bulkOutcome} disabled={!selectedMetaAdIds.length || updatingSelection} onChange={(event) => setBulkOutcome(event.target.value as IncentiveDecisionStatus | "")} aria-label="Set selected ad outcome"><option value="">Choose outcome…</option><option value="winner">Winner</option><option value="loser">Loser</option><option value="unreviewed">Unreviewed</option><option value="needs_iteration">Needs iteration</option><option value="keep_testing">Keep testing</option></Select>{updatingSelection ? <Loader2 className="size-3.5 animate-spin" aria-label="Updating selected ad outcomes"/> : null}</label> : null}<Button size="sm" disabled={!bulkOutcome || updatingSelection} onClick={() => void updateSelectedOutcomes(bulkOutcome as IncentiveDecisionStatus)}>Apply outcome</Button><Button size="sm" variant="secondary" disabled={!selectedMetaAdIds.length || updatingSelection} onClick={() => void updateSelectedOutcomes(null)}>Clear override</Button><Button size="sm" onClick={bulkDownload} disabled={!selectedDownloadCount}><Download className="size-3.5"/>Download selected</Button></div></> : null}{bulkMessage ? <p className="basis-full text-success">{bulkMessage}</p> : null}{bulkError ? <p className="basis-full text-destructive">{bulkError}</p> : null}</div> : null}
    {view === "creative" ? (mode === "all" || mode === "testing" || mode === "scaling" || mode === "active" || mode === "paused" || mode === "winner" || mode === "loser"
            ? <CreativeAssetsTable ads={sortedAggregateAds} creatives={creatives} libraryAds={libraryAds} reviewer={reviewer} selected={selected} allSelected={selectionItems.length > 0 && selectionItems.every((item) => selected.has(item.key))} onToggle={(id) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; })} onToggleAll={toggleAll} dateFrom={dateFrom} dateTo={dateTo} sort={sort} sortDirection={sortDirection} onSort={setColumnSort} onView={setAssetPreview} onViewAd={(ad, creative, libraryAd) => setMetaPreview({ ad, creative, libraryAd })} isEffectiveHidden={isEffectiveHidden}/>
            : <CreativeTable rows={rows} adById={adById} reviewer={reviewer} sort={sort} sortDirection={sortDirection} onSort={setColumnSort} selected={selected} allSelected={selectionItems.length > 0 && selectionItems.every((item) => selected.has(item.key))} onToggle={(id) => setSelected((current) => { const next = new Set(current); if (next.has(id))
                next.delete(id);
            else
                next.add(id); return next; })} onToggleAll={toggleAll} onDetails={setDetail} isEffectiveHidden={isEffectiveHidden}/>)
            : <AggregateTable rows={aggregates} view={view} onCampaign={(name) => { setCampaignFilter(name); setView("creative"); setPage(1); }} onAdset={(name) => { setAdsetFilter(name); setView("creative"); setPage(1); }} isEffectiveHidden={isEffectiveHidden}/>}
    {!rows.length && view === "creative" && !(mode === "all" || mode === "active" || mode === "paused") ? <div className="flex min-h-36 flex-col items-center justify-center gap-1 text-center"><Search className="size-6 text-border"/><p className="text-sm font-medium text-muted-foreground">{creatives.length ? "No ads found for these filters" : "No creatives mapped yet"}</p><p className="text-xs text-muted-foreground">Sync Meta data or map a creative to see performance.</p></div> : null}
    {view === "creative" ? <div ref={loadMoreRef} className="flex min-h-12 items-center justify-center border-t border-border px-4 py-3 text-xs text-muted-foreground">{mode === "all" || mode === "testing" || mode === "scaling" || mode === "active" || mode === "paused" ? `All synced Meta ads are shown (${sortedAggregateAds.length})` : rows.length < filtered.length ? `Showing ${rows.length} of ${filtered.length} · keep scrolling to load more` : filtered.length ? `All ${filtered.length} creatives loaded` : ""}</div> : null}
    {detail ? <CreativeDetailsModal creative={detail} meta={adById.get(detail.meta_ad_id)} onClose={() => setDetail(null)}/> : null}
    {metaPreview ? <MetaAdPreviewModal {...metaPreview} onClose={() => setMetaPreview(null)}/> : null}
    {assetPreview ? <AssetPreviewModal preview={assetPreview} onClose={() => setAssetPreview(null)}/> : null}
  </section>;
}
function matchesMetaAd(ad: MetaAd, filters: {
    query: string;
    campaignFilter: string;
    adsetFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
    mode: CreativeMode;
}, destinationOverrides?: Record<string, string>) {
    const delivery = normalizedStatus(ad.effective_status ?? ad.status);
    const haystack = `${ad.name} ${ad.id} ${ad.creative_id ?? ""} ${ad.campaign_name ?? ""} ${ad.adset_name ?? ""} ${ad.detected_tag ?? ""}`.toLowerCase();
    const tier = metaCampaignTier(ad.campaign_id, destinationOverrides);
    const isTesting = filters.mode === "testing" && (tier === "testing" || ad.manual_outcome === "keep_testing");
    const isScaling = filters.mode === "scaling" && (tier === "scaling" || ad.manual_outcome === "winner");
    const hasDateMatch = !(filters.dateFrom || filters.dateTo) || (ad.daily_metrics?.length
        ? ad.daily_metrics.some((row) => (!filters.dateFrom || row.metric_date >= filters.dateFrom) && (!filters.dateTo || row.metric_date <= filters.dateTo))
        : (!ad.insights_from || !filters.dateTo || ad.insights_from <= filters.dateTo) && (!ad.insights_to || !filters.dateFrom || ad.insights_to >= filters.dateFrom));
    return hasDateMatch && (!filters.query || haystack.includes(filters.query.toLowerCase())) && (!filters.campaignFilter || ad.campaign_name === filters.campaignFilter) && (!filters.adsetFilter || ad.adset_name === filters.adsetFilter) && (!filters.statusFilter || delivery === filters.statusFilter) && (filters.mode === "all" || isTesting || isScaling || (filters.mode === "active" && delivery === "Active") || (filters.mode === "paused" && delivery === "Paused"));
}
function matchesCreativeFilters(creatives: IncentiveCreative[], filters: Pick<IncentiveFilters, "productFilter" | "decisionFilter" | "incentiveFilter" | "payoutFilter">, ad: MetaAd) {
    if (!filters.productFilter && !filters.decisionFilter && !filters.incentiveFilter && !filters.payoutFilter) return true;
    if (!creatives.length) {
        return !filters.productFilter
            && !filters.incentiveFilter
            && !filters.payoutFilter
            && (!filters.decisionFilter || ad.manual_outcome === filters.decisionFilter);
    }
    return creatives.some((creative) => {
        const decision = ad.manual_outcome ?? creative.decision_status ?? (creative.evaluation_status === "winner" ? "winner" : "unreviewed");
        const winner = decision === "winner" && (creative.decision_source === "manual" || meetsWinnerCriteria(creative));
        return (!filters.productFilter || creative.campaign.product_id === filters.productFilter)
            && (!filters.decisionFilter || (filters.decisionFilter === "winner" ? winner : decision === filters.decisionFilter))
            && (!filters.incentiveFilter || creative.incentive_status === filters.incentiveFilter)
            && (!filters.payoutFilter || creative.payout_status === filters.payoutFilter);
    });
}
function metaAdOutcome(ad: MetaAd, creatives: IncentiveCreative[], destinationOverrides?: Record<string, string>): IncentiveDecisionStatus {
    if (ad.manual_outcome) return ad.manual_outcome;
    if (ad.campaign_id && destinationOverrides?.[ad.campaign_id]) {
      const dest = destinationOverrides[ad.campaign_id];
      if (dest === "winner") return "winner";
      if (dest === "loser") return "loser";
      if (dest === "testing") return "keep_testing";
    }
    if (creatives.some((creative) => isQualifiedWinner(creative, ad))) return "winner";
    if (creatives.some((creative) => creative.decision_status === "loser" && (creative.decision_source === "manual" || isDiscontinuedMetaStatus(ad.effective_status ?? ad.status)))) return "loser";
    return "unreviewed";
}
type IncentiveFilters = {
    productFilter: string;
    decisionFilter: string;
    incentiveFilter: string;
    payoutFilter: string;
};
function reportMetrics(ad: MetaAd, from: string, to: string) {
    return from || to ? periodMetrics(ad.daily_metrics, from, to) : { spend: ad.spend, impressions: ad.impressions, reach: ad.reach, clicks: ad.clicks, linkClicks: ad.link_clicks, purchases: ad.purchases, revenue: ad.revenue };
}
function metaSortValue(ad: MetaAd, column: SortColumn, from: string, to: string): string | number {
    const metrics = reportMetrics(ad, from, to);
    if (column === "creative") return ad.name ?? "";
    if (column === "campaign") return `${ad.campaign_name ?? ""} ${ad.adset_name ?? ""}`;
    if (column === "delivery") return normalizedStatus(ad.effective_status ?? ad.status);
    if (column === "cpa") return metrics.purchases ? metrics.spend / metrics.purchases : Infinity;
    if (column === "roas") return metrics.spend ? metrics.revenue / metrics.spend : 0;
    if (column === "ctr") return metrics.impressions ? metrics.clicks / metrics.impressions : 0;
    if (column === "cpm") return metrics.impressions ? metrics.spend / metrics.impressions * 1000 : 0;
    if (column === "newest" || column === "oldest") return ad.created_time ?? "";
    return metrics[column as keyof Pick<ReturnType<typeof reportMetrics>, "spend" | "impressions" | "reach" | "clicks" | "purchases" | "revenue">] ?? 0;
}
function compareValues(left: string | number, right: string | number, direction: SortDirection) {
    const comparison = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left) - Number(right);
    return direction === "asc" ? comparison : -comparison;
}
function compareMetaAds(left: MetaAd, right: MetaAd, column: SortColumn, direction: SortDirection, from: string, to: string) {
    return compareValues(metaSortValue(left, column, from, to), metaSortValue(right, column, from, to), direction);
}
function compareCreatives(left: IncentiveCreative, right: IncentiveCreative, ads: Map<string, MetaAd>, column: SortColumn, direction: SortDirection, from: string, to: string) {
    if (column === "creative") return compareValues(left.ad.name, right.ad.name, direction);
    if (column === "campaign") return compareValues(left.campaign.name, right.campaign.name, direction);
    if (column === "newest" || column === "oldest") return compareValues(left.launched_on, right.launched_on, direction);
    const fallback = (creative: IncentiveCreative): MetaAd => ({ ...ads.get(creative.meta_ad_id), id: creative.meta_ad_id, name: creative.ad.name, spend: creative.latest_spend, purchases: creative.latest_purchases, revenue: 0, impressions: 0, reach: 0, clicks: 0, link_clicks: 0, cpa: null, campaign_id: null, campaign_name: creative.campaign.name, adset_id: null, adset_name: null, creative_id: null, creative_name: null, thumbnail_url: null, status: null, effective_status: null, created_time: creative.launched_on, insights_from: null, insights_to: null, last_synced_at: creative.last_synced_at ?? "", matched_ad_id: null, matched_creator_id: null, matched_editor_id: null, detected_tag: null, auto_matched_at: null });
    return compareMetaAds(fallback(left), fallback(right), column, direction, from, to);
}
function SortHeader({ column, label, sort, sortDirection, onSort, className = "" }: { column: SortColumn; label: string; sort: SortColumn; sortDirection: SortDirection; onSort: (column: SortColumn) => void; className?: string }) {
    const active = sort === column;
    const Icon = active ? sortDirection === "asc" ? ArrowUp : ArrowDown : ArrowDownUp;
    const defaultDirection: SortDirection = ["creative", "campaign", "delivery", "newest", "oldest"].includes(column) ? "asc" : "desc";
    const nextDirection = active ? (sortDirection === "asc" ? "desc" : "asc") : defaultDirection;
    return <th className={cn("px-4 py-3", className)}><button type="button" onClick={() => onSort(column)} className="inline-flex items-center gap-1 font-medium hover:text-foreground" aria-label={`Sort by ${label}, ${nextDirection === "asc" ? "ascending" : "descending"}`}><span>{label}</span><Icon className={cn("size-3.5", active && "text-foreground")}/></button></th>;
}
function CreativeThumbnail({ sources, className = "size-full object-cover" }: { sources: Array<string | null | undefined>; className?: string }) {
    const usableSources = sources.filter((source): source is string => Boolean(source));
    const [index, setIndex] = useState(0);
    const source = usableSources[index];
    if (!source) return <span className="text-xs text-muted-foreground">—</span>;
    return <img src={source} alt="" className={className} onError={() => setIndex((current) => current + 1)} />;
}
function OutcomeBadge({ outcome }: { outcome: IncentiveDecisionStatus }) {
    return <span className={cn("rounded-full px-2 py-1 text-xs font-medium", outcome === "winner" ? "bg-success/15 text-success" : outcome === "loser" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")}>{outcome.replaceAll("_", " ")}</span>;
}
function CreativeAssetsTable({ ads, creatives, libraryAds, reviewer, selected, allSelected, onToggle, onToggleAll, dateFrom, dateTo, sort, sortDirection, onSort, onView, onViewAd, isEffectiveHidden }: {
    ads: MetaAd[];
    creatives: IncentiveCreative[];
    libraryAds: LibraryVideo[];
    reviewer: boolean;
    selected: Set<string>;
    allSelected: boolean;
    onToggle: (id: string) => void;
    onToggleAll: () => void;
    dateFrom: string;
    dateTo: string;
    sort: SortColumn;
    sortDirection: SortDirection;
    onSort: (column: SortColumn) => void;
    onView: (preview: AssetPreview) => void;
    onViewAd: (ad: MetaAd, creative?: IncentiveCreative, libraryAd?: LibraryVideo) => void;
    isEffectiveHidden: (metric: PerformanceMetricKey) => boolean;
}) {
    type ReportedAsset = MetaAdAsset & MediaAsset;
    type AssetRow = {
        ad: MetaAd;
        asset?: ReportedAsset;
        mapped?: IncentiveCreative;
        libraryAd?: LibraryVideo;
    };
    const libraryAdById = new Map(libraryAds.map((item) => [item.id, item]));
    const assetsByAd = new Map<string, ReportedAsset[]>();
    const rows: AssetRow[] = ads.flatMap((ad): AssetRow[] => {
        const mapped = creatives.find((creative) => creative.meta_ad_id === ad.id || creative.ad_id === ad.matched_ad_id);
        const libraryAd = (ad.matched_ad_id ? libraryAdById.get(ad.matched_ad_id) : undefined) ?? (mapped ? mapped.ad : undefined);
        const knownAssets = assetsForAd(ad);
        const assetsByMediaId = new Map<string, ReportedAsset>();
        for (const asset of ad.assets ?? []) {
            let normalized = asset.asset_label.replaceAll("%20", " ");
            const mid = mediaIdentifier(normalized);
            const matchingKnown = mid
                ? (knownAssets.find((k) => k.id === mid || k.videoId === mid || k.key?.includes(mid))
                   ?? mediaAssets.find((k) => k.id === mid || k.videoId === mid || k.key?.includes(mid)))
                : knownAssets.length === 1 ? knownAssets[0] : undefined;

            if (isCaptionLike(normalized) || /^\d{8,}$|^(video|image)\s+\d{8,}$/i.test(normalized)) {
                if (matchingKnown?.name && !isCaptionLike(matchingKnown.name)) {
                    normalized = /\.(mp4|mov|m4v|webm)$/i.test(matchingKnown.name) ? `Video ${matchingKnown.name} (${mid ?? asset.id})` : `${matchingKnown.name} (${mid ?? asset.id})`;
                } else if (libraryAd?.name && (ad.assets?.length ?? 1) <= 1) {
                    normalized = `Video ${libraryAd.name}.mp4 (${mid ?? asset.id})`;
                } else if (ad.detected_tag && (ad.assets?.length ?? 1) <= 1) {
                    normalized = `Video ${ad.detected_tag}.mp4 (${mid ?? asset.id})`;
                } else if (/^(?:HIM|TAM|ISH)\d{2,}/i.test(ad.name) && (ad.assets?.length ?? 1) <= 1) {
                    const tagMatch = ad.name.match(/\b(?:HIM|TAM|ISH)\d{2,}\b/i)?.[0];
                    normalized = tagMatch ? `Video ${tagMatch.toUpperCase()}.mp4 (${mid ?? asset.id})` : (mid ? `Video ${mid}` : normalized);
                } else if (mid) {
                    normalized = `Video ${mid}`;
                }
            }
            const row = { ...asset, asset_label: normalized, key: asset.id, type: asset.asset_type === "image" ? "image" : "video", adId: ad.id, thumbnail: asset.thumbnail_url ?? undefined, name: normalized, campaign: ad.campaign_name ?? undefined, adSet: ad.adset_name ?? undefined } as ReportedAsset;
            const key = mediaIdentifier(normalized) ? `${ad.id}:${mediaIdentifier(normalized)}` : asset.id;
            const existing = assetsByMediaId.get(key);
            if (!existing || mediaLabelRank(normalized) > mediaLabelRank(existing.asset_label)) assetsByMediaId.set(key, row);
        }
        const assets = [...assetsByMediaId.values()];
        assetsByAd.set(ad.id, assets);
        return assets.length ? assets.map((asset) => ({ ad, asset, mapped, libraryAd })) : [{ ad, asset: undefined, mapped, libraryAd }];
    });
    const metricsForRow = (row: AssetRow) => {
        const assetRows = row.asset?.daily_metrics;
        const hasReportedAssetMetrics = Boolean(assetRows?.some((metric) => (!dateFrom || metric.metric_date >= dateFrom) && (!dateTo || metric.metric_date <= dateTo)));
        const creativeCount = assetsByAd.get(row.ad.id)?.length ?? 0;
        const isOnlyCreative = Boolean(row.asset) && creativeCount === 1;
        // When no asset in the ad has breakdown metrics yet, fall back to
        // parent-ad metrics so rows don't show zeros or "Not reported" when
        // the parent ad genuinely has spend. This gives visibility while the
        // breakdown catches up.
        const adAssets = assetsByAd.get(row.ad.id) ?? [];
        const anyAssetHasMetrics = adAssets.some((a) => a.daily_metrics?.some((m) => (!dateFrom || m.metric_date >= dateFrom) && (!dateTo || m.metric_date <= dateTo)));
        const useParentFallback = !hasReportedAssetMetrics && (isOnlyCreative || !row.asset || !anyAssetHasMetrics);
        return periodMetrics(hasReportedAssetMetrics ? assetRows : useParentFallback ? row.ad.daily_metrics : [], dateFrom, dateTo);
    };
    const assetSortValue = (row: AssetRow, column: SortColumn): string | number => {
        const metrics = metricsForRow(row);
        if (column === "creative") return cleanMediaTitle(row.asset?.asset_label ?? row.libraryAd?.name ?? row.ad.name ?? "");
        if (column === "campaign") return `${row.ad.campaign_name ?? ""} ${row.ad.adset_name ?? ""}`;
        if (column === "delivery") return normalizedStatus(row.ad.effective_status ?? row.ad.status);
        if (column === "cpa") return metrics.purchases ? metrics.spend / metrics.purchases : Infinity;
        if (column === "roas") return metrics.spend ? metrics.revenue / metrics.spend : 0;
        if (column === "ctr") return metrics.impressions ? metrics.clicks / metrics.impressions : 0;
        if (column === "cpm") return metrics.impressions ? metrics.spend / metrics.impressions * 1000 : 0;
        if (column === "newest" || column === "oldest") return row.ad.created_time ?? "";
        if (column === "spend" || column === "impressions" || column === "reach" || column === "clicks" || column === "purchases" || column === "revenue") return metrics[column];
        return 0;
    };
    const orderedRows = [...rows].sort((left, right) => {
        const availability = (row: AssetRow) => {
            const count = assetsByAd.get(row.ad.id)?.length ?? 0;
            return !row.asset || count === 1 || row.asset.daily_metrics?.some((metric) => (!dateFrom || metric.metric_date >= dateFrom) && (!dateTo || metric.metric_date <= dateTo)) ? 1 : 0;
        };
        return compareValues(assetSortValue(left, sort), assetSortValue(right, sort), sortDirection)
            || availability(right) - availability(left)
            || compareValues(assetSortValue(left, "creative"), assetSortValue(right, "creative"), "asc");
    });
    return <div className="overflow-x-auto"><table className="min-w-[1650px] w-full text-left text-sm"><thead className="bg-muted/70 text-xs text-muted-foreground"><tr>{reviewer ? <th className="w-10 px-4 py-3"><input type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label="Select all matching creatives"/></th> : null}<SortHeader column="creative" label="Creative" sort={sort} sortDirection={sortDirection} onSort={onSort}/><SortHeader column="campaign" label="Campaign / ad set" sort={sort} sortDirection={sortDirection} onSort={onSort}/><SortHeader column="delivery" label="Delivery" sort={sort} sortDirection={sortDirection} onSort={onSort}/>{!isEffectiveHidden("spend") ? <SortHeader column="spend" label="Spend" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("impressions") ? <SortHeader column="impressions" label="Impr." sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("reach") ? <SortHeader column="reach" label="Reach" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("clicks") ? <SortHeader column="clicks" label="Clicks" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("purchases") ? <SortHeader column="purchases" label="Purchases" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("revenue") ? <SortHeader column="revenue" label="Revenue" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("cpa") ? <SortHeader column="cpa" label="CPA" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("roas") ? <SortHeader column="roas" label="ROAS" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("ctr") ? <SortHeader column="ctr" label="CTR" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("cpm") ? <SortHeader column="cpm" label="CPM" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}<th className="px-4 py-3">Result</th><th className="px-4 py-3">Attribution</th><th className="px-4 py-3"/></tr></thead><tbody className="divide-y divide-border">{orderedRows.map(({ ad, asset, mapped, libraryAd }) => {
            // An ad can contain multiple assets. Reusing parent-ad totals here would
            // duplicate spend and conversions, so asset rows only use Meta asset data.
            const assetRows = asset?.daily_metrics;
            const hasReportedAssetMetrics = Boolean(assetRows?.some((row) => (!dateFrom || row.metric_date >= dateFrom) && (!dateTo || row.metric_date <= dateTo)));
            const creativeCount = assetsByAd.get(ad.id)?.length ?? 0;
            const isOnlyCreative = Boolean(asset) && creativeCount === 1;
            const metrics = metricsForRow({ ad, asset, mapped, libraryAd });
            const adAssets = assetsByAd.get(ad.id) ?? [];
            const anyReportedAssetMetrics = adAssets.some((candidate) => candidate.daily_metrics?.some((metric) => (!dateFrom || metric.metric_date >= dateFrom) && (!dateTo || metric.metric_date <= dateTo)));
            const parentMetrics = periodMetrics(ad.daily_metrics, dateFrom, dateTo);
            const adHasActivity = parentMetrics.spend > 0 || parentMetrics.impressions > 0 || parentMetrics.clicks > 0 || parentMetrics.purchases > 0;
            // "Not reported" should appear only when Meta genuinely has no
            // media-level breakdown AND another asset in the same ad DOES have
            // a breakdown (meaning this specific media was not reported). When
            // no asset has a breakdown yet, we fall back to parent-ad metrics
            // (handled by metricsForRow) rather than showing "Not reported".
            const unavailable = Boolean(asset) && !hasReportedAssetMetrics && !isOnlyCreative && adHasActivity && anyReportedAssetMetrics;
            // When using parent-ad fallback (no breakdown available for any
            // asset), annotate with the data source
            const usingParentFallback = Boolean(asset) && !hasReportedAssetMetrics && !isOnlyCreative && !anyReportedAssetMetrics && adHasActivity;
            const cpa = metrics.purchases ? metrics.spend / metrics.purchases : null;
            const roas = metrics.spend ? metrics.revenue / metrics.spend : 0;
            const ctr = metrics.impressions ? metrics.clicks / metrics.impressions * 100 : 0;
            const cpm = metrics.impressions ? metrics.spend / metrics.impressions * 1000 : 0;
            const delivery = normalizedStatus(ad.effective_status ?? ad.status);
            const knownAssets = assetsForAd(ad);
            const playableAsset = asset ? knownAssets.find((candidate) => candidate.id === asset.id || candidate.key === asset.id || candidate.name === asset.asset_label) : knownAssets.length === 1 ? knownAssets[0] : undefined;
            const imageSources = [libraryAd?.drive_file_id ? `/api/ads/${libraryAd.id}/thumbnail` : null, libraryAd?.thumbnail_url, playableAsset?.thumbnail, asset?.thumbnail_url, ad.thumbnail_url];
            const resolveDisplayName = () => {
                const clean = asset?.asset_label ? cleanMediaTitle(asset.asset_label) : "";
                if (clean && !isCaptionLike(clean) && !/^\d{8,}$|^(video|image)\s+\d{8,}$/i.test(clean)) {
                    return clean;
                }
                const mid = asset ? (mediaIdentifier(asset.asset_label) ?? mediaIdentifier(asset.id) ?? asset.id) : null;
                const foundAsset = mid ? mediaAssets.find((candidate) => candidate.id === mid || candidate.videoId === mid || candidate.key?.includes(mid)) : undefined;
                if (foundAsset?.name && !isCaptionLike(foundAsset.name)) {
                    return cleanMediaTitle(foundAsset.name);
                }
                if (playableAsset?.name && !isCaptionLike(playableAsset.name)) {
                    return cleanMediaTitle(playableAsset.name);
                }
                if (libraryAd?.name && !isCaptionLike(libraryAd.name)) {
                    return cleanMediaTitle(`${libraryAd.name}.mp4`);
                }
                if (ad.detected_tag && (ad.assets?.length ?? 1) <= 1) {
                    return cleanMediaTitle(`${ad.detected_tag}.mp4`);
                }
                const tagMatch = ad.name?.match(/\b(?:HIM|TAM|ISH)\d{2,}\b/i)?.[0];
                const adHasMultipleTags = (ad.name?.match(/\b(?:HIM|TAM|ISH)\d{2,}\b/gi)?.length ?? 0) > 1;
                if (tagMatch && !adHasMultipleTags && (ad.assets?.length ?? 1) <= 1) {
                    return cleanMediaTitle(`${tagMatch.toUpperCase()}.mp4`);
                }
                if (clean && !isCaptionLike(clean)) {
                    return clean;
                }
                if (mid) {
                    return mid;
                }
                return ad.name || "Unnamed creative";
            };
            const displayName = resolveDisplayName();
            const assetMediaId = asset ? (mediaIdentifier(asset.asset_label) ?? mediaIdentifier(asset.id)) : null;
            const metricValue = (value: string) => unavailable ? "Not reported" : value;
            const openPreview = () => playableAsset ? onView({ ad, asset: playableAsset, creative: mapped, libraryAd }) : onViewAd(ad, mapped, libraryAd);
            return <tr key={asset?.key ?? ad.id} className="bg-card align-top">
      {reviewer ? <td className="px-4 py-3"><input type="checkbox" checked={selected.has(mapped?.id ?? `meta:${ad.id}`)} onChange={() => onToggle(mapped?.id ?? `meta:${ad.id}`)} aria-label={`Select ${displayName}`}/></td> : null}<td className="px-4 py-3"><div className="flex items-center gap-3"><button type="button" className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted transition-opacity hover:opacity-75 focus:outline-none focus:ring-2 focus:ring-primary" onClick={openPreview} aria-label={`Play ${displayName}`}><CreativeThumbnail sources={imageSources}/></button><div className="min-w-0"><p className="max-w-64 truncate font-medium">{displayName}</p><p className="max-w-64 truncate text-[10px] text-muted-foreground">Meta ad: {ad.name || "Unnamed ad"}</p><p className="font-mono text-[10px] text-muted-foreground">{assetMediaId ? `Asset ${assetMediaId}` : playableAsset?.videoId ? `Video ${playableAsset.videoId}` : "Ad-level metrics only"} · Meta ad {ad.id}</p></div></div></td>
      <td className="px-4 py-3"><p className="max-w-56 truncate">{ad.campaign_name ?? asset?.campaign ?? "—"}</p><p className="max-w-56 truncate text-xs text-muted-foreground">{ad.adset_name ?? asset?.adSet ?? "—"}</p></td>
      <td className="px-4 py-3"><span className={cn("rounded-full px-2 py-1 text-xs font-medium", delivery === "Active" ? "bg-success/15 text-success" : delivery === "Learning" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>{delivery}</span></td>
      {!isEffectiveHidden("spend") ? <td className="px-4 py-3 tabular-nums">{metricValue(money(metrics.spend))}</td> : null}
      {!isEffectiveHidden("impressions") ? <td className="px-4 py-3 tabular-nums">{metricValue(number(metrics.impressions))}</td> : null}
      {!isEffectiveHidden("reach") ? <td className="px-4 py-3 tabular-nums">{metricValue(number(metrics.reach))}</td> : null}
      {!isEffectiveHidden("clicks") ? <td className="px-4 py-3 tabular-nums">{metricValue(number(metrics.clicks))}</td> : null}
      {!isEffectiveHidden("purchases") ? <td className="px-4 py-3 tabular-nums">{metricValue(number(metrics.purchases))}</td> : null}
      {!isEffectiveHidden("revenue") ? <td className="px-4 py-3 tabular-nums">{metricValue(money(metrics.revenue))}</td> : null}
      {!isEffectiveHidden("cpa") ? <td className="px-4 py-3 tabular-nums">{unavailable || cpa == null ? "—" : money(cpa)}</td> : null}
      {!isEffectiveHidden("roas") ? <td className="px-4 py-3 tabular-nums">{unavailable ? "—" : roas.toFixed(2)}</td> : null}
      {!isEffectiveHidden("ctr") ? <td className="px-4 py-3 tabular-nums">{unavailable ? "—" : `${ctr.toFixed(2)}%`}</td> : null}
      {!isEffectiveHidden("cpm") ? <td className="px-4 py-3 tabular-nums">{unavailable ? "—" : money(cpm)}</td> : null}
      <td className="px-4 py-3">{ad.manual_outcome ? <><OutcomeBadge outcome={ad.manual_outcome}/><p className="mt-1 text-[10px] text-muted-foreground">Manual ad override</p></> : mapped ? <><OutcomeBadge outcome={mapped.decision_status ?? "unreviewed"}/><p className="mt-1 text-[10px] text-muted-foreground">Tracking result</p>{reviewer ? <DecisionSelect creative={mapped}/> : null}</> : <span className="text-xs text-muted-foreground">Not set</span>}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{unavailable ? "Not reported · this media has no breakdown while other media in this ad does" : usingParentFallback ? "Ad-level total (breakdown pending)" : isOnlyCreative ? "Exact ad total · one creative variation" : mapped ? <><span className="font-medium text-success">Mapped to AdFlow</span><br />{ad.detected_tag ? <span className="font-mono">Tag {ad.detected_tag}</span> : "Internal creative match"}</> : ad.detected_tag ? <><span className="font-mono">Tag {ad.detected_tag}</span><br />Awaiting campaign match</> : "Unmapped"}</td>
      <td className="px-4 py-3"><Button size="icon" variant="secondary" className="size-9" onClick={openPreview} title="View exact video" aria-label="View exact video"><Eye className="size-4"/></Button></td>
    </tr>;
        })}</tbody></table></div>;
}
function AssetPreviewModal({ preview, onClose }: {
    preview: AssetPreview;
    onClose: () => void;
}) {
    const { ad, asset, creative, libraryAd } = preview;
    const [resolved, setResolved] = useState<LiveMetaVideo | null>(null);
    const storedCreative = libraryAd ?? creative?.ad;
    const storedMediaUrl = libraryMediaUrl(storedCreative);
    return <Modal open labelledBy="asset-preview-title" onClose={onClose}><section className="mx-auto max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-card shadow-float"><div className="flex items-start justify-between border-b border-border p-5"><div><h2 id="asset-preview-title" className="text-lg font-semibold">{storedCreative?.name ?? asset.name ?? ad.name}</h2><p className="mt-1 text-xs text-muted-foreground">{storedMediaUrl ? "Creative Library video" : `Meta ad: ${ad.name} · Video ${asset.videoId ?? "primary"}`}</p></div><Button size="icon" variant="ghost" onClick={onClose} title="Close"><X className="size-5"/></Button></div><div className="space-y-4 p-5"><div className="flex min-h-64 items-center justify-center overflow-hidden rounded-lg border border-border bg-neutral-950">{storedMediaUrl ? <video src={storedMediaUrl} controls autoPlay muted preload="auto" playsInline className="max-h-[32rem] w-full object-contain"/> : asset.type === "video" ? <ReliableMetaVideo adId={ad.id} creativeId={asset.creativeId ?? ad.creative_id} videoId={asset.videoId} onResolved={setResolved}/> : <p className="text-sm text-destructive">This row is not a video asset.</p>}</div>{storedMediaUrl ? <a className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted" href={`/api/ads/${storedCreative!.id}/download`} target="_blank" rel="noreferrer"><Download className="size-4"/>Download Creative Library video</a> : resolved ? <a className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted" href={resolved.downloadUrl} target="_blank" rel="noreferrer"><Download className="size-4"/>Download exact Meta video</a> : null}</div></section></Modal>;
}
function MetaAdsTable({ ads, onView }: {
    ads: MetaAd[];
    onView: (ad: MetaAd) => void;
}) {
    return <div className="overflow-x-auto"><div className="border-b border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">All synced Meta ads, including ads that have not yet been attributed to an incentive campaign.</div><table className="min-w-[1650px] w-full text-left text-sm"><thead className="bg-muted/70 text-xs text-muted-foreground"><tr><th className="px-4 py-3">Creative / ad</th><th className="px-4 py-3">Campaign / ad set</th><th className="px-4 py-3">Delivery</th><th className="px-4 py-3">Spend</th><th className="px-4 py-3">Impr.</th><th className="px-4 py-3">Reach</th><th className="px-4 py-3">Clicks</th><th className="px-4 py-3">Purchases</th><th className="px-4 py-3">Revenue</th><th className="px-4 py-3">CPA</th><th className="px-4 py-3">ROAS</th><th className="px-4 py-3">CTR</th><th className="px-4 py-3">CPM</th><th className="px-4 py-3">Attribution</th><th className="px-4 py-3"/></tr></thead><tbody className="divide-y divide-border">{ads.map((ad) => { const videoRows = mediaVideos as Array<{
        adId: string;
        adName?: string;
        creativeId?: string;
        id?: string;
        videoId?: string;
        url: string;
    }>; const stored = videoRows.find((item) => item.adId === ad.id && (!ad.creative_id || item.creativeId === ad.creative_id || item.id === ad.creative_id || item.videoId === ad.creative_id)) ?? (() => { const candidates = videoRows.filter((item) => item.adName === ad.name); return candidates.length === 1 ? candidates[0] : undefined; })(); const cpa = ad.purchases ? ad.spend / ad.purchases : null; const roas = ad.spend ? ad.revenue / ad.spend : 0; const ctr = ad.impressions ? ad.clicks / ad.impressions * 100 : 0; const cpm = ad.impressions ? ad.spend / ad.impressions * 1000 : 0; const delivery = normalizedStatus(ad.effective_status ?? ad.status); return <tr key={ad.id} className="bg-card align-top"><td className="px-4 py-3"><div className="flex items-center gap-3"><div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">{ad.thumbnail_url ? <img src={ad.thumbnail_url} alt="" className="size-full object-cover"/> : <span className="text-xs text-muted-foreground">—</span>}</div><div className="min-w-0"><p className="max-w-64 truncate font-medium">{ad.name || "Unnamed ad"}</p><p className="font-mono text-[10px] text-muted-foreground">Meta ad {ad.id}</p><p className="font-mono text-[10px] text-muted-foreground">Creative {ad.creative_id ?? "—"}</p></div></div></td><td className="px-4 py-3"><p className="max-w-56 truncate">{ad.campaign_name ?? "—"}</p><p className="max-w-56 truncate text-xs text-muted-foreground">{ad.adset_name ?? "—"}</p></td><td className="px-4 py-3"><span className={cn("rounded-full px-2 py-1 text-xs font-medium", delivery === "Active" ? "bg-success/15 text-success" : delivery === "Learning" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>{delivery}</span></td><td className="px-4 py-3 tabular-nums">{money(ad.spend)}</td><td className="px-4 py-3 tabular-nums">{number(ad.impressions)}</td><td className="px-4 py-3 tabular-nums">{number(ad.reach)}</td><td className="px-4 py-3 tabular-nums">{number(ad.clicks)}</td><td className="px-4 py-3 tabular-nums">{number(ad.purchases)}</td><td className="px-4 py-3 tabular-nums">{money(ad.revenue)}</td><td className="px-4 py-3 tabular-nums">{cpa == null ? "—" : money(cpa)}</td><td className="px-4 py-3 tabular-nums">{roas.toFixed(2)}</td><td className="px-4 py-3 tabular-nums">{ctr.toFixed(2)}%</td><td className="px-4 py-3 tabular-nums">{money(cpm)}</td><td className="px-4 py-3 text-xs text-muted-foreground">{ad.detected_tag ? <><span className="font-mono">{ad.detected_tag}</span><br />{ad.matched_ad_id ? "Mapped to incentive creative" : "Awaiting campaign match"}</> : "No AdFlow tag detected"}</td><td className="px-4 py-3"><div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => onView(ad)}><ExternalLink className="size-3.5"/>View ad</Button>{stored?.url || ad.matched_ad_id ? <a className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted" href={stored?.url ? `/api/incentives/media-proxy?url=${encodeURIComponent(stored.url)}&download=1` : `/api/ads/${ad.matched_ad_id}/download`} target="_blank" rel="noreferrer"><Download className="size-3.5"/>Download</a> : null}</div></td></tr>; })}</tbody></table></div>;
}
function MetaAdPreviewModal({ ad, creative, libraryAd, onClose }: {
    ad: MetaAd;
    creative?: IncentiveCreative;
    libraryAd?: LibraryVideo;
    onClose: () => void;
}) {
    const [resolved, setResolved] = useState<LiveMetaVideo | null>(null);
    const storedCreative = libraryAd ?? creative?.ad;
    const storedMediaUrl = libraryMediaUrl(storedCreative);
    return <Modal open labelledBy="meta-ad-preview-title" onClose={onClose}><section className="mx-auto max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-card shadow-float"><div className="flex items-start justify-between border-b border-border p-5"><div><h2 id="meta-ad-preview-title" className="text-lg font-semibold">{(storedCreative?.name ?? ad.name) || "Meta ad preview"}</h2><p className="mt-1 text-xs text-muted-foreground">{storedMediaUrl ? "Creative Library video" : `Meta ad ${ad.id} · ${ad.campaign_name ?? "—"}`}</p></div><Button size="icon" variant="ghost" onClick={onClose} title="Close"><X className="size-5"/></Button></div><div className="space-y-4 p-5"><div className="flex min-h-64 items-center justify-center overflow-hidden rounded-lg border border-border bg-neutral-950">{storedMediaUrl ? <video src={storedMediaUrl} controls autoPlay muted preload="metadata" playsInline className="max-h-[32rem] w-full object-contain"/> : <ReliableMetaVideo adId={ad.id} creativeId={ad.creative_id} onResolved={setResolved}/>}</div><div className="grid gap-3 sm:grid-cols-2"><Detail label="Video source" value={storedMediaUrl ? "Creative Library" : "Live Meta fallback"}/><Detail label="Meta ad ID" value={ad.id}/><Detail label="Meta creative ID" value={resolved?.creativeId ?? ad.creative_id ?? "—"}/><Detail label="Meta video ID" value={storedMediaUrl ? "Stored Creative Library video" : resolved?.videoId ?? "Resolving live from Meta"}/><Detail label="Delivery" value={normalizedStatus(ad.effective_status ?? ad.status)}/><Detail label="AdFlow attribution" value={ad.detected_tag ?? "Not detected"}/></div>{storedMediaUrl ? <a className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted" href={`/api/ads/${storedCreative!.id}/download`} target="_blank" rel="noreferrer"><Download className="size-4"/>Download Creative Library video</a> : resolved ? <a className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted" href={resolved.downloadUrl} target="_blank" rel="noreferrer"><Download className="size-4"/>Download exact Meta video</a> : null}</div></section></Modal>;
}
function CreativeTable({ rows, adById, reviewer, sort, sortDirection, onSort, selected, allSelected, onToggle, onToggleAll, onDetails, isEffectiveHidden }: {
    rows: IncentiveCreative[];
    adById: Map<string, MetaAd>;
    reviewer: boolean;
    sort: SortColumn;
    sortDirection: SortDirection;
    onSort: (column: SortColumn) => void;
    selected: Set<string>;
    allSelected: boolean;
    onToggle: (id: string) => void;
    onToggleAll: () => void;
    onDetails: (creative: IncentiveCreative) => void;
    isEffectiveHidden: (metric: PerformanceMetricKey) => boolean;
}) {
    return <div className="overflow-x-auto"><table className="min-w-[1650px] w-full text-left text-sm"><thead className="bg-muted/70 text-xs text-muted-foreground"><tr>{reviewer ? <th className="w-10 px-4 py-3"><input type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label="Select all matching creatives"/></th> : null}<SortHeader column="creative" label="Creative / ad" sort={sort} sortDirection={sortDirection} onSort={onSort}/><SortHeader column="campaign" label="Campaign / ad set" sort={sort} sortDirection={sortDirection} onSort={onSort}/><th className="px-4 py-3">Product</th><th className="px-4 py-3">Creator / editor</th><SortHeader column="delivery" label="Delivery" sort={sort} sortDirection={sortDirection} onSort={onSort}/>{!isEffectiveHidden("spend") ? <SortHeader column="spend" label="Spend" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("impressions") ? <SortHeader column="impressions" label="Impr." sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("reach") ? <SortHeader column="reach" label="Reach" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("clicks") ? <SortHeader column="clicks" label="Clicks" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("purchases") ? <SortHeader column="purchases" label="Purchases" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("revenue") ? <SortHeader column="revenue" label="Revenue" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("cpa") ? <SortHeader column="cpa" label="Cost / purchase" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("roas") ? <SortHeader column="roas" label="ROAS" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("ctr") ? <SortHeader column="ctr" label="CTR" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}{!isEffectiveHidden("cpm") ? <SortHeader column="cpm" label="CPM" sort={sort} sortDirection={sortDirection} onSort={onSort}/> : null}<th className="px-4 py-3">Result</th><th className="px-4 py-3"/></tr></thead><tbody className="divide-y divide-border">{rows.map((creative) => <CreativeTableRow key={creative.id} creative={creative} meta={adById.get(creative.meta_ad_id)} reviewer={reviewer} selected={selected.has(creative.id)} onToggle={() => onToggle(creative.id)} onDetails={() => onDetails(creative)} isEffectiveHidden={isEffectiveHidden}/>)}</tbody></table></div>;
}
function CreativeTableRow({ creative, meta, reviewer, selected, onToggle, onDetails, isEffectiveHidden }: {
    creative: IncentiveCreative;
    meta?: MetaAd;
    reviewer: boolean;
    selected: boolean;
    onToggle: () => void;
    onDetails: () => void;
    isEffectiveHidden: (metric: PerformanceMetricKey) => boolean;
}) {
    const spend = meta?.spend ?? creative.latest_spend;
    const purchases = meta?.purchases ?? creative.latest_purchases;
    const revenue = meta?.revenue ?? 0;
    const impressions = meta?.impressions ?? 0;
    const reach = meta?.reach ?? 0;
    const clicks = meta?.clicks ?? 0;
    const linkClicks = meta?.link_clicks ?? 0;
    const cpa = purchases > 0 ? spend / purchases : null;
    const roas = spend > 0 ? revenue / spend : 0;
    const ctr = impressions > 0 ? clicks / impressions * 100 : 0;
    const cpm = impressions > 0 ? spend / impressions * 1000 : 0;
    const delivery = normalizedStatus(meta?.effective_status ?? meta?.status);
    const decision = creative.decision_status ?? (creative.evaluation_status === "winner" ? "winner" : "unreviewed");
    const qualifiedWinner = isQualifiedWinner(creative, meta);
    const displayedDecision = qualifiedWinner ? "winner" : decision;
    return <tr className="bg-card align-top"><>{reviewer ? <td className="px-4 py-3"><input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${creative.ad.name}`}/></td> : null}<td className="px-4 py-3"><div className="flex items-center gap-3"><div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">{meta?.thumbnail_url || creative.ad.thumbnail_url ? <img src={meta?.thumbnail_url ?? creative.ad.thumbnail_url ?? ""} alt="" className="size-full object-cover"/> : <span className="text-xs text-muted-foreground">—</span>}</div><div className="min-w-0"><p className="max-w-56 truncate font-medium text-foreground">{creative.ad.name}</p><p className="font-mono text-[10px] text-muted-foreground">Meta ad {creative.meta_ad_id}</p><p className="font-mono text-[10px] text-muted-foreground">Meta creative {meta?.creative_id ?? "—"}</p></div></div></td><td className="px-4 py-3"><p className="max-w-48 truncate text-foreground">{meta?.campaign_name ?? "—"}</p><p className="max-w-48 truncate text-xs text-muted-foreground">{meta?.adset_name ?? "—"}</p></td><td className="px-4 py-3 text-muted-foreground">{creative.campaign.product?.name ?? "—"}</td><td className="px-4 py-3 text-xs text-muted-foreground">{creative.creator?.name ?? creative.ad.creator?.name ?? "—"}<br />{creative.editor?.name ?? creative.ad.editor?.name ?? "—"}</td><td className="px-4 py-3"><span className={cn("rounded-full px-2 py-1 text-xs font-medium", delivery === "Active" ? "bg-success/15 text-success" : delivery === "Learning" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>{delivery}</span></td>{!isEffectiveHidden("spend") ? <td className="px-4 py-3 tabular-nums">{money(spend)}</td> : null}{!isEffectiveHidden("impressions") ? <td className="px-4 py-3 tabular-nums">{number(impressions)}</td> : null}{!isEffectiveHidden("reach") ? <td className="px-4 py-3 tabular-nums">{number(reach)}<br /><span className="text-xs text-muted-foreground">F {reach ? (impressions / reach).toFixed(2) : "—"}</span></td> : null}{!isEffectiveHidden("clicks") ? <td className="px-4 py-3 tabular-nums">{number(clicks)}<br /><span className="text-xs text-muted-foreground">Link {number(linkClicks)}</span></td> : null}{!isEffectiveHidden("purchases") ? <td className="px-4 py-3 tabular-nums">{number(purchases)}</td> : null}{!isEffectiveHidden("revenue") ? <td className="px-4 py-3 tabular-nums">{money(revenue)}</td> : null}{!isEffectiveHidden("cpa") ? <td className="px-4 py-3 tabular-nums">{cpa == null ? "—" : money(cpa)}</td> : null}{!isEffectiveHidden("roas") ? <td className="px-4 py-3 tabular-nums">{roas.toFixed(2)}</td> : null}{!isEffectiveHidden("ctr") ? <td className="px-4 py-3 tabular-nums">{ctr.toFixed(2)}%</td> : null}{!isEffectiveHidden("cpm") ? <td className="px-4 py-3 tabular-nums">{money(cpm)}</td> : null}<td className="px-4 py-3"><span className={cn("rounded-full px-2 py-1 text-xs font-medium", decision === "winner" ? "bg-success/15 text-success" : decision === "loser" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")}>{decision.replaceAll("_", " ")}</span><p className="mt-1 text-[10px] text-muted-foreground">{creative.decision_source === "manual" ? "Manual" : "Automatic"} · {creative.incentive_status?.replaceAll("_", " ") ?? "pending testing"}</p>{reviewer ? <DecisionSelect creative={creative}/> : null}</td><td className="px-4 py-3"><div className="flex gap-1"><Button size="sm" variant="secondary" onClick={onDetails}>View details</Button><a className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted" href={`/api/ads/${creative.ad_id}/download`} target="_blank" rel="noreferrer" title="Download creative"><Download className="size-3.5"/>Download</a></div></td></> </tr>;
}
function DecisionSelect({ creative }: {
    creative: IncentiveCreative;
}) { const router = useRouter(); const current = creative.decision_status ?? (creative.evaluation_status === "winner" ? "winner" : "unreviewed"); return <Select className="mt-2 h-8 w-32 text-[11px]" value={current} onChange={async (event) => { const value = event.target.value as IncentiveDecisionStatus; const result = await runServerAction(() => updateIncentiveDecision({ id: creative.id, decisionStatus: value })); if (result.ok)
    router.refresh(); }} aria-label="Manual winner decision"><option value="unreviewed">Unreviewed</option><option value="winner">Winner</option><option value="loser">Loser</option><option value="needs_iteration">Needs iteration</option><option value="keep_testing">Keep testing</option></Select>; }
type Aggregate = {
    key: string;
    name: string;
    id: string;
    campaign?: string;
    adSets: number;
    ads: number;
    creatives: number;
    spend: number;
    purchases: number;
    revenue: number;
    winners: number;
};
function aggregate(ads: MetaAd[], view: View, tracked: IncentiveCreative[]): Aggregate[] { const winners = new Set(tracked.filter((item) => isQualifiedWinner(item, ads.find((ad) => ad.id === item.meta_ad_id))).map((item) => item.meta_ad_id)); const map = new Map<string, Aggregate>(); for (const meta of ads) {
    const key = view === "campaign" ? meta.campaign_id ?? meta.campaign_name ?? "unknown" : meta.adset_id ?? meta.adset_name ?? "unknown";
    const name = view === "campaign" ? meta.campaign_name ?? "Unknown campaign" : meta.adset_name ?? "Unknown ad set";
    const current = map.get(key) ?? { key, name, id: key, campaign: meta.campaign_name ?? undefined, adSets: 0, ads: 0, creatives: 0, spend: 0, purchases: 0, revenue: 0, winners: 0 };
    current.ads += 1;
    current.spend += meta.spend;
    current.purchases += meta.purchases;
    current.revenue += meta.revenue;
    if (winners.has(meta.id))
        current.winners += 1;
    map.set(key, current);
} return [...map.values()].map((row) => ({ ...row, creatives: row.ads, adSets: view === "campaign" ? new Set(ads.filter((ad) => (ad.campaign_id ?? ad.campaign_name ?? "unknown") === row.key).map((ad) => ad.adset_id ?? ad.adset_name)).size : 1 })); }
function meetsWinnerCriteria(creative: IncentiveCreative) {
    return evaluateIncentiveCreative(creative.campaign, creative.launched_on, creative.metrics).status === "winner";
}
function isQualifiedWinner(creative: IncentiveCreative, meta?: MetaAd) {
    return creative.decision_status === "winner" && (creative.decision_source === "manual" || meetsWinnerCriteria(creative));
}
function AggregateTable({ rows, view, onCampaign, onAdset, isEffectiveHidden }: {
    rows: Aggregate[];
    view: View;
    onCampaign: (name: string) => void;
    onAdset: (name: string) => void;
    isEffectiveHidden?: (metric: PerformanceMetricKey) => boolean;
}) { return <div className="overflow-x-auto"><table className="min-w-[1200px] w-full text-left text-sm"><thead className="bg-muted/70 text-xs text-muted-foreground"><tr><th className="px-4 py-3">{view === "campaign" ? "Campaign" : "Ad set"}</th><th className="px-4 py-3">ID</th>{view === "adset" ? <th className="px-4 py-3">Campaign</th> : null}<th className="px-4 py-3">Ads</th>{!isEffectiveHidden?.("spend") ? <th className="px-4 py-3">Spend</th> : null}{!isEffectiveHidden?.("purchases") ? <th className="px-4 py-3">Purchases</th> : null}{!isEffectiveHidden?.("revenue") ? <th className="px-4 py-3">Revenue</th> : null}{!isEffectiveHidden?.("cpa") ? <th className="px-4 py-3">Cost / purchase</th> : null}{!isEffectiveHidden?.("roas") ? <th className="px-4 py-3">ROAS</th> : null}<th className="px-4 py-3">Winner creatives</th><th className="px-4 py-3"/></tr></thead><tbody className="divide-y divide-border">{rows.map((row) => <tr key={row.key}><td className="px-4 py-3 font-medium">{row.name}</td><td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.id}</td>{view === "adset" ? <td className="px-4 py-3 text-muted-foreground">{row.campaign ?? "—"}</td> : null}<td className="px-4 py-3">{row.ads}</td>{!isEffectiveHidden?.("spend") ? <td className="px-4 py-3">{money(row.spend)}</td> : null}{!isEffectiveHidden?.("purchases") ? <td className="px-4 py-3">{number(row.purchases)}</td> : null}{!isEffectiveHidden?.("revenue") ? <td className="px-4 py-3">{money(row.revenue)}</td> : null}{!isEffectiveHidden?.("cpa") ? <td className="px-4 py-3">{row.purchases ? money(row.spend / row.purchases) : "—"}</td> : null}{!isEffectiveHidden?.("roas") ? <td className="px-4 py-3">{row.spend ? (row.revenue / row.spend).toFixed(2) : "0.00"}</td> : null}<td className="px-4 py-3 text-success">{row.winners}</td><td className="px-4 py-3 text-right"><Button size="icon" variant="secondary" className="size-8 shrink-0" title={`View ads in ${row.name}`} aria-label={`View ads in ${row.name}`} onClick={() => view === "campaign" ? onCampaign(row.name) : onAdset(row.name)}><Eye className="size-4"/></Button></td></tr>)}</tbody></table></div>; }
function CreativeDetails({ creative, meta, onClose }: {
    creative: IncentiveCreative;
    meta?: MetaAd;
    onClose: () => void;
}) { const [tab, setTab] = useState<"performance" | "creative" | "incentive" | "mapping">("performance"); const spend = meta?.spend ?? creative.latest_spend; const purchases = meta?.purchases ?? creative.latest_purchases; const revenue = meta?.revenue ?? 0; const impressions = meta?.impressions ?? 0; const reach = meta?.reach ?? 0; const cpa = purchases ? spend / purchases : null; const copy = (value: string) => void navigator.clipboard?.writeText(value); return <Modal open labelledBy="creative-details-title" onClose={onClose}><section className="mx-auto max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-card shadow-float"><div className="flex items-start justify-between border-b border-border p-5"><div><h2 id="creative-details-title" className="text-lg font-semibold">{creative.ad.name}</h2><p className="mt-1 text-xs text-muted-foreground">Meta ad {creative.meta_ad_id} · {meta?.campaign_name ?? "—"}</p></div><Button size="icon" variant="ghost" onClick={onClose} title="Close"><X className="size-5"/></Button></div><div className="flex gap-1 overflow-x-auto border-b border-border px-5 pt-3">{([['performance', 'Performance'], ['creative', 'Creative'], ['incentive', 'Incentive'], ['mapping', 'Mapping']] as const).map(([key, label]) => <button key={key} type="button" className={cn("border-b-2 px-3 pb-3 text-sm", tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground")} onClick={() => setTab(key)}>{label}</button>)}</div><div className="grid gap-4 p-5 sm:grid-cols-2">{tab === "performance" ? <><Detail label="Spend" value={money(spend)}/><Detail label="Impressions" value={number(impressions)}/><Detail label="Reach" value={number(reach)}/><Detail label="Frequency" value={reach ? (impressions / reach).toFixed(2) : "—"}/><Detail label="Clicks" value={number(meta?.clicks ?? 0)}/><Detail label="Link clicks" value={number(meta?.link_clicks ?? 0)}/><Detail label="Purchases" value={number(purchases)}/><Detail label="Revenue" value={money(revenue)}/><Detail label="Cost per purchase (CPA)" value={cpa == null ? "—" : money(cpa)}/><Detail label="ROAS" value={spend ? (revenue / spend).toFixed(2) : "0.00"}/><Detail label="CTR" value={impressions ? `${((meta?.clicks ?? 0) / impressions * 100).toFixed(2)}%` : "—"}/><Detail label="CPM" value={impressions ? money(spend / impressions * 1000) : "—"}/></> : tab === "creative" ? <><div className="sm:col-span-2 flex min-h-40 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">{meta?.thumbnail_url || creative.ad.thumbnail_url ? <img src={meta?.thumbnail_url ?? creative.ad.thumbnail_url ?? ""} alt="Creative preview" className="max-h-72 object-contain"/> : <span className="text-sm text-muted-foreground">No creative preview available</span>}</div><Detail label="Creative/ad name" value={creative.ad.name}/><Detail label="Meta creative ID" value={meta?.creative_id ?? "—"}/><Detail label="Meta ad ID" value={creative.meta_ad_id}/><div className="flex gap-2 sm:col-span-2"><Button size="sm" variant="secondary" onClick={() => copy(creative.meta_ad_id)}>Copy ad ID</Button>{meta?.creative_id ? <Button size="sm" variant="secondary" onClick={() => copy(meta.creative_id!)}>Copy creative ID</Button> : null}<a className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm hover:bg-muted" href={`/api/ads/${creative.ad_id}/download`} target="_blank" rel="noreferrer"><Download className="size-4"/>Download creative</a></div></> : tab === "incentive" ? <><Detail label="Incentive campaign" value={creative.campaign.name}/><Detail label="Product" value={creative.campaign.product?.name ?? "—"}/><Detail label="Target CPA" value={money(creative.campaign.target_cpa)}/><Detail label="Actual CPA" value={cpa == null ? "—" : money(cpa)}/><Detail label="Testing window" value={`${creative.campaign.gate_days} → ${creative.campaign.winner_window_days} days`}/><Detail label="Winner status" value={(creative.decision_status ?? creative.evaluation_status).replaceAll("_", " ")}/><Detail label="Creator incentive" value={money(creative.campaign.creator_incentive_amount)}/><Detail label="Editor incentive" value={money(creative.campaign.editor_incentive_amount)}/><Detail label="Payout month" value={creative.payout_month ?? "—"}/><Detail label="Payout status" value={creative.payout_status?.replaceAll("_", " ") ?? "Not ready"}/></> : <><Detail label="Product" value={creative.campaign.product?.name ?? "—"}/><Detail label="Creator" value={creative.creator?.name ?? creative.ad.creator?.name ?? "—"}/><Detail label="Editor" value={creative.editor?.name ?? creative.ad.editor?.name ?? "—"}/><Detail label="Internal creative ID" value={creative.ad_id}/><Detail label="Meta creative ID" value={meta?.creative_id ?? "—"}/><Detail label="Meta ad ID" value={creative.meta_ad_id}/></>}</div></section></Modal>; }
function Detail({ label, value }: {
    label: string;
    value: string;
}) { return <div className="rounded-lg border border-border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium text-foreground">{value}</p></div>; }
function normalizedStatus(value?: string | null) { return value === "ACTIVE" ? "Active" : value === "IN_PROCESS" || value === "PENDING_REVIEW" ? "Learning" : "Paused"; }
function metric(creative: IncentiveCreative, meta: MetaAd | undefined, sort: string) { const spend = meta?.spend ?? creative.latest_spend; const purchases = meta?.purchases ?? creative.latest_purchases; const revenue = meta?.revenue ?? 0; return sort === "purchases" ? purchases : sort === "cpa" ? (purchases ? -spend / purchases : -Infinity) : sort === "roas" ? (spend ? revenue / spend : 0) : sort === "revenue" ? revenue : spend; }
function money(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0); }
function number(value: number) { return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value || 0); }
