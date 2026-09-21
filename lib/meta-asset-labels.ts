export type MetaAssetBreakdown = string | Record<string, unknown>;

export type MetaAction = { action_type: string; value: string };

export type MetaInsightRow = {
  ad_id: string;
  ad_name?: string;
  date_start: string;
  date_stop?: string;
  ad_format_asset?: MetaAssetBreakdown;
  creative_media_type_breakdown?: MetaAssetBreakdown;
  video_asset?: MetaAssetBreakdown;
  image_asset?: MetaAssetBreakdown;
  media_asset_url?: MetaAssetBreakdown;
  media_format?: MetaAssetBreakdown;
  creative_automation_asset_id?: MetaAssetBreakdown;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
};

export type MetaCreative = {
  id?: string;
  name?: string;
  thumbnail_url?: string;
  image_url?: string;
  video_id?: string;
  object_story_spec?: unknown;
  asset_feed_spec?: unknown;
};

export type MetaAdRow = {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  created_time?: string;
  campaign?: { id?: string; name?: string };
  adset?: { id?: string; name?: string };
  creative?: MetaCreative;
};

export function decodeAssetText(value: string): string {
  // Apply decode twice to handle double-encoded strings (e.g. %2520 → %20 → space)
  try {
    const first = decodeURIComponent(value.replaceAll("+", " "));
    try {
      return decodeURIComponent(first.replaceAll("+", " "));
    } catch {
      return first;
    }
  } catch {
    return value;
  }
}

/**
 * Detects labels that look like video titles or captions rather than filenames.
 * Captions are plain-language phrases ("Save More with Satmi Bundles") that
 * arrive from Meta's video `title` field and should never be used as the
 * Creative → Media name in the dashboard.
 */
export function isCaptionLikeLabel(label: string): boolean {
  // Already a known filename format — not a caption
  if (/\b(?:HIM|TAM|ISH)\d{2,}\b/i.test(label)) return false;
  if (/\.(mp4|mov|m4v|webm|png|jpg|jpeg|webp)(?:[._\d\w]*)(?:\s|$|\()/i.test(label)) return false;

  // Pure numeric or hex IDs are not captions (they are just generic identifiers)
  const trimmed = label.trim();
  if (/^[a-f0-9]{8,}$/i.test(trimmed)) return false;
  if (/^(video|image)\s+[a-f0-9]{8,}$/i.test(trimmed)) return false;

  // Extract core text by stripping Video/Image prefix and trailing (id) or date/hash
  let core = trimmed.replace(/^(video|image)\s+/i, "");
  core = core.replace(/\s*\([a-f0-9]{8,}\)$/i, "");
  core = core.replace(/\s*\d{4}-\d{2}-\d{2}-[a-f0-9]{16,}$/i, "");

  if (/save(?:%20|\s)more|satmi(?:%20|\s)bundles/i.test(core)) return true;

  const words = core.trim().split(/\s+/);
  const alphabeticWords = words.filter((word) => /^[a-zA-Z]+$/.test(word));
  if (words.length >= 2 && alphabeticWords.length >= 2) return true;

  return false;
}

export function assetIdentifier(label: string): string | null {
  const parenthesized = label.match(/\(([^()]*[a-f0-9]{8,}[^()]*)\)$/i)?.[1]?.match(/[a-f0-9]{16,}|\d{8,}/i)?.[0];
  if (parenthesized) return parenthesized;
  const matches = label.match(/[a-f0-9]{16,}|\d{8,}/gi);
  return matches?.[matches.length - 1] ?? null;
}

/**
 * Formats an asset label for display in the creative title column,
 * matching Meta Ads Manager (e.g. "TAM0173.mp4", "ISH0203.mp4",
 * "exec-73efe705...png").
 * Strips "Video " and "Image " prefixes as well as internal tracking
 * suffixes like parenthesized IDs or date hashes.
 */
export function cleanMediaTitle(label: string): string {
  if (!label) return "";
  let clean = decodeAssetText(label.trim());
  const parenMatch = clean.match(/^(.*?)\s*\([a-f0-9]{8,}\)$/i);
  if (parenMatch) {
    const prefix = parenMatch[1].trim();
    if (prefix && !isCaptionLikeLabel(prefix)) {
      clean = prefix;
    }
  }
  clean = clean.replace(/\s*\d{4}-\d{2}-\d{2}-[a-f0-9]{16,}$/i, "");
  // Strip trailing _105 or _cropped suffixes from image extensions like .png_105 -> .png
  clean = clean.replace(/\.(png|jpg|jpeg|webp)_[a-zA-Z0-9_-]+$/i, ".$1");
  // Remove "Video " or "Image " prefix
  clean = clean.replace(/^(video|image)\s+/i, "");
  return clean;
}

export function assetLabelScore(value: MetaAssetBreakdown): number {
  const label = normalizeAssetLabel(value);
  let score = /\.(mp4|mov|m4v|webm)(?:\s|$|\()/i.test(label) ? 20 : 0;
  if (/\b(?:HIM|TAM|ISH)\d{2,}\b/i.test(label)) score += 30;
  if (typeof value === "object" && firstString(value, ["video_name", "videoName", "image_name", "imageName", "file_name", "fileName", "filename", "asset_name", "name"])) score += 15;
  if (/\([^)]{8,}\)/.test(label)) score += 5;
  if (/^(video|image)\s+[a-f0-9]{16,}|^(video|image)\s+\d{8,}$/i.test(label)) score += 1;

  // Heavily penalize labels that look like video titles/captions rather than
  // filenames. These arrive from Meta's video object `title` field and should
  // never be surfaced as the Creative → Media name.
  if (isCaptionLikeLabel(label)) score -= 40;
  return score;
}

export function mediaLabelRank(label: string): number {
  let rank = 0;
  if (/\.(mp4|mov|m4v|webm)(?:\s|$|\()/i.test(label)) rank += 20;
  if (/\b(?:HIM|TAM|ISH)\d{2,}\b/i.test(label)) rank += 30;
  if (/^\d{8,}$/.test(label) || /^(video|image)\s+\d{8,}$/i.test(label)) rank -= 20;
  if (/%[0-9a-f]{2}/i.test(label)) rank -= 5;
  if (isCaptionLikeLabel(label)) rank -= 40;
  return rank;
}

export function assetBreakdownValue(row: MetaInsightRow): MetaAssetBreakdown | undefined {
  // Intentionally exclude `row.ad_name` — it is parent-level metadata (the
  // human-readable ad title), not a Creative → Media identifier. Including it
  // caused captions like "Save More with Satmi Bundles" to be selected as the
  // asset label whenever they happened to contain a numeric substring.
  const values = [
    row.ad_format_asset,
    row.video_asset,
    row.image_asset,
    row.creative_media_type_breakdown,
    row.media_format,
    row.creative_automation_asset_id
  ].filter(Boolean) as MetaAssetBreakdown[];

  const withId = values.filter((value) => /[a-f0-9]{16,}|\d{8,}/i.test(normalizeAssetLabel(value)));
  const sorted = withId.sort((left, right) => assetLabelScore(right) - assetLabelScore(left));
  return sorted[0] ?? values[0];
}

export function normalizeAssetLabel(value: MetaAssetBreakdown): string {
  if (typeof value === "string") {
    const text = decodeAssetText(value.trim());
    if (/^https?:\/\//i.test(text)) {
      try {
        const filename = decodeAssetText(new URL(text).pathname.split("/").pop() ?? "");
        if (filename) return /\.(mp4|mov|m4v|webm)$/i.test(filename) ? `Video ${filename}` : filename;
      } catch {
        /* Keep the raw Meta value if it is not a valid URL. */
      }
    }

    // Check if the string ends with parenthesized identifier like "Title (12345678)"
    const parenthesizedMatch = text.match(/^(.*?)\s*\(([a-f0-9]{8,})\)$/i);
    if (parenthesizedMatch) {
      const prefix = parenthesizedMatch[1].trim();
      const id = parenthesizedMatch[2];
      // If the prefix looks like a caption/title, strip it and return clean Video/Image <id>
      if (isCaptionLikeLabel(prefix)) {
        return `${/^image\b/i.test(prefix) ? "Image" : "Video"} ${id}`;
      }
    }

    const typed = text.match(/^(video|image)(?:[ _-]?id)?\s*[:_-]?\s*(.+)$/i);
    if (typed) {
      const rest = typed[2].trim();
      if (isCaptionLikeLabel(rest)) {
        const id = assetIdentifier(rest);
        return id ? `${typed[1][0].toUpperCase()}${typed[1].slice(1).toLowerCase()} ${id}` : rest;
      }
      return `${typed[1][0].toUpperCase()}${typed[1].slice(1).toLowerCase()} ${rest}`;
    }

    if (/\.(mp4|mov|m4v|webm)(?:\s|$|\()/i.test(text)) return `Video ${text}`;
    return text;
  }

  const type = firstString(value, ["type", "asset_type", "media_type", "format"]) ?? (firstString(value, ["video_name", "video_id"]) ? "video" : firstString(value, ["image_name", "image_hash", "hash"]) ? "image" : null);
  const id = firstString(value, ["id", "asset_id", "video_id", "image_hash", "image_id"]);
  const name = firstString(value, ["video_name", "videoName", "image_name", "imageName", "file_name", "fileName", "filename", "name", "asset_name", "label"]);
  const decodedName = name ? decodeAssetText(name) : name;

  // Reject caption-like names (e.g. "Save More with Satmi Bundles") from the
  // name/asset_name/label fields. These are video object titles, not filenames.
  const usableName = decodedName && !isCaptionLikeLabel(decodedName) ? decodedName : null;

  if (type && usableName && id) return `${type[0].toUpperCase()}${type.slice(1).toLowerCase()} ${usableName} (${id})`;
  if (type && id) return `${type[0].toUpperCase()}${type.slice(1).toLowerCase()} ${id}`;
  if (usableName && id) return `${/\.(mp4|mov|m4v|webm)$/i.test(usableName) ? "Video " : ""}${usableName} (${id})`;
  if (usableName) return `${/\.(mp4|mov|m4v|webm)$/i.test(usableName) ? "Video " : ""}${usableName}`;

  // If the name was rejected as a caption, still return the ID
  if (id) return id;
  return decodedName ?? id ?? JSON.stringify(value);
}

export function creativeAssets(creative?: MetaCreative): Array<{ label: string; type: "video" | "image" }> {
  const assets = new Map<string, { label: string; type: "video" | "image" }>();
  const add = (id: string, type: "video" | "image", name?: string | null) => {
    const title = type === "video" ? "Video" : "Image";
    const cleanName = name?.trim();
    // Reject caption-like names (e.g. "Save More with Satmi Bundles") that
    // leak from Meta's video title field. Only include the name if it looks
    // like an actual filename or contains a HIM/TAM/ISH tag.
    const isUsableName = cleanName && cleanName !== id && !isCaptionLikeLabel(cleanName);
    const label = isUsableName ? `${title} ${cleanName} (${id})` : `${title} ${id}`;
    assets.set(`${type}:${id}`, { label, type });
  };

  if (creative?.video_id) add(creative.video_id, "video");

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item));
      return;
    }
    const object = value as Record<string, unknown>;
    const name = firstString(object, ["video_name", "videoName", "image_name", "imageName", "file_name", "fileName", "filename", "name", "asset_name"]);
    const videoId = firstString(object, ["video_id", "videoId"]);
    const imageId = firstString(object, ["image_hash", "image_id", "imageHash", "hash"]);
    if (videoId) add(videoId, "video", name);
    if (imageId) add(imageId, "image", name);
    for (const child of Object.values(object)) visit(child);
  };

  visit(creative?.object_story_spec);
  visit(creative?.asset_feed_spec);

  // Standard ads often have one Meta creative but no feed-spec asset list.
  // Represent that primary creative explicitly, rather than falling back to a
  // misleading ad-level row in the dashboard.
  if (!assets.size && creative?.id) {
    assets.set(`creative:${creative.id}`, { label: `Creative ${creative.id}`, type: "image" });
  }

  return [...assets.values()];
}

export function inferAssetType(label: string): "video" | "image" | null {
  const value = label.toLowerCase();
  return value.includes("video") ? "video" : value.includes("image") ? "image" : null;
}

export function resolveAssetLabel(_ad: MetaAdRow | undefined, value: MetaAssetBreakdown): string {
  const label = normalizeAssetLabel(value);
  if (!_ad) return label;

  const identifier = label.match(/[a-f0-9]{16,}|\d{8,}/i)?.[0];
  const candidates = creativeAssets(_ad.creative);
  const candidate = identifier ? candidates.find((asset) => asset.label.includes(identifier)) : undefined;
  if (candidate && assetLabelScore(candidate.label) > assetLabelScore(label)) return candidate.label;

  // Check if ad name itself contains an ad tag like ISH0175, TAM0147, HIM0143
  // Only use if the ad contains a SINGLE creative tag (e.g. not multi-creative "ISH0201 | ISH0203 | TAM0165")
  const allTags = _ad.name ? _ad.name.match(/\b(?:HIM|TAM|ISH)\d{2,}\b/gi) ?? [] : [];
  const adTag = allTags.length === 1 ? allTags[0] : null;

  if (isCaptionLikeLabel(label)) {
    if (candidate) return candidate.label;
    if (candidates.length === 1 && candidates[0].label && !isCaptionLikeLabel(candidates[0].label)) return candidates[0].label;
    if (adTag) return `Video ${adTag.toUpperCase()}.mp4${identifier ? ` (${identifier})` : ""}`;
    if (identifier) return `${/^image\b/i.test(label) ? "Image" : "Video"} ${identifier}`;
    if (candidates.length > 0) return candidates[0].label;
    return `Video ${_ad.id}`;
  }

  if (identifier && !/\b(?:HIM|TAM|ISH)\d{2,}\b/i.test(label) && !/\.(mp4|mov|m4v|webm)(?:\s|$|\()/i.test(label)) {
    if (candidate) return candidate.label;
    if (candidates.length === 1 && candidates[0].label && !isCaptionLikeLabel(candidates[0].label)) return candidates[0].label;
    if (adTag) return `Video ${adTag.toUpperCase()}.mp4 (${identifier})`;
    return `${/^image\b/i.test(label) ? "Image" : "Video"} ${identifier}`;
  }

  const generic = /^(video|image)\s+[a-f0-9]{16,}|^(video|image)\s+\d{8,}$/i.test(label) || /^[a-f0-9]{16,}|^\d{8,}$/i.test(label);
  if (!generic || !identifier) return label;
  if (candidate) return candidate.label;
  if (adTag) return `Video ${adTag.toUpperCase()}.mp4 (${identifier})`;
  return label;
}

export function assetId(adId: string, label: string): string {
  return `${adId}:${encodeURIComponent(label)}`;
}

function firstString(value: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key]) return value[key] as string;
  }
  return null;
}
