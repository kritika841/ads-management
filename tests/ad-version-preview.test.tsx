import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdVersionPreview } from "@/components/review/ad-version-preview";
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
    render(<AdVersionPreview ad={ad} versions={versions} />);

    expect(screen.getByTitle("Version test Current")).toHaveAttribute(
      "src",
      "https://drive.google.com/file/d/current/preview"
    );
    expect(screen.getByText("Current script")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "v2" }));
    expect(screen.getByTitle("Version test v2")).toHaveAttribute(
      "src",
      "https://drive.google.com/file/d/second/preview"
    );
    expect(screen.getByText("Second script")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "v1" }));
    expect(screen.getByTitle("Version test v1")).toHaveAttribute(
      "src",
      "https://drive.google.com/file/d/first/preview"
    );
    expect(screen.getByText("First script")).toBeInTheDocument();
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
