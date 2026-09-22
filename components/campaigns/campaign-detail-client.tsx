"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Film,
  Filter,
  FolderKanban,
  Maximize2,
  Minimize2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Search,
  SlidersHorizontal,
  Target,
  Video,
  X
} from "lucide-react";
import { ExcelColumnDef, ExcelTable } from "@/components/campaigns/excel-table";
import { AdPreviewModal } from "@/components/dashboard/ad-preview-modal";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { CreatorItemForm } from "@/components/workflow/creator-item-form";
import { ProductionStageBadge } from "@/components/workflow/production-stage";
import type { AdWithRelations, Campaign, CampaignOverview, Product, Profile } from "@/lib/types";
import { cn, formatDateOnly } from "@/lib/utils";

function getAdThumbnailUrl(ad: AdWithRelations): string {
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

export function CreativeStatusBadge({ ad }: { ad: AdWithRelations }) {
  const stage = ad.production_stage;
  const status = ad.status;

  // Approved
  if (stage === "approved" || status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success whitespace-nowrap">
        <CheckCircle2 className="size-3 shrink-0" />
        Approved
      </span>
    );
  }

  // Changes Requested
  if (
    stage === "creator_changes_requested" ||
    stage === "changes_requested" ||
    status === "changes_requested"
  ) {
    const isCreator = stage === "creator_changes_requested";
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning whitespace-nowrap"
        title={ad.latest_change_request?.note ? `Changes: "${ad.latest_change_request.note}"` : "Changes requested"}
      >
        <AlertTriangle className="size-3 shrink-0" />
        Changes Requested
        <span className="text-[9px] font-normal opacity-85">({isCreator ? "Creator" : "Editor"})</span>
      </span>
    );
  }

  // In Review
  if (stage === "final_review" || stage === "creator_review" || status === "pending_review") {
    const isFinal = stage === "final_review";
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary whitespace-nowrap">
        <Clock className="size-3 shrink-0" />
        In Review
        <span className="text-[9px] font-normal opacity-85">({isFinal ? "Final" : "Creator"})</span>
      </span>
    );
  }

  // Production stages
  if (stage === "editing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary whitespace-nowrap">
        <Scissors className="size-3 shrink-0" />
        Editing
      </span>
    );
  }

  if (stage === "shoot_complete") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary whitespace-nowrap">
        <Video className="size-3 shrink-0" />
        Clips Done
      </span>
    );
  }

  if (stage === "ready_to_shoot") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap">
        <Camera className="size-3 shrink-0" />
        Ready to Shoot
      </span>
    );
  }

  if (stage === "ready_for_edit") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary whitespace-nowrap">
        <Film className="size-3 shrink-0" />
        Ready for Edit
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap">
      <FileText className="size-3 shrink-0" />
      Script Writing
    </span>
  );
}

function FullScriptModal({
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
          <div className="min-w-0 pr-2">
            <h2 id="script-modal-title" className="text-base font-semibold text-foreground truncate">
              {ad.name}
            </h2>
          </div>
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
                <ExternalLink className="size-3" />
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

function CreativeThumbnail({
  ad,
  onPreview
}: {
  ad: AdWithRelations;
  onPreview: (ad: AdWithRelations) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [triedProduct, setTriedProduct] = useState(false);

  const primarySrc = getAdThumbnailUrl(ad);
  const productFallback = ad.product?.image_url;

  const currentSrc = !failed ? primarySrc : (!triedProduct && productFallback ? productFallback : null);

  const handleError = () => {
    if (!triedProduct && productFallback && productFallback !== primarySrc) {
      setTriedProduct(true);
    } else {
      setFailed(true);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center gap-1 py-1">
      <div
        onClick={(e) => {
          e.stopPropagation();
          onPreview(ad);
        }}
        className="group/thumb relative size-14 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border bg-muted/60 shadow-xs hover:border-primary transition-all duration-150"
        title="Click to preview video"
      >
        {currentSrc && !(failed && triedProduct) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentSrc}
            alt={ad.name}
            loading="lazy"
            className="size-full object-cover group-hover/thumb:scale-105 transition-transform duration-200"
            onError={handleError}
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center bg-gradient-to-br from-muted/80 to-muted text-muted-foreground p-1 text-center">
            <Film className="size-4 opacity-50 mb-0.5" />
            <span className="text-[9px] font-mono leading-none truncate max-w-full opacity-70">
              {ad.name.slice(0, 7)}
            </span>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity">
          <Play className="size-4 text-white fill-white" />
        </div>
      </div>

      {ad.drive_url ? (
        <a
          href={ad.drive_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-primary transition-colors max-w-full truncate font-mono"
          title="Open in Drive"
        >
          <Video className="size-2.5 shrink-0" />
          <span className="truncate">Drive</span>
        </a>
      ) : null}
    </div>
  );
}

export function CampaignDetailClient({
  overview,
  profile,
  campaigns,
  products,
  profiles,
  availableTags,
  editorWorkloads = {}
}: {
  overview: CampaignOverview;
  profile: Profile;
  campaigns: Campaign[];
  products: Product[];
  profiles: Profile[];
  availableTags: string[];
  editorWorkloads?: Record<string, number>;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [creatorFilter, setCreatorFilter] = useState<string>("all");
  const [editorFilter, setEditorFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);

  const [previewAd, setPreviewAd] = useState<AdWithRelations | null>(null);
  const [selectedScriptAd, setSelectedScriptAd] = useState<AdWithRelations | null>(null);
  const [editingAd, setEditingAd] = useState<AdWithRelations | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const creators = useMemo(() => profiles.filter((p) => p.role === "content_creator"), [profiles]);
  const editors = useMemo(() => profiles.filter((p) => p.role === "editor"), [profiles]);

  const canAddCreative =
    profile.role === "content_creator" || profile.role === "admin" || profile.role === "manager";

  // Filter creatives
  const filteredCreatives = useMemo(() => {
    return overview.creatives.filter((creative) => {
      if (stageFilter !== "all") {
        if (stageFilter === "approved" && creative.production_stage !== "approved" && creative.status !== "approved") {
          return false;
        }
        if (stageFilter === "changes_requested_all") {
          const isChange =
            creative.production_stage === "changes_requested" ||
            creative.production_stage === "creator_changes_requested" ||
            creative.status === "changes_requested";
          if (!isChange) return false;
        }
        if (stageFilter === "in_review") {
          const reviewStages = ["creator_review", "final_review", "creator_changes_requested", "changes_requested"];
          if (!reviewStages.includes(creative.production_stage)) return false;
        }
        if (stageFilter === "in_creation") {
          const creationStages = ["script_writing", "ready_to_shoot", "shoot_complete", "ready_for_edit", "editing"];
          if (!creationStages.includes(creative.production_stage)) return false;
        }
        if (
          stageFilter !== "approved" &&
          stageFilter !== "changes_requested_all" &&
          stageFilter !== "in_review" &&
          stageFilter !== "in_creation" &&
          creative.production_stage !== stageFilter
        ) {
          return false;
        }
      }

      if (creatorFilter !== "all" && creative.creator_id !== creatorFilter) return false;
      if (editorFilter !== "all" && creative.editor_id !== editorFilter) return false;
      if (productFilter !== "all" && creative.product_id !== productFilter) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = creative.name.toLowerCase().includes(q);
        const matchScript = creative.script_text?.toLowerCase().includes(q);
        const matchCreator = creative.creator?.name.toLowerCase().includes(q);
        const matchEditor = creative.editor?.name.toLowerCase().includes(q);
        const matchProduct = creative.product?.name.toLowerCase().includes(q);
        const matchNotes = creative.notes?.toLowerCase().includes(q);
        if (!matchName && !matchScript && !matchCreator && !matchEditor && !matchProduct && !matchNotes) return false;
      }

      return true;
    });
  }, [overview.creatives, stageFilter, creatorFilter, editorFilter, productFilter, search]);

  const hasActiveFilters =
    search.trim() !== "" ||
    stageFilter !== "all" ||
    creatorFilter !== "all" ||
    editorFilter !== "all" ||
    productFilter !== "all";

  const resetFilters = () => {
    setSearch("");
    setStageFilter("all");
    setCreatorFilter("all");
    setEditorFilter("all");
    setProductFilter("all");
  };

  // Export to CSV
  const exportToCsv = () => {
    const headers = [
      "ID",
      "Creative Name",
      "Product",
      "Status",
      "Production Stage",
      "Creator",
      "Editor",
      "Script",
      "Raw Footage URL",
      "Drive URL",
      "Deadline",
      "Notes"
    ];
    const rows = filteredCreatives.map((ad) => [
      ad.id,
      `"${(ad.name ?? "").replace(/"/g, '""')}"`,
      `"${(ad.product?.name ?? "").replace(/"/g, '""')}"`,
      ad.status,
      ad.production_stage,
      `"${(ad.creator?.name ?? "").replace(/"/g, '""')}"`,
      `"${(ad.editor?.name ?? "").replace(/"/g, '""')}"`,
      `"${(ad.script_text ?? "").replace(/"/g, '""')}"`,
      ad.raw_footage_url ?? "",
      ad.drive_url ?? "",
      ad.deadline ?? "",
      `"${(ad.notes ?? "").replace(/"/g, '""')}"`
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${overview.campaign.name.toLowerCase().replace(/\s+/g, "_")}_creatives.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Excel columns definition for Creatives
  const columns: ExcelColumnDef<AdWithRelations>[] = useMemo(
    () => [
      {
        id: "thumbnail",
        header: "Video",
        defaultWidth: 80,
        minWidth: 55,
        align: "center",
        cell: (ad) => <CreativeThumbnail ad={ad} onPreview={setPreviewAd} />
      },
      {
        id: "name",
        header: "Creative Name",
        defaultWidth: 170,
        minWidth: 80,
        cell: (ad) => (
          <div className="space-y-0.5 overflow-hidden">
            <Link
              href={`/ads/${ad.id}`}
              className="font-semibold text-foreground hover:text-primary transition-colors block truncate"
            >
              {ad.name}
            </Link>
            {ad.tags && ad.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {ad.tags.slice(0, 2).map((tag) => (
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
        )
      },
      {
        id: "status",
        header: "Status",
        defaultWidth: 155,
        minWidth: 100,
        cell: (ad) => (
          <div className="overflow-hidden">
            <CreativeStatusBadge ad={ad} />
          </div>
        )
      },
      {
        id: "stage",
        header: "Stage",
        defaultWidth: 125,
        minWidth: 70,
        cell: (ad) => (
          <div className="overflow-hidden">
            <ProductionStageBadge stage={ad.production_stage} role={profile.role} />
          </div>
        )
      },
      {
        id: "product",
        header: "Product",
        defaultWidth: 120,
        minWidth: 60,
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
            <div className="min-w-0 flex-1 truncate">
              <p className="font-medium text-foreground text-xs truncate">
                {ad.product?.name ?? "—"}
              </p>
            </div>
          </div>
        )
      },
      {
        id: "script",
        header: "Script",
        defaultWidth: 260,
        minWidth: 40,
        cell: (ad) => {
          const text = ad.script_text || "—";
          const hasText = Boolean(ad.script_text);
          return (
            <div className="group/script relative w-full h-full min-h-0 flex flex-col justify-start overflow-hidden">
              <div
                onClick={() => hasText && setSelectedScriptAd(ad)}
                className={cn(
                  "text-xs leading-relaxed text-foreground/90 font-normal whitespace-pre-wrap break-words overflow-hidden select-text w-full h-full",
                  hasText && "cursor-pointer hover:text-primary transition-colors"
                )}
                title={hasText ? "Click to view full script dialog" : undefined}
              >
                {text}
              </div>
              {hasText ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedScriptAd(ad);
                  }}
                  className="absolute top-0 right-0 p-0.5 rounded bg-background/90 shadow-2xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover/script:opacity-100 z-10"
                  title="Open full script modal"
                >
                  <Maximize2 className="size-3" />
                </button>
              ) : null}
            </div>
          );
        }
      },
      {
        id: "raw_footage",
        header: "Raw Clips",
        defaultWidth: 100,
        minWidth: 50,
        cell: (ad) => {
          if (!ad.raw_footage_url) {
            return <span className="text-[11px] text-muted-foreground italic">—</span>;
          }
          return (
            <a
              href={ad.raw_footage_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted transition-colors max-w-full truncate"
              title={ad.raw_footage_url}
            >
              <Video className="size-3 text-primary shrink-0" />
              <span className="truncate">Clips</span>
              <ExternalLink className="size-2.5 text-muted-foreground shrink-0" />
            </a>
          );
        }
      },
      {
        id: "creator",
        header: "Creator",
        defaultWidth: 130,
        minWidth: 60,
        cell: (ad) => {
          if (!ad.creator) {
            return <span className="text-xs text-muted-foreground">—</span>;
          }
          return (
            <div className="flex items-center gap-1.5 overflow-hidden">
              <Avatar name={ad.creator.name} src={ad.creator.avatar_url} className="size-5 shrink-0" />
              <div className="min-w-0 truncate">
                <p className="font-medium text-foreground text-xs truncate">{ad.creator.name}</p>
              </div>
            </div>
          );
        }
      },
      {
        id: "editor",
        header: "Editor",
        defaultWidth: 130,
        minWidth: 60,
        cell: (ad) => {
          if (!ad.editor) {
            return <span className="text-xs text-muted-foreground italic">Unassigned</span>;
          }
          return (
            <div className="flex items-center gap-1.5 overflow-hidden">
              <Avatar name={ad.editor.name} src={ad.editor.avatar_url} className="size-5 shrink-0" />
              <div className="min-w-0 truncate">
                <p className="font-medium text-foreground text-xs truncate">{ad.editor.name}</p>
              </div>
            </div>
          );
        }
      },
      {
        id: "performance",
        header: "Meta Metrics",
        defaultWidth: 120,
        minWidth: 70,
        cell: (ad) => {
          const perf = (ad as AdWithRelations & { performance?: { latest_spend?: number; latest_purchases?: number; latest_cpa?: number } }).performance;
          if (!perf || (!perf.latest_spend && !perf.latest_purchases)) {
            return <span className="text-xs text-muted-foreground italic">—</span>;
          }
          return (
            <div className="space-y-0.5 text-[11px] font-mono">
              <p className="text-foreground font-semibold">
                ${Number(perf.latest_spend ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}
              </p>
              <p className="text-muted-foreground text-[10px]">
                {perf.latest_purchases ?? 0} pur · {perf.latest_cpa != null ? `$${perf.latest_cpa.toFixed(1)} CPA` : "—"}
              </p>
            </div>
          );
        }
      },
      {
        id: "deadline",
        header: "Deadline",
        defaultWidth: 100,
        minWidth: 60,
        cell: (ad) => {
          if (!ad.deadline) return <span className="text-xs text-muted-foreground">—</span>;
          const isOverdue = new Date(ad.deadline).getTime() < Date.now() && ad.production_stage !== "approved";
          return (
            <span
              className={cn(
                "text-xs font-mono",
                isOverdue ? "text-warning font-semibold" : "text-muted-foreground"
              )}
            >
              {formatDateOnly(ad.deadline)}
            </span>
          );
        }
      },
      {
        id: "actions",
        header: "Actions",
        defaultWidth: 100,
        minWidth: 60,
        align: "center",
        cell: (ad) => (
          <div className="flex items-center justify-center gap-1">
            <Link
              href={`/ads/${ad.id}`}
              className="inline-flex size-6 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Open creative review"
            >
              <ArrowUpRight className="size-3.5" />
            </Link>
            {canAddCreative ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingAd(ad);
                }}
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                title="Edit creative metadata"
              >
                <Pencil className="size-3.5" />
              </Button>
            ) : null}
          </div>
        )
      }
    ],
    [profile.role, canAddCreative]
  );

  return (
    <main className="page-container space-y-4 pb-12">
      {/* Back link & Header */}
      <div>
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to campaigns</span>
        </Link>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FolderKanban className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground">{overview.campaign.name}</h1>
                <span
                  className={cn(
                    "inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                    overview.campaign.active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                  )}
                >
                  {overview.campaign.active ? "Active" : "Archived"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={exportToCsv} className="h-8 text-xs">
              <Download className="size-3.5 mr-1" />
              Export
            </Button>
            {canAddCreative ? (
              <Button onClick={() => setAddModalOpen(true)} className="h-8 text-xs shadow-sm">
                <Plus className="size-3.5 mr-1" />
                Add Creative
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Goal Progress Bar */}
      <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-warning/15 text-warning">
              <Target className="size-4" />
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold text-foreground">
                  {overview.approvedCount} / {overview.videoGoal}
                </span>
                <span className="text-xs text-muted-foreground">approved videos</span>
                <span className="font-mono text-xs font-bold text-success">
                  ({overview.goalProgressPercent}%)
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="rounded-md border border-border bg-muted/30 px-2.5 py-1">
              <span className="text-muted-foreground">Creation: </span>
              <span className="font-bold text-primary">{overview.inCreationCount}</span>
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-2.5 py-1">
              <span className="text-muted-foreground">Review: </span>
              <span className="font-bold text-warning">{overview.inReviewCount}</span>
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-2.5 py-1">
              <span className="text-muted-foreground">Total: </span>
              <span className="font-bold text-foreground">{overview.totalCreatives}</span>
            </div>
          </div>
        </div>

        <div className="mt-2.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              overview.goalProgressPercent >= 100
                ? "bg-success"
                : overview.goalProgressPercent >= 50
                ? "bg-primary"
                : "bg-warning"
            )}
            style={{ width: `${overview.goalProgressPercent}%` }}
          />
        </div>
      </div>

      {/* Top Filter Bar */}
      <div className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 flex-1 min-w-[220px] max-w-md">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search creatives by name, script, notes..."
                className="pl-9 h-8 text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs">
              <button
                onClick={() => setStageFilter("all")}
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium transition-colors text-xs",
                  stageFilter === "all" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                All ({overview.creatives.length})
              </button>
              <button
                onClick={() => setStageFilter("approved")}
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium transition-colors text-xs",
                  stageFilter === "approved"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Approved ({overview.approvedCount})
              </button>
              <button
                onClick={() => setStageFilter("changes_requested_all")}
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium transition-colors text-xs",
                  stageFilter === "changes_requested_all"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Changes ({overview.stageBreakdown.changes_requested + overview.stageBreakdown.creator_changes_requested})
              </button>
              <button
                onClick={() => setStageFilter("in_review")}
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium transition-colors text-xs",
                  stageFilter === "in_review"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                In Review ({overview.inReviewCount})
              </button>
              <button
                onClick={() => setStageFilter("in_creation")}
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium transition-colors text-xs",
                  stageFilter === "in_creation"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Creation ({overview.inCreationCount})
              </button>
            </div>

            <Button
              size="sm"
              variant={showFilters ? "secondary" : "ghost"}
              onClick={() => setShowFilters(!showFilters)}
              className="h-8 text-xs"
            >
              <SlidersHorizontal className="size-3.5 mr-1" />
              Filters
              {hasActiveFilters && <span className="ml-1 flex size-2 rounded-full bg-primary" />}
            </Button>

            {hasActiveFilters && (
              <Button size="sm" variant="ghost" onClick={resetFilters} className="h-8 text-xs text-muted-foreground">
                <RotateCcw className="size-3 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Collapsible Dropdowns */}
        {showFilters && (
          <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-border sm:grid-cols-4 text-xs">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Stage & Status</label>
              <Select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="h-8 text-xs"
              >
                <option value="all">All Statuses & Stages</option>
                <option value="approved">Approved</option>
                <option value="changes_requested_all">Changes Requested (All)</option>
                <option value="changes_requested">Changes: Editor</option>
                <option value="creator_changes_requested">Changes: Creator</option>
                <option value="in_review">In Review (All)</option>
                <option value="final_review">Final Review</option>
                <option value="creator_review">Creator Review</option>
                <option value="in_creation">In Creation (All)</option>
                <option value="editing">Editing</option>
                <option value="ready_for_edit">Ready for Edit</option>
                <option value="shoot_complete">Shoot Complete (Clips Done)</option>
                <option value="ready_to_shoot">Ready to Shoot</option>
                <option value="script_writing">Script in Progress</option>
              </Select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Creator</label>
              <Select
                value={creatorFilter}
                onChange={(e) => setCreatorFilter(e.target.value)}
                className="h-8 text-xs"
              >
                <option value="all">All Creators</option>
                {creators.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Editor</label>
              <Select
                value={editorFilter}
                onChange={(e) => setEditorFilter(e.target.value)}
                className="h-8 text-xs"
              >
                <option value="all">All Editors</option>
                {editors.map((ed) => (
                  <option key={ed.id} value={ed.id}>
                    {ed.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Product</label>
              <Select
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
                className="h-8 text-xs"
              >
                <option value="all">All Products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* Creatives Excel Table */}
      <ExcelTable
        columns={columns}
        data={filteredCreatives}
        getRowKey={(ad) => ad.id}
        title={`${overview.campaign.name} Creatives`}
        storageKey={`campaign_creatives_${overview.campaign.id}`}
        emptyMessage="No creatives in this campaign matching your filter."
      />

      {/* Video Preview Modal */}
      {previewAd ? <AdPreviewModal ad={previewAd} onClose={() => setPreviewAd(null)} /> : null}

      {/* Full Script Modal */}
      {selectedScriptAd ? (
        <FullScriptModal ad={selectedScriptAd} onClose={() => setSelectedScriptAd(null)} />
      ) : null}

      {/* Add Creative Modal */}
      {addModalOpen ? (
        <Modal open labelledBy="add-creative-title" onClose={() => setAddModalOpen(false)} className="p-0 sm:p-6">
          <section className="mx-auto min-h-full w-full bg-card shadow-float sm:min-h-0 sm:max-w-5xl sm:rounded-xl">
            <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-card px-5 sm:rounded-t-lg">
              <h2 id="add-creative-title" className="text-base font-semibold text-foreground">
                Add Creative to {overview.campaign.name}
              </h2>
              <Button size="icon" variant="ghost" onClick={() => setAddModalOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="p-5">
              <CreatorItemForm
                profile={profile}
                creators={creators}
                editors={editors}
                campaigns={campaigns.filter((c) => c.active)}
                products={products.filter((p) => p.active)}
                defaultCampaignId={overview.campaign.id}
                availableTags={availableTags}
                editorWorkloads={editorWorkloads}
                onSaved={() => {
                  setAddModalOpen(false);
                  router.refresh();
                }}
              />
            </div>
          </section>
        </Modal>
      ) : null}

      {/* Edit Creative Modal */}
      {editingAd ? (
        <Modal open labelledBy="edit-creative-title" onClose={() => setEditingAd(null)} className="p-0 sm:p-6">
          <section className="mx-auto min-h-full w-full bg-card shadow-float sm:min-h-0 sm:max-w-5xl sm:rounded-xl">
            <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-card px-5 sm:rounded-t-lg">
              <h2 id="edit-creative-title" className="text-base font-semibold text-foreground">
                Edit Creative: {editingAd.name}
              </h2>
              <Button size="icon" variant="ghost" onClick={() => setEditingAd(null)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="p-5">
              <CreatorItemForm
                profile={profile}
                creators={creators}
                editors={editors}
                campaigns={campaigns.filter((c) => c.active)}
                products={products.filter((p) => p.active)}
                initialAd={editingAd}
                availableTags={availableTags}
                editorWorkloads={editorWorkloads}
                overrideMode={profile.role === "admin" || profile.role === "manager"}
                onSaved={() => {
                  setEditingAd(null);
                  router.refresh();
                }}
              />
            </div>
          </section>
        </Modal>
      ) : null}
    </main>
  );
}
