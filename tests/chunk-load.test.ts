import { describe, expect, it } from "vitest";
import { isChunkLoadFailure, isNextChunkUrl } from "@/lib/chunk-load";

describe("chunk load recovery", () => {
  it.each([
    new Error("Loading chunk app/library/page failed."),
    { name: "ChunkLoadError", message: "route chunk unavailable" },
    "Failed to fetch dynamically imported module",
    "Importing a module script failed"
  ])("recognizes recoverable chunk failures", (failure) => {
    expect(isChunkLoadFailure(failure)).toBe(true);
  });

  it("does not reload for ordinary application errors", () => {
    expect(isChunkLoadFailure(new Error("Invalid login credentials"))).toBe(false);
  });

  it("recognizes only Next.js static chunk URLs", () => {
    expect(isNextChunkUrl("http://localhost:3000/_next/static/chunks/app/library/page.js")).toBe(true);
    expect(isNextChunkUrl("https://drive.google.com/video.mp4")).toBe(false);
  });
});
