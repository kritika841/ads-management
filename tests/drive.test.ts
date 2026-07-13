import { describe, expect, it } from "vitest";
import {
  googleDriveThumbnailUrl,
  normalizeGoogleDriveImageUrl,
  parseGoogleDriveUrl,
  resolveAdThumbnailUrl
} from "@/lib/drive-urls";

describe("parseGoogleDriveUrl", () => {
  it("parses standard share links", () => {
    const result = parseGoogleDriveUrl("https://drive.google.com/file/d/abc123/view?usp=sharing");
    expect(result).toEqual({
      fileId: "abc123",
      previewUrl: "https://drive.google.com/file/d/abc123/preview",
      embedUrl: "https://drive.google.com/uc?export=view&id=abc123",
      thumbnailUrl: "https://drive.google.com/thumbnail?id=abc123&sz=w1200"
    });
  });

  it("parses open id links", () => {
    expect(parseGoogleDriveUrl("https://drive.google.com/open?id=file-42")?.fileId).toBe("file-42");
  });

  it("rejects non-Drive links", () => {
    expect(parseGoogleDriveUrl("https://example.com/file/d/abc123")).toBeNull();
  });

  it("builds public thumbnail URLs", () => {
    expect(googleDriveThumbnailUrl("a b", 600)).toBe("https://drive.google.com/thumbnail?id=a%20b&sz=w600");
  });

  it("normalizes Drive share links used as image URLs", () => {
    expect(normalizeGoogleDriveImageUrl("https://drive.google.com/file/d/thumb-1/view")).toBe(
      "https://drive.google.com/thumbnail?id=thumb-1&sz=w1200"
    );
  });

  it("resolves ad thumbnails from explicit URL or drive file id", () => {
    expect(resolveAdThumbnailUrl(null, "file-1")).toBe("https://drive.google.com/thumbnail?id=file-1&sz=w1200");
    expect(resolveAdThumbnailUrl("https://example.com/thumb.jpg", "file-1")).toBe("https://example.com/thumb.jpg");
  });
});
