import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });
  const canManage = profile.role === "admin" || profile.role === "manager";
  if (!canManage) return NextResponse.json({ canManage, sources: [] });
  const { data, error } = await createSupabaseAdminClient().from("raw_asset_sources").select("id,name,drive_url,active,created_at").order("created_at", { ascending: false });
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ canManage, sources: data ?? [] });
}

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });
  if (profile.role !== "admin" && profile.role !== "manager") return new NextResponse("Forbidden", { status: 403 });
  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const driveUrl = typeof body?.driveUrl === "string" ? body.driveUrl.trim() : "";
  if (!name) return new NextResponse("Source name is required.", { status: 400 });
  if (!/^https:\/\/(drive\.google\.com|docs\.google\.com)\//i.test(driveUrl)) return new NextResponse("Use a valid Google Drive folder or file URL.", { status: 400 });
  const { data, error } = await createSupabaseAdminClient().from("raw_asset_sources").upsert({ name, drive_url: driveUrl, active: true, updated_at: new Date().toISOString() }, { onConflict: "drive_url" }).select("id,name,drive_url,active,created_at").single();
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ source: data }, { status: 201 });
}

