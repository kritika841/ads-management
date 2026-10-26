"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Eye,
  EyeOff,
  Filter,
  Globe,
  Layers,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  UserCheck,
  Users,
  Video,
  X
} from "lucide-react";
import {
  deactivateIncentiveCampaign,
  deleteIncentiveCampaign,
  removeIncentiveCreative,
  saveIncentiveCampaign
} from "@/app/actions/incentives";
import {
  updateCampaignPlacement,
  updateCampaignUserVisibility,
  updateUserCreativeVisibility,
  bulkUpdateUserCreativeVisibility
} from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { runServerAction } from "@/lib/client-action";
import { buildMetaIndex, metaAdsForLibraryAd, sumMeta } from "@/lib/campaign-ad-stats";
import type { CampaignPlacement } from "@/lib/metric-visibility";
import {
  CampaignPlacementModal,
  metaCampaignOptions,
  PlacementPicker,
  placementSummary
} from "@/components/incentives/campaign-placement";
import type { IncentiveCampaign, IncentiveCreative, MetaAd } from "@/lib/incentives";
import type { Product, Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

export type EligibleAd = {
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
  created_at?: string | null;
  creator?: { id: string; name: string } | null;
  editor?: { id: string; name: string } | null;
};

type TimeFrameOption = "all" | "7d" | "14d" | "30d" | "60d" | "90d";
type SortOption = "spend_desc" | "purchases_desc" | "newest" | "name_asc";

function computeAdMetrics(
  ad: EligibleAd,
  matchingMetaAds: MetaAd[],
  timeframe: TimeFrameOption
) {
  let spend = 0;
  let purchases = 0;

  if (timeframe === "all") {
    for (const m of matchingMetaAds) {
      spend += Number(m.spend) || 0;
      purchases += Number(m.purchases) || 0;
    }
    return { spend: Math.round(spend), purchases };
  }

  const days =
    timeframe === "7d"
      ? 7
      : timeframe === "14d"
      ? 14
      : timeframe === "30d"
      ? 30
      : timeframe === "60d"
      ? 60
      : 90;
  const cutoffDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  for (const m of matchingMetaAds) {
    if (m.daily_metrics && m.daily_metrics.length > 0) {
      for (const d of m.daily_metrics) {
        if (d.metric_date >= cutoffDate) {
          spend += Number(d.spend) || 0;
          purchases += Number(d.purchases) || 0;
        }
      }
    } else {
      if (!m.created_time || m.created_time.slice(0, 10) >= cutoffDate) {
        spend += Number(m.spend) || 0;
        purchases += Number(m.purchases) || 0;
      }
    }
  }

  return { spend: Math.round(spend), purchases };
}

export function InternalCampaignsManager({
  campaigns,
  creatives,
  eligibleAds,
  metaAds,
  products,
  profile,
  allProfiles = [],
  campaignVisibleUsers = {},
  hiddenCampaignsByUser = {},
  hiddenCreativesByUser = {},
  allowedCreativesByUser = {},
  campaignPlacements = {}
}: {
  campaigns: IncentiveCampaign[];
  creatives: IncentiveCreative[];
  eligibleAds: EligibleAd[];
  metaAds: MetaAd[];
  products: Product[];
  profile: Profile;
  allProfiles?: Profile[];
  campaignVisibleUsers?: Record<string, string[]>;
  hiddenCampaignsByUser?: Record<string, string[]>;
  hiddenCreativesByUser?: Record<string, string[]>;
  allowedCreativesByUser?: Record<string, string[]>;
  campaignPlacements?: Record<string, CampaignPlacement>;
}) {
  const router = useRouter();
  const isAdmin = profile.role === "admin";
  const isManager = profile.role === "manager";
  const canEdit = isAdmin || isManager;

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");
  const [productFilter, setProductFilter] = useState<string>("all");

  const [editingCampaign, setEditingCampaign] = useState<IncentiveCampaign | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAdVisibilityOpen, setIsAdVisibilityOpen] = useState(false);
  const [visibilityCampaign, setVisibilityCampaign] = useState<IncentiveCampaign | null>(null);
  const [placementCampaign, setPlacementCampaign] = useState<IncentiveCampaign | null>(null);
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(campaigns[0]?.id ?? null);

  const [message, setMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const teamProfiles = useMemo(() => {
    return allProfiles.filter((p) => p.role !== "admin" && p.active);
  }, [allProfiles]);

  // Group assigned creatives by campaign
  const creativesByCampaign = useMemo(() => {
    const map = new Map<string, IncentiveCreative[]>();
    for (const c of creatives) {
      const campId = c.incentive_campaign_id;
      if (!map.has(campId)) map.set(campId, []);
      map.get(campId)!.push(c);
    }
    return map;
  }, [creatives]);

  // Map meta ads by matched_ad_id and detected tag
  const metaAdsByAdId = useMemo(() => {
    const byId = new Map<string, MetaAd[]>();
    for (const meta of metaAds) {
      if (meta.matched_ad_id) {
        if (!byId.has(meta.matched_ad_id)) byId.set(meta.matched_ad_id, []);
        byId.get(meta.matched_ad_id)!.push(meta);
      }
    }
    return byId;
  }, [metaAds]);

  const metaAdsByTag = useMemo(() => {
    const byTag = new Map<string, MetaAd[]>();
    for (const meta of metaAds) {
      const tag = (meta.detected_tag || "").trim().toUpperCase();
      if (tag) {
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag)!.push(meta);
      }
    }
    return byTag;
  }, [metaAds]);

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) => {
      if (statusFilter === "active" && !c.active) return false;
      if (statusFilter === "paused" && c.active) return false;
      if (productFilter !== "all" && c.product_id !== productFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = c.name.toLowerCase().includes(q);
        const matchesProduct = (c.product?.name || "").toLowerCase().includes(q);
        if (!matchesName && !matchesProduct) return false;
      }
      return true;
    });
  }, [campaigns, statusFilter, productFilter, searchQuery]);

  const metaIndex = useMemo(() => buildMetaIndex(metaAds), [metaAds]);
  const metaCampaigns = useMemo(() => metaCampaignOptions(metaAds), [metaAds]);

  function statsFor(cr: IncentiveCreative) {
    return sumMeta(metaAdsForLibraryAd(metaIndex, cr.ad_id, cr.ad?.name ?? "", cr.meta_ad_id));
  }

  const summary = useMemo(() => {
    const total = campaigns.length;
    const active = campaigns.filter((c) => c.active).length;
    const trackedAds = creatives.length;
    let totalSpend = 0;
    let totalPurchases = 0;
    for (const c of creatives) {
      const s = sumMeta(metaAdsForLibraryAd(metaIndex, c.ad_id, c.ad?.name ?? "", c.meta_ad_id));
      totalSpend += s.spend;
      totalPurchases += s.purchases;
    }
    return { total, active, trackedAds, totalSpend, totalPurchases };
  }, [campaigns, creatives, metaIndex]);

  function handleDelete(campaignId: string, campaignName: string) {
    setDeleteTarget({ id: campaignId, name: campaignName });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const { id: campaignId, name: campaignName } = deleteTarget;
    startTransition(async () => {
      const res = await runServerAction(() => deleteIncentiveCampaign(campaignId));
      setDeleteTarget(null);
      if (res.ok) {
        setMessage(`Campaign “${campaignName}” deleted.`);
        router.refresh();
      } else {
        setMessage(res.message ?? "Failed to delete campaign.");
      }
    });
  }

  function handleDeactivate(campaignId: string) {
    startTransition(async () => {
      const res = await runServerAction(() => deactivateIncentiveCampaign(campaignId));
      if (res.ok) {
        setMessage("Campaign status updated.");
        router.refresh();
      } else {
        setMessage(res.message ?? "Failed to update campaign.");
      }
    });
  }

  return (
    <section className="mt-6 space-y-6">
      {/* Header and Quick Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-foreground">Internal campaigns</h2>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              {campaigns.length} campaigns
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Create internal ad groups, select specific creatives, and control custom visibility for each user and role.
          </p>
        </div>

        {canEdit ? (
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <Button
                variant="secondary"
                onClick={() => setIsAdVisibilityOpen(true)}
                className="gap-1.5 shadow-2xs"
              >
                <SlidersHorizontal className="size-3.5 text-primary" />
                Ad-level visibility
              </Button>
            ) : null}

            <Button
              onClick={() => setIsCreateOpen(true)}
              className="gap-1.5 shadow-xs"
            >
              <Plus className="size-4" />
              New campaign
            </Button>
          </div>
        ) : null}
      </div>

      {message ? (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-xs text-foreground shadow-xs">
          <span>{message}</span>
          <button type="button" onClick={() => setMessage(null)} className="opacity-70 hover:opacity-100">✕</button>
        </div>
      ) : null}

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Megaphone className="size-3.5 text-primary" />
            Total campaigns
          </div>
          <p className="mt-1 text-xl font-semibold text-foreground">{summary.total}</p>
          <p className="text-[11px] text-muted-foreground">{summary.active} active now</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-success" />
            Active campaigns
          </div>
          <p className="mt-1 text-xl font-semibold text-success">{summary.active}</p>
          <p className="text-[11px] text-muted-foreground">{summary.total - summary.active} paused</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Layers className="size-3.5 text-primary" />
            Assigned ads
          </div>
          <p className="mt-1 text-xl font-semibold text-foreground">{summary.trackedAds}</p>
          <p className="text-[11px] text-muted-foreground">Across all internal campaigns</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CircleDollarSign className="size-3.5 text-primary" />
            Total ad spend
          </div>
          <p className="mt-1 text-xl font-semibold text-foreground">
            ₹{Math.round(summary.totalSpend).toLocaleString("en-IN")}
          </p>
          <p className="text-[11px] text-muted-foreground">From assigned Meta ads</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <UserCheck className="size-3.5 text-primary" />
            Total purchases
          </div>
          <p className="mt-1 text-xl font-semibold text-foreground">
            {summary.totalPurchases.toLocaleString("en-IN")}
          </p>
          <p className="text-[11px] text-muted-foreground">Total orders generated</p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between shadow-2xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder="Search campaigns..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5 text-xs">
            {(["all", "active", "paused"] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium capitalize transition",
                  statusFilter === st ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {st}
              </button>
            ))}
          </div>

          {products.length > 1 ? (
            <Select
              className="h-8 text-xs min-w-44"
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
            >
              <option value="all">All Products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          ) : null}
        </div>

        <span className="text-xs text-muted-foreground">
          Showing <strong className="text-foreground">{filteredCampaigns.length}</strong> of {campaigns.length} campaigns
        </span>
      </div>

      {/* Campaigns List */}
      <div className="space-y-4">
        {filteredCampaigns.map((campaign) => {
          const assigned = creativesByCampaign.get(campaign.id) ?? [];
          const isExpanded = expandedCampaignId === campaign.id;
          const permittedUsers = campaignVisibleUsers[campaign.id] ?? [];
          const isRestricted = permittedUsers.length > 0;

          const campSpend = assigned.reduce((acc, c) => acc + statsFor(c).spend, 0);
          const campPurchases = assigned.reduce((acc, c) => acc + statsFor(c).purchases, 0);

          return (
            <div
              key={campaign.id}
              className={cn(
                "rounded-xl border transition overflow-hidden shadow-2xs",
                campaign.active ? "border-border bg-card" : "border-border/70 bg-card/60 opacity-80"
              )}
            >
              {/* Campaign Header Row */}
              <div className="flex flex-col gap-4 border-b border-border/80 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-foreground truncate">{campaign.name}</h3>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                        campaign.active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                      )}
                    >
                      {campaign.active ? "Active" : "Paused"}
                    </span>
                    {campaign.product?.name ? (
                      <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        {campaign.product.name}
                      </span>
                    ) : null}
                  </div>

                  {/* Summary Metric Pills */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Ads: <strong className="text-foreground">{assigned.length}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Spend: <strong className="text-foreground">₹{Math.round(campSpend).toLocaleString("en-IN")}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Purchases / Orders: <strong className="text-foreground">{campPurchases}</strong>
                    </span>
                  </div>

                  {/* User Visibility Pill */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                      <Layers className="size-3" />
                      {placementSummary(campaignPlacements[campaign.id], metaCampaigns)}
                    </span>
                    {isRestricted ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-warning/10 px-2.5 py-0.5 text-[11px] font-medium text-warning">
                        <Users className="size-3" />
                        Visible to {permittedUsers.length} selected team members
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        <Globe className="size-3 text-success" />
                        Visible to all team members
                      </span>
                    )}
                  </div>
                </div>

                {/* Campaign Action Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => setEditingCampaign(campaign)}
                    >
                      <Pencil className="size-3.5" />
                      Edit campaign &amp; ads
                    </Button>
                  ) : null}

                  {isAdmin ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      title="Choose where this campaign is displayed"
                      onClick={() => setPlacementCampaign(campaign)}
                    >
                      <Layers className="size-3.5" />
                      Placement
                    </Button>
                  ) : null}

                  {isAdmin ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      title="Manage user access"
                      onClick={() => setVisibilityCampaign(campaign)}
                    >
                      <Users className="size-3.5" />
                      User access
                    </Button>
                  ) : null}

                  {isAdmin ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-destructive/80 hover:text-destructive hover:bg-destructive/10"
                      title="Delete campaign"
                      onClick={() => handleDelete(campaign.id, campaign.name)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}

                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-primary font-medium gap-1"
                    onClick={() => setExpandedCampaignId(isExpanded ? null : campaign.id)}
                  >
                    {isExpanded ? (
                      <>
                        Hide ads <ChevronDown className="size-3.5 rotate-180 transition-transform" />
                      </>
                    ) : (
                      <>
                        View {assigned.length} ads <ChevronDown className="size-3.5 transition-transform" />
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Expandable Assigned Ads List */}
              {isExpanded ? (
                <div className="bg-muted/15 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-semibold text-foreground">
                      Assigned Ads &amp; Performance ({assigned.length})
                    </p>
                    {canEdit ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 text-xs gap-1"
                        onClick={() => setEditingCampaign(campaign)}
                      >
                        <Plus className="size-3" />
                        Modify ads
                      </Button>
                    ) : null}
                  </div>

                  {assigned.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border border-border bg-card">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-border bg-muted/60 text-[11px] font-medium text-muted-foreground">
                          <tr>
                            <th className="px-4 py-2.5">Ad / Creative</th>
                            <th className="px-4 py-2.5">Creator / Editor</th>
                            <th className="px-4 py-2.5">Spend</th>
                            <th className="px-4 py-2.5">Purchases / Orders</th>
                            {canEdit ? <th className="px-4 py-2.5 text-right">Action</th> : null}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {assigned.map((cr) => (
                            <tr key={cr.id} className="hover:bg-muted/20 transition">
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2.5">
                                  <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
                                    {cr.ad?.thumbnail_url ? (
                                      <img src={cr.ad.thumbnail_url} alt="" className="size-full object-cover" />
                                    ) : (
                                      <Video className="size-3.5 text-muted-foreground" />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate font-medium text-foreground">{cr.ad?.name ?? `Creative ${cr.ad_id}`}</p>
                                    <p className="font-mono text-[10px] text-muted-foreground">Meta ID: {cr.meta_ad_id}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-muted-foreground">
                                <p className="font-medium text-foreground">{cr.creator?.name ?? cr.ad?.creator?.name ?? "No creator"}</p>
                                <p className="text-[10px] opacity-80">{cr.editor?.name ?? cr.ad?.editor?.name ?? "No editor"}</p>
                              </td>
                              <td className="px-4 py-2.5 tabular-nums text-foreground font-medium">
                                ₹{statsFor(cr).spend.toLocaleString("en-IN")}
                              </td>
                              <td className="px-4 py-2.5 tabular-nums text-foreground">
                                {statsFor(cr).purchases}
                              </td>
                              {canEdit ? (
                                <td className="px-4 py-2.5 text-right">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="size-7 text-muted-foreground hover:text-destructive"
                                    title="Unassign ad"
                                    onClick={() => {
                                      if (confirm(`Remove “${cr.ad?.name}” from this campaign?`)) {
                                        startTransition(async () => {
                                          await runServerAction(() => removeIncentiveCreative(cr.id));
                                          router.refresh();
                                        });
                                      }
                                    }}
                                  >
                                    <Trash2 className="size-3" />
                                  </Button>
                                </td>
                              ) : null}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center">
                      <p className="text-xs text-muted-foreground">No ads currently assigned to this campaign.</p>
                      {canEdit ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="mt-3 text-xs gap-1.5"
                          onClick={() => setEditingCampaign(campaign)}
                        >
                          <Plus className="size-3.5" />
                          Select ads to assign
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}

        {filteredCampaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
            <Megaphone className="mx-auto size-8 text-muted-foreground/60" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">No internal campaigns found</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {searchQuery || statusFilter !== "all" || productFilter !== "all"
                ? "Try adjusting your search filters."
                : "Create an internal campaign to group ads and control visibility for creators and editors."}
            </p>
            {canEdit ? (
              <Button
                className="mt-4 gap-1.5"
                onClick={() => setIsCreateOpen(true)}
              >
                <Plus className="size-4" />
                Create campaign
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* All-in-One Campaign Create / Edit Modal */}
      {isCreateOpen || editingCampaign ? (
        <CampaignUnifiedModal
          campaign={editingCampaign}
          products={products}
          allProfiles={teamProfiles}
          eligibleAds={eligibleAds}
          metaAds={metaAds}
          metaAdsByAdId={metaAdsByAdId}
          metaAdsByTag={metaAdsByTag}
          initialAssignedAdIds={
            editingCampaign
              ? (creativesByCampaign.get(editingCampaign.id) ?? []).map((c) => c.ad_id)
              : []
          }
          initialVisibleUsers={
            editingCampaign ? campaignVisibleUsers[editingCampaign.id] ?? [] : []
          }
          isAdmin={isAdmin}
          initialPlacement={editingCampaign ? campaignPlacements[editingCampaign.id] ?? null : null}
          onClose={() => {
            setIsCreateOpen(false);
            setEditingCampaign(null);
          }}
          onSuccess={() => {
            setIsCreateOpen(false);
            setEditingCampaign(null);
            router.refresh();
          }}
        />
      ) : null}

      {/* Delete confirmation */}
      {deleteTarget ? (
        <Modal open labelledBy="delete-campaign-title" onClose={() => (isPending ? undefined : setDeleteTarget(null))}>
          <section className="mx-auto w-full max-w-md rounded-xl bg-card shadow-float">
            <div className="space-y-2 p-5">
              <h2 id="delete-campaign-title" className="text-lg font-semibold text-foreground">Delete campaign?</h2>
              <p className="text-sm text-muted-foreground">
                “{deleteTarget.name}” and its ad assignments will be permanently removed. The ads themselves stay in the Creative Library.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/10 px-5 py-3.5">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={isPending}>Cancel</Button>
              <Button onClick={confirmDelete} disabled={isPending} className="bg-destructive text-white hover:bg-destructive/90">
                {isPending ? "Deleting…" : "Delete campaign"}
              </Button>
            </div>
          </section>
        </Modal>
      ) : null}

      {/* Placement Modal */}
      {placementCampaign ? (
        <CampaignPlacementModal
          campaign={placementCampaign}
          current={campaignPlacements[placementCampaign.id]}
          metaAds={metaAds}
          onClose={() => setPlacementCampaign(null)}
          onSuccess={() => {
            setPlacementCampaign(null);
            router.refresh();
          }}
        />
      ) : null}

      {/* Campaign User Visibility Modal */}
      {visibilityCampaign ? (
        <CampaignUserVisibilityModal
          campaign={visibilityCampaign}
          allProfiles={teamProfiles}
          initialVisibleUsers={campaignVisibleUsers[visibilityCampaign.id] ?? []}
          onClose={() => setVisibilityCampaign(null)}
          onSuccess={() => {
            setVisibilityCampaign(null);
            router.refresh();
          }}
        />
      ) : null}

      {/* Ad-Level Visibility Control Modal */}
      {isAdVisibilityOpen ? (
        <AdLevelVisibilityModal
          teamProfiles={teamProfiles}
          eligibleAds={eligibleAds}
          metaAds={metaAds}
          hiddenCreativesByUser={hiddenCreativesByUser}
          onClose={() => setIsAdVisibilityOpen(false)}
          onSuccess={() => {
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

// ==========================================
// 1. Unified Campaign Create / Edit Modal
// ==========================================
function CampaignUnifiedModal({
  campaign,
  products,
  allProfiles,
  eligibleAds,
  metaAds,
  metaAdsByAdId,
  metaAdsByTag,
  initialAssignedAdIds = [],
  initialVisibleUsers = [],
  isAdmin = false,
  initialPlacement = null,
  onClose,
  onSuccess
}: {
  campaign: IncentiveCampaign | null;
  products: Product[];
  allProfiles: Profile[];
  eligibleAds: EligibleAd[];
  metaAds: MetaAd[];
  metaAdsByAdId: Map<string, MetaAd[]>;
  metaAdsByTag: Map<string, MetaAd[]>;
  initialAssignedAdIds?: string[];
  initialVisibleUsers?: string[];
  isAdmin?: boolean;
  initialPlacement?: CampaignPlacement | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [placement, setPlacement] = useState<CampaignPlacement | null>(initialPlacement);
  const metaCampaignList = useMemo(() => metaCampaignOptions(metaAds), [metaAds]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 1. Campaign basic details
  const [name, setName] = useState(campaign?.name ?? "");
  const [productId, setProductId] = useState(
    campaign?.product_id ?? products.find((p) => p.active)?.id ?? products[0]?.id ?? ""
  );
  const [active, setActive] = useState(campaign?.active ?? true);

  // 2. User Visibility
  const [visibilityMode, setVisibilityMode] = useState<"all" | "selected">(
    initialVisibleUsers.length > 0 ? "selected" : "all"
  );
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(initialVisibleUsers);
  const [userSearchQuery, setUserSearchQuery] = useState("");

  // 3. Ad Selection List & Filters
  const [selectedAdIds, setSelectedAdIds] = useState<string[]>(initialAssignedAdIds);
  const [adSearch, setAdSearch] = useState("");
  const [selectedCreatorId, setSelectedCreatorId] = useState<string>("all");
  const [selectedEditorId, setSelectedEditorId] = useState<string>("all");
  const [timeframe, setTimeframe] = useState<TimeFrameOption>("30d");
  const [sortOption, setSortOption] = useState<SortOption>("spend_desc");

  // Distinct creators and editors from eligible ads
  const distinctCreators = useMemo(() => {
    const map = new Map<string, string>();
    for (const ad of eligibleAds) {
      if (ad.creator_id && ad.creator?.name) {
        map.set(ad.creator_id, ad.creator.name);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [eligibleAds]);

  const distinctEditors = useMemo(() => {
    const map = new Map<string, string>();
    for (const ad of eligibleAds) {
      if (ad.editor_id && ad.editor?.name) {
        map.set(ad.editor_id, ad.editor.name);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [eligibleAds]);

  // Pre-calculate metrics for each eligible ad based on timeframe
  const adsWithMetrics = useMemo(() => {
    return eligibleAds.map((ad) => {
      // Find matching meta ads
      const byIdMatches = metaAdsByAdId.get(ad.id) ?? [];
      const byTagMatches = metaAdsByTag.get(ad.name.trim().toUpperCase()) ?? [];

      const combinedMetaMap = new Map<string, MetaAd>();
      for (const m of byIdMatches) combinedMetaMap.set(m.id, m);
      for (const m of byTagMatches) combinedMetaMap.set(m.id, m);
      const matchingMeta = Array.from(combinedMetaMap.values());

      const { spend, purchases } = computeAdMetrics(ad, matchingMeta, timeframe);

      return {
        ...ad,
        matchingMeta,
        timeframeSpend: spend,
        timeframePurchases: purchases
      };
    });
  }, [eligibleAds, metaAdsByAdId, metaAdsByTag, timeframe]);

  // Filter and sort ads
  const filteredAds = useMemo(() => {
    return adsWithMetrics
      .filter((ad) => {
        if (selectedCreatorId !== "all" && ad.creator_id !== selectedCreatorId) return false;
        if (selectedEditorId !== "all" && ad.editor_id !== selectedEditorId) return false;
        if (adSearch.trim()) {
          const q = adSearch.toLowerCase();
          const matchesName = ad.name.toLowerCase().includes(q);
          const matchesCreator = (ad.creator?.name || "").toLowerCase().includes(q);
          const matchesEditor = (ad.editor?.name || "").toLowerCase().includes(q);
          const matchesId = ad.id.toLowerCase().includes(q);
          const matchesMeta = ad.matchingMeta.some((m) => m.id.includes(q) || (m.name || "").toLowerCase().includes(q));
          if (!matchesName && !matchesCreator && !matchesEditor && !matchesId && !matchesMeta) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortOption === "spend_desc") return b.timeframeSpend - a.timeframeSpend;
        if (sortOption === "purchases_desc") return b.timeframePurchases - a.timeframePurchases;
        if (sortOption === "newest") {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return dateB - dateA;
        }
        if (sortOption === "name_asc") return a.name.localeCompare(b.name);
        return 0;
      });
  }, [adsWithMetrics, selectedCreatorId, selectedEditorId, adSearch, sortOption]);

  // Filter team profiles for visibility picker
  const filteredUsers = useMemo(() => {
    if (!userSearchQuery.trim()) return allProfiles;
    const q = userSearchQuery.toLowerCase();
    return allProfiles.filter(
      (p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || p.role.includes(q)
    );
  }, [allProfiles, userSearchQuery]);

  function toggleAd(id: string) {
    setSelectedAdIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  function selectAllFilteredAds() {
    const idsToAdd = filteredAds.map((a) => a.id);
    setSelectedAdIds((prev) => Array.from(new Set([...prev, ...idsToAdd])));
  }

  function deselectAllAds() {
    setSelectedAdIds([]);
  }

  function toggleUser(id: string) {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((uid) => uid !== id) : [...prev, id]
    );
  }

  function selectAllCreators() {
    const creatorIds = allProfiles.filter((p) => p.role === "content_creator").map((p) => p.id);
    setSelectedUserIds((prev) => Array.from(new Set([...prev, ...creatorIds])));
  }

  function selectAllEditors() {
    const editorIds = allProfiles.filter((p) => p.role === "editor").map((p) => p.id);
    setSelectedUserIds((prev) => Array.from(new Set([...prev, ...editorIds])));
  }

  function handleSave() {
    if (!name.trim()) {
      setError("Please enter a campaign name.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const visibleUsersPayload = visibilityMode === "all" ? [] : selectedUserIds;
      const res = await runServerAction(() =>
        saveIncentiveCampaign({
          id: campaign?.id,
          name: name.trim(),
          productId,
          active,
          visibleUserIds: visibleUsersPayload,
          adIds: selectedAdIds
        })
      );
      if (res.ok) {
        const savedId = campaign?.id ?? (res as { id?: string }).id;
        if (isAdmin && savedId) {
          const same = JSON.stringify(placement ?? null) === JSON.stringify(initialPlacement ?? null);
          if (!same) {
            const pr = await runServerAction(() => updateCampaignPlacement({ campaignId: savedId, placement }));
            if (!pr.ok) {
              setError(pr.message ?? "Campaign saved, but placement failed.");
              return;
            }
          }
        }
        onSuccess();
      } else {
        setError(res.message ?? "Failed to save campaign.");
      }
    });
  }

  return (
    <Modal open labelledBy="campaign-unified-modal-title" onClose={onClose}>
      <section className="mx-auto w-full max-w-4xl overflow-hidden rounded-xl bg-card shadow-float max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div>
            <h2 id="campaign-unified-modal-title" className="text-lg font-semibold text-foreground">
              {campaign ? "Edit internal campaign" : "Create new internal campaign"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Set campaign name, choose which users can view it, and select specific ads to track.
            </p>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        {/* Modal Body (Scrollable) */}
        <div className="overflow-y-auto p-6 space-y-6 flex-1">
          {/* Section 1: Campaign Details */}
          <div className="space-y-4">
            <Field label="Campaign Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Scaling Winners - Festive Collection"
                autoFocus
              />
            </Field>

            <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="size-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
              Campaign is active
            </label>
          </div>

          {/* Section 2: Visibility (To what users?) */}
          <div className="rounded-xl border border-border bg-muted/20 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Visibility: Who can view this campaign?</h3>
              <p className="text-xs text-muted-foreground">
                Control whether all team members or only specific creators/editors can see these ads.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setVisibilityMode("all")}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3.5 text-left transition",
                  visibilityMode === "all"
                    ? "border-primary bg-primary/10 text-primary font-semibold shadow-2xs"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40"
                )}
              >
                <Globe className="size-5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-foreground">All team members</p>
                  <p className="text-[11px] text-muted-foreground">Visible to every creator, editor, and manager</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setVisibilityMode("selected")}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3.5 text-left transition",
                  visibilityMode === "selected"
                    ? "border-primary bg-primary/10 text-primary font-semibold shadow-2xs"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40"
                )}
              >
                <Users className="size-5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-foreground">Selected users only</p>
                  <p className="text-[11px] text-muted-foreground">Restrict access to specific creators or editors</p>
                </div>
              </button>
            </div>

            {visibilityMode === "selected" ? (
              <div className="space-y-3 pt-2 border-t border-border/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 text-xs"
                      onClick={selectAllCreators}
                    >
                      All creators
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 text-xs"
                      onClick={selectAllEditors}
                    >
                      All editors
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setSelectedUserIds(allProfiles.map((p) => p.id))}
                    >
                      Select all
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:bg-destructive/10"
                      onClick={() => setSelectedUserIds([])}
                    >
                      Clear
                    </Button>
                  </div>

                  <span className="text-xs text-muted-foreground">
                    <strong className="text-foreground">{selectedUserIds.length}</strong> of {allProfiles.length} users selected
                  </span>
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 pl-8 text-xs"
                    placeholder="Search users by name, email, or role..."
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                  />
                </div>

                <div className="grid gap-2 sm:grid-cols-2 max-h-48 overflow-y-auto pr-1">
                  {filteredUsers.map((user) => {
                    const isSelected = selectedUserIds.includes(user.id);
                    return (
                      <label
                        key={user.id}
                        className={cn(
                          "flex cursor-pointer items-center justify-between gap-2.5 rounded-lg border p-2.5 text-xs transition select-none",
                          isSelected
                            ? "border-primary/50 bg-card shadow-2xs"
                            : "border-border/70 bg-card/60 opacity-70 hover:opacity-100"
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleUser(user.id)}
                            className="size-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                          />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{user.name}</p>
                            <p className="truncate text-[10px] text-muted-foreground">{user.email}</p>
                          </div>
                        </div>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                          {user.role.replace("_", " ")}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {/* Section: Placement (admin only) */}
          {isAdmin ? (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Where should it be displayed?</h3>
                <p className="text-xs text-muted-foreground">Choose where these ads show up for the users who can see this campaign.</p>
              </div>
              <PlacementPicker value={placement} onChange={setPlacement} campaignName={name || "This campaign"} metaCampaigns={metaCampaignList} />
            </div>
          ) : null}

          {/* Section 3: Select Ads to Include */}
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  Select Ads ({selectedAdIds.length} selected)
                </h3>
                <span className="text-xs text-muted-foreground">
                  Showing {filteredAds.length} matching ads
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Filter by creator, editor, or time frame, and sort by spend or orders to quickly pick target ads.
              </p>
            </div>

            {/* Filter and Sorter Toolbar */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 rounded-lg border border-border bg-card p-3 shadow-2xs">
              <div className="relative sm:col-span-2 lg:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-8 text-xs"
                  placeholder="Filter ads by tag, name, creator..."
                  value={adSearch}
                  onChange={(e) => setAdSearch(e.target.value)}
                />
              </div>

              <div>
                <Select
                  className="h-8 text-xs"
                  value={selectedCreatorId}
                  onChange={(e) => setSelectedCreatorId(e.target.value)}
                >
                  <option value="all">All Creators</option>
                  {distinctCreators.map(([id, cName]) => (
                    <option key={id} value={id}>{cName}</option>
                  ))}
                </Select>
              </div>

              <div>
                <Select
                  className="h-8 text-xs"
                  value={selectedEditorId}
                  onChange={(e) => setSelectedEditorId(e.target.value)}
                >
                  <option value="all">All Editors</option>
                  {distinctEditors.map(([id, eName]) => (
                    <option key={id} value={id}>{eName}</option>
                  ))}
                </Select>
              </div>

              <div>
                <Select
                  className="h-8 text-xs"
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value as TimeFrameOption)}
                >
                  <option value="7d">Last 7 days</option>
                  <option value="14d">Last 14 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="60d">Last 60 days</option>
                  <option value="90d">Last 90 days</option>
                  <option value="all">All time</option>
                </Select>
              </div>
            </div>

            {/* Sorting Strip & Multi-Select Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs"
                  onClick={selectAllFilteredAds}
                >
                  Select all filtered ({filteredAds.length})
                </Button>
                {selectedAdIds.length > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    onClick={deselectAllAds}
                  >
                    Clear selection
                  </Button>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <ArrowUpDown className="size-3" /> Sort:
                </span>
                <Select
                  className="h-7 text-xs min-w-36"
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value as SortOption)}
                >
                  <option value="spend_desc">Spend: High to Low</option>
                  <option value="purchases_desc">Orders: High to Low</option>
                  <option value="newest">Newest first</option>
                  <option value="name_asc">Name: A to Z</option>
                </Select>
              </div>
            </div>

            {/* Ads Selection Table */}
            <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-border bg-muted/90 backdrop-blur-xs text-[11px] font-medium text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2 text-center">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="px-3 py-2">Creative &amp; Tag</th>
                    <th className="px-3 py-2">Creator / Editor</th>
                    <th className="px-3 py-2">
                      Spend ({timeframe === "all" ? "All" : timeframe})
                    </th>
                    <th className="px-3 py-2">
                      Orders ({timeframe === "all" ? "All" : timeframe})
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {filteredAds.map((ad) => {
                    const isSelected = selectedAdIds.includes(ad.id);

                    return (
                      <tr
                        key={ad.id}
                        onClick={() => toggleAd(ad.id)}
                        className={cn(
                          "transition cursor-pointer select-none",
                          isSelected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-muted/30"
                        )}
                      >
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleAd(ad.id)}
                            className="size-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
                              {ad.thumbnail_url ? (
                                <img src={ad.thumbnail_url} alt="" className="size-full object-cover" />
                              ) : (
                                <Video className="size-3.5 text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">{ad.name}</p>
                              <p className="font-mono text-[10px] text-muted-foreground">
                                {ad.matchingMeta.length > 0
                                  ? `${ad.matchingMeta.length} Meta ad${ad.matchingMeta.length === 1 ? "" : "s"} linked`
                                  : `ID: ${ad.id.slice(0, 8)}...`}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          <p className="font-medium text-foreground">{ad.creator?.name ?? "No creator"}</p>
                          <p className="text-[10px] opacity-80">{ad.editor?.name ?? "No editor"}</p>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums font-medium text-foreground">
                          ₹{ad.timeframeSpend.toLocaleString("en-IN")}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-foreground">
                          {ad.timeframePurchases}
                        </td>
                      </tr>
                    );
                  })}

                  {filteredAds.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                        No matching creatives or ads found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {error ? (
            <p className="rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-border px-6 py-4 bg-muted/10 shrink-0">
          <div className="text-xs text-muted-foreground">
            <strong className="text-foreground">{selectedAdIds.length}</strong> ads selected ·{" "}
            {visibilityMode === "all" ? (
              <span className="text-success font-medium">Visible to all users</span>
            ) : (
              <span className="text-warning font-medium">{selectedUserIds.length} users permitted</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={pending || !name.trim()}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {campaign ? "Save changes" : `Create campaign (${selectedAdIds.length} ads)`}
            </Button>
          </div>
        </div>
      </section>
    </Modal>
  );
}

// ==========================================
// 2. Campaign User Visibility Modal
// ==========================================
function CampaignUserVisibilityModal({
  campaign,
  allProfiles,
  initialVisibleUsers = [],
  onClose,
  onSuccess
}: {
  campaign: IncentiveCampaign;
  allProfiles: Profile[];
  initialVisibleUsers: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"all" | "selected">(
    initialVisibleUsers.length > 0 ? "selected" : "all"
  );
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(initialVisibleUsers);
  const [userQuery, setUserQuery] = useState("");

  const filteredUsers = useMemo(() => {
    if (!userQuery.trim()) return allProfiles;
    const q = userQuery.toLowerCase();
    return allProfiles.filter(
      (p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || p.role.includes(q)
    );
  }, [allProfiles, userQuery]);

  function toggleUser(id: string) {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const payload = mode === "all" ? [] : selectedUserIds;
      const res = await runServerAction(() =>
        updateCampaignUserVisibility({
          campaignId: campaign.id,
          visibleUserIds: payload
        })
      );
      if (res.ok) {
        onSuccess();
      } else {
        setError(res.message ?? "Failed to save campaign visibility.");
      }
    });
  }

  return (
    <Modal open labelledBy="visibility-modal-title" onClose={onClose}>
      <section className="mx-auto w-full max-w-xl overflow-y-auto rounded-xl bg-card shadow-float max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="visibility-modal-title" className="text-lg font-semibold text-foreground">
              User visibility: “{campaign.name}”
            </h2>
            <p className="text-xs text-muted-foreground">
              Control which users can see this campaign and its performance in Ads Performance.
            </p>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("all")}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl border p-3.5 text-center transition",
                mode === "all"
                  ? "border-primary bg-primary/10 text-primary font-semibold shadow-2xs"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40"
              )}
            >
              <Globe className="size-4" />
              <span className="text-xs">Visible to all team members</span>
            </button>

            <button
              type="button"
              onClick={() => setMode("selected")}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl border p-3.5 text-center transition",
                mode === "selected"
                  ? "border-primary bg-primary/10 text-primary font-semibold shadow-2xs"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40"
              )}
            >
              <Users className="size-4" />
              <span className="text-xs">Selected team members only</span>
            </button>
          </div>

          {mode === "selected" ? (
            <div className="space-y-3 pt-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-8 text-xs"
                  placeholder="Filter users..."
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                />
              </div>

              <div className="max-h-60 overflow-y-auto rounded-lg border border-border p-2 space-y-1">
                {filteredUsers.map((user) => {
                  const isChecked = selectedUserIds.includes(user.id);
                  return (
                    <label
                      key={user.id}
                      className={cn(
                        "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-2.5 text-xs transition select-none",
                        isChecked ? "border-primary/40 bg-card shadow-2xs" : "border-border/60 bg-muted/20 opacity-70 hover:opacity-100"
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleUser(user.id)}
                          className="size-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{user.name}</p>
                          <p className="truncate text-[10px] text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                        {user.role.replace("_", " ")}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
              This campaign is currently visible to every creator, editor, and manager on the team.
            </div>
          )}

          {error ? (
            <p className="rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5 bg-muted/10">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save visibility
          </Button>
        </div>
      </section>
    </Modal>
  );
}

// ==========================================
// 3. Ad-Level Visibility Control Modal
// ==========================================
function AdLevelVisibilityModal({
  teamProfiles,
  eligibleAds,
  metaAds,
  hiddenCreativesByUser: initialHiddenCreatives,
  onClose,
  onSuccess
}: {
  teamProfiles: Profile[];
  eligibleAds: EligibleAd[];
  metaAds: MetaAd[];
  hiddenCreativesByUser: Record<string, string[]>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [selectedUserId, setSelectedUserId] = useState<string>(teamProfiles[0]?.id ?? "");
  const [hiddenMap, setHiddenMap] = useState<Record<string, string[]>>(initialHiddenCreatives);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "visible" | "hidden">("all");
  const [message, setMessage] = useState<string | null>(null);

  const selectedUser = teamProfiles.find((p) => p.id === selectedUserId);
  const userHiddenList = hiddenMap[selectedUserId] ?? [];

  // Unified list of all creatives/ads
  const allAdsList = useMemo(() => {
    return eligibleAds.map((ad) => {
      const isHidden = userHiddenList.includes(ad.id);
      return {
        ...ad,
        isHidden
      };
    });
  }, [eligibleAds, userHiddenList]);

  const filteredAds = useMemo(() => {
    return allAdsList.filter((ad) => {
      if (filterMode === "visible" && ad.isHidden) return false;
      if (filterMode === "hidden" && !ad.isHidden) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesName = ad.name.toLowerCase().includes(q);
        const matchesCreator = (ad.creator?.name || "").toLowerCase().includes(q);
        const matchesEditor = (ad.editor?.name || "").toLowerCase().includes(q);
        const matchesId = ad.id.toLowerCase().includes(q);
        if (!matchesName && !matchesCreator && !matchesEditor && !matchesId) return false;
      }
      return true;
    });
  }, [allAdsList, filterMode, search]);

  function toggleAdVisibility(adId: string) {
    if (!selectedUserId) return;
    const isCurrentlyHidden = userHiddenList.includes(adId);
    const action = isCurrentlyHidden ? "show" : "hide";

    const next = isCurrentlyHidden
      ? userHiddenList.filter((id) => id !== adId)
      : [...userHiddenList, adId];

    const updated = { ...hiddenMap, [selectedUserId]: next };
    setHiddenMap(updated);

    startTransition(async () => {
      await runServerAction(() =>
        updateUserCreativeVisibility({
          userId: selectedUserId,
          creativeId: adId,
          action
        })
      );
      setMessage("Ad visibility updated.");
    });
  }

  function showAllForUser() {
    if (!selectedUserId) return;
    const updated = { ...hiddenMap, [selectedUserId]: [] };
    setHiddenMap(updated);

    startTransition(async () => {
      await runServerAction(() =>
        bulkUpdateUserCreativeVisibility({
          userId: selectedUserId,
          creativeIds: eligibleAds.map((a) => a.id),
          action: "show_all"
        })
      );
      setMessage(`All ads made visible to ${selectedUser?.name ?? "user"}.`);
    });
  }

  function hideAllForUser() {
    if (!selectedUserId) return;
    const allIds = eligibleAds.map((a) => a.id);
    const updated = { ...hiddenMap, [selectedUserId]: allIds };
    setHiddenMap(updated);

    startTransition(async () => {
      await runServerAction(() =>
        bulkUpdateUserCreativeVisibility({
          userId: selectedUserId,
          creativeIds: allIds,
          action: "hide_all"
        })
      );
      setMessage(`All ads hidden for ${selectedUser?.name ?? "user"}.`);
    });
  }

  return (
    <Modal open labelledBy="ad-visibility-title" onClose={onClose}>
      <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-xl bg-card shadow-float max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div>
            <h2 id="ad-visibility-title" className="text-lg font-semibold text-foreground">
              Ad-Level Visibility Control
            </h2>
            <p className="text-xs text-muted-foreground">
              Modify the exact ad visibility for each creator, editor, and manager.
            </p>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="overflow-y-auto p-6 space-y-4 flex-1">
          {/* User Selector Header */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-border bg-muted/20 p-3.5">
            <div className="flex items-center gap-3">
              <label htmlFor="user-select-ad-visibility" className="text-xs font-semibold text-foreground shrink-0">
                Select user:
              </label>
              <Select
                id="user-select-ad-visibility"
                className="h-8 min-w-56 text-xs"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              >
                {teamProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.role.replace("_", " ")})
                  </option>
                ))}
              </Select>
            </div>

            {selectedUser ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  <strong className="text-foreground">{userHiddenList.length}</strong> of {eligibleAds.length} ads hidden
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs text-success hover:bg-success/10"
                  onClick={showAllForUser}
                  disabled={pending || userHiddenList.length === 0}
                >
                  Show all
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs text-destructive hover:bg-destructive/10"
                  onClick={hideAllForUser}
                  disabled={pending}
                >
                  Hide all
                </Button>
              </div>
            ) : null}
          </div>

          {message ? (
            <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground flex items-center justify-between">
              <span>{message}</span>
              <button type="button" onClick={() => setMessage(null)} className="opacity-70 hover:opacity-100">✕</button>
            </div>
          ) : null}

          {/* Search & Filter Mode Tabs */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 pl-8 text-xs"
                placeholder="Search ads by name, tag, creator..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5 text-xs">
              {(["all", "visible", "hidden"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setFilterMode(m)}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium capitalize transition",
                    filterMode === m ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Ads List Table */}
          <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted/80 text-[11px] font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Ad / Creative</th>
                  <th className="px-4 py-2.5">Creator / Editor</th>
                  <th className="px-4 py-2.5 text-right">Visibility for {selectedUser?.name ?? "User"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {filteredAds.map((ad) => {
                  const isHidden = userHiddenList.includes(ad.id);
                  return (
                    <tr key={ad.id} className={cn("hover:bg-muted/30 transition", isHidden && "bg-destructive/5 opacity-80")}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
                            {ad.thumbnail_url ? (
                              <img src={ad.thumbnail_url} alt="" className="size-full object-cover" />
                            ) : (
                              <Video className="size-3 text-muted-foreground" />
                            )}
                          </div>
                          <div>
                            <p className="font-semibold text-foreground">{ad.name}</p>
                            <p className="font-mono text-[10px] text-muted-foreground">ID: {ad.id.slice(0, 8)}...</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        <p>{ad.creator?.name ?? "No creator"}</p>
                        <p className="text-[10px] opacity-80">{ad.editor?.name ?? "No editor"}</p>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => toggleAdVisibility(ad.id)}
                          disabled={pending}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer",
                            isHidden
                              ? "bg-destructive/15 text-destructive hover:bg-destructive/25"
                              : "bg-success/15 text-success hover:bg-success/25"
                          )}
                        >
                          {isHidden ? (
                            <>
                              <EyeOff className="size-3" />
                              Hidden
                            </>
                          ) : (
                            <>
                              <Eye className="size-3" />
                              Visible
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filteredAds.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-xs text-muted-foreground">
                      No matching ads found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-end border-t border-border px-6 py-3.5 bg-muted/10 shrink-0">
          <Button variant="secondary" onClick={() => { onSuccess(); onClose(); }}>
            Close
          </Button>
        </div>
      </section>
    </Modal>
  );
}
