import { beforeEach, describe, expect, it, vi } from "vitest";

const getDriveMedia = vi.fn();
vi.mock("@/lib/drive", () => ({ getDriveMedia: (...args: unknown[]) => getDriveMedia(...args) }));

const { streamFromCachedPrefix, streamDriveMediaPrefix, getCachedDriveMediaPrefix } = await import("@/lib/drive-media-cache");

function bytes(from: number, to: number) {
  return Uint8Array.from({ length: to - from }, (_, index) => (from + index) % 256);
}

async function readAll(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const parts: number[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(...value);
  }
  return Uint8Array.from(parts);
}

describe("drive media streaming", () => {
  beforeEach(() => getDriveMedia.mockReset());

  it("stitches the cached prefix with the live Drive tail in one stream", async () => {
    const total = 20;
    getDriveMedia.mockResolvedValue(new Response(bytes(8, total), { status: 206, headers: { "content-range": `bytes 8-19/${total}` } }));
    const prefix = { bytes: bytes(0, 8).buffer as ArrayBuffer, contentType: "video/mp4", totalSize: total, expiresAt: Date.now() + 60_000 };

    const result = await readAll(streamFromCachedPrefix("file-a", prefix, 3));

    expect(getDriveMedia).toHaveBeenCalledWith("file-a", "bytes=8-", expect.any(AbortSignal));
    expect(Array.from(result)).toEqual(Array.from(bytes(3, total)));
  });

  it("streams the whole file for a cold open-ended request and caches only the prefix", async () => {
    const total = 64;
    getDriveMedia.mockResolvedValue(new Response(bytes(0, total), { status: 206, headers: { "content-range": `bytes 0-63/${total}`, "content-type": "video/mp4" } }));

    const streamed = await streamDriveMediaPrefix("file-b");
    expect(getDriveMedia).toHaveBeenCalledWith("file-b", "bytes=0-");
    const result = await readAll(streamed!.body);
    expect(result.byteLength).toBe(total);

    await new Promise((resolve) => setTimeout(resolve, 0));
    const cached = getCachedDriveMediaPrefix("file-b");
    expect(cached?.totalSize).toBe(total);
    expect(cached?.bytes.byteLength).toBe(total); // file smaller than the 8 MB prefix → fully cached
  });
});
