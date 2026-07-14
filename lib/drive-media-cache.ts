import { getDriveMedia } from "@/lib/drive";

const prefixSize = 1024 * 1024;
const cacheLifetimeMs = 10 * 60 * 1000;
const maxEntries = 12;

export type DriveMediaPrefix = {
  bytes: ArrayBuffer;
  contentType: string;
  totalSize: number;
  expiresAt: number;
};

type MediaCacheState = {
  entries: Map<string, DriveMediaPrefix>;
  pending: Map<string, Promise<DriveMediaPrefix | null>>;
};

const globalMediaCache = globalThis as typeof globalThis & {
  __adflowDriveMediaCache?: MediaCacheState;
};

const state = globalMediaCache.__adflowDriveMediaCache ??= {
  entries: new Map(),
  pending: new Map()
};

export function getCachedDriveMediaPrefix(fileId: string) {
  const entry = state.entries.get(fileId);
  if (!entry || entry.expiresAt <= Date.now()) {
    state.entries.delete(fileId);
    return null;
  }

  // Refresh insertion order so frequently played files stay warm.
  state.entries.delete(fileId);
  state.entries.set(fileId, entry);
  return entry;
}

export async function warmDriveMediaPrefix(fileId: string) {
  const cached = getCachedDriveMediaPrefix(fileId);
  if (cached) return cached;

  const existing = state.pending.get(fileId);
  if (existing) return existing;

  const request = loadPrefix(fileId).finally(() => state.pending.delete(fileId));
  state.pending.set(fileId, request);
  return request;
}

async function loadPrefix(fileId: string) {
  const response = await getDriveMedia(fileId, `bytes=0-${prefixSize - 1}`);
  if (!response?.ok) return null;

  const contentRange = response.headers.get("content-range");
  const totalSize = Number(contentRange?.match(/\/(\d+)$/)?.[1]);
  if (!Number.isFinite(totalSize) || totalSize <= 0) return null;

  const entry: DriveMediaPrefix = {
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") ?? "video/mp4",
    totalSize,
    expiresAt: Date.now() + cacheLifetimeMs
  };
  state.entries.set(fileId, entry);
  while (state.entries.size > maxEntries) {
    const oldest = state.entries.keys().next().value;
    if (!oldest) break;
    state.entries.delete(oldest);
  }
  return entry;
}
