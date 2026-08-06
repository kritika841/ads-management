import { getDriveThumbnail } from "@/lib/drive";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function extractDriveFileId(url?: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: ad, error } = await supabase
    .from("ads")
    .select("drive_file_id, resolved_video_url, raw_footage_url")
    .eq("id", id)
    .maybeSingle();
  if (error || !ad) return new Response("Thumbnail not found", { status: 404 });

  const fileId =
    extractDriveFileId(ad.resolved_video_url) ||
    (ad.drive_file_id && !ad.drive_file_id.includes("folders") ? ad.drive_file_id : null) ||
    extractDriveFileId(ad.raw_footage_url);

  if (!fileId) return new Response("Thumbnail not found", { status: 404 });

  try {
    const thumbnail = await getDriveThumbnail(fileId);
    if (thumbnail) {
      return new Response(thumbnail.bytes, {
        headers: {
          "Content-Type": thumbnail.contentType,
          "Cache-Control": "private, max-age=300, stale-while-revalidate=600"
        }
      });
    }
  } catch {
    // fall through to public URL
  }

  // Service account unavailable — redirect to public Drive thumbnail (works for shared files)
  return Response.redirect(
    `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w640`,
    302
  );
}
