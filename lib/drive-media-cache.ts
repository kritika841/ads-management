import { getDriveMedia } from "@/lib/drive";

// One megabyte is enough to read metadata but not enough to sustain playback.
// Keeping a larger leading range locally lets the browser fill a meaningful
// buffer before it has to make a second round-trip to Drive.
const prefixSize = 8 * 1024 * 1024;
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

  return storePrefix(fileId, {
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") ?? "video/mp4",
    totalSize,
    expiresAt: Date.now() + cacheLifetimeMs
  });
}

function storePrefix(fileId: string, entry: DriveMediaPrefix) {
  state.entries.set(fileId, entry);
  while (state.entries.size > maxEntries) {
    const oldest = state.entries.keys().next().value;
    if (!oldest) break;
    state.entries.delete(oldest);
  }
  return entry;
}

export type StreamedDrivePrefix = {
  body: ReadableStream<Uint8Array>;
  status: number;
  contentType: string;
  contentLength: string | null;
  contentRange: string | null;
};

/**
 * Opens the whole Drive file (open-ended range) and returns it as one continuous live stream,
 * so the browser starts decoding after a single upstream round-trip *and keeps receiving data*
 * for the rest of playback. Previously the first response was capped at the 8 MB prefix: the
 * video started, played until that buffer ran dry, then stalled while the browser opened a
 * second request — the "plays for a moment, then buffers" gap.
 *
 * A second branch of the same stream captures just the leading prefix into the cache (then lets
 * go), which makes replays and seeks near the start instant without another Drive download.
 */
export async function streamDriveMediaPrefix(fileId: string): Promise<StreamedDrivePrefix | null> {
  // No abort signal on purpose: if the browser cancels early (e.g. to fetch a trailing moov
  // atom first), the cache branch still finishes the bounded prefix, then the upstream closes.
  const upstream = await getDriveMedia(fileId, "bytes=0-");
  if (!upstream?.ok || !upstream.body) return null;

  const contentType = upstream.headers.get("content-type") ?? "video/mp4";
  const contentRange = upstream.headers.get("content-range");
  const totalSize = Number(contentRange?.match(/\/(\d+)$/)?.[1]);
  const [forClient, forCache] = upstream.body.tee();

  if (upstream.status === 206 && Number.isFinite(totalSize) && totalSize > 0) {
    const expected = Math.min(prefixSize, totalSize);
    void collectPrefix(forCache, expected)
      .then((bytes) => {
        if (bytes && bytes.byteLength === expected) storePrefix(fileId, { bytes, contentType, totalSize, expiresAt: Date.now() + cacheLifetimeMs });
      })
      .catch(() => undefined);
  } else {
    void forCache.cancel().catch(() => undefined);
  }

  return {
    body: forClient,
    status: upstream.status,
    contentType,
    contentLength: upstream.headers.get("content-length"),
    contentRange
  };
}

/**
 * Serves an open-ended range that starts inside the cached prefix: the cached bytes go out
 * immediately, and the remainder is piped from Drive in the same response. The Drive request is
 * opened up front, so it is already flowing by the time the browser consumes the cached part —
 * playback crosses the cache boundary without a stall.
 */
export function streamFromCachedPrefix(fileId: string, prefix: DriveMediaPrefix, start: number): ReadableStream<Uint8Array> {
  const available = prefix.bytes.byteLength;
  const abort = new AbortController();
  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let upstream: Promise<Response | null> | null = null;
  let sentPrefix = false;

  return new ReadableStream<Uint8Array>({
    start() {
      if (available < prefix.totalSize) upstream = getDriveMedia(fileId, `bytes=${available}-`, abort.signal).catch(() => null);
    },
    async pull(controller) {
      try {
        if (!sentPrefix) {
          sentPrefix = true;
          controller.enqueue(new Uint8Array(prefix.bytes.slice(start)));
          if (!upstream) controller.close();
          return;
        }
        if (!upstreamReader) {
          const response = await upstream;
          if (!response?.ok || response.status !== 206 || !response.body) {
            // Ending early makes the browser re-request the missing tail on its own.
            controller.error(new Error("Drive tail unavailable"));
            return;
          }
          upstreamReader = response.body.getReader();
        }
        const { done, value } = await upstreamReader.read();
        if (done) controller.close();
        else if (value) controller.enqueue(value);
      } catch (cause) {
        controller.error(cause);
      }
    },
    cancel() {
      abort.abort();
      void upstreamReader?.cancel().catch(() => undefined);
    }
  });
}

/** Reads only the first `limit` bytes of a stream, then releases it. */
async function collectPrefix(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        length += value.byteLength;
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  if (!length) return null;
  const size = Math.min(length, limit);
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= size) break;
    const part = chunk.byteLength > size - offset ? chunk.subarray(0, size - offset) : chunk;
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return merged.buffer as ArrayBuffer;
}
