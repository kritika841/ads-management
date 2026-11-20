import type { CreativeVariation, EditedVariation } from "@/lib/types";

export const CREATIVE_VARIATIONS_ACTION = "creative_variations_updated";
export const EDITOR_VARIATIONS_ACTION = "editor_variations_submitted";

export type VariationInput = {
  id?: string;
  label?: string;
  rawFootageUrl?: string;
  raw_footage_url?: string;
};

export type EditedVariationInput = {
  id?: string;
  label?: string;
  driveUrl?: string;
  drive_url?: string;
  drive_file_id?: string | null;
  preview_url?: string | null;
};

export function normalizeCreativeVariations(input: unknown): CreativeVariation[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as VariationInput;
      const rawUrl = String(obj.raw_footage_url ?? obj.rawFootageUrl ?? "").trim();
      const label = String(obj.label ?? "").trim() || `Variation ${idx + 1}`;
      const id = String(obj.id ?? "").trim() || `var-${idx + 1}`;
      return {
        id,
        label,
        raw_footage_url: rawUrl
      };
    })
    .filter((item): item is CreativeVariation => Boolean(item));
}

export function normalizeEditedVariations(input: unknown): EditedVariation[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as EditedVariationInput;
      const driveUrl = String(obj.drive_url ?? obj.driveUrl ?? "").trim();
      const label = String(obj.label ?? "").trim() || `Variation ${idx + 1}`;
      const id = String(obj.id ?? "").trim() || `evar-${idx + 1}`;
      return {
        id,
        label,
        drive_url: driveUrl,
        drive_file_id: obj.drive_file_id ? String(obj.drive_file_id) : null,
        preview_url: obj.preview_url ? String(obj.preview_url) : null
      };
    })
    .filter((item): item is EditedVariation => Boolean(item));
}

export type VariationPair = {
  key: string;
  label: string;
  rawUrl: string | null;
  editedUrl: string | null;
  driveFileId: string | null;
  previewUrl: string | null;
};

/** Pair creator raw variations with submitted edited variation videos by index or id. */
export function buildVariationPairs(
  rawVariations: CreativeVariation[] | null | undefined,
  editedVariations: EditedVariation[] | null | undefined,
  includeRaw = true,
  includeEdited = true
): VariationPair[] {
  const rawList = includeRaw ? (rawVariations ?? []) : [];
  const editedList = includeEdited ? (editedVariations ?? []) : [];
  const count = Math.max(rawList.length, editedList.length);
  if (count === 0) return [];

  return Array.from({ length: count }, (_, idx) => {
    const rawVar = rawList[idx];
    const editedVar =
      editedList[idx] ??
      (rawVar ? editedList.find((item) => item.id === rawVar.id) : undefined);
    return {
      key: rawVar?.id ?? editedVar?.id ?? `var-${idx + 1}`,
      label: rawVar?.label || editedVar?.label || `Variation ${idx + 1}`,
      rawUrl: rawVar?.raw_footage_url || null,
      editedUrl: editedVar?.drive_url || null,
      driveFileId: editedVar?.drive_file_id ?? null,
      previewUrl: editedVar?.preview_url ?? null
    };
  });
}

export type PlayableAdVideo = {
  key: string;
  label: string;
  isMain: boolean;
  driveFileId: string | null;
  driveUrl: string | null;
  previewUrl: string | null;
};

/** Return the ordered list of playable final videos for an ad: Main video first, then edited variations. */
export function buildPlayableAdVideos(ad: {
  drive_file_id?: string | null;
  drive_url?: string | null;
  preview_url?: string | null;
  edited_variations?: EditedVariation[] | null;
}): PlayableAdVideo[] {
  const editedVars = (ad.edited_variations ?? []).filter(
    (variation) => Boolean(variation.drive_file_id || variation.drive_url || variation.preview_url)
  );
  const items: PlayableAdVideo[] = [];

  if (ad.drive_file_id || ad.drive_url || ad.preview_url) {
    items.push({
      key: "main",
      label: editedVars.length > 0 ? "Main" : "Main video",
      isMain: true,
      driveFileId: ad.drive_file_id ?? null,
      driveUrl: ad.drive_url ?? null,
      previewUrl: ad.preview_url ?? null
    });
  }

  for (let idx = 0; idx < editedVars.length; idx++) {
    const variation = editedVars[idx];
    items.push({
      key: `${variation.id}-${idx}`,
      label: variation.label || `Variation ${idx + 1}`,
      isMain: false,
      driveFileId: variation.drive_file_id ?? null,
      driveUrl: variation.drive_url || null,
      previewUrl: variation.preview_url ?? null
    });
  }

  return items;
}

export function extractVariationsFromActivityLogs(
  logs: Array<{ action?: string; metadata?: Record<string, unknown> | null; created_at?: string }> | null | undefined
): CreativeVariation[] {
  if (!Array.isArray(logs) || logs.length === 0) return [];
  const matching = logs
    .filter((log) => log.action === CREATIVE_VARIATIONS_ACTION && log.metadata && Array.isArray(log.metadata.variations))
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());

  if (matching.length === 0) return [];
  return normalizeCreativeVariations(matching[0].metadata?.variations);
}

export function extractEditedVariationsFromActivityLogs(
  logs: Array<{ action?: string; metadata?: Record<string, unknown> | null; created_at?: string }> | null | undefined
): EditedVariation[] {
  if (!Array.isArray(logs) || logs.length === 0) return [];
  const matching = logs
    .filter((log) => log.action === EDITOR_VARIATIONS_ACTION && log.metadata && Array.isArray(log.metadata.edited_variations))
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());

  if (matching.length === 0) return [];
  return normalizeEditedVariations(matching[0].metadata?.edited_variations);
}

export function buildVariationsByAdId(
  logs: Array<{ ad_id?: string | null; action?: string; metadata?: Record<string, unknown> | null; created_at?: string }> | null | undefined
): Map<string, CreativeVariation[]> {
  const grouped = new Map<string, Array<{ action?: string; metadata?: Record<string, unknown> | null; created_at?: string }>>();
  for (const log of logs ?? []) {
    if (!log.ad_id || log.action !== CREATIVE_VARIATIONS_ACTION) continue;
    const list = grouped.get(log.ad_id) ?? [];
    list.push(log);
    grouped.set(log.ad_id, list);
  }

  const result = new Map<string, CreativeVariation[]>();
  for (const [adId, adLogs] of grouped.entries()) {
    const variations = extractVariationsFromActivityLogs(adLogs);
    if (variations.length > 0) {
      result.set(adId, variations);
    }
  }
  return result;
}

export function buildEditedVariationsByAdId(
  logs: Array<{ ad_id?: string | null; action?: string; metadata?: Record<string, unknown> | null; created_at?: string }> | null | undefined
): Map<string, EditedVariation[]> {
  const grouped = new Map<string, Array<{ action?: string; metadata?: Record<string, unknown> | null; created_at?: string }>>();
  for (const log of logs ?? []) {
    if (!log.ad_id || log.action !== EDITOR_VARIATIONS_ACTION) continue;
    const list = grouped.get(log.ad_id) ?? [];
    list.push(log);
    grouped.set(log.ad_id, list);
  }

  const result = new Map<string, EditedVariation[]>();
  for (const [adId, adLogs] of grouped.entries()) {
    const variations = extractEditedVariationsFromActivityLogs(adLogs);
    if (variations.length > 0) {
      result.set(adId, variations);
    }
  }
  return result;
}
