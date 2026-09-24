import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST as uploadHandler } from "@/app/api/announcements/attachments/route";
import { GET as downloadHandler } from "@/app/api/announcements/attachments/[id]/route";

vi.mock("@/lib/auth", () => ({
  getCurrentProfile: vi.fn(),
  requireProfile: vi.fn()
}));

describe("Announcement Attachments API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks unauthorized users from uploading announcement attachments", async () => {
    const { getCurrentProfile } = await import("@/lib/auth");
    (getCurrentProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const formData = new FormData();
    formData.append("file", new File(["test data"], "test.pdf", { type: "application/pdf" }));

    const req = new Request("http://localhost/api/announcements/attachments", {
      method: "POST",
      body: formData
    });

    const res = await uploadHandler(req);
    expect(res.status).toBe(401);
  });

  it("blocks non-admin and non-manager users from uploading attachments", async () => {
    const { getCurrentProfile } = await import("@/lib/auth");
    (getCurrentProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "creator-1",
      role: "content_creator",
      name: "Creator"
    });

    const formData = new FormData();
    formData.append("file", new File(["test data"], "test.pdf", { type: "application/pdf" }));

    const req = new Request("http://localhost/api/announcements/attachments", {
      method: "POST",
      body: formData
    });

    const res = await uploadHandler(req);
    expect(res.status).toBe(403);
  });

  it("rejects attachments exceeding the 30 MB size limit", async () => {
    const { getCurrentProfile } = await import("@/lib/auth");
    (getCurrentProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "admin-1",
      role: "admin",
      name: "Admin"
    });

    // 31 MB blob exceeding the 30 MB limit
    const largeBlob = new Blob([new Uint8Array(31 * 1024 * 1024)]);

    const formData = new FormData();
    formData.append("file", largeBlob, "large_video.mp4");

    const req = new Request("http://localhost/api/announcements/attachments", {
      method: "POST",
      body: formData
    });

    const res = await uploadHandler(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("exceeds the 30 MB limit");
  });

  it("successfully uploads and returns downloadable URL for files up to 30MB", async () => {
    const { getCurrentProfile } = await import("@/lib/auth");
    (getCurrentProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "admin-1",
      role: "admin",
      name: "Admin"
    });

    const musicFile = new Blob(["audio-binary-data"], { type: "audio/mpeg" });
    const formData = new FormData();
    formData.append("file", musicFile, "Sample_Soundtrack.mp3");
    formData.append("filename", "Sample_Soundtrack.mp3");

    const req = new Request("http://localhost/api/announcements/attachments", {
      method: "POST",
      body: formData
    });

    const res = await uploadHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.attachment).toBeDefined();
    expect(body.attachment.name).toBe("Sample_Soundtrack.mp3");
    expect(body.attachment.type).toBe("audio/mpeg");
    expect(body.attachment.url).toContain("/api/announcements/attachments/");

    // Verify downloading the newly uploaded file
    const downloadReq = new Request(`http://localhost${body.attachment.url}`);
    const downloadRes = await downloadHandler(downloadReq, {
      params: Promise.resolve({ id: body.attachment.id })
    });

    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(downloadRes.headers.get("Content-Disposition")).toContain("attachment; filename=");
  });

  it("handles non-existent attachments gracefully with 404", async () => {
    const { getCurrentProfile } = await import("@/lib/auth");
    (getCurrentProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "admin-1",
      role: "admin",
      name: "Admin"
    });

    const downloadReq = new Request("http://localhost/api/announcements/attachments/non-existent-id");
    const downloadRes = await downloadHandler(downloadReq, {
      params: Promise.resolve({ id: "non-existent-id" })
    });

    expect(downloadRes.status).toBe(404);
  });
});
