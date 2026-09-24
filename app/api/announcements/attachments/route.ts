import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30 MB
const ATTACHMENT_DIR = path.join(process.cwd(), "storage", "announcements", "attachments");

export async function POST(request: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (profile.role !== "admin" && profile.role !== "manager") {
      return NextResponse.json(
        { ok: false, error: "Only administrators and managers can upload announcement attachments." },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string" || typeof (file as Blob).arrayBuffer !== "function") {
      return NextResponse.json({ ok: false, error: "No file uploaded." }, { status: 400 });
    }

    const uploadFile = file as unknown as {
      name: string;
      size: number;
      type?: string;
      arrayBuffer(): Promise<ArrayBuffer>;
    };

    if (uploadFile.size > MAX_FILE_SIZE) {
      const sizeMb = (uploadFile.size / (1024 * 1024)).toFixed(1);
      return NextResponse.json(
        { ok: false, error: `File size (${sizeMb} MB) exceeds the 30 MB limit.` },
        { status: 400 }
      );
    }

    await fs.mkdir(ATTACHMENT_DIR, { recursive: true });

    const fileId = crypto.randomUUID();
    const customName = (formData.get("filename") as string) || (formData.get("name") as string);
    const originalName = customName || (uploadFile.name && uploadFile.name !== "blob" ? uploadFile.name : "attachment");
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storedFileName = `${fileId}_${safeName}`;
    const filePath = path.join(ATTACHMENT_DIR, storedFileName);

    const arrayBuffer = await uploadFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(filePath, buffer);

    const downloadUrl = `/api/announcements/attachments/${fileId}?name=${encodeURIComponent(originalName)}`;

    return NextResponse.json({
      ok: true,
      attachment: {
        id: fileId,
        name: originalName,
        url: downloadUrl,
        size: uploadFile.size,
        type: uploadFile.type || "application/octet-stream"
      }
    });
  } catch (error) {
    console.error("Failed to upload announcement attachment:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to upload file." },
      { status: 500 }
    );
  }
}
