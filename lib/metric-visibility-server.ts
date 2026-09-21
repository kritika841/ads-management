import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_HIDDEN_METRICS, type HiddenMetricsByRole } from "@/lib/metric-visibility";

const METRIC_VISIBILITY_FILE = path.join(process.cwd(), "data", "metric-visibility.json");

export async function readMetricVisibilityFile(): Promise<HiddenMetricsByRole> {
  try {
    const raw = await fs.readFile(METRIC_VISIBILITY_FILE, "utf-8");
    const parsed = JSON.parse(raw) as HiddenMetricsByRole;
    return {
      content_creator: Array.isArray(parsed.content_creator) ? parsed.content_creator : [],
      editor: Array.isArray(parsed.editor) ? parsed.editor : [],
      manager: Array.isArray(parsed.manager) ? parsed.manager : []
    };
  } catch {
    return { ...DEFAULT_HIDDEN_METRICS };
  }
}

export async function writeMetricVisibilityFile(data: HiddenMetricsByRole): Promise<void> {
  try {
    await fs.mkdir(path.dirname(METRIC_VISIBILITY_FILE), { recursive: true });
    await fs.writeFile(METRIC_VISIBILITY_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to write metric-visibility.json:", error);
  }
}
