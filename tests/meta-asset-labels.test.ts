import { describe, expect, it } from "vitest";
import {
  assetBreakdownValue,
  assetId,
  assetIdentifier,
  assetLabelScore,
  cleanMediaTitle,
  isCaptionLikeLabel,
  mediaLabelRank,
  normalizeAssetLabel,
  resolveAssetLabel,
  type MetaAdRow,
  type MetaInsightRow,
} from "@/lib/meta-asset-labels";

describe("Meta ↔ AdFlow Data-Mapping: normalizeAssetLabel", () => {
  it("double-decodes URL-encoded filenames and spaces", () => {
    // Single-encoded: %20 -> space
    expect(normalizeAssetLabel("Video%20TAM0173.mp4")).toBe("Video TAM0173.mp4");
    expect(normalizeAssetLabel("TAM0173.mp4")).toBe("Video TAM0173.mp4");
    // Double-encoded: %2520 -> %20 -> space
    expect(normalizeAssetLabel("TAM0173%2520v2.mp4")).toBe("Video TAM0173 v2.mp4");
    // Plus replaced with spaces
    expect(normalizeAssetLabel("TAM0173+final.mp4")).toBe("Video TAM0173 final.mp4");
  });

  it("extracts filename from URL", () => {
    expect(
      normalizeAssetLabel("https://example.com/assets/TAM0173.mp4?token=xyz")
    ).toBe("Video TAM0173.mp4");
  });

  it("normalizes typed strings (video_id, image_id)", () => {
    expect(normalizeAssetLabel("video: 1234567890123456")).toBe("Video 1234567890123456");
    expect(normalizeAssetLabel("image_id: abcdef1234567890")).toBe("Image abcdef1234567890");
  });

  it("strips caption-style titles when paired with an identifier", () => {
    // Object with caption title and video id
    const objectBreakdown = {
      type: "video",
      id: "1234567890123456",
      name: "Save More with Satmi Bundles",
    };
    // Should NOT include the caption "Save More with Satmi Bundles"
    const label = normalizeAssetLabel(objectBreakdown);
    expect(label).not.toContain("Save More with Satmi Bundles");
    expect(label).toBe("Video 1234567890123456");

    // String with caption and identifier: "Save More with Satmi Bundles (1234567890123456)"
    const stringBreakdown = "Save More with Satmi Bundles (1234567890123456)";
    expect(normalizeAssetLabel(stringBreakdown)).toBe("Video 1234567890123456");
  });

  it("preserves actual creative filenames in object breakdown", () => {
    const objectBreakdown = {
      type: "video",
      id: "1234567890123456",
      name: "TAM0173.mp4",
    };
    expect(normalizeAssetLabel(objectBreakdown)).toBe("Video TAM0173.mp4 (1234567890123456)");
  });
});

describe("Meta ↔ AdFlow Data-Mapping: isCaptionLikeLabel", () => {
  it("identifies plain-language video captions as caption-like", () => {
    expect(isCaptionLikeLabel("Save More with Satmi Bundles")).toBe(true);
    expect(isCaptionLikeLabel("Get 20% Off Today Only")).toBe(true);
    expect(isCaptionLikeLabel("Why You Need This Face Serum")).toBe(true);
  });

  it("does not flag actual media filenames containing HIM, TAM, or ISH codes", () => {
    expect(isCaptionLikeLabel("TAM0173.mp4")).toBe(false);
    expect(isCaptionLikeLabel("Video TAM0173.mp4")).toBe(false);
    expect(isCaptionLikeLabel("Video ISH0203.mp4 (1234567890123456)")).toBe(false);
    expect(isCaptionLikeLabel("HIM0162_v3.mov")).toBe(false);
  });

  it("does not flag raw technical identifiers or video/image IDs", () => {
    expect(isCaptionLikeLabel("1234567890123456")).toBe(false);
    expect(isCaptionLikeLabel("Video 1234567890123456")).toBe(false);
    expect(isCaptionLikeLabel("Image abcdef1234567890")).toBe(false);
  });
});

describe("Meta ↔ AdFlow Data-Mapping: assetBreakdownValue", () => {
  it("ignores row.ad_name so captions are never picked as asset labels", () => {
    const row: MetaInsightRow = {
      ad_id: "1001",
      ad_name: "Save More with Satmi Bundles 12345678", // Contains numbers and caption
      date_start: "2026-09-01",
      ad_format_asset: "Video TAM0173.mp4 (1234567890123456)",
    };

    const chosen = assetBreakdownValue(row);
    expect(chosen).toBe("Video TAM0173.mp4 (1234567890123456)");
    expect(chosen).not.toBe(row.ad_name);
  });

  it("prefers breakdowns with filenames and HIM/TAM/ISH tags over generic IDs", () => {
    const row: MetaInsightRow = {
      ad_id: "1002",
      date_start: "2026-09-01",
      video_asset: { id: "1234567890123456" },
      ad_format_asset: "Video TAM0173.mp4 (1234567890123456)",
    };

    const chosen = assetBreakdownValue(row);
    expect(chosen).toBe("Video TAM0173.mp4 (1234567890123456)");
  });
});

describe("Meta ↔ AdFlow Data-Mapping: resolveAssetLabel", () => {
  const adWithCreative: MetaAdRow = {
    id: "1003",
    name: "Campaign Ad 1",
    creative: {
      id: "creative-99",
      video_id: "1234567890123456",
      object_story_spec: {
        video_data: {
          video_id: "1234567890123456",
          file_name: "TAM0173.mp4",
        },
      },
    },
  };

  it("replaces a caption label with filename from creative when available", () => {
    const resolved = resolveAssetLabel(
      adWithCreative,
      "Save More with Satmi Bundles (1234567890123456)"
    );
    expect(resolved).toContain("TAM0173.mp4");
    expect(resolved).not.toContain("Save More with Satmi Bundles");
  });

  it("rejects plain-sentence caption labels and falls back to clean identifier", () => {
    const adWithoutFilename: MetaAdRow = {
      id: "1004",
      name: "Campaign Ad 2",
    };

    const resolved = resolveAssetLabel(
      adWithoutFilename,
      "Save More with Satmi Bundles (1234567890123456)"
    );
    expect(resolved).toBe("Video 1234567890123456");
    expect(resolved).not.toContain("Save More with Satmi Bundles");
  });

  it("keeps canonical filename if already present", () => {
    const resolved = resolveAssetLabel(
      adWithCreative,
      "Video ISH0203.mp4 (9988776655443322)"
    );
    expect(resolved).toBe("Video ISH0203.mp4 (9988776655443322)");
  });
});

describe("mediaLabelRank and assetIdentifier", () => {
  it("ranks filenames and HIM/TAM/ISH tags highest and penalizes captions", () => {
    const filenameScore = mediaLabelRank("Video TAM0173.mp4 (1234567890123456)");
    const genericScore = mediaLabelRank("Video 1234567890123456");
    const captionScore = mediaLabelRank("Save More with Satmi Bundles");

    expect(filenameScore).toBeGreaterThan(genericScore);
    expect(genericScore).toBeGreaterThan(captionScore);
  });

  it("extracts parenthesized or trailing media identifier", () => {
    expect(
      assetIdentifier("Video TAM0173.mp4 (1234567890123456)")
    ).toBe("1234567890123456");
    expect(assetIdentifier("Video 9876543210987654")).toBe("9876543210987654");
  });

  it("constructs assetId deterministically", () => {
    expect(assetId("ad-123", "Video TAM0173.mp4")).toBe(
      "ad-123:Video%20TAM0173.mp4"
    );
  });
});

describe("cleanMediaTitle: strips Video prefix and tracking IDs", () => {
  it("removes Video prefix and parenthesized ID from creative filenames", () => {
    expect(cleanMediaTitle("Video TAM0173.mp4 (1614141190263114)")).toBe("TAM0173.mp4");
    expect(cleanMediaTitle("Video ISH0203.mp4 (1614141193596447)")).toBe("ISH0203.mp4");
    expect(cleanMediaTitle("Video HIM0162.mp4 (1614144830262750)")).toBe("HIM0162.mp4");
    expect(cleanMediaTitle("Video Copy of hk 86.mp4 (1560699532273947)")).toBe("Copy of hk 86.mp4");
    expect(cleanMediaTitle("Video ad21.mp4 (1592564669087433)")).toBe("ad21.mp4");
    expect(cleanMediaTitle("Video 0716 (6).mp4 (1562734658737101)")).toBe("0716 (6).mp4");
  });

  it("handles image filenames cleanly", () => {
    expect(cleanMediaTitle("Image exec-73efe705-b921-4ff3-9df3-3fdf1edb3dc7.png_105 (1580703210273579)")).toBe("exec-73efe705-b921-4ff3-9df3-3fdf1edb3dc7.png");
  });
});
