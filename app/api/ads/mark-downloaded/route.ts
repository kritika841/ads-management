import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });

  const body = await request.json().catch(() => ({}));
  const requestedIds = Array.isArray(body?.ids)
    ? [...new Set(body.ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0))]
    : [];
  if (!requestedIds.length) return new NextResponse("No creatives supplied.", { status: 400 });

  const admin = createSupabaseAdminClient();
  let query = admin.from("ads").select("id").in("id", requestedIds).not("drive_file_id", "is", null);
  if (profile.role === "editor") query = query.eq("editor_id", profile.id);
  else if (profile.role === "content_creator") query = query.eq("creator_id", profile.id);
  const { data: ads, error } = await query;
  if (error) return new NextResponse(error.message, { status: 500 });
  const ids = (ads ?? []).map((ad) => ad.id);
  if (!ids.length) return new NextResponse("No downloadable creatives found.", { status: 404 });

  const { error: tagError } = await admin.rpc("add_ad_tags_bulk", { p_ad_ids: ids, p_tags: ["downloaded"] });
  if (tagError) return new NextResponse(tagError.message, { status: 500 });
  return NextResponse.json({ count: ids.length });
}
