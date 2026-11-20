import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  buildEditedVariationsByAdId,
  buildPlayableAdVideos,
  buildVariationPairs,
  buildVariationsByAdId,
  CREATIVE_VARIATIONS_ACTION,
  EDITOR_VARIATIONS_ACTION,
  extractEditedVariationsFromActivityLogs,
  extractVariationsFromActivityLogs,
  normalizeCreativeVariations,
  normalizeEditedVariations
} from "@/lib/creative-variations";
import { CreatorItemForm } from "@/components/workflow/creator-item-form";
import { EditorWorkspace } from "@/components/workflow/editor-workspace";
import { SettingsClient } from "@/components/admin/settings-client";

vi.mock("@/components/admin/download-logs-panel", () => ({
  DownloadLogsPanel: () => null
}));
vi.mock("@/components/admin/recycle-bin-panel", () => ({
  RecycleBinPanel: () => null
}));
vi.mock("@/components/announcements/announcements-dashboard", () => ({
  AnnouncementsDashboard: () => null
}));
vi.mock("@/components/admin/security-settings-panel", () => ({
  SecuritySettingsPanel: () => null
}));

vi.mock("@/lib/auth", () => ({
  getCurrentProfile: vi.fn(async () => null),
  requireProfile: vi.fn(async () => null),
  requireRole: vi.fn(async () => null),
  canReview: vi.fn(() => false)
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));

vi.mock("@/app/actions/ads", () => ({
  getNextAdName: vi.fn(async () => "KRI0099"),
  getPendingTaskManagerCreativeIds: vi.fn(async () => ({ nextCreativeId: "KRI0099", pendingCreativeIds: [] })),
  saveCreatorItem: vi.fn(async () => ({ ok: true, adId: "ad-1" })),
  submitFinalClipByReviewer: vi.fn(async () => ({ ok: true })),
  adminOverrideCreativeEdit: vi.fn(async () => ({ ok: true, adId: "ad-1" })),
  startEditing: vi.fn(async () => ({ ok: true })),
  submitEditedVideo: vi.fn(async () => ({ ok: true }))
}));

vi.mock("@/app/actions/admin", () => ({
  updateSettings: vi.fn(async () => ({ ok: true })),
  saveCampaign: vi.fn(async () => ({ ok: true })),
  deleteCampaign: vi.fn(async () => ({ ok: true }))
}));

describe("Creative Variations helpers", () => {
  it("normalizes and extracts the latest variations from activity_logs", () => {
    const logs = [
      {
        ad_id: "ad-1",
        action: CREATIVE_VARIATIONS_ACTION,
        created_at: "2026-11-20T05:00:00Z",
        metadata: {
          variations: [{ id: "v1", label: "Hook A", rawFootageUrl: "https://drive.google.com/drive/folders/abc" }]
        }
      },
      {
        ad_id: "ad-1",
        action: CREATIVE_VARIATIONS_ACTION,
        created_at: "2026-11-20T06:00:00Z",
        metadata: {
          variations: [
            { id: "v1", label: "Hook A", raw_footage_url: "https://drive.google.com/drive/folders/abc" },
            { id: "v2", label: "Hook B", raw_footage_url: "https://drive.google.com/drive/folders/def" }
          ]
        }
      }
    ];

    const latest = extractVariationsFromActivityLogs(logs);
    expect(latest).toHaveLength(2);
    expect(latest[1].label).toBe("Hook B");
    expect(latest[1].raw_footage_url).toBe("https://drive.google.com/drive/folders/def");

    const map = buildVariationsByAdId(logs);
    expect(map.get("ad-1")).toHaveLength(2);
  });

  it("assigns default labels when missing", () => {
    const normalized = normalizeCreativeVariations([{ rawFootageUrl: "https://drive.google.com/drive/folders/xyz" }]);
    expect(normalized).toEqual([
      { id: "var-1", label: "Variation 1", raw_footage_url: "https://drive.google.com/drive/folders/xyz" }
    ]);
  });
});

describe("CreatorItemForm variations UI", () => {
  const baseProfile = {
    id: "user-1",
    name: "Kritika",
    email: "kritika@satmi.in",
    role: "content_creator" as const,
    avatar_url: null,
    active: true,
    deleted_at: null,
    created_at: "",
    updated_at: ""
  };

  it("shows variations checkbox and lets creator configure N variations", () => {
    render(
      React.createElement(CreatorItemForm, {
        profile: baseProfile,
        creators: [baseProfile],
        editors: [],
        campaigns: [{ id: "camp-1", name: "Camp", description: null, active: true, created_at: "", updated_at: "" }],
        products: [{ id: "prod-1", name: "Prod", sku: null, image_url: null, active: true, created_at: "", updated_at: "" }],
        availableTags: [],
        editorWorkloads: {}
      })
    );

    const checkbox = screen.getByLabelText(/Want to add variations to this creative/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    const countInput = screen.getByLabelText("Number of variations") as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));

    expect(screen.getAllByPlaceholderText("https://drive.google.com/drive/folders/...").length).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: /Add variation/i }));
    expect(screen.getAllByPlaceholderText("https://drive.google.com/drive/folders/...").length).toBe(4);
  });
});

describe("Admin Settings editor limit", () => {
  it("allows up to 50 concurrent edits per editor", () => {
    render(
      React.createElement(SettingsClient, {
        settings: {
          id: 1,
          two_step_approval: false,
          email_notifications: true,
          deadline_reminder_days: 2,
          max_concurrent_edits: 5,
          assignment_start_sla_hours: 24,
          editing_sla_hours: 48,
          creator_review_sla_hours: 24,
          final_review_sla_hours: 24,
          revision_sla_hours: 24,
          updated_at: ""
        },
        campaigns: []
      })
    );

    const inputs = document.querySelectorAll('input[type="number"]');
    const maxEditsInput = Array.from(inputs).find((el) => el.getAttribute("max") === "50") as HTMLInputElement | undefined;
    expect(maxEditsInput).toBeTruthy();
    expect(maxEditsInput?.getAttribute("max")).toBe("50");
  });
});

describe("EditorWorkspace multiple variation input boxes", () => {
  it("normalizes and extracts edited variations from activity logs", () => {
    const logs = [
      {
        ad_id: "ad-1",
        action: EDITOR_VARIATIONS_ACTION,
        created_at: "2026-11-20T08:00:00Z",
        metadata: {
          edited_variations: [
            { id: "e1", label: "Hook B", driveUrl: "https://drive.google.com/file/d/abc/view", drive_file_id: "abc", preview_url: "https://drive.google.com/file/d/abc/preview" }
          ]
        }
      }
    ];
    expect(extractEditedVariationsFromActivityLogs(logs)).toHaveLength(1);
    expect(buildEditedVariationsByAdId(logs).get("ad-1")?.[0].label).toBe("Hook B");
    expect(normalizeEditedVariations([{ driveUrl: "https://drive.google.com/file/d/xyz/view" }])[0].label).toBe("Variation 1");

    const pairs = buildVariationPairs(
      [{ id: "v1", label: "Hook A", raw_footage_url: "https://drive.google.com/drive/folders/raw-a" }],
      [{ id: "v1", label: "Hook A", drive_url: "https://drive.google.com/file/d/ed-a/view", drive_file_id: "ed-a", preview_url: "https://drive.google.com/file/d/ed-a/preview" }]
    );
    expect(pairs).toEqual([
      {
        key: "v1",
        label: "Hook A",
        rawUrl: "https://drive.google.com/drive/folders/raw-a",
        editedUrl: "https://drive.google.com/file/d/ed-a/view",
        driveFileId: "ed-a",
        previewUrl: "https://drive.google.com/file/d/ed-a/preview"
      }
    ]);

    const playable = buildPlayableAdVideos({
      drive_file_id: "main-id",
      drive_url: "https://drive.google.com/file/d/main-id/view",
      preview_url: "https://drive.google.com/file/d/main-id/preview",
      edited_variations: [
        { id: "v1", label: "Hook A", drive_url: "https://drive.google.com/file/d/ed-a/view", drive_file_id: "ed-a", preview_url: "https://drive.google.com/file/d/ed-a/preview" }
      ]
    });
    expect(playable.map((item) => item.label)).toEqual(["Main", "Hook A"]);
  });

  it("locks editor variation inputs to the creator's defined variations without add/remove controls", () => {
    render(
      React.createElement(EditorWorkspace, {
        ad: {
          id: "ad-1",
          name: "KRI0050",
          campaign_id: "camp-1",
          product_id: "prod-1",
          creator_id: "u1",
          editor_id: "u2",
          status: "draft",
          approval_stage: "manager_review",
          drive_url: null,
          drive_file_id: null,
          preview_url: null,
          thumbnail_url: null,
          script_html: "<p>Hello</p>",
          script_text: "Hello",
          ad_type: "video",
          platforms: [],
          deadline: null,
          notes: null,
          live_url: null,
          submitted_at: null,
          approved_at: null,
          published_at: null,
          production_stage: "editing",
          raw_footage_url: "https://drive.google.com/drive/folders/raw1",
          script_ready_at: null,
          shoot_completed_at: null,
          raw_footage_shared_at: null,
          editing_started_at: null,
          creator_reviewed_at: null,
          final_approved_at: null,
          workflow_status_changed_at: "",
          editor_notes: null,
          updated_at: "",
          created_at: "",
          creator: null,
          editor: null,
          campaign: null,
          product: null,
          tags: [],
          variations: [
            { id: "v1", label: "Var A", raw_footage_url: "https://drive.google.com/drive/folders/a" },
            { id: "v2", label: "Var B", raw_footage_url: "https://drive.google.com/drive/folders/b" }
          ]
        },
        feedback: [],
        inProgressCount: 0,
        maxConcurrentEdits: 5,
        timeLogs: []
      })
    );

    // 1 primary final video box + 2 locked variation boxes for Var A & Var B
    expect(screen.getAllByPlaceholderText("https://drive.google.com/file/d/...").length).toBe(3);
    expect(screen.getAllByText("Var A").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Var B").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("button", { name: /Add variation box/i })).toBeNull();
    expect(screen.queryByLabelText("Number of variation video boxes")).toBeNull();
  });
});
