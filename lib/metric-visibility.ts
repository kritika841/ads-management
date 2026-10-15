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
  "active",
  "testing",
  "winning",
  "losing",
  "paused",
  "mapping",
  "settings"
];

