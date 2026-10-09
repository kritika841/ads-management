"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CalendarClock, Check, ChevronsUpDown, Download, ExternalLink, Eye, Filter, FolderKanban, Grid2X2, ListFilter, Loader2, Maximize2, Pause, Play, Plus, RotateCcw, Search, Square, SquareCheck, Table2, Tags, UserCheck, Video, Volume2, VolumeX, X } from "lucide-react";
import { bulkAddTags, bulkAssignCampaign, bulkSetDownloadedBadge, bulkSetEditorAssignment, dismissDownloadedBadge, reviewAd } from "@/app/actions/ads";
import { BulkEditorAssignmentModal, type BulkEditorAssignmentRequest } from "@/components/dashboard/bulk-editor-assignment-modal";
import { AdPreviewModal } from "@/components/dashboard/ad-preview-modal";
import { MultiSelectFilter } from "@/components/dashboard/multi-select-filter";
import { BulkAssignCampaignModal } from "@/components/dashboard/bulk-assign-campaign-modal";
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
import { downloadProgressLabel, downloadWithProgress, type DownloadProgress } from "@/lib/client-download";
import type { ExportJobSnapshot } from "@/lib/export-job-types";
import { canBulkAddToCampaign, canDeleteAd } from "@/lib/permissions";
import { creatorCapableProfiles, isCreatorCapableRole } from "@/lib/creators";
import { clearSavedDashboardFilters, emptyDashboardFilters, loadSavedDashboardFilters, readDashboardFilters, saveDashboardFilters, writeDashboardFilters, type DashboardFilterState, type DashboardView } from "@/lib/dashboard-filter-state";
import { getSavedLibraryTabLocal, LIBRARY_QUEUE_COOKIE, LIBRARY_REVIEW_TAB_COOKIE, parseLibraryReviewTab, rememberLibraryTab, type LibraryReviewTab } from "@/lib/library-tab-state";
import { canToggleEditingFreeze, creatorEditableStages, getProductionStageLabel, isCreativeCreationBlocked, isFinalMediaVisible, productionStageLabels, productionStages, workflowStageAgeLabel } from "@/lib/production-workflow";
import { EditingFreezeBadge, FreezeEditingToggle } from "@/components/workflow/freeze-editing-toggle";
import type { AdStatus, AdWithRelations, AppSettings, Campaign, EditingFreezeState, Product, Profile, ProductionStage } from "@/lib/types";
import { cn, dateOnlyDaysFromToday, formatDateOnly } from "@/lib/utils";
import { matchesQueue, queueForRole, queuesForRole, type QueueKey } from "@/lib/work-queues";

const gridPageSize = 18;

function isDownloaded(ad: AdWithRelations) {
  return ad.tags.some((tag) => tag.name.toLowerCase() === "downloaded");
}

export function DashboardClient({
  profile,
  ads: adsProp,
  campaigns,
  products,
  profiles,
  availableTags,
  editorWorkloads,
  initialQueue,
  initialReviewTab = "all",
  initialFilters,
  mediaTokens,
  allowManagerFinalApproval = true,
  settings
}: {
  profile: Profile;
  ads: AdWithRelations[];
  campaigns: Campaign[];
  products: Product[];
  profiles: Profile[];
  availableTags: string[];
  editorWorkloads: Record<string, number>;
  initialQueue: QueueKey;
  initialReviewTab?: LibraryReviewTab;
  initialFilters?: DashboardFilterState;
  mediaTokens: Record<string, string>;
  allowManagerFinalApproval?: boolean;
  settings?: AppSettings;
}) {
  const router = useRouter();
  const { toast } = useToast();
  // Freeze toggles apply immediately; the server page keeps a short in-memory cache, so a
  // refresh within that window could otherwise briefly show the previous state.
  const [freezeOverrides, setFreezeOverrides] = useState<Record<string, EditingFreezeState>>({});
  const [stageOverrides, setStageOverrides] = useState<Record<string, ProductionStage>>({});
  // Deleted creatives disappear immediately and stay hidden even if a refresh briefly returns
  // the pre-delete snapshot, so the grid never re-flows twice.
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const ads = useMemo(() => {
    const visible = removedIds.size ? adsProp.filter((item) => !removedIds.has(item.id)) : adsProp;
    if (!Object.keys(freezeOverrides).length && !Object.keys(stageOverrides).length) {
      return visible;
    }
    return visible.map((item) => {
      let updated = item;
      if (freezeOverrides[item.id]) {
        updated = { ...updated, editing_freeze: freezeOverrides[item.id] };
      }
      if (stageOverrides[item.id]) {
        updated = { ...updated, production_stage: stageOverrides[item.id] };
      }
      return updated;
    });
  }, [adsProp, freezeOverrides, stageOverrides, removedIds]);
  const handleFreezeChange = (adId: string, state: EditingFreezeState, stage?: ProductionStage) => {
    setFreezeOverrides((current) => ({ ...current, [adId]: state }));
    if (stage) {
      setStageOverrides((current) => ({ ...current, [adId]: stage }));
    }
  };
  const handleDeleted = (adId: string) => {
    setRemovedIds((current) => new Set(current).add(adId));
    setSelectedIds((current) => { if (!current.has(adId)) return current; const next = new Set(current); next.delete(adId); return next; });
    setPlayingAdIds((current) => { if (!current.has(adId)) return current; const next = new Set(current); next.delete(adId); return next; });
  };
  const queueOptions = useMemo(() => queuesForRole(profile.role), [profile.role]);
  const [queue, setQueue] = useState<QueueKey>(() => {
    if (typeof window !== "undefined") {
      const urlQueue = new URLSearchParams(window.location.search).get("queue");
      if (urlQueue) {
        const validated = queueForRole(profile.role, urlQueue);
        if (validated) return validated;
      }
      const local = getSavedLibraryTabLocal(LIBRARY_QUEUE_COOKIE);
      if (local) {
        const validated = queueForRole(profile.role, local);
        if (validated) return validated;
      }
    }
    return queueForRole(profile.role, initialQueue) ?? queuesForRole(profile.role)[0].key;
  });
  const [reviewSubTab, setReviewSubTab] = useState<LibraryReviewTab>(() => {
    if (typeof window !== "undefined") {
      const urlReview = new URLSearchParams(window.location.search).get("review");
      if (urlReview) {
        const validated = parseLibraryReviewTab(urlReview);
        if (validated) return validated;
      }
      const local = getSavedLibraryTabLocal(LIBRARY_REVIEW_TAB_COOKIE);
      if (local) {
        const validated = parseLibraryReviewTab(local);
        if (validated) return validated;
      }
    }
    return initialReviewTab;
  });
  const canApprove = profile.role === "admin" || profile.role === "manager";
  const canViewDownloadState = profile.role === "admin";
  const [query, setQuery] = useState(initialFilters?.q ?? "");
  // Every list filter holds an array (empty = no filter), exactly like the Tags filter.
  const [stage, setStage] = useState<string[]>(initialFilters?.stage ?? []);
  const [editor, setEditor] = useState<string[]>(initialFilters?.editor ?? []);
  const [creator, setCreator] = useState<string[]>(initialFilters?.creator ?? []);
  const [campaign, setCampaign] = useState<string[]>(initialFilters?.campaign ?? []);
  const [product, setProduct] = useState<string[]>(initialFilters?.product ?? []);
  const [platform, setPlatform] = useState<string[]>(initialFilters?.platform ?? []);
  const [tag, setTag] = useState<string[]>(initialFilters?.tag ?? []);
  const [download, setDownload] = useState<string[]>(canViewDownloadState ? (initialFilters?.download ?? []) : []);
  const [deadline, setDeadline] = useState<string[]>(initialFilters?.deadline ?? []);
  const [sort, setSort] = useState(initialFilters?.sort ?? "all");
  const [dateFrom, setDateFrom] = useState(initialFilters?.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(initialFilters?.dateTo ?? "");
  const [view, setView] = useState<DashboardView>(initialFilters?.view ?? "grid");
  const [urlInitialized, setUrlInitialized] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAd, setEditingAd] = useState<AdWithRelations | null>(null);
  const [previewAd, setPreviewAd] = useState<AdWithRelations | null>(null);
  const [playingAdIds, setPlayingAdIds] = useState<Set<string>>(new Set());
  const [cancelAd, setCancelAd] = useState<AdWithRelations | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelTarget, setCancelTarget] = useState<"creator" | "editor" | "">("");
  const [actingAdId, setActingAdId] = useState<string | null>(null);
  const [visibleGridCount, setVisibleGridCount] = useState(gridPageSize);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDownloading, setIsDownloading] = useState(false);
  const [bulkDownloadProgress, setBulkDownloadProgress] = useState<DownloadProgress | null>(null);
  const [bulkExportJob, setBulkExportJob] = useState<ExportJobSnapshot | null>(null);
  const [bulkDownloadComplete, setBulkDownloadComplete] = useState(false);
  const [bulkDownloadCount, setBulkDownloadCount] = useState(0);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgress>>({});
  const [bulkTagModalOpen, setBulkTagModalOpen] = useState(false);
  const [isBulkTagging, setIsBulkTagging] = useState(false);
  const [bulkCampaignModalOpen, setBulkCampaignModalOpen] = useState(false);
  const [isBulkAssigningCampaign, setIsBulkAssigningCampaign] = useState(false);
  const canBulkCampaign = canBulkAddToCampaign(profile.role, settings);
  const [isBulkUpdatingDownloaded, setIsBulkUpdatingDownloaded] = useState(false);
  const [bulkEditorModalOpen, setBulkEditorModalOpen] = useState(false);
  const [isBulkAssigningEditor, setIsBulkAssigningEditor] = useState(false);
  const [isPending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const editors = profiles.filter((item) => item.role === "editor" && item.active);
  // Admins and managers can author creatives too, so they appear alongside content creators.
  const creators = creatorCapableProfiles(profiles).filter((item) => item.active);
  const ordinaryAvailableTags = availableTags.filter((item) => item.toLowerCase() !== "downloaded");
  const canCreate = profile.role === "content_creator" || profile.role === "admin" || profile.role === "manager";
  const createBlocked = isCreativeCreationBlocked({ role: profile.role, userId: profile.id, ads });

  function handleCreateClick() {
    if (createBlocked) {
      toast({ title: "Cannot add creative", description: "You must resolve requested changes on your creatives before creating a new creative.", tone: "info" });
      return;
    }

    openCreatorForm();
  }

  useEffect(() => {
    const savedView = window.localStorage.getItem("adflow-dashboard-view");
    const urlParams = new URLSearchParams(window.location.search);
    const hasUrlFilters = Array.from(urlParams.keys()).some(
      (key) => key !== "queue" && key !== "review"
    );

    let state = readDashboardFilters(window.location.search, savedView);

    if (!hasUrlFilters) {
      const savedFilters = loadSavedDashboardFilters();
      if (savedFilters) {
        state = {
          ...emptyDashboardFilters,
          ...savedFilters,
          view: (savedFilters.view ?? savedView ?? "grid") as DashboardView
        };
      }
    }

    const urlQueue = urlParams.get("queue");
    if (!urlQueue) {
      const savedQueue = getSavedLibraryTabLocal(LIBRARY_QUEUE_COOKIE);
      const validQueue = queueForRole(profile.role, savedQueue);
      if (validQueue && validQueue !== queue) {
        setQueue(validQueue);
      }
    }

    setQuery(state.q ?? "");
    setStage(state.stage ?? []);
    setEditor(state.editor ?? []);
    setCreator(state.creator ?? []);
    setCampaign(state.campaign ?? []);
    setProduct(state.product ?? []);
    setPlatform(state.platform ?? []);
    setTag((state.tag ?? []).filter((item) => item.toLowerCase() !== "downloaded"));
    setDownload(canViewDownloadState ? (state.download ?? []) : []);
    setDeadline(state.deadline ?? []);
    setSort(state.sort ?? "all");
    setDateFrom(state.dateFrom ?? "");
    setDateTo(state.dateTo ?? "");
    if (state.view) setView(state.view);

    setUrlInitialized(true);
  }, [canViewDownloadState, profile.role]);

  useEffect(() => {
    if (!urlInitialized) return;
    window.localStorage.setItem("adflow-dashboard-view", view);
  }, [urlInitialized, view]);

  useEffect(() => {
    if (!urlInitialized) return;
    const currentState: DashboardFilterState = {
      q: query,
      stage,
      editor,
      creator,
      campaign,
      product,
      platform,
      tag,
      download,
      deadline,
      sort,
      dateFrom,
      dateTo,
      view
    };

    const url = new URL(window.location.href);
    url.searchParams.set("queue", queue);
    if (queue === "needs_review" || queue === "creator_review" || queue === "final_review") {
      if (reviewSubTab !== "all") {
        url.searchParams.set("review", reviewSubTab);
      } else {
        url.searchParams.delete("review");
      }
    } else {
      url.searchParams.delete("review");
    }

    writeDashboardFilters(url, currentState);
    window.history.replaceState(null, "", url);

    saveDashboardFilters(currentState);
    rememberLibraryTab(LIBRARY_QUEUE_COOKIE, queue);
    rememberLibraryTab(LIBRARY_REVIEW_TAB_COOKIE, reviewSubTab);
  }, [campaign, creator, dateFrom, dateTo, deadline, download, editor, platform, product, query, queue, reviewSubTab, sort, stage, tag, urlInitialized, view]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key === "/" && !target?.isContentEditable && target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === "Escape" && !isPending) { setFormOpen(false); setEditingAd(null); setPreviewAd(null); setCancelAd(null); setCancelTarget(""); }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [isPending]);

  const isReviewQueue = queue === "needs_review" || queue === "creator_review" || queue === "final_review";

  // Pre-filter ads by all active user filters (search query, tags, creators, products, etc.)
  // so that tab counts throughout the top bar reflect the matching count for each status queue.
  const adsMatchingFilters = useMemo(() => {
    const text = query.trim().toLowerCase();
    return ads.filter((ad) => {
      if (stage.length > 0 && !stage.includes(ad.production_stage)) return false;
      if (editor.length > 0 && (ad.editor_id === null || !editor.includes(ad.editor_id))) return false;
      if (creator.length > 0 && (ad.creator_id === null || !creator.includes(ad.creator_id))) return false;
      if (campaign.length > 0 && (ad.campaign_id === null || !campaign.includes(ad.campaign_id))) return false;
      if (product.length > 0 && (ad.product_id === null || !product.includes(ad.product_id))) return false;
      if (platform.length > 0 && !platform.some((selected) => ad.platforms.includes(selected as AdWithRelations["platforms"][number]))) return false;
      if (tag.length > 0 && !tag.some((selectedTag) => ad.tags.some((item) => item.name === selectedTag))) return false;
      if (canViewDownloadState && download.length === 1) {
        if (download[0] === "downloaded" && !isDownloaded(ad)) return false;
        if (download[0] === "not_downloaded" && isDownloaded(ad)) return false;
      }
      if (deadline.length > 0) {
        if (!ad.deadline || ad.status === "approved" || ad.status === "published") return false;
        const days = dateOnlyDaysFromToday(ad.deadline);
        const matchesDeadline = deadline.some((selected) => {
          if (selected === "overdue") return days < 0;
          if (selected === "today") return days === 0;
          return days >= 0 && days <= 3;
        });
        if (!matchesDeadline) return false;
      }
      if (text) {
        const searchable = `${ad.name} ${ad.script_text ?? ""} ${ad.creator?.name ?? ""} ${ad.editor?.name ?? ""} ${ad.campaign?.name ?? ""} ${ad.product?.name ?? ""} ${ad.tags.map((item) => item.name).join(" ")}`.toLowerCase();
        if (!searchable.includes(text)) return false;
      }
      if (dateFrom || dateTo) {
        const adDate = ad.created_at.slice(0, 10);
        if (dateFrom && adDate < dateFrom) return false;
        if (dateTo && adDate > dateTo) return false;
      }
      return true;
    });
  }, [ads, campaign, canViewDownloadState, creator, dateFrom, dateTo, deadline, download, editor, platform, product, query, stage, tag]);

  const queueCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const option of queueOptions) {
      counts[option.key] = adsMatchingFilters.filter((ad) => matchesQueue(ad, option.key)).length;
    }
    return counts;
  }, [adsMatchingFilters]);

  const reviewCounts = useMemo(() => {
    const inReviewAds = adsMatchingFilters.filter((ad) => matchesQueue(ad, "needs_review"));
    return {
      all: inReviewAds.length,
      new: inReviewAds.filter((ad) => ad.review_submission_type === "new").length,
      editor: inReviewAds.filter((ad) => ad.review_submission_type === "editor_resubmission").length,
      creator: inReviewAds.filter((ad) => ad.review_submission_type === "creator_resubmission").length
    };
  }, [adsMatchingFilters]);

  const filteredAds = useMemo(() => {
    const filtered = adsMatchingFilters
      .filter((ad) => matchesQueue(ad, queue))
      .filter((ad) => {
        if (!isReviewQueue || reviewSubTab === "all") return true;
        if (reviewSubTab === "new") return ad.review_submission_type === "new";
        if (reviewSubTab === "editor") return ad.review_submission_type === "editor_resubmission";
        if (reviewSubTab === "creator") return ad.review_submission_type === "creator_resubmission";
        return true;
      });
    return filtered.sort((a, b) => {
      if (sort === "deadline") return (a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31");
      if (sort === "waiting") return a.workflow_status_changed_at.localeCompare(b.workflow_status_changed_at);
      if (sort === "oldest") return a.created_at.localeCompare(b.created_at);
      return b.updated_at.localeCompare(a.updated_at);
    }).map((ad) => canViewDownloadState ? ad : ({ ...ad, tags: ad.tags.filter((tag) => tag.name.toLowerCase() !== "downloaded") }));
  }, [adsMatchingFilters, canViewDownloadState, isReviewQueue, queue, reviewSubTab, sort]);

  const filtersActive = sort !== "all" || [stage, editor, creator, campaign, product, platform, tag, download, deadline].some((value) => value.length > 0) || !!dateFrom || !!dateTo;
  const gridFilterKey = [queue, query, ...stage, "|", ...editor, "|", ...creator, "|", ...campaign, "|", ...product, "|", ...platform, "|", ...tag, "|", ...download, "|", ...deadline, sort, reviewSubTab].join("|");
  const visibleGridAds = filteredAds.slice(0, visibleGridCount);
  const hasMoreGridAds = view === "grid" && visibleGridCount < filteredAds.length;

  useEffect(() => {
    setVisibleGridCount(gridPageSize);
    setPlayingAdIds(new Set());
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
    // Warm only the first couple of cards, off the critical path, so the rest of the page keeps its bandwidth.
    const candidates = visibleGridAds.filter((ad) => ad.drive_file_id && mediaTokens[ad.id]).slice(0, 2);
    if (!candidates.length) return;
    const warm = () => {
      void Promise.allSettled(candidates.map((ad) => fetch(mediaUrl(ad, mediaTokens[ad.id], true))));
    };
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void });
    if (idle.requestIdleCallback) {
      const id = idle.requestIdleCallback(warm, { timeout: 2000 });
      return () => idle.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(warm, 800);
    return () => window.clearTimeout(timer);
  }, [mediaTokens, view, visibleGridAds]);

  const activeFilters = useMemo(() => {
    const labelFor = (items: { id: string; name: string }[], values: string[]) => values.map((value) => items.find((item) => item.id === value)?.name ?? value).join(", ");
    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (stage.length > 0) chips.push({ key: "stage", label: `Status: ${stage.map((value) => productionStageLabels[value as keyof typeof productionStageLabels] ?? value).join(", ")}`, clear: () => setStage([]) });
    if (editor.length > 0) chips.push({ key: "editor", label: `Editor: ${labelFor(editors, editor)}`, clear: () => setEditor([]) });
    if (creator.length > 0) chips.push({ key: "creator", label: `Creator: ${labelFor(creators, creator)}`, clear: () => setCreator([]) });
    if (campaign.length > 0) chips.push({ key: "campaign", label: `Campaign: ${labelFor(campaigns, campaign)}`, clear: () => setCampaign([]) });
    if (product.length > 0) chips.push({ key: "product", label: `Product: ${labelFor(products, product)}`, clear: () => setProduct([]) });
    if (platform.length > 0) chips.push({ key: "platform", label: `Platform: ${platform.join(", ")}`, clear: () => setPlatform([]) });
    if (tag.length > 0) chips.push({ key: "tag", label: `Tags: ${tag.map((item) => `#${item}`).join(", ")}`, clear: () => setTag([]) });
    if (download.length > 0) chips.push({ key: "download", label: download.map((value) => value === "downloaded" ? "Downloaded" : "Yet to download").join(", "), clear: () => setDownload([]) });
    if (deadline.length > 0) chips.push({ key: "deadline", label: `Deadline: ${deadline.map((value) => value === "soon" ? "Due in 3 days" : value === "today" ? "Due today" : "Overdue").join(", ")}`, clear: () => setDeadline([]) });
    if (sort !== "all") chips.push({ key: "sort", label: `Sort: ${sort === "deadline" ? "Deadline first" : sort === "waiting" ? "Waiting longest" : "Oldest created"}`, clear: () => setSort("all") });
    if (dateFrom) chips.push({ key: "dateFrom", label: `From: ${dateFrom}`, clear: () => setDateFrom("") });
    if (dateTo) chips.push({ key: "dateTo", label: `To: ${dateTo}`, clear: () => setDateTo("") });
    return chips;
  }, [campaign, campaigns, creator, creators, dateFrom, dateTo, deadline, download, editor, editors, platform, product, products, sort, stage, tag]);

  function clearFilters(clearSearch = false) {
    setStage([]); setEditor([]); setCreator([]); setCampaign([]); setProduct([]);
    setPlatform([]); setTag([]); setDownload([]); setDeadline([]); setSort("all"); setDateFrom(""); setDateTo("");
    if (clearSearch) setQuery("");
    clearSavedDashboardFilters();
  }

  function openCreatorForm(ad?: AdWithRelations) {
    const isReviewer = profile.role === "admin" || profile.role === "manager";
    if (ad && !creatorEditableStages.includes(ad.production_stage as (typeof creatorEditableStages)[number])) {
      if (isReviewer) {
        // Admin/manager: always open the edit form in override mode
        setEditingAd(ad);
        setFormOpen(true);
      } else {
        router.push(`/ads/${ad.id}`);
      }
      return;
    }
    setEditingAd(ad ?? null); setFormOpen(true);
  }

  function selectReviewSubTab(next: LibraryReviewTab) {
    setReviewSubTab(next);
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("review");
    else url.searchParams.set("review", next);
    window.history.replaceState(null, "", url);
    rememberLibraryTab(LIBRARY_REVIEW_TAB_COOKIE, next);
  }

  function selectQueue(nextQueue: QueueKey) {
    setQueue(nextQueue);
    const url = new URL(window.location.href);
    url.searchParams.set("queue", nextQueue);
    if (nextQueue !== "needs_review" && nextQueue !== "creator_review" && nextQueue !== "final_review") {
      setReviewSubTab("all");
      url.searchParams.delete("review");
      rememberLibraryTab(LIBRARY_REVIEW_TAB_COOKIE, "all");
    }
    window.history.replaceState(null, "", url);
    rememberLibraryTab(LIBRARY_QUEUE_COOKIE, nextQueue);
  }

  function decide(ad: AdWithRelations, decision: "approve" | "request_changes", note = "") {
    if (decision === "approve") {
      setActingAdId(ad.id);
      const isIntermediate = !allowManagerFinalApproval && profile.role === "manager";
      toast({
        title: "Approved",
        description: isIntermediate
          ? `${ad.name} will be approved and sent to Admin in 5 seconds.`
          : `${ad.name} will be approved in 5 seconds.`,
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
      const target = cancelTarget || undefined;
      const response = await runServerAction(() => reviewAd(ad.id, decision, note, target));
      if (!response.ok) {
        toast({ title: "Review not saved", description: response.message ?? "Unable to save review.", tone: "error" });
      } else {
        const resolvedTarget = target ?? "editor";
        const isIntermediate = decision === "approve" && profile.role === "manager" && !allowManagerFinalApproval;
        const isReopen = decision === "request_changes" && ad.production_stage === "approved";
        toast({
          title: decision === "approve" ? `${ad.name} approved` : isReopen ? "Creative reopened" : "Changes requested",
          description: decision === "approve"
            ? (isIntermediate ? "Forwarded to Administrator for final approval." : "The creative is now approved.")
            : resolvedTarget === "creator"
              ? `${ad.name} was returned to the creator.`
              : `${ad.name} was returned to the editor.`,
          tone: "success"
        });
        setCancelAd(null); setCancelReason(""); setCancelTarget(""); router.refresh();
      }
      setActingAdId(null);
    });
  }


  function assign(ad: AdWithRelations, editorId: string, deadline: string) {
    setActingAdId(ad.id);
    startTransition(async () => {
      // Same server path as bulk assignment: assigns when the creative is waiting for an editor,
      // reassigns (stopping the previous editor's timer) when one is already assigned.
      const response = await runServerAction(() => bulkSetEditorAssignment({ adIds: [ad.id], mode: "assign", editorId, deadline }));
      const result = response.results?.[0];
      if (!response.ok || !result?.ok) toast({ title: "Assignment not saved", description: result?.message ?? response.message ?? "Unable to assign editor.", tone: "error" });
      else { toast({ title: result.kind === "reassign" ? "Editor reassigned" : "Editor assigned", description: `${ad.name} is ready for editing.`, tone: "success" }); router.refresh(); }
      setActingAdId(null);
    });
  }

  async function submitBulkEditor(request: BulkEditorAssignmentRequest) {
    if (!selectedIds.size || isBulkAssigningEditor) return;
    setIsBulkAssigningEditor(true);
    try {
      const response = await runServerAction(() => bulkSetEditorAssignment({ adIds: Array.from(selectedIds), ...request }));
      const failures = (response.results ?? []).filter((item) => !item.ok && item.kind !== "skip");
      if (!response.ok) {
        toast({ title: "Editor assignment not saved", description: failures[0]?.message ?? response.message ?? "Try again.", tone: "error" });
        return;
      }
      toast({
        title: request.mode === "unassign" ? "Editors removed" : "Editor assignment updated",
        description: failures.length ? `${response.message}. First error: ${failures[0].name} — ${failures[0].message}` : response.message,
        tone: failures.length ? "info" : "success"
      });
      setSelectedIds(new Set());
      setBulkEditorModalOpen(false);
      router.refresh();
    } finally {
      setIsBulkAssigningEditor(false);
    }
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

  function playVideo(ad: AdWithRelations) {
    if (playingAdIds.has(ad.id)) return;
    // No cap: any number of cards can buffer and play at the same time. Each player releases its
    // own connection when it is stopped or scrolled out by a filter change.
    setPlayingAdIds((current) => {
      if (current.has(ad.id)) return current;
      const next = new Set(current);
      next.add(ad.id);
      return next;
    });
  }

  function stopVideo(id: string) {
    setPlayingAdIds((current) => {
      const next = new Set(current);
      next.delete(id);
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
    const selectedCount = selectedIds.size;
    setIsDownloading(true);
    setBulkDownloadCount(selectedCount);
    setBulkDownloadProgress(null);
    setBulkExportJob(null);
    setBulkDownloadComplete(false);
    const filename = `creatives-${new Date().toISOString().slice(0, 10)}.zip`;
    try {
      const created = await fetch("/api/ads/export-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          source: "creative_library",
          title: `Creative Library (${selectedCount} creatives)`,
        }),
      });
      if (!created.ok) throw new Error(await created.text());
      let job = await created.json() as ExportJobSnapshot;
      setBulkExportJob(job);
      while (job.phase === "preparing" || job.phase === "building") {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const response = await fetch(`/api/ads/export-jobs/${job.id}`, { cache: "no-store" });
        if (!response.ok) throw new Error(await response.text());
        job = await response.json() as ExportJobSnapshot;
        setBulkExportJob(job);
      }
      if (job.phase !== "ready") throw new Error(job.error || "The ZIP could not be prepared.");
      // A save-file picker is only permitted while the original click is still
      // active. ZIP preparation is asynchronous, so opening one here can hang
      // indefinitely. Fetch and save the completed archive directly instead.
      await downloadWithProgress(`/api/ads/export-jobs/${job.id}/download`, filename, setBulkDownloadProgress);
      try { await markDownloaded(job.files.filter((file) => file.state === "included" && file.adId).map((file) => file.adId!)); }
      catch (cause) { toast({ title: "ZIP downloaded", description: cause instanceof Error ? cause.message : "The Downloaded tag could not be saved.", tone: "error" }); }
      setBulkDownloadComplete(true);
      const included = job.files.filter((file) => file.state === "included").length;
      toast({ title: `${included} video${included === 1 ? "" : "s"} downloaded`, tone: "success" });
    } catch (cause) {
      toast({ title: "Download failed", description: cause instanceof Error ? cause.message : "Network error — please try again.", tone: "error" });
    } finally {
      setIsDownloading(false);
    }
  }

  async function downloadOne(ad: AdWithRelations) {
    if (downloadingIds.has(ad.id)) return;
    setDownloadingIds((current) => new Set(current).add(ad.id));
    setDownloadProgress((current) => ({ ...current, [ad.id]: { receivedBytes: 0, totalBytes: null, percent: null, etaSeconds: null } }));
    try {
      await downloadWithProgress(`/api/ads/${ad.id}/download`, `${ad.name}.mp4`, (progress) => setDownloadProgress((current) => ({ ...current, [ad.id]: progress })));
      try { await markDownloaded([ad.id]); }
      catch (cause) { toast({ title: `${ad.name} downloaded`, description: cause instanceof Error ? cause.message : "The Downloaded tag could not be saved.", tone: "error" }); }
      toast({ title: `${ad.name} downloaded`, tone: "success" });
    } catch {
      toast({ title: "Download failed", description: "Network error — please try again.", tone: "error" });
    } finally {
      setDownloadingIds((current) => { const next = new Set(current); next.delete(ad.id); return next; });
      window.setTimeout(() => setDownloadProgress((current) => { const next = { ...current }; delete next[ad.id]; return next; }), 1200);
    }
  }

  async function markDownloaded(adIds: string[]) {
    const response = await fetch("/api/ads/mark-downloaded", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: adIds }),
    });
    if (!response.ok) throw new Error(`The file downloaded, but its Downloaded tag could not be saved: ${await response.text()}`);
    router.refresh();
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

  async function submitBulkCampaign(campaignId: string) {
    if (!selectedIds.size || isBulkAssigningCampaign) return;
    setIsBulkAssigningCampaign(true);
    try {
      const response = await runServerAction(() => bulkAssignCampaign(Array.from(selectedIds), campaignId));
      if (!response.ok) {
        toast({ title: "Could not assign campaign", description: response.message ?? "Try again.", tone: "error" });
        return;
      }
      toast({
        title: "Creatives assigned to campaign",
        description: response.message ?? `Assigned ${response.count} creative(s) to campaign.`,
        tone: "success"
      });
      setSelectedIds(new Set());
      setBulkCampaignModalOpen(false);
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setIsBulkAssigningCampaign(false);
    }
  }

  async function updateDownloadedSelection(downloaded: boolean) {
    if (profile.role !== "admin" || !selectedIds.size || isBulkUpdatingDownloaded) return;
    setIsBulkUpdatingDownloaded(true);
    try {
      const response = await runServerAction(() => bulkSetDownloadedBadge(Array.from(selectedIds), downloaded));
      if (!response.ok) {
        toast({ title: "Could not update downloaded badges", description: response.message ?? "Try again.", tone: "error" });
        return;
      }
      toast({
        title: downloaded
          ? `Marked ${response.count} creative${response.count === 1 ? "" : "s"} as downloaded`
          : `Removed downloaded badge from ${response.count} creative${response.count === 1 ? "" : "s"}`,
        tone: "success"
      });
      router.refresh();
    } finally {
      setIsBulkUpdatingDownloaded(false);
    }
  }

  return <main className="page-container">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-2xl font-semibold text-foreground">Creative library</h1><p className="mt-1 text-sm text-muted-foreground">Your work, organized by what needs attention next.</p></div>{canCreate ? <Button onClick={handleCreateClick} disabled={createBlocked} title={createBlocked ? "Resolve requested changes before creating another creative." : undefined}><Plus className="size-4" aria-hidden />Add creative</Button> : null}</div>

    {createBlocked ? (
      <div className="mt-4 flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3.5 text-sm text-foreground">
        <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden />
        <div className="flex-1">
          <span className="font-semibold text-warning">Action required: </span>
          You have creatives with requested changes that must be resolved before you can add new creatives.
        </div>
      </div>
    ) : null}

    <div className="mt-6 overflow-x-auto pb-1"><div className="inline-flex min-w-max rounded-md border border-border bg-card p-1 shadow-sm">{queueOptions.map((option) => <button key={option.key} className={cn("flex h-9 items-center gap-2 rounded px-3 text-sm font-medium transition", queue === option.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")} onClick={() => selectQueue(option.key)}>{option.label}<span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", queue === option.key ? "bg-primary-foreground/15" : "bg-muted text-muted-foreground")}>{queueCounts[option.key] ?? 0}</span></button>)}</div></div>

    {isReviewQueue ? (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-1 shadow-sm">
          <button
            type="button"
            onClick={() => selectReviewSubTab("all")}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition",
              reviewSubTab === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            )}
          >
            All in review
            <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", reviewSubTab === "all" ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground")}>
              {reviewCounts.all}
            </span>
          </button>
          <button
            type="button"
            onClick={() => selectReviewSubTab("new")}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition",
              reviewSubTab === "new" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            )}
          >
            New submissions
            <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", reviewSubTab === "new" ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground")}>
              {reviewCounts.new}
            </span>
          </button>
          <button
            type="button"
            onClick={() => selectReviewSubTab("editor")}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition",
              reviewSubTab === "editor" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            )}
          >
            Editor review
            <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", reviewSubTab === "editor" ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground")}>
              {reviewCounts.editor}
            </span>
          </button>
          <button
            type="button"
            onClick={() => selectReviewSubTab("creator")}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition",
              reviewSubTab === "creator" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            )}
          >
            Creator review
            <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", reviewSubTab === "creator" ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground")}>
              {reviewCounts.creator}
            </span>
          </button>
        </div>
      </div>
    ) : null}



    <section className="panel mt-4 p-3">
      <div className="flex flex-col gap-2 lg:flex-row"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input ref={searchRef} className="pl-9 pr-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ads, scripts, people, products, or tags" /><kbd className="pointer-events-none absolute right-2 top-1/2 hidden h-6 min-w-6 -translate-y-1/2 items-center justify-center rounded border border-border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground sm:inline-flex">/</kbd></div><Button variant={filtersOpen || filtersActive ? "primary" : "secondary"} onClick={() => setFiltersOpen((current) => !current)}><Filter className="size-4" aria-hidden />Filters{filtersActive ? <span className="size-1.5 rounded-full bg-current" /> : null}</Button><div className="flex rounded-lg border border-border bg-muted p-1"><Button size="icon" variant={view === "grid" ? "secondary" : "ghost"} className="size-8" title="Grid view" onClick={() => setView("grid")}><Grid2X2 className="size-4" aria-hidden /></Button><Button size="icon" variant={view === "table" ? "secondary" : "ghost"} className="size-8" title="Table view" onClick={() => setView("table")}><Table2 className="size-4" aria-hidden /></Button></div></div>
      {activeFilters.length || query ? <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">{query ? <FilterChip label={`Search: ${query}`} onRemove={() => setQuery("")} /> : null}{activeFilters.map((filter) => <FilterChip key={filter.key} label={filter.label} onRemove={filter.clear} />)}<button type="button" className="h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => clearFilters(true)}>Clear all</button></div> : null}
      {filtersOpen ? <div className="mt-3 border-t border-border pt-3"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><MultiSelectFilter label="Status" values={stage} onChange={setStage} options={productionStages.map((item) => ({ value: item, label: productionStageLabels[item] }))} />{profile.role === "admin" || profile.role === "manager" ? <><MultiSelectFilter label="Editor" values={editor} onChange={setEditor} options={editors.map((item) => ({ value: item.id, label: item.name }))} /><MultiSelectFilter label="Creator" values={creator} onChange={setCreator} options={creators.map((item) => ({ value: item.id, label: item.name }))} /></> : null}<MultiSelectFilter label="Campaign" values={campaign} onChange={setCampaign} options={campaigns.map((item) => ({ value: item.id, label: item.name }))} /><MultiSelectFilter label="Product" values={product} onChange={setProduct} options={products.map((item) => ({ value: item.id, label: item.name }))} /><MultiSelectFilter label="Platform" values={platform} onChange={setPlatform} options={platforms.map((item) => ({ value: item, label: item }))} /><MultiSelectFilter label="Tag" values={tag} onChange={setTag} optionPrefix="#" allLabel="All tags" options={ordinaryAvailableTags.map((item) => ({ value: item, label: item }))} />{profile.role === "admin" ? <MultiSelectFilter label="Download" values={download} onChange={setDownload} options={[{ value: "downloaded", label: "Downloaded" }, { value: "not_downloaded", label: "Yet to download" }]} /> : null}<MultiSelectFilter label="Deadline" values={deadline} onChange={setDeadline} options={[{ value: "overdue", label: "Overdue" }, { value: "today", label: "Due today" }, { value: "soon", label: "Due in 3 days" }]} /><FilterSelect label="Sort" value={sort} onChange={setSort} options={[{ value: "deadline", label: "Deadline first" }, { value: "waiting", label: "Waiting longest" }, { value: "oldest", label: "Oldest created" }]} /><div><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Created from</span><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground transition-[border-color,box-shadow,background-color] duration-150 hover:border-ring/50 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" /></label></div><div><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Created to</span><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground transition-[border-color,box-shadow,background-color] duration-150 hover:border-ring/50 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" /></label></div></div></div> : null}
    </section>

    <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
      <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{filteredAds.length}</span> items{view === "grid" && filteredAds.length > gridPageSize ? <span> · showing {visibleGridAds.length}</span> : null}</p>
      <div className="flex items-center gap-2">
        {selectedIds.size > 0 ? (
          <>
            <span className="text-sm font-medium text-foreground">{selectedIds.size} selected</span>
            <Button size="sm" variant="secondary" onClick={selectAll}>Select all {filteredAds.length}</Button>
            <Button size="sm" variant="secondary" onClick={clearSelection}>Clear</Button>
            {canBulkCampaign ? (
              <Button size="sm" variant="secondary" onClick={() => setBulkCampaignModalOpen(true)}>
                <FolderKanban className="size-3.5" aria-hidden />
                Add to campaign
              </Button>
            ) : null}
            {canApprove ? (
              <Button id="bulk-editor-assignment" size="sm" variant="secondary" onClick={() => setBulkEditorModalOpen(true)}>
                <UserCheck className="size-3.5" aria-hidden />
                Assign editor
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => setBulkTagModalOpen(true)}>
              <Tags className="size-3.5" aria-hidden />
              Add tags
            </Button>
            {profile.role === "admin" ? <>
              <Button size="sm" variant="secondary" disabled={isBulkUpdatingDownloaded} onClick={() => updateDownloadedSelection(true)}>
                {isBulkUpdatingDownloaded ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
                Mark downloaded
              </Button>
              <Button size="sm" variant="secondary" disabled={isBulkUpdatingDownloaded} onClick={() => updateDownloadedSelection(false)}>
                <X className="size-3.5" aria-hidden />
                Remove downloaded
              </Button>
            </> : null}
            <Button size="sm" disabled={isDownloading} onClick={downloadZip}>
              {isDownloading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
              {isDownloading && bulkDownloadProgress?.percent != null ? `Downloading ${bulkDownloadProgress.percent}%` : "Download ZIP"}
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
    {bulkExportJob || isDownloading || bulkDownloadComplete ? (
      <BulkDownloadProgress
        job={bulkExportJob}
        progress={bulkDownloadProgress}
        count={bulkDownloadCount}
        complete={bulkDownloadComplete}
        onDismiss={() => {
          setBulkExportJob(null);
          setBulkDownloadProgress(null);
          setBulkDownloadComplete(false);
        }}
      />
    ) : null}
    {filteredAds.length ? view === "grid" ? <><section className="mt-3 grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">{visibleGridAds.map((ad) => <WorkflowCard key={ad.id} ad={ad} mediaToken={mediaTokens[ad.id]} profile={profile} canApprove={canApprove} allowManagerFinalApproval={allowManagerFinalApproval} editors={editors} editorWorkloads={editorWorkloads} pending={actingAdId === ad.id} playing={playingAdIds.has(ad.id)} selected={selectedIds.has(ad.id)} downloading={downloadingIds.has(ad.id)} downloadProgress={downloadProgress[ad.id]} onToggleSelect={() => toggleSelect(ad.id)} onPlay={() => playVideo(ad)} onFreezeChange={handleFreezeChange} onPlaybackError={() => { stopVideo(ad.id); toast({ title: "Video unavailable", description: `${ad.name} could not be played.`, tone: "error" }); }} onQuickPreview={() => setPreviewAd(ad)} onOpenDrive={() => { if (ad.drive_url) window.open(ad.drive_url, "_blank", "noopener,noreferrer"); }} onDownload={() => downloadOne(ad)} onEdit={() => openCreatorForm(ad)} onApprove={() => decide(ad, "approve")} onRequestChanges={() => setCancelAd(ad)} onReopen={(target) => { setCancelTarget(target); setCancelAd(ad); }} onAssignEditor={(editorId, deadline) => assign(ad, editorId, deadline)} onDeleted={handleDeleted} />)}</section>{hasMoreGridAds ? <div ref={loadMoreRef} className="flex h-20 items-center justify-center" role="status" aria-label="Loading more creatives"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden /><span className="sr-only">Loading more creatives</span></div> : null}</> : <WorkflowTable ads={filteredAds} profile={profile} canApprove={canApprove} allowManagerFinalApproval={allowManagerFinalApproval} pendingId={actingAdId} selectedIds={selectedIds} downloadingIds={downloadingIds} downloadProgress={downloadProgress} onToggleSelect={toggleSelect} onApprove={(ad) => decide(ad, "approve")} onRequestChanges={setCancelAd} onDownload={downloadOne} onFreezeChange={handleFreezeChange} onQuickPreview={setPreviewAd} onDeleted={handleDeleted} /> : <EmptyQueue canCreate={canCreate} createBlocked={createBlocked} onCreate={handleCreateClick} />}

    {formOpen ? <Modal open labelledBy="creator-form-title" onClose={() => { setFormOpen(false); setEditingAd(null); }} className="p-0 sm:p-6"><section className="mx-auto min-h-full w-full bg-card shadow-float sm:min-h-0 sm:max-w-5xl sm:rounded-xl"><div className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-card px-5 sm:rounded-t-lg"><div><h2 id="creator-form-title" className="text-lg font-semibold text-foreground">{editingAd ? (editingAd && !creatorEditableStages.includes(editingAd.production_stage as (typeof creatorEditableStages)[number]) && (profile.role === "admin" || profile.role === "manager") ? "Override edit creative" : "Update creative") : "Add creative"}</h2><p className="text-xs text-muted-foreground">{editingAd && !creatorEditableStages.includes(editingAd.production_stage as (typeof creatorEditableStages)[number]) && (profile.role === "admin" || profile.role === "manager") ? "Admin/manager override — all fields editable." : "Set the current preparation status and save."}</p></div><Button size="icon" variant="ghost" title="Close" onClick={() => { setFormOpen(false); setEditingAd(null); }}><X className="size-5" aria-hidden /></Button></div><div className="p-5"><CreatorItemForm profile={profile} creators={creators} editors={editors} campaigns={campaigns.filter((item) => item.active)} products={products.filter((item) => item.active)} initialAd={editingAd} availableTags={availableTags} editorWorkloads={editorWorkloads} overrideMode={Boolean(editingAd && !creatorEditableStages.includes(editingAd.production_stage as (typeof creatorEditableStages)[number]) && (profile.role === "admin" || profile.role === "manager"))} onSaved={() => { setFormOpen(false); setEditingAd(null); router.refresh(); }} /></div></section></Modal> : null}

    {cancelAd ? (
      <Modal open labelledBy="changes-title" onClose={() => { setCancelAd(null); setCancelTarget(""); }} className="flex items-center justify-center p-4">
        <section className="w-full max-w-lg rounded-xl border border-border bg-card shadow-float dark:shadow-none">
          <div className="flex items-start justify-between border-b border-border px-5 py-4">
            <div>
              <h2 id="changes-title" className="text-lg font-semibold text-foreground">
                {cancelAd.production_stage === "approved" ? "Reopen creative for revision" : "Request changes"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {cancelAd.production_stage === "approved"
                  ? `Send "${cancelAd.name}" back for revisions.`
                  : "Tell the creator or editor exactly what must change."}
              </p>
            </div>
            <Button size="icon" variant="ghost" className="size-9" title="Close" onClick={() => { setCancelAd(null); setCancelTarget(""); }}>
              <X className="size-5" aria-hidden />
            </Button>
          </div>
          <div className="space-y-4 p-5">
            <div>
              <label htmlFor="changes-reason-input" className="mb-1.5 block text-xs font-medium text-foreground">
                Required changes / reason <span className="text-destructive">*</span>
              </label>
              <Textarea
                id="changes-reason-input"
                className="min-h-32"
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder={cancelAd.production_stage === "approved" ? "Explain what needs to be changed or revised..." : "Required changes"}
              />
            </div>
            <div>
              <label htmlFor="changes-target-select" className="mb-1.5 block text-xs font-medium text-foreground">
                Revision target <span className="text-destructive">*</span>
              </label>
              <Select
                id="changes-target-select"
                value={cancelTarget}
                onChange={(event) => setCancelTarget(event.target.value as "creator" | "editor" | "")}
              >
                <option value="">Choose target (Creator or Editor)</option>
                <option value="editor">Editor ({cancelAd.editor?.name ?? "Editor"})</option>
                <option value="creator">Creator ({cancelAd.creator?.name ?? "Creator"})</option>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
            <Button variant="secondary" onClick={() => { setCancelAd(null); setCancelTarget(""); }}>
              {cancelAd.production_stage === "approved" ? "Keep approved" : "Keep in review"}
            </Button>
            <Button
              variant="danger"
              disabled={isPending || !cancelReason.trim() || !cancelTarget}
              onClick={() => decide(cancelAd, "request_changes", cancelReason.trim())}
              className="gap-1.5"
            >
              {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
              {cancelAd.production_stage === "approved" ? "Reopen & send changes" : "Send changes"}
            </Button>
          </div>
        </section>
      </Modal>
    ) : null}
    <AdPreviewModal
      ad={previewAd ? {
        ...previewAd,
        editing_freeze: freezeOverrides[previewAd.id] ?? previewAd.editing_freeze,
        production_stage: stageOverrides[previewAd.id] ?? previewAd.production_stage
      } : null}
      role={profile.role}
      onFreezeChange={handleFreezeChange}
      onClose={() => setPreviewAd(null)}
    />
    {bulkTagModalOpen ? <BulkTagModal count={selectedIds.size} availableTags={ordinaryAvailableTags} pending={isBulkTagging} onClose={() => setBulkTagModalOpen(false)} onSubmit={submitBulkTags} /> : null}
    {bulkCampaignModalOpen ? (
      <BulkAssignCampaignModal
        count={selectedIds.size}
        campaigns={campaigns}
        selectedAds={ads.filter((ad) => selectedIds.has(ad.id))}
        pending={isBulkAssigningCampaign}
        onClose={() => setBulkCampaignModalOpen(false)}
        onSubmit={submitBulkCampaign}
      />
    ) : null}
    {bulkEditorModalOpen ? (
      <BulkEditorAssignmentModal
        selectedAds={ads.filter((ad) => selectedIds.has(ad.id))}
        editors={editors}
        editorWorkloads={editorWorkloads}
        profile={profile}
        pending={isBulkAssigningEditor}
        onClose={() => setBulkEditorModalOpen(false)}
        onSubmit={submitBulkEditor}
      />
    ) : null}
  </main>;
}

function BulkTagModal({ count, availableTags, pending, onClose, onSubmit }: { count: number; availableTags: string[]; pending: boolean; onClose: () => void; onSubmit: (tags: string[]) => void }) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const tagOptions = useMemo(() => Array.from(new Set([...availableTags, ...selectedTags])).filter(Boolean).sort(), [availableTags, selectedTags]);

  function addTag() {
    const tags = tagDraft.split(",").map((item) => item.trim().toLowerCase()).filter((item) => Boolean(item) && item !== "downloaded");
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

function WorkflowCard({ ad, mediaToken, profile, canApprove = true, allowManagerFinalApproval = true, editors, editorWorkloads, pending, playing, selected, downloading, downloadProgress, onToggleSelect, onPlay, onFreezeChange, onPlaybackError, onQuickPreview, onOpenDrive, onDownload, onEdit, onApprove, onRequestChanges, onReopen, onAssignEditor, onDeleted }: { ad: AdWithRelations; mediaToken?: string; profile: Profile; canApprove?: boolean; allowManagerFinalApproval?: boolean; editors: Profile[]; editorWorkloads: Record<string, number>; pending: boolean; playing: boolean; selected: boolean; downloading: boolean; downloadProgress?: DownloadProgress; onToggleSelect: () => void; onPlay: () => void; onFreezeChange: (adId: string, state: EditingFreezeState, stage?: ProductionStage) => void; onPlaybackError: () => void; onQuickPreview: () => void; onOpenDrive: () => void; onDownload: () => void; onEdit: () => void; onApprove: () => void; onRequestChanges: () => void; onReopen?: (target: "creator" | "editor") => void; onAssignEditor: (editorId: string, deadline: string) => void; onDeleted: (adId: string) => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const isApproved = ad.production_stage === "approved";
  const defaultRevisionTarget: "creator" | "editor" = ad.editor_id ? "editor" : "creator";
  const [revisionTarget, setRevisionTarget] = useState<"creator" | "editor">(defaultRevisionTarget);
  const [selectedEditor, setSelectedEditor] = useState("");
  const [selectedDeadline, setSelectedDeadline] = useState(ad.deadline ?? "");
  const [dismissingDownloaded, setDismissingDownloaded] = useState(false);
  const [downloadedDismissed, setDownloadedDismissed] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  const mediaVisible = isFinalMediaVisible(ad.production_stage);
  const canPreview = mediaVisible && Boolean(ad.drive_file_id);
  const canOpenInDrive = mediaVisible && Boolean(ad.drive_url);
  const thumbnail = canPreview ? `/api/ads/${ad.id}/thumbnail?v=${encodeURIComponent(ad.drive_file_id!)}` : null;
  const reviewer = profile.role === "admin" || profile.role === "manager";
  const canFinalReview = reviewer && (ad.production_stage === "creator_review" || ad.production_stage === "final_review");
  const canAssignEditor = (ad.production_stage === "shoot_complete" || ad.production_stage === "ready_for_edit") && reviewer;
  const activeEditors = editors.filter((item) => item.active && item.id !== (ad.production_stage === "ready_for_edit" ? ad.editor_id : null));
  const isReassign = ad.production_stage === "ready_for_edit" && Boolean(ad.editor_id);
  const downloaded = isDownloaded(ad) && !downloadedDismissed;
  const allAdTags = ad.tags.filter((tag) => tag.name.toLowerCase() !== "downloaded");
  const visibleTags = showAllTags ? allAdTags : allAdTags.slice(0, 10);
  const remainingTagsCount = allAdTags.length - 10;
  const creatorChangeRequested =
    isCreatorCapableRole(profile.role) &&
    (ad.creator_id === profile.id || (profile.role !== "admin" && Boolean(ad.activity_logs?.some((l) => l.actor_id === profile.id && l.action === "creator_item_created")))) &&
    ad.production_stage === "creator_changes_requested";
  const creatorEditable = creatorEditableStages.includes(ad.production_stage as (typeof creatorEditableStages)[number]) && (reviewer || (profile.role === "content_creator" && ad.creator_id === profile.id));
  const actionLabel = creatorChangeRequested ? "Resubmit creative" : creatorEditable ? "Update" : profile.role === "editor" && ad.production_stage === "ready_for_edit" ? "Open assignment" : profile.role === "editor" && (ad.production_stage === "editing" || ad.production_stage === "changes_requested") ? "Submit video" : isCreatorCapableRole(profile.role) && ad.creator_id === profile.id && ad.production_stage === "creator_review" ? "Review edit" : "Open";

  async function dismissDownloaded() {
    if (dismissingDownloaded) return;
    setDismissingDownloaded(true);
    const response = await runServerAction(() => dismissDownloadedBadge(ad.id));
    if (!response.ok) {
      setDismissingDownloaded(false);
      toast({ title: "Badge not dismissed", description: response.message ?? "Unable to update this creative.", tone: "error" });
      return;
    }
    setDownloadedDismissed(true);
    setDismissingDownloaded(false);
    toast({ title: "Downloaded badge dismissed", description: ad.name, tone: "success" });
    router.refresh();
  }

  return (
    <article className="group/card relative overflow-hidden rounded-xl border border-border bg-card shadow-soft transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-ring/40 hover:shadow-float dark:shadow-none dark:hover:border-ring/60">
      {pending ? <div className="absolute inset-0 z-20 flex items-center justify-center bg-card/75 backdrop-blur-[1px]" role="status"><span className="inline-flex items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-sm font-medium text-foreground shadow-soft dark:shadow-none"><Loader2 className="size-4 animate-spin text-primary" aria-hidden />Saving...</span></div> : null}
      <button type="button" onClick={(e) => { e.stopPropagation(); onToggleSelect(); }} aria-label={selected ? "Deselect" : "Select"} aria-pressed={selected} className={cn("absolute right-3 z-20 flex size-7 items-center justify-center rounded-md border transition-all duration-150", profile.role === "admin" && downloaded ? "top-12" : "top-3", selected ? "border-primary bg-primary text-primary-foreground opacity-100" : "border-border bg-card/80 text-muted-foreground opacity-0 group-hover/card:opacity-100")}>{selected ? <SquareCheck className="size-4" aria-hidden /> : <Square className="size-4" aria-hidden />}</button>
      <div className="relative">
        {canPreview ? (
          playing ? <InlineCardVideo ad={ad} mediaToken={mediaToken} poster={thumbnail} onError={onPlaybackError} /> :
          <button className="relative block aspect-video w-full overflow-hidden bg-neutral-950" onPointerEnter={() => { if (mediaToken) { void fetch(mediaUrl(ad, mediaToken, true)).catch(() => undefined); } }} onFocus={() => { if (mediaToken) { void fetch(mediaUrl(ad, mediaToken, true)).catch(() => undefined); } }} onClick={onPlay} aria-label={`Play ${ad.name}`}>
            {thumbnail ? <CardThumbnail src={thumbnail} name={ad.name} /> : <MediaPlaceholder label="Final video submitted" />}
            <span className="absolute left-1/2 top-1/2 inline-flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/65 text-white shadow-lg backdrop-blur-sm transition duration-200 group-hover/card:scale-105 group-hover/card:bg-black/80"><Play className="ml-0.5 size-5 fill-current" aria-hidden /></span>
          </button>
        ) : (
          <div className="relative aspect-video overflow-hidden bg-neutral-950">
            <MediaPlaceholder label={ad.production_stage === "ready_for_edit" ? "Editing has not started" : ad.production_stage === "editing" ? "Editing in progress" : "Video not available yet"} />
          </div>
        )}
        <span className="pointer-events-none absolute left-3 top-3 z-10 max-w-[60%]"><ProductionStageBadge stage={ad.production_stage} role={profile.role} allowManagerFinalApproval={allowManagerFinalApproval} approvalStage={ad.approval_stage} /></span>
        {profile.role === "admin" && downloaded ? <button type="button" disabled={dismissingDownloaded} onClick={(event) => { event.stopPropagation(); void dismissDownloaded(); }} className="group/download absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full border border-success/40 bg-card/90 px-2.5 py-1 text-[10px] font-semibold text-success shadow-sm backdrop-blur-sm transition hover:bg-success/10 disabled:cursor-wait" title="Dismiss downloaded badge" aria-label={`Dismiss downloaded badge for ${ad.name}`}><Download className="size-3" aria-hidden />Downloaded{dismissingDownloaded ? <Loader2 className="size-2.5 animate-spin" aria-hidden /> : <X className="size-2.5 opacity-0 transition-opacity group-hover/download:opacity-100 group-focus-visible/download:opacity-100" aria-hidden />}</button> : null}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-foreground">{ad.name}</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{ad.campaign?.name ?? "No campaign"}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ad.product?.name ? <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Product · {ad.product.name}</span> : null}
              {visibleTags.map((tag) => <span key={tag.id} className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">#{tag.name}</span>)}
              {remainingTagsCount > 0 ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAllTags((v) => !v);
                  }}
                  className="inline-flex items-center rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-semibold text-primary transition hover:bg-muted"
                  aria-label={showAllTags ? "Show fewer tags" : `Show ${remainingTagsCount} more tags`}
                >
                  {showAllTags ? "Show less" : `+${remainingTagsCount} more`}
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex gap-0.5">{canDeleteAd(profile.role) ? <DeleteAdButton adId={ad.id} adName={ad.name} compact onDeleted={onDeleted} /> : null}{canPreview ? <button className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50" title="Download video" disabled={downloading} onClick={(e) => { e.stopPropagation(); onDownload(); }}>{downloading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}</button> : null}<button className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" title="Expand details" aria-label={`Expand ${ad.name}`} onClick={onQuickPreview}><Maximize2 className="size-4" aria-hidden /></button>{canOpenInDrive ? <button className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" title="Open final video in Google Drive" aria-label={`Open ${ad.name} in Google Drive`} onClick={onOpenDrive}><Eye className="size-4" aria-hidden /></button> : null}</div>
        </div>
        {downloadProgress ? <DownloadProgressBar progress={downloadProgress} /> : null}
        <div className="mt-4 grid grid-cols-2 gap-3 border-y border-border py-3"><Person label="Creator" person={ad.creator} /><Person label="Editor" person={ad.editor} /></div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs"><span className="font-medium text-muted-foreground" suppressHydrationWarning>{workflowStageAgeLabel(ad.production_stage, ad.workflow_status_changed_at)}</span><Deadline deadline={ad.deadline} status={ad.status} /></div>
        {canToggleEditingFreeze(ad.production_stage) && (reviewer || ad.editing_freeze) ? (
          <div className="mt-2 flex items-center justify-between gap-2">
            <EditingFreezeBadge state={ad.editing_freeze} />
            {reviewer ? <FreezeEditingToggle variant="compact" adId={ad.id} adName={ad.name} stage={ad.production_stage} state={ad.editing_freeze} onChanged={(next, stage) => onFreezeChange(ad.id, next, stage)} /> : null}
          </div>
        ) : null}

        {(ad.production_stage === "creator_changes_requested" ||
          ad.production_stage === "changes_requested" ||
          ((ad.production_stage === "creator_review" || ad.production_stage === "final_review" || ad.status === "pending_review") && Boolean(ad.latest_change_request?.note))) ? (
          <div className="mt-3 rounded-lg border border-primary/30 bg-primary/10 p-2.5">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-primary">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-primary" />
                {ad.production_stage === "creator_changes_requested"
                  ? "Changes requested to Creator"
                  : ad.production_stage === "changes_requested"
                  ? "Changes requested to Editor"
                  : ad.latest_change_request?.target_role === "creator"
                  ? "Revisions submitted · Previously requested to Creator"
                  : "Revisions submitted · Previously requested to Editor"}
              </span>
              <span className="truncate text-[11px] font-normal text-muted-foreground">
                {ad.production_stage === "creator_changes_requested" || ad.latest_change_request?.target_role === "creator"
                  ? (ad.creator?.name ?? "Creator")
                  : (ad.editor?.name ?? "Editor")}
              </span>
            </div>
            {ad.latest_change_request?.note ? (
              <p className="mt-1.5 line-clamp-2 rounded bg-card/80 px-2 py-1 text-xs text-foreground shadow-sm">
                &ldquo;{ad.latest_change_request.note}&rdquo;
              </p>
            ) : null}
            {ad.latest_change_request?.reviewer?.name ? (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Requested by {ad.latest_change_request.reviewer.name}
              </p>
            ) : null}
          </div>
        ) : null}

        {canFinalReview ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {profile.role === "manager" && !allowManagerFinalApproval && ad.approval_stage === "admin_final" ? (
              <Button size="sm" variant="secondary" disabled className="gap-1.5 opacity-85" title="You approved this creative. Waiting for Administrator final approval.">
                <Check className="size-3.5 text-primary" aria-hidden />
                Awaiting Admin
              </Button>
            ) : (
              <Button size="sm" disabled={pending} onClick={onApprove}>
                {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
                Approve
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={onRequestChanges}>Changes</Button>
          </div>
        ) : canAssignEditor ? (
          <div className="mt-3 space-y-2">
            {isReassign ? <p className="text-[11px] text-muted-foreground">Assigned to <span className="font-medium text-foreground">{ad.editor?.name ?? "an editor"}</span> · choose another editor to reassign</p> : null}
            <Select value={selectedEditor} onChange={(event) => setSelectedEditor(event.target.value)} aria-label={isReassign ? "Reassign to editor" : "Choose editor"}>
              <option value="">{isReassign ? "Reassign to…" : "Choose editor"}</option>
              {activeEditors.map((editor) => <option key={editor.id} value={editor.id}>{editor.name} · {editorWorkloads[editor.id] ?? 0} assigned</option>)}
            </Select>
            <Input type="date" value={selectedDeadline ?? ""} onChange={(event) => setSelectedDeadline(event.target.value)} aria-label="Deadline" />
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" disabled={!selectedEditor || !selectedDeadline || pending} title={!selectedDeadline ? "Choose a deadline before assigning" : undefined} onClick={() => onAssignEditor(selectedEditor, selectedDeadline)}>{pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <UserCheck className="size-3.5" aria-hidden />}{isReassign ? "Reassign" : "Assign"}</Button>
              <Button size="sm" variant="secondary" onClick={onEdit}>Update</Button>
            </div>
          </div>
        ) : isApproved && reviewer && onReopen ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`target-${ad.id}`} className="text-[11px] font-medium text-muted-foreground shrink-0">
                Revision target:
              </label>
              <Select
                id={`target-${ad.id}`}
                value={revisionTarget}
                onChange={(event) => setRevisionTarget(event.target.value as "creator" | "editor")}
                className="h-8 text-xs w-auto min-w-[140px] max-w-[200px]"
                aria-label={`Revision target for ${ad.name}`}
              >
                <option value="editor">Editor ({ad.editor?.name ?? "Assigned editor"})</option>
                <option value="creator">Creator ({ad.creator?.name ?? "Creator"})</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => onReopen(revisionTarget)}
                className="gap-1.5 text-xs font-medium text-foreground hover:bg-muted"
                title="Reopen approved creative and send back for revision"
              >
                <RotateCcw className="size-3.5 text-warning" aria-hidden />
                Resend creative
              </Button>
              <Link
                href={`/ads/${ad.id}`}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card text-xs font-medium text-foreground hover:bg-muted"
              >
                Open<ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        ) : creatorChangeRequested ? (
          <Link href={`/ads/${ad.id}`} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-card text-sm font-medium text-foreground hover:bg-muted">Resubmit creative<ArrowRight className="size-3.5" aria-hidden /></Link>
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

/** Compact thumbnail for the table view; uses the same endpoint and visibility rule as the grid cards. */
function RowThumbnail({ adId, name, fileId }: { adId: string; name: string; fileId?: string | null }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(fileId) && !failed;
  return (
    <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground">
      {showImage ? (
        <Image src={`/api/ads/${adId}/thumbnail?v=${encodeURIComponent(fileId!)}`} alt={`${name} thumbnail`} fill sizes="48px" className="object-cover object-center" unoptimized loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <Video className="size-4" aria-hidden />
      )}
    </span>
  );
}

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Inline card player. Native controls are intentionally off: in Chromium they paint their own
 * loading / "cannot play" glyph (the large cross) over the poster while the first bytes arrive.
 * Instead the whole frame is the control — tap to pause, tap again to resume — with a slim
 * progress bar, time and mute toggle that appear on hover or while paused.
 */
function InlineCardVideo({ ad, mediaToken, poster, onError }: { ad: AdWithRelations; mediaToken?: string; poster: string | null; onError: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Buffering is only surfaced after a short grace period. Most stalls resolve in well under a
  // second, and flashing a spinner for those is what made playback feel janky.
  const [showSpinner, setShowSpinner] = useState(false);
  const spinnerTimer = useRef<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [progress, setProgress] = useState({ current: 0, duration: 0, buffered: 0 });
  // A server refresh issues a fresh signed token. Capturing the URL at mount
  // keeps the active media element's src unchanged, so live dashboard updates
  // cannot reset playback to the beginning.
  const [source] = useState(() => mediaUrl(ad, mediaToken));

  function clearSpinnerTimer() {
    if (spinnerTimer.current !== null) {
      window.clearTimeout(spinnerTimer.current);
      spinnerTimer.current = null;
    }
  }
  function beginBuffering(delay = 700) {
    if (spinnerTimer.current !== null) return;
    spinnerTimer.current = window.setTimeout(() => { spinnerTimer.current = null; setShowSpinner(true); }, delay);
  }
  function endBuffering() {
    clearSpinnerTimer();
    setShowSpinner(false);
  }

  async function startPlayback(video: HTMLVideoElement) {
    try {
      await video.play();
    } catch (cause) {
      // Autoplay with sound can be refused (e.g. the tap was consumed elsewhere); fall back to
      // muted playback rather than leaving the card frozen on its poster.
      if (cause instanceof DOMException && cause.name === "NotAllowedError") {
        video.muted = true;
        setMuted(true);
        try { await video.play(); } catch { setPaused(true); endBuffering(); }
      }
    }
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) void startPlayback(video);
    else video.pause();
  }

  function toggleMute(event: React.MouseEvent) {
    event.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  function seek(event: React.MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    video.currentTime = ratio * video.duration;
  }

  function syncProgress() {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    let buffered = 0;
    for (let index = 0; index < video.buffered.length; index += 1) {
      if (video.buffered.start(index) <= video.currentTime + 0.25) buffered = Math.max(buffered, video.buffered.end(index));
    }
    setProgress({ current: video.currentTime, duration, buffered });
  }

  useEffect(() => {
    // Quick feedback for the first frame (the user just tapped), longer grace for mid-play stalls.
    beginBuffering(350);
    const video = videoRef.current;
    if (video) void startPlayback(video);
    return () => {
      clearSpinnerTimer();
      // Release the connection as soon as the card stops playing so it cannot compete with the next video.
      // The deferred check keeps React strict-mode's simulated unmount from tearing down a live player.
      window.setTimeout(() => {
        if (!video || video.isConnected) return;
        video.pause();
        video.removeAttribute("src");
        video.load();
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const percent = progress.duration ? (progress.current / progress.duration) * 100 : 0;
  const bufferedPercent = progress.duration ? Math.min(100, (progress.buffered / progress.duration) * 100) : 0;

  return (
    <div
      className="group/player relative aspect-video w-full cursor-pointer overflow-hidden bg-neutral-950"
      role="button"
      tabIndex={0}
      aria-label={paused ? `Play ${ad.name}` : `Pause ${ad.name}`}
      onClick={togglePlayback}
      onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); togglePlayback(); } }}
    >
      <video
        ref={videoRef}
        src={source}
        poster={poster ?? undefined}
        className="pointer-events-none size-full object-contain"
        playsInline
        preload="auto"
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        onCanPlay={endBuffering}
        onPlaying={() => { endBuffering(); setPaused(false); setHasStarted(true); }}
        onPause={() => { endBuffering(); setPaused(true); }}
        onEnded={() => setPaused(true)}
        onWaiting={() => beginBuffering(hasStarted ? 700 : 350)}
        onSeeking={() => beginBuffering(400)}
        onSeeked={endBuffering}
        onTimeUpdate={syncProgress}
        onProgress={syncProgress}
        onLoadedMetadata={syncProgress}
        onVolumeChange={() => setMuted(Boolean(videoRef.current?.muted))}
        onError={() => { endBuffering(); onError(); }}
      />

      {showSpinner && !paused ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status" aria-label="Loading video">
          <span className="inline-flex size-11 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
            <Loader2 className="size-5 animate-spin text-white/90" aria-hidden />
          </span>
        </div>
      ) : null}

      {paused ? (
        <span className="pointer-events-none absolute left-1/2 top-1/2 inline-flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform duration-150 group-hover/player:scale-105">
          <Play className="ml-0.5 size-5 fill-current" aria-hidden />
        </span>
      ) : (
        <span className="pointer-events-none absolute left-1/2 top-1/2 inline-flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur-sm transition-opacity duration-150 group-hover/player:opacity-100" aria-hidden>
          <Pause className="size-5 fill-current" />
        </span>
      )}

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-[11px] font-medium text-white transition-opacity duration-150",
          paused ? "opacity-100" : "opacity-0 group-hover/player:opacity-100 group-focus-visible/player:opacity-100"
        )}
      >
        <span className="tabular-nums">{formatClock(progress.current)} / {formatClock(progress.duration)}</span>
        <div className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-neutral-100/25" onClick={seek} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(progress.duration)} aria-valuenow={Math.round(progress.current)} tabIndex={-1}>
          <span className="absolute inset-y-0 left-0 rounded-full bg-neutral-100/40" style={{ width: `${bufferedPercent}%` }} />
          <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        <button type="button" className="inline-flex size-7 items-center justify-center rounded-md hover:bg-neutral-100/15" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  );
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

function WorkflowTable({ ads, profile, canApprove = true, allowManagerFinalApproval = true, pendingId, selectedIds, downloadingIds, downloadProgress, onToggleSelect, onApprove, onRequestChanges, onDownload, onFreezeChange, onQuickPreview, onDeleted }: { ads: AdWithRelations[]; profile: Profile; canApprove?: boolean; allowManagerFinalApproval?: boolean; pendingId: string | null; selectedIds: Set<string>; downloadingIds: Set<string>; downloadProgress: Record<string, DownloadProgress>; onToggleSelect: (id: string) => void; onApprove: (ad: AdWithRelations) => void; onRequestChanges: (ad: AdWithRelations) => void; onDownload: (ad: AdWithRelations) => void; onFreezeChange: (adId: string, state: EditingFreezeState, stage?: ProductionStage) => void; onQuickPreview: (ad: AdWithRelations) => void; onDeleted: (adId: string) => void }) {
  const router = useRouter();
  const reviewer = profile.role === "admin" || profile.role === "manager";
  const [tableSort, setTableSort] = useState<TableSort>({ key: "waiting", direction: "asc" });
  const sortedAds = useMemo(() => [...ads].sort((a, b) => {
    const values = {
      name: [a.name, b.name],
      status: [getProductionStageLabel(a.production_stage, profile.role, allowManagerFinalApproval), getProductionStageLabel(b.production_stage, profile.role, allowManagerFinalApproval)],
      creator: [a.creator?.name ?? "", b.creator?.name ?? ""],
      editor: [a.editor?.name ?? "", b.editor?.name ?? ""],
      waiting: [a.workflow_status_changed_at, b.workflow_status_changed_at]
    } satisfies Record<TableSortKey, [string, string]>;
    const result = values[tableSort.key][0].localeCompare(values[tableSort.key][1]);
    return tableSort.direction === "asc" ? result : -result;
  }), [ads, allowManagerFinalApproval, profile.role, tableSort]);
  const changeSort = (key: TableSortKey) => setTableSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });

  return (
    <section className="panel mt-3 overflow-x-auto">
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead className="border-b border-border bg-muted text-xs uppercase text-muted-foreground">
          <tr><th className="w-10 px-3 py-3" /><SortHeader label="Creative" sortKey="name" sort={tableSort} onSort={changeSort} /><SortHeader label="Status" sortKey="status" sort={tableSort} onSort={changeSort} /><SortHeader label="Creator" sortKey="creator" sort={tableSort} onSort={changeSort} /><SortHeader label="Editor" sortKey="editor" sort={tableSort} onSort={changeSort} /><SortHeader label="Time in status" sortKey="waiting" sort={tableSort} onSort={changeSort} /><th className="px-4 py-3" /></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sortedAds.map((ad) => {
            const reviewable = reviewer && (ad.production_stage === "creator_review" || ad.production_stage === "final_review");
            const isApproved = ad.production_stage === "approved";
            const isSelected = selectedIds.has(ad.id);
            const canDownload = isFinalMediaVisible(ad.production_stage) && Boolean(ad.drive_file_id);
            const isDownloadingRow = downloadingIds.has(ad.id);
            const progress = downloadProgress[ad.id];
            const ordinaryTags = ad.tags.filter((tag) => tag.name.toLowerCase() !== "downloaded").slice(0, 2);
            const creatorChangeRequested =
              isCreatorCapableRole(profile.role) &&
              (ad.creator_id === profile.id || (profile.role !== "admin" && Boolean(ad.activity_logs?.some((l) => l.actor_id === profile.id && l.action === "creator_item_created")))) &&
              ad.production_stage === "creator_changes_requested";
            const open = () => router.push(`/ads/${ad.id}`);
            return (
              <tr key={ad.id} className={`cursor-pointer transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${isSelected ? "bg-accent/40" : ""}`} role="link" tabIndex={0} onClick={open} onKeyDown={(event) => { if (event.key === "Enter") open(); }}>
                <td className="px-3 py-3" onClick={(event) => { event.stopPropagation(); onToggleSelect(ad.id); }}><button type="button" aria-label={isSelected ? "Deselect" : "Select"} aria-pressed={isSelected} className={`flex size-7 items-center justify-center rounded-md border transition-colors ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-ring"}`}>{isSelected ? <SquareCheck className="size-4" aria-hidden /> : <Square className="size-4" aria-hidden />}</button></td>
                <td className="px-4 py-3"><div className="flex items-center gap-3"><RowThumbnail adId={ad.id} name={ad.name} fileId={isFinalMediaVisible(ad.production_stage) ? ad.drive_file_id : null} /><div className="min-w-0"><p className="font-medium text-foreground">{ad.name}</p><p className="text-xs text-muted-foreground">{ad.campaign?.name}</p>{progress ? <DownloadProgressBar progress={progress} compact /> : <div className="mt-1 flex flex-wrap gap-1.5">{ad.product?.name ? <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Product · {ad.product.name}</span> : null}{ordinaryTags.map((tag) => <span key={tag.id} className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">#{tag.name}</span>)}{profile.role === "admin" && isDownloaded(ad) ? <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success"><Download className="size-2.5" aria-hidden />Downloaded</span> : null}</div>}</div></div></td>
                <td className="px-4 py-3">
                  <ProductionStageBadge stage={ad.production_stage} role={profile.role} allowManagerFinalApproval={allowManagerFinalApproval} approvalStage={ad.approval_stage} className="bg-muted text-muted-foreground shadow-none" />
                  {ad.production_stage === "creator_changes_requested" ? (
                    <span className="mt-1 block text-[11px] font-medium text-primary">To: {ad.creator?.name ?? "Creator"}</span>
                  ) : ad.production_stage === "changes_requested" ? (
                    <span className="mt-1 block text-[11px] font-medium text-primary">To: {ad.editor?.name ?? "Editor"}</span>
                  ) : ad.latest_change_request?.note && (ad.production_stage === "creator_review" || ad.production_stage === "final_review") ? (
                    <span className="mt-1 block text-[11px] font-medium text-primary">
                      Revisions: {ad.latest_change_request?.target_role === "creator" ? (ad.creator?.name ?? "Creator") : (ad.editor?.name ?? "Editor")}
                    </span>
                  ) : null}
                  {ad.latest_change_request?.note ? (
                    <span className="mt-0.5 block max-w-[200px] truncate text-[11px] text-muted-foreground" title={ad.latest_change_request.reviewer?.name ? `"${ad.latest_change_request.note}" (Requested by ${ad.latest_change_request.reviewer.name})` : ad.latest_change_request.note}>
                      &ldquo;{ad.latest_change_request.note}&rdquo;
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3">{ad.creator?.name ?? "Unassigned"}</td>
                <td className="px-4 py-3">{ad.editor?.name ?? "Unassigned"}</td>
                <td className="px-4 py-3 text-muted-foreground normal-case" suppressHydrationWarning>{workflowStageAgeLabel(ad.production_stage, ad.workflow_status_changed_at)}</td>
                <td className="px-4 py-3"><div className="flex items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>{canToggleEditingFreeze(ad.production_stage) ? <>{ad.editing_freeze ? <EditingFreezeBadge state={ad.editing_freeze} /> : null}{reviewer ? <FreezeEditingToggle variant="compact" adId={ad.id} adName={ad.name} stage={ad.production_stage} state={ad.editing_freeze} onChanged={(next, stage) => onFreezeChange(ad.id, next, stage)} /> : null}</> : null}{reviewable ? <>{profile.role === "manager" && !allowManagerFinalApproval && ad.approval_stage === "admin_final" ? <span className="inline-flex items-center gap-1 text-xs text-primary font-medium px-1.5 py-1 rounded bg-primary/10" title="Approved by manager. Waiting for administrator final approval."><Check className="size-3" aria-hidden />Awaiting Admin</span> : <Button size="sm" disabled={pendingId === ad.id} onClick={() => onApprove(ad)}>Approve</Button>}<Button size="sm" variant="secondary" onClick={() => onRequestChanges(ad)}>Changes</Button></> : creatorChangeRequested ? <Button size="sm" variant="secondary" onClick={open}>Resubmit<ArrowRight className="size-3.5" aria-hidden /></Button> : isApproved && reviewer ? <><Button size="sm" variant="secondary" onClick={() => onRequestChanges(ad)} className="gap-1 text-xs" title="Reopen creative for revision"><RotateCcw className="size-3 text-warning" aria-hidden />Reopen</Button><Button size="sm" variant="secondary" onClick={open}>Open<ArrowRight className="size-3.5" aria-hidden /></Button></> : <Button size="sm" variant="secondary" onClick={open}>Open<ArrowRight className="size-3.5" aria-hidden /></Button>}{canDownload ? <button className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50" title="Download video" disabled={isDownloadingRow} onClick={() => onDownload(ad)}>{isDownloadingRow ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}</button> : null}<button className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" title="Expand details" aria-label={`Expand ${ad.name}`} onClick={() => onQuickPreview(ad)}><Maximize2 className="size-4" aria-hidden /></button>{canDeleteAd(profile.role) ? <DeleteAdButton adId={ad.id} adName={ad.name} compact onDeleted={onDeleted} /> : null}</div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function DownloadProgressBar({ progress, compact = false }: { progress: DownloadProgress; compact?: boolean }) {
  const percent = progress.percent ?? 0;
  return <div className={compact ? "mt-2 min-w-48" : "mt-3"} role="progressbar" aria-label="Video download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent ?? undefined}>
    <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full bg-primary transition-[width] duration-200", progress.percent === null && "w-1/3 animate-pulse")} style={progress.percent === null ? undefined : { width: `${percent}%` }} /></div>
    <p className="mt-1 text-[10px] font-medium text-muted-foreground">{downloadProgressLabel(progress)}</p>
  </div>;
}

function BulkDownloadProgress({ job, progress, count, complete, onDismiss }: { job: ExportJobSnapshot | null; progress: DownloadProgress | null; count: number; complete: boolean; onDismiss: () => void }) {
  const preparing = !progress && (job?.phase === "preparing" || job?.phase === "building");
  const readyToDownload = !progress && job?.phase === "ready";
  const failed = job?.phase === "failed";
  const included = job?.files.filter((file) => file.state === "included").length ?? 0;
  const skipped = job?.files.filter((file) => file.state === "skipped" || file.state === "failed").length ?? 0;
  // There is deliberately no preparation progress bar. The only visible bar
  // measures bytes of the finished ZIP as they arrive in the browser, so its
  // fraction always equals downloaded ZIP bytes ÷ exact final ZIP bytes.
  const percent = progress?.percent ?? 0;
  const title = complete ? "ZIP download complete" : failed ? "ZIP preparation failed" : progress ? `Downloading final ZIP · ${included} video${included === 1 ? "" : "s"}` : readyToDownload ? "Final ZIP ready" : "Preparing final ZIP";
  const detail = progress ? downloadProgressLabel(progress) : readyToDownload ? "Starting your browser download…" : preparing ? `Preparing ${job?.requestedCount ?? count} selected creatives. The download meter starts once the exact ZIP size is ready.` : job?.error ?? "Starting…";
  return <section className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-4 shadow-soft" role="status" aria-live="polite">
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">{complete ? <Check className="size-4" aria-hidden /> : <Loader2 className="size-4 animate-spin" aria-hidden />}</span>
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {detail}
            <span className="block mt-1 text-[11px] text-muted-foreground/90">
              {preparing ? "Zipping continues in the background if you close this tab. " : ""}The archive is saved for {job?.retentionDays ?? 3} day{(job?.retentionDays ?? 3) === 1 ? "" : "s"} in{" "}
              <Link
                href="/admin/settings#downloads"
                className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
              >
                Settings &gt; Download Logs <ExternalLink className="size-2.5" />
              </Link>
              .
            </span>
          </p>
          {job?.zipSizeBytes ? <p className="mt-1 text-xs font-medium text-foreground">Final ZIP size: {formatDownloadBytes(job.zipSizeBytes)} · {included} included{skipped ? ` · ${skipped} skipped/failed` : ""}</p> : null}
        </div>
      </div>
      <div className="flex items-center gap-2">{progress || complete ? <span className="shrink-0 text-sm font-semibold text-primary">{`${percent}%`}</span> : null}{complete || failed ? <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={onDismiss} aria-label="Dismiss download status"><X className="size-4" /></button> : null}</div>
    </div>
    {progress || complete ? <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="ZIP progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${percent}%` }} /></div> : null}
  </section>;
}

function formatDownloadBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`; return `${(bytes / 1024 ** 3).toFixed(1)} GB`; }

function SortHeader({ label, sortKey, sort, onSort }: { label: string; sortKey: TableSortKey; sort: TableSort; onSort: (key: TableSortKey) => void }) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
  return <th className="px-2 py-1" aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 font-semibold hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSort(sortKey)}>{label}<Icon className="size-3.5" aria-hidden /></button></th>;
}

function Person({ label, person }: { label: string; person: AdWithRelations["creator"] }) { return <div className="flex min-w-0 items-center gap-2"><Avatar className="size-7" name={person?.name ?? "Unassigned"} src={person?.avatar_url} /><div className="min-w-0"><p className="text-[10px] font-medium uppercase text-muted-foreground">{label}</p><p className="truncate text-xs font-medium text-muted-foreground">{person?.name ?? "Unassigned"}</p></div></div>; }
function Deadline({ deadline, status }: { deadline: string | null; status: AdStatus }) { if (!deadline) return <span className="text-muted-foreground">No deadline</span>; const days = dateOnlyDaysFromToday(deadline); const active = status !== "approved" && status !== "published"; return <span className={cn("inline-flex items-center gap-1", active && days < 0 ? "text-destructive" : "text-muted-foreground")}><CalendarClock className="size-3.5" aria-hidden />{active && days < 0 ? `${Math.abs(days)}d overdue` : formatDateOnly(deadline)}</span>; }
function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) { return <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">{label}</span><Select value={value} onChange={(event) => onChange(event.target.value)}><option value="all">{label === "Sort" ? "Recently updated" : `All ${label.toLowerCase()}`}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label>; }
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) { return <span className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-muted pl-2.5 pr-1 text-xs font-medium text-foreground">{label}<button type="button" className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground" aria-label={`Remove ${label} filter`} onClick={onRemove}><X className="size-3" aria-hidden /></button></span>; }
function EmptyQueue({ canCreate, createBlocked, onCreate }: { canCreate: boolean; createBlocked?: boolean; onCreate: () => void }) { return <div className="mt-6 flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-center"><span className="flex size-12 items-center justify-center rounded-full bg-muted"><ListFilter className="size-5 text-muted-foreground" aria-hidden /></span><h2 className="mt-3 text-base font-semibold text-foreground">Nothing in this queue</h2><p className="mt-1 text-sm text-muted-foreground">Items will appear here when they reach this status.</p>{canCreate ? <Button className="mt-4" onClick={onCreate} disabled={createBlocked} title={createBlocked ? "Resolve requested changes before creating another creative." : undefined}><Plus className="size-4" aria-hidden />Add creative</Button> : null}</div>; }
