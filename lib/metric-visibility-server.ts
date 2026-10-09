import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_HIDDEN_METRICS, DEFAULT_MANAGER_CREATIVE_SCOPE, PERFORMANCE_METRIC_KEYS, type HiddenMetricsByRole, type ManagerCreativeScope, type PerformanceMetricKey } from "@/lib/metric-visibility";

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
  bulk_add_to_campaign_roles?: ("admin" | "content_creator" | "editor" | "manager")[];
  overview_metrics?: PerformanceMetricKey[];
  override_all_users?: boolean;
  users_with_all_ads_access?: string[];
  hidden_campaigns_by_user?: Record<string, string[]>;
};

function sanitizeKeys(arr: unknown): PerformanceMetricKey[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((item): item is PerformanceMetricKey =>
    typeof item === "string" && (PERFORMANCE_METRIC_KEYS as readonly string[]).includes(item)
  );
}

function sanitizeRoles(arr: unknown): ("admin" | "content_creator" | "editor" | "manager")[] {
  if (!Array.isArray(arr)) return ["admin"];
  const allowed = ["admin", "content_creator", "editor", "manager"];
  const filtered = arr.filter((item): item is "admin" | "content_creator" | "editor" | "manager" =>
    typeof item === "string" && allowed.includes(item)
  );
  if (!filtered.includes("admin")) {
    filtered.unshift("admin");
  }
  return filtered;
}

function sanitizeHiddenCampaigns(input: unknown): Record<string, string[]> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const res: Record<string, string[]> = {};
  for (const [userId, campaigns] of Object.entries(input as Record<string, unknown>)) {
    if (Array.isArray(campaigns)) {
      res[userId] = campaigns.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
    }
  }
  return res;
}

export async function readMetricVisibilityFile(): Promise<MetricVisibilityConfig> {
  try {
    const raw = await fs.readFile(METRIC_VISIBILITY_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const scope = parsed.manager_creative_scope === "own" ? "own" : "all";
    const overviewMetrics = Array.isArray(parsed.overview_metrics)
      ? sanitizeKeys(parsed.overview_metrics)
      : DEFAULT_OVERVIEW_METRICS;

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
      hidden_campaigns_by_user: sanitizeHiddenCampaigns(parsed.hidden_campaigns_by_user)
    };
  } catch {
    return {
      ...DEFAULT_HIDDEN_METRICS,
      manager_creative_scope: DEFAULT_MANAGER_CREATIVE_SCOPE,
      bulk_add_to_campaign_roles: ["admin"],
      overview_metrics: DEFAULT_OVERVIEW_METRICS,
      override_all_users: false,
      users_with_all_ads_access: [],
      hidden_campaigns_by_user: {}
    };
  }
}

export async function writeMetricVisibilityFile(
  data: HiddenMetricsByRole,
  managerCreativeScope?: ManagerCreativeScope,
  bulkAddToCampaignRoles?: ("admin" | "content_creator" | "editor" | "manager")[],
  extra?: {
    overview_metrics?: PerformanceMetricKey[];
    override_all_users?: boolean;
    users_with_all_ads_access?: string[];
    hidden_campaigns_by_user?: Record<string, string[]>;
  }
): Promise<void> {
  try {
    const existing = await readMetricVisibilityFile();
    const payload: MetricVisibilityConfig = {
      content_creator: Array.isArray(data.content_creator) ? data.content_creator : existing.content_creator ?? [],
      editor: Array.isArray(data.editor) ? data.editor : existing.editor ?? [],
      manager: Array.isArray(data.manager) ? data.manager : existing.manager ?? [],
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
        ? sanitizeHiddenCampaigns(extra.hidden_campaigns_by_user)
        : existing.hidden_campaigns_by_user ?? {}
    };
    await fs.mkdir(path.dirname(METRIC_VISIBILITY_FILE), { recursive: true });
    await fs.writeFile(METRIC_VISIBILITY_FILE, JSON.stringify(payload, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to write metric-visibility.json:", error);
  }
}
