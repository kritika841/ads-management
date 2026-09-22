"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
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
  Target,
  Trash2,
  Video,
  X
} from "lucide-react";
import { ExcelColumnDef, ExcelTable } from "@/components/campaigns/excel-table";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { saveInternalCampaign, deleteInternalCampaign } from "@/app/actions/campaigns";
import { runServerAction } from "@/lib/client-action";
import type { AdWithRelations, Campaign, CampaignOverview, Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

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

export function CampaignsDashboardClient({
  profile,
  campaignOverviews
}: {
  profile: Profile;
  campaignOverviews: CampaignOverview[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("all");
  const [selectedProductId, setSelectedProductId] = useState<string>("all");
  const [selectedCreatorId, setSelectedCreatorId] = useState<string>("all");
  const [selectedEditorId, setSelectedEditorId] = useState<string>("all");
  const [selectedProgress, setSelectedProgress] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);

  const [isPending, startTransition] = useTransition();

  // Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [videoGoal, setVideoGoal] = useState(10);
  const [active, setActive] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canManage = profile.role === "admin" || profile.role === "manager";

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

  // Filtered overviews
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

      if (selectedProgress === "completed" && item.goalProgressPercent < 100) return false;
      if (selectedProgress === "in_progress" && (item.goalProgressPercent >= 100 || item.totalCreatives === 0))
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
      totalGoal += item.videoGoal;
      totalCreatives += item.totalCreatives;
      totalApproved += item.approvedCount;
      totalInCreation += item.inCreationCount;
      totalInReview += item.inReviewCount;
      totalSpend += item.metrics.totalSpend;
      totalPurchases += item.metrics.totalPurchases;
    }

    const overallProgress = totalGoal > 0 ? Math.min(100, Math.round((totalApproved / totalGoal) * 100)) : 0;
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
    setVideoGoal(10);
    setActive(true);
    setErrorMessage(null);
    setModalOpen(true);
  };

  const openEditModal = (campaign: Campaign, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingCampaign(campaign);
    setName(campaign.name);
    setDescription(campaign.description ?? "");
    setVideoGoal(campaign.video_goal ?? 10);
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
          videoGoal: Number(videoGoal) || 10,
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

  // Excel columns definition
  const columns: ExcelColumnDef<CampaignOverview>[] = useMemo(
    () => [
      {
        id: "name",
        header: "Campaign Name",
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
        defaultWidth: 75,
        minWidth: 50,
        align: "center",
        cell: (item) => <span className="font-mono font-bold text-xs text-foreground">{item.videoGoal}</span>
      },
      {
        id: "creatives",
        header: "Total",
        defaultWidth: 75,
        minWidth: 50,
        align: "center",
        cell: (item) => <span className="font-mono font-semibold text-xs text-foreground">{item.totalCreatives}</span>
      },
      {
        id: "progress",
        header: "Progress",
        defaultWidth: 130,
        minWidth: 80,
        cell: (item) => (
          <div className="space-y-1 w-full">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-foreground">
                {item.approvedCount}/{item.videoGoal}
              </span>
              <span
                className={cn(
                  "font-mono font-semibold text-[10px]",
                  item.goalProgressPercent >= 100 ? "text-success" : "text-muted-foreground"
                )}
              >
                {item.goalProgressPercent}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  item.goalProgressPercent >= 100
                    ? "bg-success"
                    : item.goalProgressPercent >= 50
                    ? "bg-primary"
                    : "bg-warning"
                )}
                style={{ width: `${item.goalProgressPercent}%` }}
              />
            </div>
          </div>
        )
      },
      {
        id: "approved",
        header: "Approved",
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
        id: "metrics_spend",
        header: "Spend",
        defaultWidth: 95,
        minWidth: 55,
        align: "right",
        cell: (item) => (
          <span className="font-mono text-xs text-foreground">
            {item.metrics.totalSpend > 0 ? `₹${item.metrics.totalSpend.toLocaleString("en-IN")}` : "—"}
          </span>
        )
      },
      {
        id: "metrics_cpa",
        header: "CPA",
        defaultWidth: 85,
        minWidth: 50,
        align: "right",
        cell: (item) => (
          <span className="font-mono text-xs text-foreground">
            {item.metrics.averageCpa != null ? `₹${item.metrics.averageCpa.toFixed(1)}` : "—"}
          </span>
        )
      },
      {
        id: "status",
        header: "Status",
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
    [canManage]
  );

  return (
    <main className="page-container space-y-5 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FolderKanban className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Campaigns</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canManage ? (
            <Button onClick={openCreateModal} className="h-9 gap-1.5 shadow-sm">
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
          <p className="mt-1 text-xl font-bold text-foreground">{totals.totalGoal}</p>
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

      {/* Top Filter Bar */}
      <div className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-md">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search campaigns..."
                className="pl-9 h-9 text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs">
              <button
                onClick={() => setFilterActive("all")}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium transition-colors",
                  filterActive === "all" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
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
              <Button size="sm" variant="ghost" onClick={resetFilters} className="h-8 text-xs text-muted-foreground">
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

      {/* Excel Spreadsheet Table */}
      <ExcelTable
        columns={columns}
        data={filteredOverviews}
        getRowKey={(item) => item.campaign.id}
        title="Campaigns Overview"
        storageKey="campaigns_overview"
        emptyMessage="No campaigns found matching your filter criteria."
        onRowClick={(item) => {
          router.push(`/campaigns/${item.campaign.id}`);
        }}
      />

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
                  hint="A clear, identifiable title for internal tracking and creative assignment."
                >
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Summer Launch 2026, TikTok UGC Blitz"
                    autoFocus
                    required
                    className="h-10 text-sm"
                  />
                </Field>

                <Field
                  label="Number of Creatives *"
                  hint="Target number of creative videos to produce for this campaign."
                >
                  <div className="relative flex items-center">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={videoGoal}
                      onChange={(e) => setVideoGoal(Math.max(1, parseInt(e.target.value) || 1))}
                      placeholder="10"
                      required
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
