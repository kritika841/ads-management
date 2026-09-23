import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_HIDDEN_METRICS, DEFAULT_MANAGER_CREATIVE_SCOPE, PERFORMANCE_METRIC_KEYS, type HiddenMetricsByRole, type ManagerCreativeScope, type PerformanceMetricKey } from "@/lib/metric-visibility";

const METRIC_VISIBILITY_FILE = path.join(process.cwd(), "data", "metric-visibility.json");

export type MetricVisibilityConfig = HiddenMetricsByRole & {
  manager_creative_scope?: ManagerCreativeScope;
};

function sanitizeKeys(arr: unknown): PerformanceMetricKey[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((item): item is PerformanceMetricKey =>
    typeof item === "string" && (PERFORMANCE_METRIC_KEYS as readonly string[]).includes(item)
  );
}

export async function readMetricVisibilityFile(): Promise<MetricVisibilityConfig> {
  try {
    const raw = await fs.readFile(METRIC_VISIBILITY_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const scope = parsed.manager_creative_scope === "own" ? "own" : "all";
    return {
      content_creator: sanitizeKeys(parsed.content_creator),
      editor: sanitizeKeys(parsed.editor),
      manager: sanitizeKeys(parsed.manager),
      manager_creative_scope: scope
    };
  } catch {
    return {
      ...DEFAULT_HIDDEN_METRICS,
      manager_creative_scope: DEFAULT_MANAGER_CREATIVE_SCOPE
    };
  }
}

export async function writeMetricVisibilityFile(
  data: HiddenMetricsByRole,
  managerCreativeScope?: ManagerCreativeScope
): Promise<void> {
  try {
    const existing = await readMetricVisibilityFile();
    const payload = {
      content_creator: Array.isArray(data.content_creator) ? data.content_creator : existing.content_creator ?? [],
      editor: Array.isArray(data.editor) ? data.editor : existing.editor ?? [],
      manager: Array.isArray(data.manager) ? data.manager : existing.manager ?? [],
      manager_creative_scope: managerCreativeScope ?? existing.manager_creative_scope ?? DEFAULT_MANAGER_CREATIVE_SCOPE
    };
    await fs.mkdir(path.dirname(METRIC_VISIBILITY_FILE), { recursive: true });
    await fs.writeFile(METRIC_VISIBILITY_FILE, JSON.stringify(payload, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to write metric-visibility.json:", error);
  }
}
