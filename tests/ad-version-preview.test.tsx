import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdVersionPreview } from "@/components/review/ad-version-preview";
import { formatVideoTime, VideoTimestampProvider } from "@/components/review/video-timestamp-context";
import type { AdVersion, AdWithRelations } from "@/lib/types";

const ad = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Version test",
  updated_at: "2026-07-10T10:00:00.000Z",
  drive_url: "https://drive.google.com/file/d/current/view",
  drive_file_id: "current",
  preview_url: "https://drive.google.com/file/d/current/preview",
  thumbnail_url: null,
  script_html: "<p>Current script</p>"
} as AdWithRelations;

const versions = [
  version(1, "first", "First script"),
  version(2, "second", "Second script")
];

describe("AdVersionPreview", () => {
  it("switches the preview URL and script for every saved version", () => {
    render(<VideoTimestampProvider><AdVersionPreview ad={ad} versions={versions} /></VideoTimestampProvider>);

    expect(screen.getByTitle("Version test Current")).toHaveAttribute(
      "src",
      "/api/ads/00000000-0000-0000-0000-000000000001/media?fileId=current"
    );
    expect(screen.getByText("Current script")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "v2" }));
    expect(screen.getByTitle("Version test v2")).toHaveAttribute(
      "src",
      "/api/ads/00000000-0000-0000-0000-000000000001/media?fileId=second"
    );
    expect(screen.getByText("Second script")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "v1" }));
    expect(screen.getByTitle("Version test v1")).toHaveAttribute(
      "src",
      "/api/ads/00000000-0000-0000-0000-000000000001/media?fileId=first"
    );
    expect(screen.getByText("First script")).toBeInTheDocument();
  });

  it("falls back to the Drive preview when native playback is unavailable", () => {
    render(<VideoTimestampProvider><AdVersionPreview ad={ad} versions={versions} /></VideoTimestampProvider>);
    fireEvent.error(screen.getByTitle("Version test Current"));
    expect(screen.getByTitle("Version test Current").tagName).toBe("IFRAME");
    expect(screen.getByTitle("Version test Current")).toHaveAttribute("src", ad.preview_url);
  });

  it("formats review timestamps for quick scanning", () => {
    expect(formatVideoTime(0)).toBe("0:00");
    expect(formatVideoTime(74.9)).toBe("1:14");
  });
});

function version(versionNumber: number, fileId: string, script: string): AdVersion {
  return {
    id: `00000000-0000-0000-0000-00000000000${versionNumber + 1}`,
    ad_id: ad.id,
    version_number: versionNumber,
    drive_url: `https://drive.google.com/file/d/${fileId}/view`,
    drive_file_id: fileId,
    preview_url: `https://drive.google.com/file/d/${fileId}/preview`,
    script_html: `<p>${script}</p>`,
    script_text: script,
    feedback_snapshot: null,
    created_by: "00000000-0000-0000-0000-000000000009",
    created_at: `2026-07-0${versionNumber}T10:00:00.000Z`
  };
}
