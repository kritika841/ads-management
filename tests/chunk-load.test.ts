import { describe, expect, it } from "vitest";
import { isChunkLoadFailure, isNextChunkUrl, isStaleApplicationFailure } from "@/lib/chunk-load";

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

  it.each([
    { name: "UnrecognizedActionError", message: "The action is from an older build." },
    'Server Action "407aa23449c3be479f8650e455766e979b793fa8f2" was not found on the server.',
    "Failed to find Server Action"
  ])("recognizes stale Server Action failures", (failure) => {
    expect(isStaleApplicationFailure(failure)).toBe(true);
  });

  it("does not treat normal action validation errors as stale", () => {
    expect(isStaleApplicationFailure(new Error("Deadline is required."))).toBe(false);
  });

  it("recognizes only Next.js static chunk URLs", () => {
    expect(isNextChunkUrl("http://localhost:3000/_next/static/chunks/app/library/page.js")).toBe(true);
    expect(isNextChunkUrl("https://drive.google.com/video.mp4")).toBe(false);
  });
});
