"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AppWindow,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Edit2,
  ExternalLink,
  Film,
  Filter,
  FolderKanban,
  Layers,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  SquareCheck,
  Target,
  Trash2,
  Video,
  X
} from "lucide-react";
import { ExcelColumnDef, ExcelTable } from "@/components/campaigns/excel-table";
import {
  useBulkDownload,
  BulkDownloadProgress,
  BulkActionsBar
} from "@/components/campaigns/bulk-download-progress";
import { CreativeStatusBadge } from "@/components/campaigns/campaign-detail-client";
import { AdPreviewModal } from "@/components/dashboard/ad-preview-modal";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ProductionStageBadge } from "@/components/workflow/production-stage";
import { bulkSetDownloadedBadge } from "@/app/actions/ads";
import { saveInternalCampaign, deleteInternalCampaign } from "@/app/actions/campaigns";
import { runServerAction } from "@/lib/client-action";
import type { AdWithRelations, Campaign, CampaignOverview, Profile } from "@/lib/types";
import { cn, formatDateOnly, isDownloaded } from "@/lib/utils";

function getAdThumbnailSrc(ad: AdWithRelations): string {
  if (ad.id) {
    return `/api/ads/${ad.id}/thumbnail`;
  }
  if (ad.thumbnail_url && !ad.thumbnail_url.includes("google")) {
    return ad.thumbnail_url;
  }
  if (ad.product?.image_url) {
    return ad.product.image_url;
  }
  return "";
}

function MiniThumbnail({ ad }: { ad: AdWithRelations }) {
  const [failed, setFailed] = useState(false);
  const [triedProduct, setTriedProduct] = useState(false);

  const primarySrc = getAdThumbnailSrc(ad);
  const productFallback = ad.product?.image_url;

  const currentSrc = !failed ? primarySrc : (!triedProduct && productFallback ? productFallback : null);

  const handleError = () => {
    if (!triedProduct && productFallback && productFallback !== primarySrc) {
      setTriedProduct(true);
    } else {
      setFailed(true);
    }
  };

  if (!currentSrc || (failed && triedProduct)) {
    return (
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded border border-border bg-muted/80 text-muted-foreground text-[10px] font-mono shadow-xs"
        title={ad.name}
      >
        <Film className="size-3.5 opacity-60" />
      </div>
    );
  }

  return (
    <div
      className="group/mini relative size-9 shrink-0 overflow-hidden rounded border border-border bg-muted/50 shadow-xs"
      title={ad.name}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={currentSrc}
        alt={ad.name}
        loading="lazy"
        className="size-full object-cover group-hover/mini:scale-110 transition-transform duration-150"
        onError={handleError}
      />
    </div>
  );
}

function AdScriptModal({
  ad,
  onClose
}: {
  ad: AdWithRelations | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!ad) return null;

  const text = ad.script_text || "No script text available.";
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  const handleCopy = () => {
    if (ad.script_text) {
      void navigator.clipboard.writeText(ad.script_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Modal open labelledBy="script-modal-title" onClose={onClose} className="p-0 sm:p-6">
      <section className="mx-auto min-h-full w-full bg-card shadow-float sm:min-h-0 sm:max-w-2xl sm:rounded-xl">
        <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-card px-5 sm:rounded-t-lg">
          <h2 id="script-modal-title" className="text-base font-semibold text-foreground truncate pr-2">
            {ad.name}
          </h2>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <CreativeStatusBadge ad={ad} />
              {ad.product?.name ? (
                <span className="text-xs font-medium text-foreground">· {ad.product.name}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{wordCount} words</span>
              <span>·</span>
              <span>{text.length} characters</span>
            </div>
          </div>

          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border bg-muted/30 p-4 font-normal text-sm leading-relaxed text-foreground whitespace-pre-wrap select-text">
            {text}
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleCopy}
              className="gap-1.5 text-xs"
            >
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy script"}
            </Button>

            <div className="flex items-center gap-2">
              <Link
                href={`/ads/${ad.id}`}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                Open creative
                <ArrowRight className="size-3" />
              </Link>
              <Button type="button" size="sm" onClick={onClose} className="text-xs">
                Close
              </Button>
            </div>
          </div>
        </div>
      </section>
    </Modal>
  );
}

export function CampaignsDashboardClient({
  profile,
  campaignOverviews
}: {
  profile: Profile;
  campaignOverviews: CampaignOverview[];
}) {
  const router = useRouter();

  // Dual View Switcher: "campaigns" vs "ads"
  const [dashboardView, setDashboardView] = useState<"campaigns" | "ads">("campaigns");

  // Campaigns View filters
  const [search, setSearch] = useState("");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("all");
  const [selectedProductId, setSelectedProductId] = useState<string>("all");
  const [selectedCreatorId, setSelectedCreatorId] = useState<string>("all");
  const [selectedEditorId, setSelectedEditorId] = useState<string>("all");
  const [selectedProgress, setSelectedProgress] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);

  // Ads View filters & bulk state
  const { toast } = useToast();
  const [adSearch, setAdSearch] = useState("");
  const [adCampaignFilter, setAdCampaignFilter] = useState<string>("all");
  const [adProductFilter, setAdProductFilter] = useState<string>("all");
  const [adCreatorFilter, setAdCreatorFilter] = useState<string>("all");
  const [adEditorFilter, setAdEditorFilter] = useState<string>("all");
  const [adStageFilter, setAdStageFilter] = useState<string>("all");
  const [adDownloadFilter, setAdDownloadFilter] = useState<"all" | "downloaded" | "not_downloaded">("all");
  const [showAdFilters, setShowAdFilters] = useState(false);
  const [updatingDownloadedId, setUpdatingDownloadedId] = useState<string | null>(null);
  const [isBulkUpdatingDownloaded, setIsBulkUpdatingDownloaded] = useState(false);
  const adsBulk = useBulkDownload();
  const campaignsBulk = useBulkDownload();

  const handleToggleDownloaded = async (ad: AdWithRelations) => {
    if (profile.role !== "admin" || updatingDownloadedId) return;
    const currentlyDownloaded = isDownloaded(ad);
    setUpdatingDownloadedId(ad.id);
    try {
      const res = await runServerAction(() => bulkSetDownloadedBadge([ad.id], !currentlyDownloaded));
      if (!res.ok) {
        toast({ title: "Could not update downloaded badge", description: res.message ?? "Try again.", tone: "error" });
        return;
      }
      toast({
        title: !currentlyDownloaded ? `Marked "${ad.name}" as downloaded` : `Removed downloaded badge from "${ad.name}"`,
        tone: "success"
      });
      router.refresh();
    } finally {
      setUpdatingDownloadedId(null);
    }
  };

  const handleBulkDownloaded = async (downloaded: boolean) => {
    if (profile.role !== "admin" || !adsBulk.selectedIds.size || isBulkUpdatingDownloaded) return;
    setIsBulkUpdatingDownloaded(true);
    try {
      const ids = Array.from(adsBulk.selectedIds);
      const res = await runServerAction(() => bulkSetDownloadedBadge(ids, downloaded));
      if (!res.ok) {
        toast({ title: "Could not update downloaded badges", description: res.message ?? "Try again.", tone: "error" });
        return;
      }
      toast({
        title: downloaded
          ? `Marked ${res.count} creative${res.count === 1 ? "" : "s"} as downloaded`
          : `Removed downloaded badge from ${res.count} creative${res.count === 1 ? "" : "s"}`,
        tone: "success"
      });
      router.refresh();
    } finally {
      setIsBulkUpdatingDownloaded(false);
    }
  };

  // Modals for Ads view
  const [previewAd, setPreviewAd] = useState<AdWithRelations | null>(null);
  const [selectedScriptAd, setSelectedScriptAd] = useState<AdWithRelations | null>(null);

  const [isPending, startTransition] = useTransition();

  // Modal states for Campaign Creation / Editing
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [videoGoal, setVideoGoal] = useState<number | null>(null);
  const [active, setActive] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canManage = profile.role === "admin" || profile.role === "manager";

  // Flat list of all creatives across campaigns
  const allCreatives: (AdWithRelations & { campaign?: Campaign })[] = useMemo(() => {
    return campaignOverviews.flatMap((ov) =>
      ov.creatives
        .filter((creative) => {
          if (profile.role === "admin" || profile.role === "manager") return true;
          if (profile.role === "content_creator") return creative.creator_id === profile.id;
          if (profile.role === "editor") return creative.editor_id === profile.id;
          return true;
        })
        .map((creative) => ({
          ...creative,
          campaign: ov.campaign
        }))
    );
  }, [campaignOverviews, profile.role, profile.id]);

  // Available filter options extracted from creatives
  const { allProducts, allCreators, allEditors } = useMemo(() => {
    const productsMap = new Map<string, string>();
    const creatorsMap = new Map<string, string>();
    const editorsMap = new Map<string, string>();

    for (const ov of campaignOverviews) {
      for (const cr of ov.creatives) {
        if (cr.product?.id && cr.product?.name) productsMap.set(cr.product.id, cr.product.name);
        if (cr.creator?.id && cr.creator?.name) creatorsMap.set(cr.creator.id, cr.creator.name);
        if (cr.editor?.id && cr.editor?.name) editorsMap.set(cr.editor.id, cr.editor.name);
      }
    }

    return {
      allProducts: Array.from(productsMap.entries()).map(([id, name]) => ({ id, name })),
      allCreators: Array.from(creatorsMap.entries()).map(([id, name]) => ({ id, name })),
      allEditors: Array.from(editorsMap.entries()).map(([id, name]) => ({ id, name }))
    };
  }, [campaignOverviews]);

  // Filtered overviews (for Campaigns view)
  const filteredOverviews = useMemo(() => {
    return campaignOverviews.filter((item) => {
      if (filterActive === "active" && !item.campaign.active) return false;
      if (filterActive === "inactive" && item.campaign.active) return false;

      if (search.trim()) {
        const query = search.toLowerCase();
        const matchName = item.campaign.name.toLowerCase().includes(query);
        const matchDesc = item.campaign.description?.toLowerCase().includes(query);
        const matchCreatives = item.creatives.some(
          (c) =>
            c.name.toLowerCase().includes(query) ||
            c.product?.name.toLowerCase().includes(query) ||
            c.creator?.name.toLowerCase().includes(query)
        );
        if (!matchName && !matchDesc && !matchCreatives) return false;
      }

      if (selectedProductId !== "all") {
        const hasProd = item.creatives.some((c) => c.product_id === selectedProductId);
        if (!hasProd) return false;
      }

      if (selectedCreatorId !== "all") {
        const hasCreator = item.creatives.some((c) => c.creator_id === selectedCreatorId);
        if (!hasCreator) return false;
      }

      if (selectedEditorId !== "all") {
        const hasEditor = item.creatives.some((c) => c.editor_id === selectedEditorId);
        if (!hasEditor) return false;
      }

      if (selectedProgress === "completed" && (item.goalProgressPercent == null || item.goalProgressPercent < 100))
        return false;
      if (
        selectedProgress === "in_progress" &&
        (item.goalProgressPercent == null || item.goalProgressPercent >= 100 || item.totalCreatives === 0)
      )
        return false;
      if (selectedProgress === "empty" && item.totalCreatives > 0) return false;

      return true;
    });
  }, [
    campaignOverviews,
    search,
    filterActive,
    selectedProductId,
    selectedCreatorId,
    selectedEditorId,
    selectedProgress
  ]);

  const hasActiveFilters =
    search.trim() !== "" ||
    filterActive !== "all" ||
    selectedProductId !== "all" ||
    selectedCreatorId !== "all" ||
    selectedEditorId !== "all" ||
    selectedProgress !== "all";

  const resetFilters = () => {
    setSearch("");
    setFilterActive("all");
    setSelectedProductId("all");
    setSelectedCreatorId("all");
    setSelectedEditorId("all");
    setSelectedProgress("all");
  };

  // Filtered ads (for Ads view)
  const filteredAds = useMemo(() => {
    return allCreatives.filter((ad) => {
      if (adCampaignFilter !== "all" && ad.campaign_id !== adCampaignFilter) return false;
      if (adProductFilter !== "all" && ad.product_id !== adProductFilter) return false;
      if (adCreatorFilter !== "all" && ad.creator_id !== adCreatorFilter) return false;
      if (adEditorFilter !== "all" && ad.editor_id !== adEditorFilter) return false;

      if (adDownloadFilter !== "all") {
        const dl = isDownloaded(ad);
        if (adDownloadFilter === "downloaded" && !dl) return false;
        if (adDownloadFilter === "not_downloaded" && dl) return false;
      }

      if (adStageFilter !== "all") {
        if (adStageFilter === "approved" && ad.production_stage !== "approved" && ad.status !== "approved") {
          return false;
        }
        if (adStageFilter === "in_review") {
          const reviewStages = ["creator_review", "final_review", "creator_changes_requested", "changes_requested"];
          if (!reviewStages.includes(ad.production_stage)) return false;
        }
        if (adStageFilter === "in_creation") {
          const creationStages = ["script_writing", "ready_to_shoot", "shoot_complete", "ready_for_edit", "editing"];
          if (!creationStages.includes(ad.production_stage)) return false;
        }
        if (ad.production_stage !== adStageFilter && ad.status !== adStageFilter) return false;
      }

      if (adSearch.trim()) {
        const q = adSearch.toLowerCase();
        const matchName = ad.name.toLowerCase().includes(q);
        const matchCamp = ad.campaign?.name.toLowerCase().includes(q);
        const matchScript = ad.script_text?.toLowerCase().includes(q);
        const matchNotes = ad.notes?.toLowerCase().includes(q);
        const matchProd = ad.product?.name.toLowerCase().includes(q);
        const matchCreator = ad.creator?.name.toLowerCase().includes(q);
        const matchEditor = ad.editor?.name.toLowerCase().includes(q);
        const matchTags = ad.tags?.some((t) => t.name.toLowerCase().includes(q));
        if (
          !matchName &&
          !matchCamp &&
          !matchScript &&
          !matchNotes &&
          !matchProd &&
          !matchCreator &&
          !matchEditor &&
          !matchTags
        ) {
          return false;
        }
      }

      return true;
    });
  }, [
    allCreatives,
    adCampaignFilter,
    adProductFilter,
    adCreatorFilter,
    adEditorFilter,
    adStageFilter,
    adDownloadFilter,
    adSearch
  ]);

  const hasActiveAdFilters =
    adSearch.trim() !== "" ||
    adCampaignFilter !== "all" ||
    adProductFilter !== "all" ||
    adCreatorFilter !== "all" ||
    adEditorFilter !== "all" ||
    adStageFilter !== "all" ||
    adDownloadFilter !== "all";

  const resetAdFilters = () => {
    setAdSearch("");
    setAdCampaignFilter("all");
    setAdProductFilter("all");
    setAdCreatorFilter("all");
    setAdEditorFilter("all");
    setAdStageFilter("all");
    setAdDownloadFilter("all");
  };

  // Overall KPIs rollup
  const totals = useMemo(() => {
    let totalGoal = 0;
    let totalCreatives = 0;
    let totalApproved = 0;
    let totalInCreation = 0;
    let totalInReview = 0;
    let totalSpend = 0;
    let totalPurchases = 0;

    for (const item of campaignOverviews) {
      if (item.videoGoal && item.videoGoal > 0) {
        totalGoal += item.videoGoal;
      }
      totalCreatives += item.totalCreatives;
      totalApproved += item.approvedCount;
      totalInCreation += item.inCreationCount;
      totalInReview += item.inReviewCount;
      totalSpend += item.metrics.totalSpend;
      totalPurchases += item.metrics.totalPurchases;
    }

    const overallProgress = totalGoal > 0 ? Math.min(100, Math.round((totalApproved / totalGoal) * 100)) : null;
    return {
      totalCampaigns: campaignOverviews.length,
      totalGoal,
      totalCreatives,
      totalApproved,
      totalInCreation,
      totalInReview,
      overallProgress,
      totalSpend,
      totalPurchases
    };
  }, [campaignOverviews]);

  const openCreateModal = () => {
    setEditingCampaign(null);
    setName("");
    setDescription("");
    setVideoGoal(null);
    setActive(true);
    setErrorMessage(null);
    setModalOpen(true);
  };

  const openEditModal = (campaign: Campaign, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingCampaign(campaign);
    setName(campaign.name);
    setDescription(campaign.description ?? "");
    setVideoGoal(campaign.video_goal ?? null);
    setActive(campaign.active);
    setErrorMessage(null);
    setModalOpen(true);
  };

  const handleDuplicateCampaign = (campaign: Campaign) => {
    setEditingCampaign(null);
    setName(`${campaign.name} (Copy)`);
    setDescription(campaign.description ?? "");
    setVideoGoal(campaign.video_goal ?? null);
    setActive(campaign.active);
    setErrorMessage(null);
    setModalOpen(true);
  };

  const handleSaveCampaign = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage("Campaign name is required.");
      return;
    }

    setErrorMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() =>
        saveInternalCampaign({
          id: editingCampaign?.id,
          name: name.trim(),
          description: description.trim() || null,
          videoGoal: videoGoal != null ? Number(videoGoal) : null,
          active
        })
      );

      if (!response.ok) {
        setErrorMessage(response.message ?? "Failed to save campaign.");
        return;
      }

      setModalOpen(false);
      router.refresh();
    });
  };

  const handleDeleteCampaign = (campaignId: string, campaignName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete campaign "${campaignName}"?`)) return;

    startTransition(async () => {
      const response = await runServerAction(() => deleteInternalCampaign(campaignId));
      if (!response.ok) {
        alert(response.message ?? "Failed to delete campaign.");
        return;
      }
      router.refresh();
    });
  };

  const allCampaignIds = useMemo(() => filteredOverviews.map((item) => item.campaign.id), [filteredOverviews]);
  const isAllCampaignsSelected = allCampaignIds.length > 0 && allCampaignIds.every((id) => campaignsBulk.isSelected(id));
  const hasSomeCampaignsSelected = campaignsBulk.selectedIds.size > 0 && !isAllCampaignsSelected;

  const allAdIds = useMemo(() => filteredAds.map((ad) => ad.id), [filteredAds]);
  const isAllAdsSelected = allAdIds.length > 0 && allAdIds.every((id) => adsBulk.isSelected(id));
  const hasSomeAdsSelected = adsBulk.selectedIds.size > 0 && !isAllAdsSelected;

  // Excel columns definition for Campaigns View
  const campaignColumns: ExcelColumnDef<CampaignOverview>[] = useMemo(
    () => [
      {
        id: "select",
        header: (
          <div
            className="flex items-center justify-center size-full"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              ref={(el) => {
                if (el) el.indeterminate = hasSomeCampaignsSelected;
              }}
              checked={isAllCampaignsSelected}
              onChange={() => {
                if (isAllCampaignsSelected) {
                  campaignsBulk.clearSelection();
                } else {
                  campaignsBulk.selectAll(allCampaignIds);
                }
              }}
              aria-label="Select all campaigns"
              className="size-4 rounded border-border text-primary focus:ring-primary/20 cursor-pointer"
            />
          </div>
        ),
        sortable: false,
        defaultWidth: 44,
        minWidth: 44,
        maxWidth: 44,
        align: "center",
        cell: (item) => (
          <div
            className="flex items-center justify-center size-full"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={campaignsBulk.isSelected(item.campaign.id)}
              onChange={() => campaignsBulk.toggleSelect(item.campaign.id)}
              aria-label={`Select campaign ${item.campaign.name}`}
              className="size-4 rounded border-border text-primary focus:ring-primary/20 cursor-pointer"
            />
          </div>
        )
      },
      {
        id: "name",
        header: "Campaign Name",
        sortableValue: (item) => item.campaign.name,
        defaultWidth: 230,
        minWidth: 140,
        cell: (item) => (
          <div className="flex items-start gap-2">
            <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
              <FolderKanban className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <Link
                href={`/campaigns/${item.campaign.id}`}
                className="font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1 group/link"
              >
                <span className="break-words">{item.campaign.name}</span>
                <ArrowRight className="size-3 opacity-0 group-hover/link:opacity-100 transition-opacity shrink-0" />
              </Link>
              {item.campaign.description ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground whitespace-pre-wrap break-words line-clamp-1">
                  {item.campaign.description}
                </p>
              ) : null}
            </div>
          </div>
        )
      },
      {
        id: "thumbnails",
        header: "Videos",
        sortableValue: (item) => item.creatives.length,
        defaultWidth: 120,
        minWidth: 80,
        cell: (item) => {
          const sample = item.creatives.slice(0, 3);
          if (sample.length === 0) {
            return <span className="text-[11px] text-muted-foreground italic">—</span>;
          }
          return (
            <div className="flex items-center gap-1 py-0.5">
              {sample.map((ad) => (
                <MiniThumbnail key={ad.id} ad={ad} />
              ))}
              {item.creatives.length > 3 ? (
                <span className="text-[10px] font-mono text-muted-foreground ml-0.5">
                  +{item.creatives.length - 3}
                </span>
              ) : null}
            </div>
          );
        }
      },
      {
        id: "goal",
        header: "Goal",
        sortableValue: (item) => item.videoGoal ?? 0,
        defaultWidth: 75,
        minWidth: 50,
        align: "center",
        cell: (item) => (
          <span className="font-mono font-bold text-xs text-foreground">
            {item.videoGoal && item.videoGoal > 0 ? item.videoGoal : "—"}
          </span>
        )
      },
      {
        id: "creatives",
        header: "Total",
        sortableValue: (item) => item.totalCreatives,
        defaultWidth: 75,
        minWidth: 50,
        align: "center",
        cell: (item) => <span className="font-mono font-semibold text-xs text-foreground">{item.totalCreatives}</span>
      },
      {
        id: "progress",
        header: "Progress",
        sortableValue: (item) => item.goalProgressPercent ?? (item.videoGoal && item.videoGoal > 0 ? Math.round((item.approvedCount / item.videoGoal) * 100) : item.approvedCount),
        defaultWidth: 130,
        minWidth: 80,
        cell: (item) => {
          if (!item.videoGoal || item.videoGoal <= 0) {
            return (
              <span className="text-xs text-muted-foreground font-medium">
                {item.approvedCount} approved
              </span>
            );
          }
          return (
            <div className="space-y-1 w-full">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-foreground">
                  {item.approvedCount}/{item.videoGoal}
                </span>
                <span
                  className={cn(
                    "font-mono font-semibold text-[10px]",
                    (item.goalProgressPercent ?? 0) >= 100 ? "text-success" : "text-muted-foreground"
                  )}
                >
                  {item.goalProgressPercent ?? 0}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    (item.goalProgressPercent ?? 0) >= 100
                      ? "bg-success"
                      : (item.goalProgressPercent ?? 0) >= 50
                      ? "bg-primary"
                      : "bg-warning"
                  )}
                  style={{ width: `${item.goalProgressPercent ?? 0}%` }}
                />
              </div>
            </div>
          );
        }
      },
      {
        id: "approved",
        header: "Approved",
        sortableValue: (item) => item.approvedCount,
        defaultWidth: 85,
        minWidth: 50,
        align: "center",
        cell: (item) => (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold bg-success/15 text-success">
            <CheckCircle2 className="size-3" />
            {item.approvedCount}
          </span>
        )
      },
      {
        id: "in_creation",
        header: "Creation",
        sortableValue: (item) => item.inCreationCount,
        defaultWidth: 85,
        minWidth: 50,
        align: "center",
        cell: (item) => (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold bg-primary/15 text-primary">
            <Film className="size-3" />
            {item.inCreationCount}
          </span>
        )
      },
      {
        id: "in_review",
        header: "Review",
        sortableValue: (item) => item.inReviewCount,
        defaultWidth: 85,
        minWidth: 50,
        align: "center",
        cell: (item) => (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold bg-warning/15 text-warning">
            <Clock className="size-3" />
            {item.inReviewCount}
          </span>
        )
      },
      // Individual AdFlow Stage Columns
      {
        id: "stage_script",
        header: "Script",
        sortableValue: (item) => item.stageBreakdown.script_writing || 0,
        defaultWidth: 70,
        minWidth: 40,
        align: "center",
        cell: (item) => (
          <span className="font-mono text-xs text-foreground/80">{item.stageBreakdown.script_writing || "—"}</span>
        )
      },
      {
        id: "stage_shoot_ready",
        header: "Shoot Ready",
        sortableValue: (item) => item.stageBreakdown.ready_to_shoot || 0,
        defaultWidth: 85,
        minWidth: 45,
        align: "center",
        cell: (item) => (
          <span className="font-mono text-xs text-foreground/80">{item.stageBreakdown.ready_to_shoot || "—"}</span>
        )
      },
      {
        id: "stage_shot",
        header: "Shot",
        sortableValue: (item) => item.stageBreakdown.shoot_complete || 0,
        defaultWidth: 70,
        minWidth: 40,
        align: "center",
        cell: (item) => (
          <span className="font-mono text-xs text-foreground/80">{item.stageBreakdown.shoot_complete || "—"}</span>
        )
      },
      {
        id: "stage_handoff",
        header: "Handoff",
        sortableValue: (item) => item.stageBreakdown.ready_for_edit || 0,
        defaultWidth: 75,
        minWidth: 45,
        align: "center",
        cell: (item) => (
          <span className="font-mono text-xs text-foreground/80">{item.stageBreakdown.ready_for_edit || "—"}</span>
        )
      },
      {
        id: "stage_editing",
        header: "Editing",
        sortableValue: (item) => item.stageBreakdown.editing || 0,
        defaultWidth: 75,
        minWidth: 45,
        align: "center",
        cell: (item) => (
          <span className="font-mono text-xs text-foreground/80">{item.stageBreakdown.editing || "—"}</span>
        )
      },
      {
        id: "stage_creator_review",
        header: "Creator Rev",
        sortableValue: (item) => item.stageBreakdown.creator_review || 0,
        defaultWidth: 85,
        minWidth: 45,
        align: "center",
        cell: (item) => (
          <span className="font-mono text-xs text-foreground/80">{item.stageBreakdown.creator_review || "—"}</span>
        )
      },
      {
        id: "stage_final_review",
        header: "Final Rev",
        sortableValue: (item) => item.stageBreakdown.final_review || 0,
        defaultWidth: 80,
        minWidth: 45,
        align: "center",
        cell: (item) => (
          <span className="font-mono text-xs text-foreground/80">{item.stageBreakdown.final_review || "—"}</span>
        )
      },
      {
        id: "stage_creator_changes",
        header: "Creator Chg",
        sortableValue: (item) => item.stageBreakdown.creator_changes_requested || 0,
        defaultWidth: 85,
        minWidth: 45,
        align: "center",
        cell: (item) => (
          <span
            className={cn(
              "font-mono text-xs",
              item.stageBreakdown.creator_changes_requested ? "text-warning font-semibold" : "text-foreground/80"
            )}
          >
            {item.stageBreakdown.creator_changes_requested || "—"}
          </span>
        )
      },
      {
        id: "stage_editor_changes",
        header: "Editor Chg",
        sortableValue: (item) => item.stageBreakdown.changes_requested || 0,
        defaultWidth: 85,
        minWidth: 45,
        align: "center",
        cell: (item) => (
          <span
            className={cn(
              "font-mono text-xs",
              item.stageBreakdown.changes_requested ? "text-warning font-semibold" : "text-foreground/80"
            )}
          >
            {item.stageBreakdown.changes_requested || "—"}
          </span>
        )
      },
      {
        id: "status",
        header: "Status",
        sortableValue: (item) => (item.campaign.active ? 1 : 0),
        defaultWidth: 80,
        minWidth: 50,
        align: "center",
        cell: (item) => (
          <span
            className={cn(
              "inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
              item.campaign.active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
            )}
          >
            {item.campaign.active ? "Active" : "Archived"}
          </span>
        )
      },
      {
        id: "actions",
        header: "Actions",
        sortable: false,
        defaultWidth: 100,
        minWidth: 60,
        align: "center",
        cell: (item) => (
          <div className="flex items-center justify-center gap-1">
            <Link
              href={`/campaigns/${item.campaign.id}`}
              className="inline-flex size-7 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Open full campaign table"
            >
              <ExternalLink className="size-3.5" />
            </Link>
            {canManage ? (
              <>
                <button
                  onClick={(e) => openEditModal(item.campaign, e)}
                  className="inline-flex size-7 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title="Edit campaign settings"
                >
                  <Edit2 className="size-3.5" />
                </button>
                <button
                  onClick={(e) => handleDeleteCampaign(item.campaign.id, item.campaign.name, e)}
                  className="inline-flex size-7 items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  title="Delete campaign"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </>
            ) : null}
          </div>
        )
      }
    ],
    [canManage, campaignsBulk.selectedIds, campaignsBulk.toggleSelect, campaignsBulk.isSelected, campaignsBulk.clearSelection, campaignsBulk.selectAll, allCampaignIds, isAllCampaignsSelected, hasSomeCampaignsSelected]
  );

  // Excel columns definition for Ads View
  const adColumns: ExcelColumnDef<AdWithRelations & { campaign?: Campaign }>[] = useMemo(
    () => [
      {
        id: "select",
        header: (
          <div
            className="flex items-center justify-center size-full"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              ref={(el) => {
                if (el) el.indeterminate = hasSomeAdsSelected;
              }}
              checked={isAllAdsSelected}
              onChange={() => {
                if (isAllAdsSelected) {
                  adsBulk.clearSelection();
                } else {
                  adsBulk.selectAll(allAdIds);
                }
              }}
              className="size-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-background cursor-pointer"
              aria-label="Select all ads"
            />
          </div>
        ),
        sortable: false,
        defaultWidth: 44,
        minWidth: 44,
        maxWidth: 44,
        align: "center",
        cell: (ad) => (
          <div
            className="flex items-center justify-center size-full"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={adsBulk.isSelected(ad.id)}
              onChange={() => adsBulk.toggleSelect(ad.id)}
              className="size-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-background cursor-pointer"
              aria-label={`Select ${ad.name}`}
            />
          </div>
        )
      },
      {
        id: "thumbnail",
        header: "Video",
        sortable: false,
        defaultWidth: 70,
        minWidth: 55,
        align: "center",
        cell: (ad) => (
          <div
            className="flex items-center justify-center cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setPreviewAd(ad);
            }}
          >
            <MiniThumbnail ad={ad} />
          </div>
        )
      },
      {
        id: "name",
        header: "Ad / Creative Name",
        sortableValue: (ad) => ad.name,
        defaultWidth: 200,
        minWidth: 120,
        cell: (ad) => {
          const displayTags = (ad.tags ?? [])
            .filter((tag) => tag.name.toLowerCase() !== "downloaded")
            .slice(0, 2);
          return (
            <div className="space-y-0.5 overflow-hidden">
              <Link
                href={`/ads/${ad.id}`}
                className="font-semibold text-foreground hover:text-primary transition-colors block truncate"
              >
                {ad.name}
              </Link>
              {displayTags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {displayTags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-block rounded bg-muted px-1 py-0.2 text-[9px] text-muted-foreground"
                    >
                      #{tag.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }
      },
      {
        id: "downloaded",
        header: "Downloaded",
        sortableValue: (ad) => (isDownloaded(ad) ? 1 : 0),
        defaultWidth: 135,
        minWidth: 110,
        align: "center",
        cell: (ad) => {
          const downloaded = isDownloaded(ad);
          const isUpdating = updatingDownloadedId === ad.id;
          const isAdmin = profile.role === "admin";
          return (
            <div
              className="flex items-center justify-center size-full"
              onClick={(e) => e.stopPropagation()}
            >
              {isAdmin ? (
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => void handleToggleDownloaded(ad)}
                  className={cn(
                    "group/dl inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-all duration-150 border cursor-pointer select-none",
                    downloaded
                      ? "border-success/40 bg-success/15 text-success hover:bg-success/25 hover:border-success/60"
                      : "border-border/80 bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  title={
                    downloaded
                      ? "Downloaded · Click to remove downloaded badge"
                      : "Yet to download · Click to mark as downloaded"
                  }
                >
                  {isUpdating ? (
                    <Loader2 className="size-2.5 animate-spin shrink-0" />
                  ) : downloaded ? (
                    <Download className="size-2.5 shrink-0 text-success" />
                  ) : (
                    <Clock className="size-2.5 shrink-0 text-muted-foreground/70" />
                  )}
                  <span>{downloaded ? "Downloaded" : "Yet to download"}</span>
                </button>
              ) : (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold border",
                    downloaded
                      ? "border-success/40 bg-success/15 text-success"
                      : "border-border/80 bg-muted/60 text-muted-foreground"
                  )}
                >
                  {downloaded ? (
                    <Download className="size-2.5 shrink-0 text-success" />
                  ) : (
                    <Clock className="size-2.5 shrink-0 text-muted-foreground/70" />
                  )}
                  <span>{downloaded ? "Downloaded" : "Yet to download"}</span>
                </span>
              )}
            </div>
          );
        }
      },
      {
        id: "campaign",
        header: "Campaign",
        sortableValue: (ad) => ad.campaign?.name ?? "",
        defaultWidth: 170,
        minWidth: 110,
        cell: (ad) => (
          <Link
            href={`/campaigns/${ad.campaign_id}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors max-w-full truncate group/camp"
          >
            <FolderKanban className="size-3 text-primary shrink-0" />
            <span className="truncate">{ad.campaign?.name ?? "Campaign"}</span>
            <ExternalLink className="size-2.5 text-muted-foreground opacity-0 group-hover/camp:opacity-100 transition-opacity shrink-0" />
          </Link>
        )
      },
      {
        id: "product",
        header: "Product",
        sortableValue: (ad) => ad.product?.name ?? "",
        defaultWidth: 130,
        minWidth: 80,
        cell: (ad) => (
          <div className="flex items-center gap-1.5 overflow-hidden">
            {ad.product?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ad.product.image_url}
                alt={ad.product.name}
                className="size-5 shrink-0 rounded object-cover border border-border"
              />
            ) : null}
            <span className="font-medium text-foreground text-xs truncate">
              {ad.product?.name ?? "—"}
            </span>
          </div>
        )
      },
      {
        id: "status",
        header: "Status",
        sortableValue: (ad) => ad.status,
        defaultWidth: 130,
        minWidth: 90,
        cell: (ad) => <CreativeStatusBadge ad={ad} />
      },
      {
        id: "stage",
        header: "Stage",
        sortableValue: (ad) => ad.production_stage,
        defaultWidth: 130,
        minWidth: 80,
        cell: (ad) => <ProductionStageBadge stage={ad.production_stage} role={profile.role} />
      },
      {
        id: "creator",
        header: "Creator",
        sortableValue: (ad) => ad.creator?.name ?? "",
        defaultWidth: 130,
        minWidth: 70,
        cell: (ad) =>
          ad.creator ? (
            <div className="flex items-center gap-1.5 overflow-hidden">
              <Avatar name={ad.creator.name} src={ad.creator.avatar_url} className="size-5 shrink-0" />
              <span className="font-medium text-foreground text-xs truncate">{ad.creator.name}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )
      },
      {
        id: "editor",
        header: "Editor",
        sortableValue: (ad) => ad.editor?.name ?? "",
        defaultWidth: 130,
        minWidth: 70,
        cell: (ad) =>
          ad.editor ? (
            <div className="flex items-center gap-1.5 overflow-hidden">
              <Avatar name={ad.editor.name} src={ad.editor.avatar_url} className="size-5 shrink-0" />
              <span className="font-medium text-foreground text-xs truncate">{ad.editor.name}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground italic">Unassigned</span>
          )
      },
      {
        id: "script",
        header: "Script",
        sortableValue: (ad) => ad.script_text ?? "",
        defaultWidth: 200,
        minWidth: 60,
        cell: (ad) => {
          const text = ad.script_text || "—";
          const hasText = Boolean(ad.script_text);
          return (
            <div
              onClick={(e) => {
                if (hasText) {
                  e.stopPropagation();
                  setSelectedScriptAd(ad);
                }
              }}
              className={cn(
                "text-xs leading-relaxed text-foreground/90 font-normal whitespace-pre-wrap break-words line-clamp-2 w-full",
                hasText && "cursor-pointer hover:text-primary transition-colors"
              )}
              title={hasText ? "Click to view full script" : undefined}
            >
              {text}
            </div>
          );
        }
      },
      {
        id: "deadline",
        header: "Deadline",
        sortableValue: (ad) => (ad.deadline ? new Date(ad.deadline).getTime() : 0),
        defaultWidth: 100,
        minWidth: 60,
        cell: (ad) => (
          <span className="text-xs font-mono text-muted-foreground">
            {ad.deadline ? formatDateOnly(ad.deadline) : "—"}
          </span>
        )
      },
      {
        id: "actions",
        header: "Actions",
        sortable: false,
        defaultWidth: 75,
        minWidth: 50,
        align: "center",
        cell: (ad) => (
          <div className="flex items-center justify-center gap-1">
            <Link
              href={`/ads/${ad.id}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex size-6 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Open creative review"
            >
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        )
      }
    ],
    [profile.role, adsBulk.selectedIds, adsBulk.toggleSelect, adsBulk.isSelected, adsBulk.clearSelection, adsBulk.selectAll, allAdIds, isAllAdsSelected, hasSomeAdsSelected, updatingDownloadedId, handleToggleDownloaded]
  );

  return (
    <main className="page-container space-y-5 pb-12">
      {/* Top Static Header with Folder-Type View Switcher on the Left */}
      <div className="flex flex-col gap-3 border-b border-border pb-px sm:flex-row sm:items-center sm:justify-between">
        {/* Left Side: Folder-type Tab Switcher replacing the title */}
        <div className="flex items-end gap-1.5 -mb-px">
          {/* Campaigns Folder Tab */}
          <button
            type="button"
            onClick={() => setDashboardView("campaigns")}
            className={cn(
              "group relative flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm transition-all duration-150",
              dashboardView === "campaigns"
                ? "border-t-2 border-primary border-x border-border bg-card text-foreground font-semibold shadow-2xs z-10"
                : "border-t border-x border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40 font-medium"
            )}
          >
            <div
              className={cn(
                "flex size-5 items-center justify-center rounded transition-colors",
                dashboardView === "campaigns"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground group-hover:text-foreground"
              )}
            >
              <FolderKanban className="size-3.5" />
            </div>
            <span className="text-base tracking-tight font-semibold">Campaigns</span>
            <span
              className={cn(
                "ml-0.5 rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                dashboardView === "campaigns"
                  ? "bg-primary/10 text-primary font-semibold"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {campaignOverviews.length}
            </span>
          </button>

          {/* Ads Folder Tab */}
          <button
            type="button"
            onClick={() => setDashboardView("ads")}
            className={cn(
              "group relative flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm transition-all duration-150",
              dashboardView === "ads"
                ? "border-t-2 border-primary border-x border-border bg-card text-foreground font-semibold shadow-2xs z-10"
                : "border-t border-x border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40 font-medium"
            )}
          >
            <div
              className={cn(
                "flex size-5 items-center justify-center rounded transition-colors",
                dashboardView === "ads"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground group-hover:text-foreground"
              )}
            >
              <AppWindow className="size-3.5" />
            </div>
            <span className="text-base tracking-tight font-semibold">Ads</span>
            <span
              className={cn(
                "ml-0.5 rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                dashboardView === "ads"
                  ? "bg-primary/10 text-primary font-semibold"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {allCreatives.length}
            </span>
          </button>
        </div>

        {/* Right Side: Standard Dashboard Action Buttons */}
        <div className="flex items-center gap-2.5 pb-2 sm:pb-0">
          {canManage ? (
            <Button onClick={openCreateModal} className="h-9 gap-1.5 shadow-xs">
              <Plus className="size-4" />
              Create campaign
            </Button>
          ) : null}
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Campaigns</span>
            <FolderKanban className="size-4 text-primary" />
          </div>
          <p className="mt-1 text-xl font-bold text-foreground">{totals.totalCampaigns}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Video Goals</span>
            <Target className="size-4 text-warning" />
          </div>
          <p className="mt-1 text-xl font-bold text-foreground">
            {totals.totalGoal > 0 ? totals.totalGoal : "—"}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Total Creatives</span>
            <Film className="size-4 text-primary" />
          </div>
          <p className="mt-1 text-xl font-bold text-foreground">{totals.totalCreatives}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Approved</span>
            <CheckCircle2 className="size-4 text-success" />
          </div>
          <p className="mt-1 text-xl font-bold text-success">{totals.totalApproved}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">In Creation</span>
            <Film className="size-4 text-primary" />
          </div>
          <p className="mt-1 text-xl font-bold text-primary">{totals.totalInCreation}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">In Review</span>
            <Clock className="size-4 text-warning" />
          </div>
          <p className="mt-1 text-xl font-bold text-warning">{totals.totalInReview}</p>
        </div>
      </div>

      {/* VIEW 1: CAMPAIGNS VIEW */}
      {dashboardView === "campaigns" && (
        <>
          {/* Filter Bar for Campaigns */}
          <div className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-md">
                <div className="relative w-full">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search campaigns (e.g. Navratri, Diwali Sale)..."
                    className="pl-9 h-9 text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={campaignsBulk.selectedIds.size === 0}
                  onClick={() => {
                    const ids = Array.from(campaignsBulk.selectedIds);
                    if (ids.length > 0) {
                      const firstCamp = campaignOverviews.find((c) => c.campaign.id === ids[0]);
                      if (firstCamp) {
                        handleDuplicateCampaign(firstCamp.campaign);
                      }
                    }
                  }}
                  className="h-8 text-xs gap-1.5"
                  title={campaignsBulk.selectedIds.size === 0 ? "Select a campaign to duplicate" : "Duplicate selected campaign"}
                >
                  <Copy className="size-3.5" />
                  Duplicate
                </Button>

                <Button
                  size="sm"
                  variant="secondary"
                  disabled={campaignsBulk.selectedIds.size !== 1}
                  onClick={() => {
                    const id = Array.from(campaignsBulk.selectedIds)[0];
                    const camp = campaignOverviews.find((c) => c.campaign.id === id);
                    if (camp) openEditModal(camp.campaign);
                  }}
                  className="h-8 text-xs gap-1.5"
                  title={campaignsBulk.selectedIds.size !== 1 ? "Select exactly one campaign to edit" : "Edit selected campaign"}
                >
                  <Edit2 className="size-3.5" />
                  Edit
                </Button>

                <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs">
                  <button
                    onClick={() => setFilterActive("all")}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      filterActive === "all"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    All ({campaignOverviews.length})
                  </button>
                  <button
                    onClick={() => setFilterActive("active")}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      filterActive === "active"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Active
                  </button>
                  <button
                    onClick={() => setFilterActive("inactive")}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      filterActive === "inactive"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Archived
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">

                <Button
                  size="sm"
                  variant={showFilters ? "secondary" : "ghost"}
                  onClick={() => setShowFilters(!showFilters)}
                  className="h-8 text-xs"
                >
                  <SlidersHorizontal className="size-3.5 mr-1.5" />
                  Filters
                  {hasActiveFilters && (
                    <span className="ml-1.5 flex size-2 rounded-full bg-primary" />
                  )}
                </Button>

                {hasActiveFilters && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={resetFilters}
                    className="h-8 text-xs text-muted-foreground"
                  >
                    <RotateCcw className="size-3 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {/* Collapsible Advanced Filters */}
            {showFilters && (
              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border sm:grid-cols-4 text-xs">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Product</label>
                  <Select
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    className="h-8 text-xs"
                  >
                    <option value="all">All Products</option>
                    {allProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Creator</label>
                  <Select
                    value={selectedCreatorId}
                    onChange={(e) => setSelectedCreatorId(e.target.value)}
                    className="h-8 text-xs"
                  >
                    <option value="all">All Creators</option>
                    {allCreators.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Editor</label>
                  <Select
                    value={selectedEditorId}
                    onChange={(e) => setSelectedEditorId(e.target.value)}
                    className="h-8 text-xs"
                  >
                    <option value="all">All Editors</option>
                    {allEditors.map((ed) => (
                      <option key={ed.id} value={ed.id}>
                        {ed.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Goal Target</label>
                  <Select
                    value={selectedProgress}
                    onChange={(e) => setSelectedProgress(e.target.value)}
                    className="h-8 text-xs"
                  >
                    <option value="all">All Progress</option>
                    <option value="completed">Goal Achieved (100%+)</option>
                    <option value="in_progress">In Progress</option>
                    <option value="empty">No Creatives</option>
                  </Select>
                </div>
              </div>
            )}
          </div>

          {/* Excel Spreadsheet Table for Campaigns */}
          <ExcelTable
            columns={campaignColumns}
            data={filteredOverviews}
            getRowKey={(item) => item.campaign.id}
            title="Campaigns Overview"
            storageKey="campaigns_overview"
            emptyMessage="No campaigns found matching your filter criteria."
            onRowClick={(item) => {
              router.push(`/campaigns/${item.campaign.id}`);
            }}
          />
        </>
      )}

      {/* VIEW 2: ADS VIEW */}
      {dashboardView === "ads" && (
        <>
          {/* Filter Bar for Ads */}
          <div className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-md">
                <div className="relative w-full">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={adSearch}
                    onChange={(e) => setAdSearch(e.target.value)}
                    placeholder="Search ads (e.g. Navratri Hook, Diwali Offer, script)..."
                    className="pl-9 h-9 text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={adsBulk.selectedIds.size !== 1}
                  onClick={() => {
                    const id = Array.from(adsBulk.selectedIds)[0];
                    if (id) router.push(`/ads/${id}`);
                  }}
                  className="h-8 text-xs gap-1.5"
                  title={adsBulk.selectedIds.size !== 1 ? "Select exactly one ad to review" : "Open ad review"}
                >
                  <Edit2 className="size-3.5" />
                  Edit
                </Button>

                <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs">
                  <button
                    onClick={() => setAdStageFilter("all")}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      adStageFilter === "all"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    All ({allCreatives.length})
                  </button>
                  <button
                    onClick={() => setAdStageFilter("approved")}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      adStageFilter === "approved"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Approved ({totals.totalApproved})
                  </button>
                  <button
                    onClick={() => setAdStageFilter("in_review")}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      adStageFilter === "in_review"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Review ({totals.totalInReview})
                  </button>
                  <button
                    onClick={() => setAdStageFilter("in_creation")}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      adStageFilter === "in_creation"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Creation ({totals.totalInCreation})
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={showAdFilters ? "secondary" : "ghost"}
                  onClick={() => setShowAdFilters(!showAdFilters)}
                  className="h-8 text-xs"
                >
                  <SlidersHorizontal className="size-3.5 mr-1.5" />
                  Filters
                  {hasActiveAdFilters && (
                    <span className="ml-1.5 flex size-2 rounded-full bg-primary" />
                  )}
                </Button>

                <Button
                  size="sm"
                  variant={adsBulk.selectedIds.size > 0 ? "secondary" : "ghost"}
                  onClick={() => {
                    if (adsBulk.isAllSelected(filteredAds.map((a) => a.id))) {
                      adsBulk.clearSelection();
                    } else {
                      adsBulk.selectAll(filteredAds.map((a) => a.id));
                    }
                  }}
                  className="h-8 text-xs gap-1.5"
                >
                  <SquareCheck className="size-3.5" />
                  {adsBulk.isAllSelected(filteredAds.map((a) => a.id))
                    ? "Deselect all"
                    : "Select all"}
                </Button>

                {hasActiveAdFilters && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={resetAdFilters}
                    className="h-8 text-xs text-muted-foreground"
                  >
                    <RotateCcw className="size-3 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {/* Collapsible Advanced Filters for Ads */}
            {showAdFilters && (
              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border sm:grid-cols-5 text-xs">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Campaign</label>
                  <Select
                    value={adCampaignFilter}
                    onChange={(e) => setAdCampaignFilter(e.target.value)}
                    className="h-8 text-xs"
                  >
                    <option value="all">All Campaigns</option>
                    {campaignOverviews.map((ov) => (
                      <option key={ov.campaign.id} value={ov.campaign.id}>
                        {ov.campaign.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Download Status</label>
                  <Select
                    value={adDownloadFilter}
                    onChange={(e) => setAdDownloadFilter(e.target.value as "all" | "downloaded" | "not_downloaded")}
                    className="h-8 text-xs"
                  >
                    <option value="all">All Download States</option>
                    <option value="downloaded">Downloaded</option>
                    <option value="not_downloaded">Yet to download</option>
                  </Select>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Product</label>
                  <Select
                    value={adProductFilter}
                    onChange={(e) => setAdProductFilter(e.target.value)}
                    className="h-8 text-xs"
                  >
                    <option value="all">All Products</option>
                    {allProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Creator</label>
                  <Select
                    value={adCreatorFilter}
                    onChange={(e) => setAdCreatorFilter(e.target.value)}
                    className="h-8 text-xs"
                  >
                    <option value="all">All Creators</option>
                    {allCreators.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Editor</label>
                  <Select
                    value={adEditorFilter}
                    onChange={(e) => setAdEditorFilter(e.target.value)}
                    className="h-8 text-xs"
                  >
                    <option value="all">All Editors</option>
                    {allEditors.map((ed) => (
                      <option key={ed.id} value={ed.id}>
                        {ed.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            )}
          </div>

          {/* Bulk Download Progress Status */}
          {adsBulk.bulkExportJob || adsBulk.isDownloading ? (
            <BulkDownloadProgress
              job={adsBulk.bulkExportJob}
              progress={adsBulk.bulkDownloadProgress}
              count={adsBulk.bulkDownloadCount}
              complete={adsBulk.bulkDownloadComplete}
              onDismiss={adsBulk.dismissDownload}
            />
          ) : null}

          {/* Bulk Actions Bar if ads selected */}
          {adsBulk.selectedIds.size > 0 && (
            <BulkActionsBar
              selectedCount={adsBulk.selectedIds.size}
              totalFilteredCount={filteredAds.length}
              onSelectAll={() => adsBulk.selectAll(filteredAds.map((a) => a.id))}
              onClear={adsBulk.clearSelection}
              onDownloadZip={() => adsBulk.downloadZip("campaign-ads")}
              isDownloading={adsBulk.isDownloading}
              downloadPercent={adsBulk.bulkDownloadProgress?.percent}
              onMarkDownloaded={profile.role === "admin" ? () => void handleBulkDownloaded(true) : undefined}
              onRemoveDownloaded={profile.role === "admin" ? () => void handleBulkDownloaded(false) : undefined}
              isUpdatingDownloaded={isBulkUpdatingDownloaded}
            />
          )}

          {/* Excel Spreadsheet Table for Ads */}
          <ExcelTable
            columns={adColumns}
            data={filteredAds}
            getRowKey={(ad) => ad.id}
            title="All Campaign Ads"
            storageKey="campaigns_all_ads"
            emptyMessage="No ads found matching your filter criteria."
            onRowClick={(ad) => {
              router.push(`/ads/${ad.id}`);
            }}
          />
        </>
      )}

      {/* Video Preview Modal */}
      {previewAd ? <AdPreviewModal ad={previewAd} onClose={() => setPreviewAd(null)} /> : null}

      {/* Full Script Modal */}
      {selectedScriptAd ? (
        <AdScriptModal ad={selectedScriptAd} onClose={() => setSelectedScriptAd(null)} />
      ) : null}

      {/* Create / Edit Campaign Modal */}
      {modalOpen ? (
        <Modal
          open
          labelledBy="campaign-modal-title"
          onClose={() => setModalOpen(false)}
          className="flex items-center justify-center p-4 sm:p-6"
        >
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-float overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border px-6 py-5 bg-muted/20">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                  <FolderKanban className="size-5" />
                </div>
                <div>
                  <h3 id="campaign-modal-title" className="text-base font-semibold text-foreground">
                    {editingCampaign ? "Edit Campaign" : "Create Campaign"}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {editingCampaign
                      ? "Update campaign targets, status, or creative guidelines."
                      : "Define campaign targets, creative goals, and details."}
                  </p>
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => setModalOpen(false)}
              >
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </Button>
            </div>

            <form onSubmit={handleSaveCampaign} className="p-6 space-y-5">
              {errorMessage ? (
                <div className="flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-xs text-destructive">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{errorMessage}</span>
                </div>
              ) : null}

              <div className="space-y-4">
                <Field
                  label="Campaign Name *"
                  hint="A clear title like Navratri Sale 2026, Diwali Festive Special, or Pooja Gifting."
                >
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Navratri Sale 2026, Diwali Festive Special, Pooja Bundle Blast"
                    autoFocus
                    required
                    className="h-10 text-sm"
                  />
                </Field>

                <Field
                  label="Number of Creatives"
                  hint="Target number of creative videos to produce for this campaign (optional)."
                >
                  <div className="relative flex items-center">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={videoGoal === null ? "" : videoGoal}
                      onChange={(e) =>
                        setVideoGoal(e.target.value === "" ? null : Math.max(1, parseInt(e.target.value) || 1))
                      }
                      placeholder="e.g. 10 (optional)"
                      className="h-10 pr-24 font-mono text-sm"
                    />
                    <div className="pointer-events-none absolute right-3 flex items-center rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      creatives
                    </div>
                  </div>
                </Field>

                <Field
                  label="Description"
                  hint="Optional objectives, creative guidelines, hooks, or notes."
                >
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Add campaign goals, creative requirements, angle concepts, or notes..."
                    className="min-h-[96px] text-xs leading-relaxed resize-y"
                  />
                </Field>

                <label className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3.5 cursor-pointer hover:bg-muted/40 transition">
                  <div className="space-y-0.5">
                    <span className="text-xs font-semibold text-foreground">Active Campaign</span>
                    <p className="text-[11px] text-muted-foreground">
                      Active campaigns appear in creative submission menus and track live metrics.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                    className="size-4.5 rounded border-border text-primary focus:ring-primary focus:ring-offset-background cursor-pointer"
                  />
                </label>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setModalOpen(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending || !name.trim()} className="gap-2">
                  {isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  {editingCampaign ? "Save changes" : "Create campaign"}
                </Button>
              </div>
            </form>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
