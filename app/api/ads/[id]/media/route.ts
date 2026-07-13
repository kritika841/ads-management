import { getDriveMedia } from "@/lib/drive";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fileId = new URL(request.url).searchParams.get("fileId");
  if (!fileId) return new Response("File not found", { status: 404 });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const [{ data: ad }, { data: versions }] = await Promise.all([
    supabase.from("ads").select("drive_file_id").eq("id", id).maybeSingle(),
    supabase.from("ad_versions").select("drive_file_id").eq("ad_id", id)
  ]);
  const allowed = ad?.drive_file_id === fileId || versions?.some((version) => version.drive_file_id === fileId);
  if (!allowed) return new Response("File not found", { status: 404 });

  try {
    const media = await getDriveMedia(fileId, request.headers.get("range"));
    if (!media?.ok || !media.body) return new Response("Video unavailable", { status: media?.status ?? 502 });
    const headers = new Headers();
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = media.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("Cache-Control", "private, max-age=300");
    return new Response(media.body, { status: media.status, headers });
  } catch {
    return new Response("Video unavailable", { status: 502 });
  }
}
