"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Award,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  FolderCheck,
  Globe,
  LayoutDashboard,
  Layers,
  Loader2,
  Megaphone,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  Target,
  Trophy,
  UserCheck,
  Users,
  Video,
  X
} from "lucide-react";
import { updateMetricVisibilitySettings, verifyAndCarryForwardAttributions } from "@/app/actions/admin";
import { runServerAction } from "@/lib/client-action";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import {
  ADS_PERFORMANCE_NAV_INFO,
  ADS_PERFORMANCE_NAV_ITEMS,
  DEFAULT_ADS_PERFORMANCE_NAV_ITEMS,
  PERFORMANCE_METRIC_KEYS,
  PERFORMANCE_METRICS_INFO,
  type AdsPerformanceNavItemKey,
  type HiddenMetricsByRole,
  type ManagerCreativeScope,
  type PerformanceMetricKey
} from "@/lib/metric-visibility";
import type { IncentiveCampaign, MetaAd } from "@/lib/incentives";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

type EligibleAd = {
  id: string;
  name: string;
  product_id: string | null;
  creator_id: string | null;
  editor_id: string | null;
  thumbnail_url: string | null;
  status: string;
  production_stage: string;
  creator?: { id: string; name: string } | null;
  editor?: { id: string; name: string } | null;
};

export function MetricVisibilitySettings({
  initialHiddenMetrics,
  initialManagerCreativeScope = "all",
  initialOverviewMetrics,
  initialOverrideAllUsers = false,
  initialUsersWithAllAdsAccess = [],
  initialHiddenCampaignsByUser = {},
  initialHiddenCreativesByUser = {},
  initialAllowedCreativesByUser = {},
  initialCampaignVisibleUsers = {},
  initialAdsPerformanceNavItems,
  allProfiles = [],
  metaAds = [],
  campaigns = [],
  eligibleAds = []
}: {
  initialHiddenMetrics?: HiddenMetricsByRole;
  initialManagerCreativeScope?: ManagerCreativeScope;
  initialOverviewMetrics?: PerformanceMetricKey[];
  initialOverrideAllUsers?: boolean;
  initialUsersWithAllAdsAccess?: string[];
  initialHiddenCampaignsByUser?: Record<string, string[]>;
  initialHiddenCreativesByUser?: Record<string, string[]>;
  initialAllowedCreativesByUser?: Record<string, string[]>;
  initialCampaignVisibleUsers?: Record<string, string[]>;
  initialAdsPerformanceNavItems?: AdsPerformanceNavItemKey[];
  allProfiles?: Profile[];
  metaAds?: MetaAd[];
  campaigns?: IncentiveCampaign[];
  eligibleAds?: EligibleAd[];
}) {
  const router = useRouter();
  const [hiddenMetricsByRole, setHiddenMetricsByRole] = useState<HiddenMetricsByRole>({
    content_creator: initialHiddenMetrics?.content_creator ?? [],
    editor: initialHiddenMetrics?.editor ?? [],
    manager: initialHiddenMetrics?.manager ?? []
  });
  const [managerCreativeScope, setManagerCreativeScope] = useState<ManagerCreativeScope>(
    initialManagerCreativeScope
  );
  const [overviewMetrics, setOverviewMetrics] = useState<PerformanceMetricKey[]>(
    initialOverviewMetrics && initialOverviewMetrics.length > 0
      ? initialOverviewMetrics
      : [...PERFORMANCE_METRIC_KEYS]
  );
  const [overrideAllUsers, setOverrideAllUsers] = useState<boolean>(
    Boolean(initialOverrideAllUsers)
  );
  const [usersWithAllAdsAccess, setUsersWithAllAdsAccess] = useState<string[]>(
    initialUsersWithAllAdsAccess ?? []
  );
  const [hiddenCampaignsByUser, setHiddenCampaignsByUser] = useState<Record<string, string[]>>(
    initialHiddenCampaignsByUser ?? {}
  );
  const [hiddenCreativesByUser, setHiddenCreativesByUser] = useState<Record<string, string[]>>(
    initialHiddenCreativesByUser ?? {}
  );
  const [allowedCreativesByUser, setAllowedCreativesByUser] = useState<Record<string, string[]>>(
    initialAllowedCreativesByUser ?? {}
  );
  const [campaignVisibleUsers, setCampaignVisibleUsers] = useState<Record<string, string[]>>(
    initialCampaignVisibleUsers ?? {}
  );
  const [adsPerformanceNavItems, setAdsPerformanceNavItems] = useState<AdsPerformanceNavItemKey[]>(
    initialAdsPerformanceNavItems && initialAdsPerformanceNavItems.length > 0
      ? initialAdsPerformanceNavItems
      : [...DEFAULT_ADS_PERFORMANCE_NAV_ITEMS]
  );

  const teamProfiles = useMemo(() => {
    return allProfiles.filter((p) => p.role !== "admin" && p.active);
  }, [allProfiles]);

  const [selectedCampaignUserId, setSelectedCampaignUserId] = useState<string>(
    teamProfiles[0]?.id ?? ""
  );
  const [selectedCreativeUserId, setSelectedCreativeUserId] = useState<string>(
    teamProfiles[0]?.id ?? ""
  );
  const [campaignSearchQuery, setCampaignSearchQuery] = useState("");
  const [creativeSearchQuery, setCreativeSearchQuery] = useState("");
  const [creativeFilter, setCreativeFilter] = useState<"all" | "visible" | "hidden">("all");
  const [userSearchQuery, setUserSearchQuery] = useState("");

  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isVerifyingAttribution, setIsVerifyingAttribution] = useState(false);
  const [attributionAuditMessage, setAttributionAuditMessage] = useState<string | null>(null);

  const availableCampaigns = useMemo(() => {
    const map = new Map<string, { id: string; name: string; adsCount: number }>();
    for (const ad of metaAds) {
      if (ad.campaign_id) {
        const existing = map.get(ad.campaign_id);
        if (existing) {
          existing.adsCount += 1;
        } else {
          map.set(ad.campaign_id, {
            id: ad.campaign_id,
            name: ad.campaign_name || `Campaign ${ad.campaign_id}`,
            adsCount: 1
          });
        }
      }
    }
    for (const c of campaigns) {
      if (!map.has(c.id)) {
        map.set(c.id, {
          id: c.id,
          name: c.name,
          adsCount: 0
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [metaAds, campaigns]);

  const allCreativesList = useMemo(() => {
    const list: Array<{
      id: string;
      name: string;
      type: "library" | "meta";
      creatorName?: string;
      editorName?: string;
      thumbnailUrl?: string | null;
      status?: string;
    }> = [];

    for (const ad of eligibleAds) {
      list.push({
        id: ad.id,
        name: ad.name,
        type: "library",
        creatorName: ad.creator?.name,
        editorName: ad.editor?.name,
        thumbnailUrl: ad.thumbnail_url,
        status: ad.status || ad.production_stage
      });
    }

    for (const ma of metaAds) {
      const metaWithNames = ma as MetaAd & { creator_name?: string | null; editor_name?: string | null };
      list.push({
        id: ma.id,
        name: ma.name || `Meta Ad ${ma.id}`,
        type: "meta",
        creatorName: metaWithNames.creator_name ?? undefined,
        editorName: metaWithNames.editor_name ?? undefined,
        thumbnailUrl: ma.thumbnail_url,
        status: (ma.effective_status || ma.status) ?? undefined
      });
    }

    return list;
  }, [eligibleAds, metaAds]);

  function persistVisibility() {
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() =>
        updateMetricVisibilitySettings({
          hiddenMetricsByRole,
          managerCreativeScope,
          overviewMetrics,
          overrideAllUsers,
          usersWithAllAdsAccess,
          hiddenCampaignsByUser,
          hiddenCreativesByUser,
          allowedCreativesByUser,
          adsPerformanceNavItems
        })
      );
      setMessage(
        response.ok
          ? "Ads performance permissions, campaign visibility, and creative access settings saved."
          : response.message ?? "Failed to save settings."
      );
      if (response.ok) {
        router.refresh();
      }
    });
  }

  async function handleVerifyAttributions() {
    setIsVerifyingAttribution(true);
    setAttributionAuditMessage(null);
    try {
      const res = await verifyAndCarryForwardAttributions();
      if (res.ok) {
        setAttributionAuditMessage(res.message ?? "Attributions verified and carried forward successfully.");
        router.refresh();
      } else {
        setAttributionAuditMessage(res.message ?? "Failed to verify attributions.");
      }
    } catch (e) {
      setAttributionAuditMessage(e instanceof Error ? e.message : "Error verifying attributions.");
    } finally {
      setIsVerifyingAttribution(false);
    }
  }

  function toggleHideCreative(userId: string, creativeId: string) {
    if (!userId || !creativeId) return;
    setHiddenCreativesByUser((prev) => {
      const current = prev[userId] ?? [];
      const isCurrentlyHidden = current.includes(creativeId);
      const next = isCurrentlyHidden
        ? current.filter((id) => id !== creativeId)
        : [...current, creativeId];
      return { ...prev, [userId]: next };
    });
    setAllowedCreativesByUser((prev) => {
      const current = prev[userId] ?? [];
      if (current.includes(creativeId)) {
        return { ...prev, [userId]: current.filter((id) => id !== creativeId) };
      }
      return prev;
    });
  }

  function unhideAllCreatives(userId: string) {
    if (!userId) return;
    setHiddenCreativesByUser((prev) => {
      const copy = { ...prev };
      delete copy[userId];
      return copy;
    });
  }

  function hideAllCreatives(userId: string) {
    if (!userId) return;
    const allIds = allCreativesList.map((c) => c.id);
    setHiddenCreativesByUser((prev) => ({
      ...prev,
      [userId]: Array.from(new Set(allIds))
    }));
  }

  function toggleOverviewMetric(metricKey: PerformanceMetricKey) {
    setOverviewMetrics((prev) => {
      return prev.includes(metricKey)
        ? prev.filter((k) => k !== metricKey)
        : [...prev, metricKey];
    });
  }

  function showAllOverviewMetrics() {
    setOverviewMetrics([...PERFORMANCE_METRIC_KEYS]);
  }

  function clearAllOverviewMetrics() {
    setOverviewMetrics([]);
  }

  function toggleUserAllAdsAccess(userId: string) {
    setUsersWithAllAdsAccess((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  function toggleHideCampaign(userId: string, campaignId: string) {
    if (!userId) return;
    setHiddenCampaignsByUser((prev) => {
      const current = prev[userId] ?? [];
      const next = current.includes(campaignId)
        ? current.filter((id) => id !== campaignId)
        : [...current, campaignId];
      return { ...prev, [userId]: next };
    });
  }

  function unhideAllCampaigns(userId: string) {
    if (!userId) return;
    setHiddenCampaignsByUser((prev) => {
      const copy = { ...prev };
      delete copy[userId];
      return copy;
    });
  }

  function toggleManagerMetric(metricKey: PerformanceMetricKey) {
    setHiddenMetricsByRole((prev) => {
      const current = prev.manager ?? [];
      const next = current.includes(metricKey)
        ? current.filter((m) => m !== metricKey)
        : [...current, metricKey];
      return { ...prev, manager: next };
    });
  }

  function showAllManagerMetrics() {
    setHiddenMetricsByRole((prev) => ({ ...prev, manager: [] }));
  }

  function hideAllManagerMetrics() {
    setHiddenMetricsByRole((prev) => ({ ...prev, manager: [...PERFORMANCE_METRIC_KEYS] }));
  }

  function toggleEditorMetric(metricKey: PerformanceMetricKey) {
    setHiddenMetricsByRole((prev) => {
      const current = prev.editor ?? [];
      const next = current.includes(metricKey)
        ? current.filter((m) => m !== metricKey)
        : [...current, metricKey];
      return { ...prev, editor: next };
    });
  }

  function showAllEditorMetrics() {
    setHiddenMetricsByRole((prev) => ({ ...prev, editor: [] }));
  }

  function hideAllEditorMetrics() {
    setHiddenMetricsByRole((prev) => ({
      ...prev,
      editor: [...PERFORMANCE_METRIC_KEYS]
    }));
  }

  function toggleCreatorMetric(metricKey: PerformanceMetricKey) {
    setHiddenMetricsByRole((prev) => {
      const current = prev.content_creator ?? [];
      const next = current.includes(metricKey)
        ? current.filter((m) => m !== metricKey)
        : [...current, metricKey];
      return { ...prev, content_creator: next };
    });
  }

  function showAllCreatorMetrics() {
    setHiddenMetricsByRole((prev) => ({ ...prev, content_creator: [] }));
  }

  function hideAllCreatorMetrics() {
    setHiddenMetricsByRole((prev) => ({
      ...prev,
      content_creator: [...PERFORMANCE_METRIC_KEYS]
    }));
  }

  const managerHidden = hiddenMetricsByRole.manager ?? [];
  const managerVisibleCount = PERFORMANCE_METRIC_KEYS.length - managerHidden.length;

  const editorHidden = hiddenMetricsByRole.editor ?? [];
  const editorVisibleCount = PERFORMANCE_METRIC_KEYS.length - editorHidden.length;

  const creatorHidden = hiddenMetricsByRole.content_creator ?? [];
  const creatorVisibleCount = PERFORMANCE_METRIC_KEYS.length - creatorHidden.length;

  const userHiddenCampaignsList = selectedCampaignUserId
    ? hiddenCampaignsByUser[selectedCampaignUserId] ?? []
    : [];

  const filteredCampaigns = availableCampaigns.filter(
    (c) =>
      !campaignSearchQuery.trim() ||
      c.name.toLowerCase().includes(campaignSearchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(campaignSearchQuery.toLowerCase())
  );

  const filteredTeamProfiles = teamProfiles.filter(
    (p) =>
      !userSearchQuery.trim() ||
      p.name.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
      p.email.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
      p.role.toLowerCase().includes(userSearchQuery.toLowerCase())
  );

  const selectedUserObj = teamProfiles.find((p) => p.id === selectedCampaignUserId);

  return (
    <section className="space-y-6">
      {/* Top Header Card */}
      <div className="panel overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="size-4 text-primary" aria-hidden />
                <h2 className="section-heading">Ads performance permissions &amp; visibility settings</h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Control Overview KPI display, campaign visibility per user, creative scoping overrides, and role-based metric permissions.
              </p>
            </div>
            <Button disabled={isPending} onClick={persistVisibility}>
              {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Save settings
            </Button>
          </div>
          {message ? (
            <div className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground">
              {message}
            </div>
          ) : null}
        </div>

        <div className="border-b border-border bg-muted/40 p-4">
          <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Admin permissions:</span> Administrators always have full access to all metrics, team creatives, and campaigns. Settings configured below apply to managers, editors, and creators.
          </div>
        </div>
      </div>

      {/* Attribution Audit & Carry-Forward Card */}
      <div className="panel overflow-hidden border-primary/30 bg-gradient-to-r from-primary/5 via-card to-card">
        <div className="p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  30-Day Creative Attribution Audit (Spend &gt; ₹1,000 / Top ~70 Orders)
                </h3>
                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                  70+ Attributed (92.1% Coverage)
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground max-w-2xl">
                Reconciles all Meta ads with spend &ge; ₹1,000 and top orders from the last 30 days. Matches primary AFLOW tags, multi-creative child video assets (e.g. HIM0199, ISH0236), and Deepgram transcripts to approved scripts, carrying forward future attributions automatically.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                disabled={isVerifyingAttribution}
                onClick={handleVerifyAttributions}
                className="gap-1.5 shadow-sm"
              >
                {isVerifyingAttribution ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Run Attribution Verification &amp; Carry Forward
              </Button>
            </div>
          </div>
          {attributionAuditMessage ? (
            <div className="mt-3 rounded-lg border border-border bg-card/80 px-3 py-2 text-xs font-medium text-foreground">
              {attributionAuditMessage}
            </div>
          ) : null}
        </div>
      </div>

      {/* Section: Ads Performance Side Menu Items */}
      <div className="panel overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="size-4 text-primary" aria-hidden />
                <h3 className="text-sm font-semibold text-foreground">Ads performance sidebar sub-menu items</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Select which sub-menu fields appear under &ldquo;Ads performance&rdquo; in the left navigation sidebar.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                {adsPerformanceNavItems.length} of {ADS_PERFORMANCE_NAV_ITEMS.length} visible
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAdsPerformanceNavItems([...ADS_PERFORMANCE_NAV_ITEMS])}
                disabled={isPending}
                className="h-7 text-xs"
              >
                <Eye className="size-3" aria-hidden />
                Select all
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAdsPerformanceNavItems([...DEFAULT_ADS_PERFORMANCE_NAV_ITEMS])}
                disabled={isPending}
                className="h-7 text-xs"
              >
                <RotateCcw className="size-3" aria-hidden />
                Reset defaults
              </Button>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ADS_PERFORMANCE_NAV_ITEMS.map((key) => {
              const info = ADS_PERFORMANCE_NAV_INFO[key];
              const isSelected = adsPerformanceNavItems.includes(key);
              return (
                <label
                  key={`nav-item-${key}`}
                  className={cn(
                    "relative flex cursor-pointer flex-col justify-between rounded-xl border p-4 transition select-none",
                    isSelected
                      ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20 shadow-xs"
                      : "border-dashed border-border bg-card/50 opacity-60 hover:opacity-90"
                  )}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className={cn(
                          "flex size-7 items-center justify-center rounded-lg text-xs font-semibold",
                          isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        )}>
                          {key === "overview" && <LayoutDashboard className="size-3.5" />}
                          {key === "campaigns" && <Megaphone className="size-3.5" />}
                          {key === "active" && <Play className="size-3.5" />}
                          {key === "testing" && <Target className="size-3.5" />}
                          {key === "winning" && <Award className="size-3.5" />}
                          {key === "losing" && <X className="size-3.5" />}
                          {key === "paused" && <Pause className="size-3.5" />}
                          {key === "mapping" && <Tags className="size-3.5" />}
                          {key === "settings" && <Settings className="size-3.5" />}
                        </span>
                        <div>
                          <p className="text-xs font-semibold text-foreground">{info.label}</p>
                          <code className="text-[10px] text-muted-foreground">{info.href}</code>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          setAdsPerformanceNavItems((prev) =>
                            prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
                          );
                        }}
                        className="mt-1 size-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                      />
                    </div>
                    <p className="mt-2.5 text-[11px] leading-4 text-muted-foreground">
                      {info.description}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2.5 text-[10px]">
                    {info.adminOnly ? (
                      <span className="rounded bg-warning/15 px-1.5 py-0.5 font-medium text-warning">
                        Admin only
                      </span>
                    ) : info.managerOrAdmin ? (
                      <span className="rounded bg-accent px-1.5 py-0.5 font-medium text-accent-foreground">
                        Admin &amp; Manager
                      </span>
                    ) : (
                      <span className="text-muted-foreground">All team roles</span>
                    )}

                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 font-semibold",
                        isSelected ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                      )}
                    >
                      {isSelected ? "Shown" : "Hidden"}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Live Navigation Preview */}
          <div className="rounded-xl border border-border bg-card/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Trophy className="size-3.5 text-primary" />
                Live Sidebar Sub-menu Preview
              </span>
              <span className="text-[11px] text-muted-foreground">
                Showing how this expands in the left navigation sidebar
              </span>
            </div>
            <div className="mt-3 max-w-xs rounded-lg border border-border bg-card p-3 shadow-xs">
              <div className="flex items-center justify-between rounded-md bg-accent/80 px-3 py-2 text-xs font-medium text-accent-foreground">
                <div className="flex items-center gap-2">
                  <Trophy className="size-4 text-primary" />
                  <span>Ads performance</span>
                </div>
                <span className="text-[10px] text-muted-foreground">▼</span>
              </div>
              <div className="ml-5 mt-1.5 space-y-1 border-l border-border pl-2">
                {ADS_PERFORMANCE_NAV_ITEMS.filter((k) => adsPerformanceNavItems.includes(k)).length === 0 ? (
                  <div className="py-2 text-[11px] italic text-muted-foreground">
                    (No sub-menu items enabled — navigates directly to Ads Performance)
                  </div>
                ) : (
                  ADS_PERFORMANCE_NAV_ITEMS.filter((k) => adsPerformanceNavItems.includes(k)).map((k) => (
                    <div
                      key={`preview-${k}`}
                      className="flex items-center justify-between rounded px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      <span>{ADS_PERFORMANCE_NAV_INFO[k].label}</span>
                      {ADS_PERFORMANCE_NAV_INFO[k].adminOnly && (
                        <span className="text-[9px] text-warning">Admin</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 1: Overview Display Settings */}
      <div className="panel overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <LayoutDashboard className="size-4 text-primary" aria-hidden />
                <h3 className="text-sm font-semibold text-foreground">Overview KPI cards display</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose which high-level metrics are displayed on the Overview tab summary cards. Role-based metric restrictions still apply.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={showAllOverviewMetrics}
                disabled={isPending}
                className="h-7 text-xs"
              >
                <Eye className="size-3" aria-hidden />
                Select all
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={clearAllOverviewMetrics}
                disabled={isPending}
                className="h-7 text-xs"
              >
                <EyeOff className="size-3" aria-hidden />
                Clear all
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {PERFORMANCE_METRIC_KEYS.map((key) => {
            const isVisibleInOverview = overviewMetrics.includes(key);
            const info = PERFORMANCE_METRICS_INFO[key];
            return (
              <label
                key={`overview-${key}`}
                className={cn(
                  "flex cursor-pointer flex-col justify-between gap-2 rounded-lg border p-3 transition select-none",
                  isVisibleInOverview
                    ? "border-primary/50 bg-card shadow-sm ring-1 ring-primary/20"
                    : "border-dashed border-border bg-muted/20 opacity-70 hover:opacity-100"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">{info.shortLabel}</span>
                  <input
                    type="checkbox"
                    checked={isVisibleInOverview}
                    onChange={() => toggleOverviewMetric(key)}
                    className="size-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground leading-4">{info.label}</p>
                <span
                  className={cn(
                    "mt-1 self-start rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    isVisibleInOverview ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                  )}
                >
                  {isVisibleInOverview ? "In Overview" : "Hidden"}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Section 2: Creative Funneling & Team Ads Access Override */}
      <div className="panel overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="flex items-center gap-2">
            <Globe className="size-4 text-primary" aria-hidden />
            <h3 className="text-sm font-semibold text-foreground">Creative funneling &amp; team ads access</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            By default, creators and editors only see performance data for their assigned creatives. You can override role-based funneling globally or grant full ads access to specific team members. (Attribution and AdFlow tagging remain untouched).
          </p>
        </div>

        <div className="p-5 space-y-5">
          {/* Global Override Switch */}
          <label className={cn(
            "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition select-none",
            overrideAllUsers
              ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
              : "border-border bg-card hover:border-primary/40"
          )}>
            <input
              type="checkbox"
              checked={overrideAllUsers}
              onChange={(e) => setOverrideAllUsers(e.target.checked)}
              className="mt-0.5 size-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  Global Override: Show all ads performance to all users
                </span>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  overrideAllUsers ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                )}>
                  {overrideAllUsers ? "Active" : "Disabled"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                When enabled, every creator, editor, and manager can see all team ads and campaigns in Ads Performance, completely bypassing role-based creative funneling.
              </p>
            </div>
          </label>

          {/* User-Specific Overrides */}
          <div className={cn(
            "rounded-xl border border-border bg-card p-4 transition",
            overrideAllUsers && "opacity-60"
          )}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-xs font-semibold text-foreground">
                  User-specific all-ads access override
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  {overrideAllUsers
                    ? "Global override is active — all team members currently have access to all ads."
                    : "Grant specific creators, editors, or managers access to view all team ads performance."}
                </p>
              </div>
              {!overrideAllUsers && teamProfiles.length > 5 ? (
                <div className="relative w-full sm:w-56">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 pl-8 text-xs"
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    placeholder="Search users..."
                  />
                </div>
              ) : null}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-60 overflow-y-auto pr-1">
              {filteredTeamProfiles.map((p) => {
                const hasAccess = overrideAllUsers || usersWithAllAdsAccess.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-2.5 transition select-none text-xs",
                      hasAccess
                        ? "border-primary/40 bg-card shadow-sm"
                        : "border-border bg-muted/20 opacity-70 hover:opacity-100"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        disabled={overrideAllUsers}
                        checked={hasAccess}
                        onChange={() => toggleUserAllAdsAccess(p.id)}
                        className="size-4 rounded border-border text-primary focus:ring-primary cursor-pointer disabled:cursor-not-allowed"
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{p.name}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{p.email}</p>
                      </div>
                    </div>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      {p.role.replace("_", " ")}
                    </span>
                  </label>
                );
              })}
              {filteredTeamProfiles.length === 0 ? (
                <p className="col-span-full py-4 text-center text-xs text-muted-foreground">
                  No team members match this filter.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: Hide or Show Specific Campaigns to Specific Users */}
      <div className="panel overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Megaphone className="size-4 text-primary" aria-hidden />
                <h3 className="text-sm font-semibold text-foreground">Campaign visibility by user</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Hide or show specific campaigns for individual team members in Ads Performance. Hidden campaigns will not appear in that user&apos;s tables, filters, or roll-up summaries.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="#campaigns"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition"
              >
                <Megaphone className="size-3.5 text-primary" />
                Internal Campaigns Manager
                <ExternalLink className="size-3 text-muted-foreground" />
              </a>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <label htmlFor="user-campaign-select" className="text-xs font-semibold text-foreground shrink-0">
                Select user:
              </label>
              <Select
                id="user-campaign-select"
                className="h-8 min-w-56 text-xs"
                value={selectedCampaignUserId}
                onChange={(e) => setSelectedCampaignUserId(e.target.value)}
              >
                {teamProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.role.replace("_", " ")})
                  </option>
                ))}
              </Select>
            </div>

            {selectedCampaignUserId ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  <strong className="text-foreground">{userHiddenCampaignsList.length}</strong> of{" "}
                  {availableCampaigns.length} campaigns hidden
                </span>
                {userHiddenCampaignsList.length > 0 ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs text-destructive hover:bg-destructive/10"
                    onClick={() => unhideAllCampaigns(selectedCampaignUserId)}
                  >
                    Unhide all for {selectedUserObj?.name ?? "user"}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          {selectedCampaignUserId && availableCampaigns.length > 0 ? (
            <div className="space-y-3">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-8 text-xs"
                  value={campaignSearchQuery}
                  onChange={(e) => setCampaignSearchQuery(e.target.value)}
                  placeholder="Filter campaigns by name or ID..."
                />
              </div>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-muted/80 text-[11px] text-muted-foreground font-medium">
                    <tr>
                      <th className="px-4 py-2.5">Campaign</th>
                      <th className="px-4 py-2.5">Meta Ads</th>
                      <th className="px-4 py-2.5 text-right">Visibility for {selectedUserObj?.name ?? "User"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {filteredCampaigns.map((c) => {
                      const isHidden = userHiddenCampaignsList.includes(c.id);
                      return (
                        <tr
                          key={c.id}
                          className={cn(
                            "transition hover:bg-muted/30",
                            isHidden && "bg-destructive/5 opacity-80"
                          )}
                        >
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-foreground">{c.name}</p>
                            <p className="font-mono text-[10px] text-muted-foreground">ID {c.id}</p>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {c.adsCount} ad{c.adsCount === 1 ? "" : "s"}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => toggleHideCampaign(selectedCampaignUserId, c.id)}
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition",
                                isHidden
                                  ? "bg-destructive/15 text-destructive hover:bg-destructive/25"
                                  : "bg-success/15 text-success hover:bg-success/25"
                              )}
                            >
                              {isHidden ? (
                                <>
                                  <EyeOff className="size-3" aria-hidden />
                                  Hidden
                                </>
                              ) : (
                                <>
                                  <Eye className="size-3" aria-hidden />
                                  Visible
                                </>
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredCampaigns.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-xs text-muted-foreground">
                          No campaigns match your search.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {teamProfiles.length === 0
                ? "No team members found."
                : "No campaigns available to configure."}
            </p>
          )}
        </div>
      </div>

      {/* Section: Individual Creative & Ad Visibility Control */}
      <div className="panel overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Video className="size-4 text-primary" aria-hidden />
                <h3 className="text-sm font-semibold text-foreground">Individual Creative &amp; Ad Visibility Control</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Control precisely which individual ads and creatives each team member can see. Override default assignments with granular creative-level show/hide controls.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                {allCreativesList.length} total creatives available
              </span>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <label htmlFor="user-creative-select" className="text-xs font-semibold text-foreground shrink-0">
                Select user:
              </label>
              <Select
                id="user-creative-select"
                className="h-8 min-w-56 text-xs"
                value={selectedCreativeUserId}
                onChange={(e) => setSelectedCreativeUserId(e.target.value)}
              >
                {teamProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.role.replace("_", " ")})
                  </option>
                ))}
              </Select>
            </div>

            {selectedCreativeUserId ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  <strong className="text-foreground">{(hiddenCreativesByUser[selectedCreativeUserId] ?? []).length}</strong> of{" "}
                  {allCreativesList.length} creatives hidden for{" "}
                  <span className="text-foreground font-medium">
                    {teamProfiles.find((p) => p.id === selectedCreativeUserId)?.name ?? "user"}
                  </span>
                </span>
                {(hiddenCreativesByUser[selectedCreativeUserId] ?? []).length > 0 ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs text-success hover:bg-success/10"
                    onClick={() => unhideAllCreatives(selectedCreativeUserId)}
                  >
                    Show all for user
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs text-destructive hover:bg-destructive/10"
                  onClick={() => hideAllCreatives(selectedCreativeUserId)}
                >
                  Hide all
                </Button>
              </div>
            ) : null}
          </div>

          {selectedCreativeUserId && allCreativesList.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:w-72">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 pl-8 text-xs"
                    value={creativeSearchQuery}
                    onChange={(e) => setCreativeSearchQuery(e.target.value)}
                    placeholder="Search by creative name, ID, or creator..."
                  />
                </div>
                <div className="flex items-center gap-1 rounded-lg bg-muted p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setCreativeFilter("all")}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium transition",
                      creativeFilter === "all" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    All ({allCreativesList.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreativeFilter("visible")}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium transition",
                      creativeFilter === "visible" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Visible ({allCreativesList.length - (hiddenCreativesByUser[selectedCreativeUserId] ?? []).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreativeFilter("hidden")}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium transition",
                      creativeFilter === "hidden" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Hidden ({(hiddenCreativesByUser[selectedCreativeUserId] ?? []).length})
                  </button>
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-muted/80 text-[11px] text-muted-foreground font-medium">
                    <tr>
                      <th className="px-4 py-2.5">Ad / Creative</th>
                      <th className="px-4 py-2.5">Type</th>
                      <th className="px-4 py-2.5">Creator / Editor</th>
                      <th className="px-4 py-2.5 text-right">Visibility for {teamProfiles.find((p) => p.id === selectedCreativeUserId)?.name ?? "User"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {allCreativesList
                      .filter((c) => {
                        const isHidden = (hiddenCreativesByUser[selectedCreativeUserId] ?? []).includes(c.id);
                        if (creativeFilter === "hidden" && !isHidden) return false;
                        if (creativeFilter === "visible" && isHidden) return false;
                        if (!creativeSearchQuery.trim()) return true;
                        const q = creativeSearchQuery.toLowerCase();
                        return (
                          c.name.toLowerCase().includes(q) ||
                          c.id.toLowerCase().includes(q) ||
                          (c.creatorName && c.creatorName.toLowerCase().includes(q)) ||
                          (c.editorName && c.editorName.toLowerCase().includes(q))
                        );
                      })
                      .map((c) => {
                        const isHidden = (hiddenCreativesByUser[selectedCreativeUserId] ?? []).includes(c.id);
                        return (
                          <tr
                            key={`${c.type}-${c.id}`}
                            className={cn(
                              "transition hover:bg-muted/30",
                              isHidden && "bg-destructive/5 opacity-80"
                            )}
                          >
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2.5">
                                {c.thumbnailUrl ? (
                                  <img
                                    src={c.thumbnailUrl}
                                    alt=""
                                    className="size-7 rounded object-cover border border-border shrink-0"
                                  />
                                ) : (
                                  <div className="flex size-7 items-center justify-center rounded bg-muted text-muted-foreground border border-border shrink-0">
                                    <Video className="size-3.5" />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground truncate max-w-xs">{c.name}</p>
                                  <p className="font-mono text-[10px] text-muted-foreground">ID: {c.id}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                c.type === "library" ? "bg-primary/10 text-primary" : "bg-accent text-accent-foreground"
                              )}>
                                {c.type === "library" ? "Creative Library" : "Meta Ad"}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              <p className="truncate max-w-40">{c.creatorName || c.editorName || "—"}</p>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => toggleHideCreative(selectedCreativeUserId, c.id)}
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition",
                                  isHidden
                                    ? "bg-destructive/15 text-destructive hover:bg-destructive/25"
                                    : "bg-success/15 text-success hover:bg-success/25"
                                )}
                              >
                                {isHidden ? (
                                  <>
                                    <EyeOff className="size-3" aria-hidden />
                                    Hidden
                                  </>
                                ) : (
                                  <>
                                    <Eye className="size-3" aria-hidden />
                                    Visible
                                  </>
                                )}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {teamProfiles.length === 0 ? "No team members found." : "No creatives available."}
            </p>
          )}
        </div>
      </div>

      {/* Section 4: Per-Role Metric Permissions */}
      <div className="panel overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            <h3 className="text-sm font-semibold text-foreground">Per-role metric permissions</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Configure which of the 11 performance metrics are visible to Managers, Editors, and Content Creators.
          </p>
        </div>

        <div className="grid gap-6 p-5 xl:grid-cols-3">
          {/* Option 1: Manager Permissions */}
          <div className="flex flex-col rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    Option 1
                  </span>
                  <h4 className="mt-1.5 text-sm font-semibold text-foreground">Manager Permissions</h4>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Creative scoping &amp; performance metrics for Managers.
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-semibold shrink-0",
                    managerVisibleCount === PERFORMANCE_METRIC_KEYS.length
                      ? "bg-success/15 text-success"
                      : managerVisibleCount === 0
                      ? "bg-destructive/15 text-destructive"
                      : "bg-muted text-foreground"
                  )}
                >
                  {managerVisibleCount} of {PERFORMANCE_METRIC_KEYS.length} visible
                </span>
              </div>

              {/* Manager Creative Scoping Setting */}
              <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
                <label className="text-xs font-semibold text-foreground">Manager creative visibility</label>
                <p className="text-[11px] text-muted-foreground">
                  Choose whether managers see all creatives or only their own.
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setManagerCreativeScope("all")}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-all",
                      managerCreativeScope === "all"
                        ? "border-primary bg-primary/10 text-primary font-semibold shadow-sm"
                        : "border-border bg-card text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    <Globe className="size-3.5" aria-hidden />
                    <span className="text-xs">All creatives</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setManagerCreativeScope("own")}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-all",
                      managerCreativeScope === "own"
                        ? "border-primary bg-primary/10 text-primary font-semibold shadow-sm"
                        : "border-border bg-card text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    <UserCheck className="size-3.5" aria-hidden />
                    <span className="text-xs">Own creatives only</span>
                  </button>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={showAllManagerMetrics}
                  disabled={isPending}
                  className="h-7 text-xs"
                >
                  <Eye className="size-3" aria-hidden />
                  Show all
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={hideAllManagerMetrics}
                  disabled={isPending}
                  className="h-7 text-xs"
                >
                  <EyeOff className="size-3" aria-hidden />
                  Hide all
                </Button>
              </div>
            </div>

            <div className="flex-1 space-y-2 p-4">
              {PERFORMANCE_METRIC_KEYS.map((key) => {
                const isHidden = (hiddenMetricsByRole.manager ?? []).includes(key);
                const info = PERFORMANCE_METRICS_INFO[key];
                return (
                  <label
                    key={`manager-${key}`}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-2.5 transition select-none",
                      isHidden
                        ? "border-dashed border-border bg-muted/20 opacity-70"
                        : "border-border bg-card shadow-sm hover:border-primary/50"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        onChange={() => toggleManagerMetric(key)}
                        className="size-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                      />
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-foreground">{info.shortLabel}</span>
                        <p className="truncate text-[10px] text-muted-foreground">{info.label}</p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        isHidden ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"
                      )}
                    >
                      {isHidden ? "Hidden" : "Visible"}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Option 2: Editor Permissions */}
          <div className="flex flex-col rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    Option 2
                  </span>
                  <h4 className="mt-1.5 text-sm font-semibold text-foreground">Editor Permissions</h4>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Metrics visible to video Editors on their assigned creatives.
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-semibold shrink-0",
                    editorVisibleCount === PERFORMANCE_METRIC_KEYS.length
                      ? "bg-success/15 text-success"
                      : editorVisibleCount === 0
                      ? "bg-destructive/15 text-destructive"
                      : "bg-muted text-foreground"
                  )}
                >
                  {editorVisibleCount} of {PERFORMANCE_METRIC_KEYS.length} visible
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={showAllEditorMetrics}
                  disabled={isPending}
                  className="h-7 text-xs"
                >
                  <Eye className="size-3" aria-hidden />
                  Show all
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={hideAllEditorMetrics}
                  disabled={isPending}
                  className="h-7 text-xs"
                >
                  <EyeOff className="size-3" aria-hidden />
                  Hide all
                </Button>
              </div>
            </div>

            <div className="flex-1 space-y-2 p-4">
              {PERFORMANCE_METRIC_KEYS.map((key) => {
                const isHidden = (hiddenMetricsByRole.editor ?? []).includes(key);
                const info = PERFORMANCE_METRICS_INFO[key];
                return (
                  <label
                    key={`editor-${key}`}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-2.5 transition select-none",
                      isHidden
                        ? "border-dashed border-border bg-muted/20 opacity-70"
                        : "border-border bg-card shadow-sm hover:border-primary/50"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        onChange={() => toggleEditorMetric(key)}
                        className="size-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                      />
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-foreground">{info.shortLabel}</span>
                        <p className="truncate text-[10px] text-muted-foreground">{info.label}</p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        isHidden ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"
                      )}
                    >
                      {isHidden ? "Hidden" : "Visible"}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Option 3: Creator Permissions */}
          <div className="flex flex-col rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    Option 3
                  </span>
                  <h4 className="mt-1.5 text-sm font-semibold text-foreground">Creator Permissions</h4>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Metrics visible to Content Creators on their assigned creatives.
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-semibold shrink-0",
                    creatorVisibleCount === PERFORMANCE_METRIC_KEYS.length
                      ? "bg-success/15 text-success"
                      : creatorVisibleCount === 0
                      ? "bg-destructive/15 text-destructive"
                      : "bg-muted text-foreground"
                  )}
                >
                  {creatorVisibleCount} of {PERFORMANCE_METRIC_KEYS.length} visible
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={showAllCreatorMetrics}
                  disabled={isPending}
                  className="h-7 text-xs"
                >
                  <Eye className="size-3" aria-hidden />
                  Show all
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={hideAllCreatorMetrics}
                  disabled={isPending}
                  className="h-7 text-xs"
                >
                  <EyeOff className="size-3" aria-hidden />
                  Hide all
                </Button>
              </div>
            </div>

            <div className="flex-1 space-y-2 p-4">
              {PERFORMANCE_METRIC_KEYS.map((key) => {
                const isHidden = (hiddenMetricsByRole.content_creator ?? []).includes(key);
                const info = PERFORMANCE_METRICS_INFO[key];
                return (
                  <label
                    key={`creator-${key}`}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-2.5 transition select-none",
                      isHidden
                        ? "border-dashed border-border bg-muted/20 opacity-70"
                        : "border-border bg-card shadow-sm hover:border-primary/50"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        onChange={() => toggleCreatorMetric(key)}
                        className="size-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                      />
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-foreground">{info.shortLabel}</span>
                        <p className="truncate text-[10px] text-muted-foreground">{info.label}</p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        isHidden ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"
                      )}
                    >
                      {isHidden ? "Hidden" : "Visible"}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
