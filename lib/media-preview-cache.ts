export type MediaPreviewAsset = { mediaType: "video" | "image"; mediaUrl: string; thumbnailUrl?: string | null };

// Keeps a resolved playable URL stable while users filter, sort, or navigate within the dashboard.
const cache = new Map<string, MediaPreviewAsset>();

export function getCachedMediaPreview(key: string) { return cache.get(key); }
export function cacheMediaPreview(key: string, asset: MediaPreviewAsset) { cache.set(key, asset); return asset; }
