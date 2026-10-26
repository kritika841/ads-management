import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ADS_PERFORMANCE_NAV_ITEMS,
  CAMPAIGN_PLACEMENT_MODES,
  DEFAULT_ADS_PERFORMANCE_NAV_ITEMS,
  DEFAULT_HIDDEN_METRICS,
  DEFAULT_MANAGER_CREATIVE_SCOPE,
  PERFORMANCE_METRIC_KEYS,
  PLACEABLE_TABS,
  type AdsPerformanceNavItemKey,
  type CampaignPlacement,
  type HiddenMetricsByRole,
  type ManagerCreativeScope,
  type PerformanceMetricKey
} from "@/lib/metric-visibility";
import type { UserRole } from "@/lib/types";

const METRIC_VISIBILITY_FILE = path.join(process.cwd(), "data", "metric-visibility.json");

export const DEFAULT_OVERVIEW_METRICS: PerformanceMetricKey[] = [
  "spend",
  "purchases",
  "revenue",
  "cpa",
  "cpc",
  "roas"
];

export type MetricVisibilityConfig = HiddenMetricsByRole & {
  manager_creative_scope?: ManagerCreativeScope;
  bulk_add_to_campaign_roles?: UserRole[];
  overview_metrics?: PerformanceMetricKey[];
  override_all_users?: boolean;
  users_with_all_ads_access?: string[];
  hidden_campaigns_by_user?: Record<string, string[]>;
  hidden_creatives_by_user?: Record<string, string[]>;
  allowed_creatives_by_user?: Record<string, string[]>;
  campaign_visible_users?: Record<string, string[]>;
  ads_performance_nav_items?: AdsPerformanceNavItemKey[];
  campaign_placements?: Record<string, CampaignPlacement>;
};

export function sanitizePlacement(input: unknown): CampaignPlacement | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const mode = raw.mode;
  if (typeof mode !== "string" || !(CAMPAIGN_PLACEMENT_MODES as readonly string[]).includes(mode)) return null;
  if (mode === "campaigns_only") return null;
  const placement: CampaignPlacement = { mode: mode as CampaignPlacement["mode"] };
  if (mode === "existing_tab") {
    if (typeof raw.tab_key !== "string" || !(PLACEABLE_TABS as readonly string[]).includes(raw.tab_key)) return null;
    placement.tab_key = raw.tab_key as AdsPerformanceNavItemKey;
  }
  if (mode === "with_meta_campaign") {
    if (typeof raw.meta_campaign_id !== "string" || !raw.meta_campaign_id.trim()) return null;
    placement.meta_campaign_id = raw.meta_campaign_id.trim();
  }
  if (mode === "submenu" && typeof raw.submenu_label === "string" && raw.submenu_label.trim()) {
    placement.submenu_label = raw.submenu_label.trim().slice(0, 40);
  }
  return placement;
}

function sanitizePlacements(input: unknown): Record<string, CampaignPlacement> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const res: Record<string, CampaignPlacement> = {};
  for (const [campaignId, value] of Object.entries(input as Record<string, unknown>)) {
    const placement = sanitizePlacement(value);
    if (placement) res[campaignId] = placement;
  }
  return res;
}

function sanitizeKeys(arr: unknown): PerformanceMetricKey[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((item): item is PerformanceMetricKey =>
    typeof item === "string" && (PERFORMANCE_METRIC_KEYS as readonly string[]).includes(item)
  );
}

function sanitizeRoles(arr: unknown): UserRole[] {
  if (!Array.isArray(arr)) return ["admin"];
  const allowed: UserRole[] = ["admin", "content_creator", "editor", "manager", "media_buyer"];
  const filtered = arr.filter((item): item is UserRole =>
    typeof item === "string" && allowed.includes(item as UserRole)
  );
  if (!filtered.includes("admin")) {
    filtered.unshift("admin");
  }
  return filtered;
}

function sanitizeIdMap(input: unknown): Record<string, string[]> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const res: Record<string, string[]> = {};
  for (const [key, items] of Object.entries(input as Record<string, unknown>)) {
    if (Array.isArray(items)) {
      res[key] = items.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
    }
  }
  return res;
}

function sanitizeNavItems(arr: unknown): AdsPerformanceNavItemKey[] {
  if (!Array.isArray(arr)) return [...DEFAULT_ADS_PERFORMANCE_NAV_ITEMS];
  const valid = arr.filter((item): item is AdsPerformanceNavItemKey =>
    typeof item === "string" && (ADS_PERFORMANCE_NAV_ITEMS as readonly string[]).includes(item)
  );
  return valid.length > 0 ? valid : [...DEFAULT_ADS_PERFORMANCE_NAV_ITEMS];
}

export async function readMetricVisibilityFile(): Promise<MetricVisibilityConfig> {
  try {
    const raw = await fs.readFile(METRIC_VISIBILITY_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const scope = parsed.manager_creative_scope === "own" ? "own" : "all";
    const overviewMetrics = Array.isArray(parsed.overview_metrics)
      ? sanitizeKeys(parsed.overview_metrics)
      : DEFAULT_OVERVIEW_METRICS;
    const navItems = Array.isArray(parsed.ads_performance_nav_items)
      ? sanitizeNavItems(parsed.ads_performance_nav_items)
      : [...DEFAULT_ADS_PERFORMANCE_NAV_ITEMS];

    return {
      content_creator: sanitizeKeys(parsed.content_creator),
      editor: sanitizeKeys(parsed.editor),
      manager: sanitizeKeys(parsed.manager),
      manager_creative_scope: scope,
      bulk_add_to_campaign_roles: sanitizeRoles(parsed.bulk_add_to_campaign_roles),
      overview_metrics: overviewMetrics.length ? overviewMetrics : DEFAULT_OVERVIEW_METRICS,
      override_all_users: Boolean(parsed.override_all_users),
      users_with_all_ads_access: Array.isArray(parsed.users_with_all_ads_access)
        ? parsed.users_with_all_ads_access.filter((u): u is string => typeof u === "string")
        : [],
      hidden_campaigns_by_user: sanitizeIdMap(parsed.hidden_campaigns_by_user),
      hidden_creatives_by_user: sanitizeIdMap(parsed.hidden_creatives_by_user),
      allowed_creatives_by_user: sanitizeIdMap(parsed.allowed_creatives_by_user),
      campaign_visible_users: sanitizeIdMap(parsed.campaign_visible_users),
      ads_performance_nav_items: navItems,
      campaign_placements: sanitizePlacements(parsed.campaign_placements)
    };
  } catch {
    return {
      ...DEFAULT_HIDDEN_METRICS,
      manager_creative_scope: DEFAULT_MANAGER_CREATIVE_SCOPE,
      bulk_add_to_campaign_roles: ["admin"],
      overview_metrics: DEFAULT_OVERVIEW_METRICS,
      override_all_users: false,
      users_with_all_ads_access: [],
      hidden_campaigns_by_user: {},
      hidden_creatives_by_user: {},
      allowed_creatives_by_user: {},
      campaign_visible_users: {},
      ads_performance_nav_items: [...DEFAULT_ADS_PERFORMANCE_NAV_ITEMS],
      campaign_placements: {}
    };
  }
}

export async function writeMetricVisibilityFile(
  data: HiddenMetricsByRole,
  managerCreativeScope?: ManagerCreativeScope,
  bulkAddToCampaignRoles?: UserRole[],
  extra?: {
    overview_metrics?: PerformanceMetricKey[];
    override_all_users?: boolean;
    users_with_all_ads_access?: string[];
    hidden_campaigns_by_user?: Record<string, string[]>;
    hidden_creatives_by_user?: Record<string, string[]>;
    allowed_creatives_by_user?: Record<string, string[]>;
    campaign_visible_users?: Record<string, string[]>;
    ads_performance_nav_items?: AdsPerformanceNavItemKey[];
    campaign_placements?: Record<string, CampaignPlacement>;
  },
  options?: { strict?: boolean }
): Promise<void> {
  try {
    const existing = await readMetricVisibilityFile();
    const payload: MetricVisibilityConfig = {
      content_creator: Array.isArray(data.content_creator) ? data.content_creator : existing.content_creator ?? [],
      editor: Array.isArray(data.editor) ? data.editor : existing.editor ?? [],
      manager: Array.isArray(data.manager) ? data.manager : existing.manager ?? [],
      media_buyer: Array.isArray(data.media_buyer) ? data.media_buyer : existing.media_buyer ?? [],
      manager_creative_scope: managerCreativeScope ?? existing.manager_creative_scope ?? DEFAULT_MANAGER_CREATIVE_SCOPE,
      bulk_add_to_campaign_roles: bulkAddToCampaignRoles
        ? sanitizeRoles(bulkAddToCampaignRoles)
        : existing.bulk_add_to_campaign_roles ?? ["admin"],
      overview_metrics: extra?.overview_metrics
        ? sanitizeKeys(extra.overview_metrics)
        : existing.overview_metrics ?? DEFAULT_OVERVIEW_METRICS,
      override_all_users: extra?.override_all_users !== undefined
        ? Boolean(extra.override_all_users)
        : Boolean(existing.override_all_users),
      users_with_all_ads_access: extra?.users_with_all_ads_access
        ? extra.users_with_all_ads_access
        : existing.users_with_all_ads_access ?? [],
      hidden_campaigns_by_user: extra?.hidden_campaigns_by_user
        ? sanitizeIdMap(extra.hidden_campaigns_by_user)
        : existing.hidden_campaigns_by_user ?? {},
      hidden_creatives_by_user: extra?.hidden_creatives_by_user
        ? sanitizeIdMap(extra.hidden_creatives_by_user)
        : existing.hidden_creatives_by_user ?? {},
      allowed_creatives_by_user: extra?.allowed_creatives_by_user
        ? sanitizeIdMap(extra.allowed_creatives_by_user)
        : existing.allowed_creatives_by_user ?? {},
      campaign_visible_users: extra?.campaign_visible_users
        ? sanitizeIdMap(extra.campaign_visible_users)
        : existing.campaign_visible_users ?? {},
      ads_performance_nav_items: extra?.ads_performance_nav_items !== undefined
        ? sanitizeNavItems(extra.ads_performance_nav_items)
        : (existing.ads_performance_nav_items ?? [...DEFAULT_ADS_PERFORMANCE_NAV_ITEMS]),
      campaign_placements: extra?.campaign_placements !== undefined
        ? sanitizePlacements(extra.campaign_placements)
        : (existing.campaign_placements ?? {})
    };
    await fs.mkdir(path.dirname(METRIC_VISIBILITY_FILE), { recursive: true });
    await fs.writeFile(METRIC_VISIBILITY_FILE, JSON.stringify(payload, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to write metric-visibility.json:", error);
    if (options?.strict) {
      throw new Error("Could not save these settings to the server. Please try again.");
    }
  }
}
