export const PERFORMANCE_METRIC_KEYS = [
  "spend",
  "impressions",
  "reach",
  "clicks",
  "purchases",
  "revenue",
  "cpa",
  "cpc",
  "roas",
  "ctr",
  "cpm"
] as const;

export type PerformanceMetricKey = (typeof PERFORMANCE_METRIC_KEYS)[number];

export type ConfigurableMetricRole = "content_creator" | "editor" | "manager" | "media_buyer";

export type ManagerCreativeScope = "all" | "own";

export const DEFAULT_MANAGER_CREATIVE_SCOPE: ManagerCreativeScope = "all";

export type HiddenMetricsByRole = {
  content_creator?: PerformanceMetricKey[];
  editor?: PerformanceMetricKey[];
  manager?: PerformanceMetricKey[];
  media_buyer?: PerformanceMetricKey[];
};


export const PERFORMANCE_METRICS_INFO: Record<
  PerformanceMetricKey,
  { label: string; shortLabel: string; description: string }
> = {
  spend: { label: "Spend", shortLabel: "Spend", description: "Total budget spent on ad" },
  impressions: { label: "Impressions", shortLabel: "Impr.", description: "Total ad impressions" },
  reach: { label: "Reach", shortLabel: "Reach", description: "Unique viewers reached" },
  clicks: { label: "Clicks", shortLabel: "Clicks", description: "Total clicks on ad" },
  purchases: { label: "Purchases", shortLabel: "Purchases", description: "Attributed purchase conversions" },
  revenue: { label: "Revenue", shortLabel: "Revenue", description: "Attributed purchase revenue" },
  cpa: { label: "Cost / purchase (CPA)", shortLabel: "CPA", description: "Cost per acquired purchase" },
  cpc: { label: "Cost per click (CPC)", shortLabel: "CPC", description: "Cost per landing page click (link click)" },
  roas: { label: "Return on ad spend (ROAS)", shortLabel: "ROAS", description: "Revenue divided by spend" },
  ctr: { label: "Click-through rate (CTR)", shortLabel: "CTR", description: "Click rate percentage" },
  cpm: { label: "Cost per mille (CPM)", shortLabel: "CPM", description: "Cost per 1,000 impressions" }
};

export const DEFAULT_HIDDEN_METRICS: Record<ConfigurableMetricRole, PerformanceMetricKey[]> = {
  content_creator: [],
  editor: [],
  manager: [],
  media_buyer: []
};

export const ADS_PERFORMANCE_NAV_ITEMS = [
  "overview",
  "campaigns",
  "active",
  "testing",
  "winning",
  "losing",
  "paused",
  "mapping",
  "settings"
] as const;

export type AdsPerformanceNavItemKey = (typeof ADS_PERFORMANCE_NAV_ITEMS)[number];

export const ADS_PERFORMANCE_NAV_INFO: Record<
  AdsPerformanceNavItemKey,
  { label: string; href: string; description: string; adminOnly?: boolean; managerOrAdmin?: boolean }
> = {
  overview: {
    label: "Overview",
    href: "/incentives#overview",
    description: "High-level performance KPIs and aggregate summaries"
  },
  campaigns: {
    label: "Campaigns",
    href: "/incentives#campaigns",
    description: "Manage internal campaigns, assign creatives, and control user visibility",
    managerOrAdmin: true
  },
  active: {
    label: "Active creatives",
    href: "/incentives#active",
    description: "Creatives currently running and receiving spend"
  },
  testing: {
    label: "Testing creatives",
    href: "/incentives#testing",
    description: "New creatives in initial testing phase"
  },
  winning: {
    label: "Winning creatives",
    href: "/incentives#winning",
    description: "Top-performing creatives meeting target benchmarks"
  },
  losing: {
    label: "Losing creatives",
    href: "/incentives#losing",
    description: "Underperforming creatives failing to meet target benchmarks"
  },
  paused: {
    label: "Paused creatives",
    href: "/incentives#paused",
    description: "Creatives that have been stopped or disabled"
  },
  mapping: {
    label: "Creative attribution",
    href: "/incentives#mapping",
    description: "Transcript matching and Meta ad mapping tools",
    managerOrAdmin: true
  },
  settings: {
    label: "Settings",
    href: "/incentives#settings",
    description: "Metric visibility, permissions, and destination configuration",
    adminOnly: true
  }
};

export const DEFAULT_ADS_PERFORMANCE_NAV_ITEMS: AdsPerformanceNavItemKey[] = [
  "overview",
  "campaigns",
  "active",
  "testing",
  "winning",
  "losing",
  "paused",
  "mapping",
  "settings"
];

/**
 * Where an internal campaign's ads are surfaced inside Ads performance.
 * - campaigns_only: only in the admin/manager Campaigns tab (default)
 * - submenu: gets its own new sidebar submenu
 * - existing_tab: pinned inside an existing submenu (Overview, Active, ...)
 * - with_meta_campaign: pinned wherever a chosen Meta campaign is displayed
 * - override_all: targeted non-admin users see ONLY this campaign's ads
 */
export const CAMPAIGN_PLACEMENT_MODES = [
  "campaigns_only",
  "submenu",
  "existing_tab",
  "with_meta_campaign",
  "override_all"
] as const;

export type CampaignPlacementMode = (typeof CAMPAIGN_PLACEMENT_MODES)[number];

export type CampaignPlacement = {
  mode: CampaignPlacementMode;
  /** existing_tab: which submenu to pin into */
  tab_key?: AdsPerformanceNavItemKey;
  /** with_meta_campaign: the Meta campaign id to sit alongside */
  meta_campaign_id?: string;
  /** submenu: label shown in the sidebar (defaults to campaign name) */
  submenu_label?: string;
};

/** Existing submenus an internal campaign can be pinned into. */
export const PLACEABLE_TABS = ["overview", "active", "testing", "winning", "losing", "paused"] as const;

export function customSubmenuKey(campaignId: string) {
  return `cmp-${campaignId}`;
}

/** Which submenu a Meta campaign is shown in, based on its configured destination. */
export function tabForMetaCampaignDestination(destination?: string | null): AdsPerformanceNavItemKey {
  if (destination === "testing") return "testing";
  if (destination === "scaling") return "winning";
  return "overview";
}

