import { describe, expect, it } from "vitest";
import {
  isUserTargetedByAnnouncement,
  type Announcement,
  type AnnouncementAcknowledgement
} from "@/lib/announcements";
import type { Profile } from "@/lib/types";

describe("Announcements System", () => {
  const dummyProfiles: Profile[] = [
    { id: "admin-1", name: "Admin User", email: "admin@test.com", role: "admin", active: true, avatar_url: null, deleted_at: null, created_at: "", updated_at: "" },
    { id: "mgr-1", name: "Manager User", email: "mgr@test.com", role: "manager", active: true, avatar_url: null, deleted_at: null, created_at: "", updated_at: "" },
    { id: "creator-1", name: "Creator User", email: "creator@test.com", role: "content_creator", active: true, avatar_url: null, deleted_at: null, created_at: "", updated_at: "" },
    { id: "editor-1", name: "Editor User", email: "editor@test.com", role: "editor", active: true, avatar_url: null, deleted_at: null, created_at: "", updated_at: "" }
  ];

  it("correctly identifies users targeted by 'all'", () => {
    const announcement: Announcement = {
      id: "ann-1",
      title: "Company Update",
      content: "Please read this important update.",
      author_id: "admin-1",
      author_name: "Admin User",
      author_role: "admin",
      target_type: "all",
      target_roles: [],
      target_user_ids: [],
      images: [],
      attachments: [],
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      acknowledgements: []
    };

    expect(isUserTargetedByAnnouncement(announcement, "admin-1", "admin")).toBe(true);
    expect(isUserTargetedByAnnouncement(announcement, "mgr-1", "manager")).toBe(true);
    expect(isUserTargetedByAnnouncement(announcement, "creator-1", "content_creator")).toBe(true);
    expect(isUserTargetedByAnnouncement(announcement, "editor-1", "editor")).toBe(true);
  });

  it("correctly identifies users targeted by role", () => {
    const creatorEditorAnnouncement: Announcement = {
      id: "ann-2",
      title: "Production Workflow Update",
      content: "New delivery guidelines for creatives.",
      author_id: "mgr-1",
      author_name: "Manager User",
      author_role: "manager",
      target_type: "roles",
      target_roles: ["content_creator", "editor"],
      target_user_ids: [],
      images: [],
      attachments: [],
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      acknowledgements: []
    };

    expect(isUserTargetedByAnnouncement(creatorEditorAnnouncement, "creator-1", "content_creator")).toBe(true);
    expect(isUserTargetedByAnnouncement(creatorEditorAnnouncement, "editor-1", "editor")).toBe(true);
    expect(isUserTargetedByAnnouncement(creatorEditorAnnouncement, "mgr-1", "manager")).toBe(false);
    expect(isUserTargetedByAnnouncement(creatorEditorAnnouncement, "admin-1", "admin")).toBe(false);
  });

  it("correctly identifies users targeted by specific user IDs", () => {
    const userSpecificAnnouncement: Announcement = {
      id: "ann-3",
      title: "Direct Notice",
      content: "Specific notice for selected team members.",
      author_id: "admin-1",
      author_name: "Admin User",
      author_role: "admin",
      target_type: "users",
      target_roles: [],
      target_user_ids: ["creator-1", "mgr-1"],
      images: [],
      attachments: [],
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      acknowledgements: []
    };

    expect(isUserTargetedByAnnouncement(userSpecificAnnouncement, "creator-1", "content_creator")).toBe(true);
    expect(isUserTargetedByAnnouncement(userSpecificAnnouncement, "mgr-1", "manager")).toBe(true);
    expect(isUserTargetedByAnnouncement(userSpecificAnnouncement, "editor-1", "editor")).toBe(false);
    expect(isUserTargetedByAnnouncement(userSpecificAnnouncement, "admin-1", "admin")).toBe(false);
  });

  it("calculates acknowledgement statistics and pending recipients correctly", () => {
    const announcement: Announcement = {
      id: "ann-stats",
      title: "Policy Update",
      content: "Acknowledged tracking test.",
      author_id: "admin-1",
      author_name: "Admin User",
      author_role: "admin",
      target_type: "roles",
      target_roles: ["content_creator", "editor"],
      target_user_ids: [],
      images: [],
      attachments: [],
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      acknowledgements: []
    };

    const targetedProfiles = dummyProfiles.filter((p) =>
      isUserTargetedByAnnouncement(announcement, p.id, p.role)
    );
    expect(targetedProfiles.map((p) => p.id)).toEqual(["creator-1", "editor-1"]);

    const acknowledgements: AnnouncementAcknowledgement[] = [
      {
        user_id: "creator-1",
        user_name: "Creator User",
        user_role: "content_creator",
        acknowledged_at: "2026-09-24T08:00:00Z"
      }
    ];

    const acknowledgedUserIds = new Set(acknowledgements.map((a) => a.user_id));
    const totalTargeted = targetedProfiles.length;
    const acknowledgedCount = acknowledgements.length;
    const pendingProfiles = targetedProfiles.filter((p) => !acknowledgedUserIds.has(p.id));

    expect(totalTargeted).toBe(2);
    expect(acknowledgedCount).toBe(1);
    expect(pendingProfiles.length).toBe(1);
    expect(pendingProfiles[0].id).toBe("editor-1");
  });

  it("handles image attachments and document links gracefully", () => {
    const announcementWithMedia: Announcement = {
      id: "ann-media",
      title: "Brand Asset Release",
      content: "Please see attached preview and guidelines.",
      author_id: "admin-1",
      author_name: "Admin User",
      author_role: "admin",
      target_type: "all",
      target_roles: [],
      target_user_ids: [],
      images: ["https://example.com/mockup.png"],
      attachments: [
        { id: "att-1", name: "Brand_Guidelines_2026.pdf", url: "https://example.com/guidelines.pdf", size: 2048576 }
      ],
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      acknowledgements: []
    };

    expect(announcementWithMedia.images).toHaveLength(1);
    expect(announcementWithMedia.attachments).toHaveLength(1);
    expect(announcementWithMedia.attachments![0].name).toBe("Brand_Guidelines_2026.pdf");
  });

  it("supports attachments of any type including music, video, image, or pdf up to 30 MB", () => {
    const announcementWithDiverseFiles: Announcement = {
      id: "ann-diverse-files",
      title: "Audio & Video Creative Pack",
      content: "Please download the background music track, reference video, and pdf script.",
      author_id: "admin-1",
      author_name: "Admin User",
      author_role: "admin",
      target_type: "all",
      target_roles: [],
      target_user_ids: [],
      images: ["https://example.com/banner.jpg"],
      attachments: [
        {
          id: "att-audio",
          name: "Voiceover_Intro.mp3",
          url: "/api/announcements/attachments/att-audio",
          size: 5 * 1024 * 1024, // 5 MB
          type: "audio/mpeg"
        },
        {
          id: "att-video",
          name: "Sample_Hook_Reference.mp4",
          url: "/api/announcements/attachments/att-video",
          size: 28 * 1024 * 1024, // 28 MB <= 30 MB
          type: "video/mp4"
        },
        {
          id: "att-pdf",
          name: "Script_Template.pdf",
          url: "/api/announcements/attachments/att-pdf",
          size: 1.5 * 1024 * 1024, // 1.5 MB
          type: "application/pdf"
        },
        {
          id: "att-image",
          name: "Thumbnail_Storyboard.png",
          url: "/api/announcements/attachments/att-image",
          size: 800 * 1024, // 800 KB
          type: "image/png"
        }
      ],
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      acknowledgements: []
    };

    expect(announcementWithDiverseFiles.attachments).toHaveLength(4);
    expect(announcementWithDiverseFiles.attachments.every((a) => (a.size ?? 0) <= 30 * 1024 * 1024)).toBe(true);

    const audioFile = announcementWithDiverseFiles.attachments.find((a) => a.type?.startsWith("audio/"));
    const videoFile = announcementWithDiverseFiles.attachments.find((a) => a.type?.startsWith("video/"));
    const pdfFile = announcementWithDiverseFiles.attachments.find((a) => a.name.endsWith(".pdf"));

    expect(audioFile?.name).toBe("Voiceover_Intro.mp3");
    expect(videoFile?.name).toBe("Sample_Hook_Reference.mp4");
    expect(pdfFile?.name).toBe("Script_Template.pdf");
  });

  it("respects archived status: archived announcements do not prompt or target users", () => {
    const activeAnnouncement: Announcement = {
      id: "ann-active",
      title: "Active Announcement",
      content: "Must be acknowledged.",
      author_id: "admin-1",
      author_name: "Admin User",
      author_role: "admin",
      target_type: "all",
      target_roles: [],
      target_user_ids: [],
      images: [],
      attachments: [],
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      acknowledgements: []
    };

    const archivedAnnouncement: Announcement = {
      ...activeAnnouncement,
      id: "ann-archived",
      title: "Archived Announcement",
      status: "archived"
    };

    // Active announcement targets user
    expect(isUserTargetedByAnnouncement(activeAnnouncement, "creator-1", "content_creator")).toBe(true);

    // Archived announcement does not target user for prompting
    expect(isUserTargetedByAnnouncement(archivedAnnouncement, "creator-1", "content_creator")).toBe(false);
  });
});

