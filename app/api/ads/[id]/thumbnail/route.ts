import { getDriveThumbnail } from "@/lib/drive";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: ad, error } = await supabase
    .from("ads")
    .select("drive_file_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !ad?.drive_file_id) return new Response("Thumbnail not found", { status: 404 });

  try {
    const thumbnail = await getDriveThumbnail(ad.drive_file_id);
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
    `https://drive.google.com/thumbnail?id=${encodeURIComponent(ad.drive_file_id)}&sz=w640`,
    302
  );
}
