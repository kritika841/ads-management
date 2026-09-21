export const PERFORMANCE_METRIC_KEYS = [
  "spend",
  "impressions",
  "reach",
  "clicks",
  "purchases",
  "revenue",
  "cpa",
  "roas",
  "ctr",
  "cpm"
] as const;

export type PerformanceMetricKey = (typeof PERFORMANCE_METRIC_KEYS)[number];

export type ConfigurableMetricRole = "content_creator" | "editor" | "manager";

export type HiddenMetricsByRole = {
  content_creator?: PerformanceMetricKey[];
  editor?: PerformanceMetricKey[];
  manager?: PerformanceMetricKey[];
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
  roas: { label: "Return on ad spend (ROAS)", shortLabel: "ROAS", description: "Revenue divided by spend" },
  ctr: { label: "Click-through rate (CTR)", shortLabel: "CTR", description: "Click rate percentage" },
  cpm: { label: "Cost per mille (CPM)", shortLabel: "CPM", description: "Cost per 1,000 impressions" }
};

export const DEFAULT_HIDDEN_METRICS: Record<ConfigurableMetricRole, PerformanceMetricKey[]> = {
  content_creator: [],
  editor: [],
  manager: []
};
