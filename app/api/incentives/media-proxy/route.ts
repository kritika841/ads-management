import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

export async function GET(request: NextRequest) {
  await requireRole(["admin", "manager", "content_creator", "editor"]);
  const raw = request.nextUrl.searchParams.get("url");
  const download = request.nextUrl.searchParams.get("download") === "1";
  if (!raw) return NextResponse.json({ error: "Missing media URL." }, { status: 400 });
  let url: URL;
  try { url = new URL(raw); } catch { return NextResponse.json({ error: "Invalid media URL." }, { status: 400 }); }
  if (!url.hostname.endsWith("fbcdn.net") && !url.hostname.endsWith("facebook.com")) return NextResponse.json({ error: "Media host is not allowed." }, { status: 403 });
  const headers = new Headers();
  const range = request.headers.get("range");
  if (range) headers.set("range", range);
  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok || !response.body) return NextResponse.json({ error: "Unable to fetch media asset." }, { status: response.status || 502 });
  const output = new Headers({ "Content-Type": response.headers.get("content-type") ?? "video/mp4", "Accept-Ranges": response.headers.get("accept-ranges") ?? "bytes", "Cache-Control": "private, max-age=300" });
  if (download) output.set("Content-Disposition", "attachment; filename=\"creative.mp4\"");
  for (const key of ["content-length", "content-range"]) { const value = response.headers.get(key); if (value) output.set(key, value); }
  return new NextResponse(response.body, { status: response.status, headers: output });
}
