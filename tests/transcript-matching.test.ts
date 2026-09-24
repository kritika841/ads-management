import { describe, expect, it } from "vitest";
import { matchTranscriptToScripts, normalizeTranscript } from "@/lib/transcript-matching";

describe("transcript mapping", () => {
  it("normalizes punctuation and casing", () => {
    expect(normalizeTranscript("  Hello, WORLD!  ")).toBe("hello world");
  });

  it("selects the closest Creative Library script", () => {
    const result = matchTranscriptToScripts(
      "Try our vitamin c serum for brighter skin and a smoother glow every morning",
      [
        { id: "serum", script_text: "Try our vitamin c serum for brighter skin and a smoother glow every morning" },
        { id: "shoes", script_text: "These running shoes are light and comfortable for every workout" }
      ]
    );
    expect(result.adId).toBe("serum");
    expect(result.confidence).toBe("high");
  });

  it("does not force an unrelated or very short transcript", () => {
    expect(matchTranscriptToScripts("buy now", [{ id: "one", script_text: "A completely different product story" }]).adId).toBeNull();
  });
});
