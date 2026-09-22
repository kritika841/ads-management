import { getDriveThumbnail } from "@/lib/drive";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function extractDriveFileId(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^[a-zA-Z0-9_-]{25,50}$/.test(trimmed)) {
    return trimmed;
  }
  const match =
    trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
    trimmed.match(/[?&]fileId=([a-zA-Z0-9_-]+)/) ||
    trimmed.match(/\/uc\?id=([a-zA-Z0-9_-]+)/) ||
    trimmed.match(/\/open\?id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function generateFallbackSvg(name: string): Response {
  const cleanName = (name || "Creative Video").slice(0, 24).replace(/[<>&"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="320" y2="180" gradientUnits="userSpaceOnUse">
      <stop stop-color="#18181b"/>
      <stop offset="1" stop-color="#09090b"/>
    </linearGradient>
  </defs>
  <rect width="320" height="180" fill="url(#bg)"/>
  <rect x="0.5" y="0.5" width="319" height="179" stroke="#27272a" stroke-width="1" rx="4"/>
  <circle cx="160" cy="74" r="26" fill="#27272a"/>
  <polygon points="154,63 172,74 154,85" fill="#f4f4f5"/>
  <text x="160" y="126" fill="#a1a1aa" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="600" text-anchor="middle">${cleanName}</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"
    }
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const { data: ad, error } = await admin
    .from("ads")
    .select("name, thumbnail_url, drive_file_id, drive_url, preview_url, resolved_video_url, raw_footage_url, product:products(image_url)")
    .eq("id", id)
    .maybeSingle();

  if (error || !ad) {
    return generateFallbackSvg("Creative");
  }

  // Handle product relation whether returned as object or array
  const productData = Array.isArray(ad.product) ? ad.product[0] : ad.product;
  const productImage = (productData as { image_url?: string | null } | null)?.image_url;

  const fileId =
    extractDriveFileId(ad.drive_file_id) ||
    extractDriveFileId(ad.resolved_video_url) ||
    extractDriveFileId(ad.drive_url) ||
    extractDriveFileId(ad.preview_url) ||
    extractDriveFileId(ad.thumbnail_url) ||
    extractDriveFileId(ad.raw_footage_url);

  if (fileId) {
    // 1. Try Google Drive API with Service Account (authorized)
    try {
      const thumbnail = await getDriveThumbnail(fileId);
      if (thumbnail) {
        return new Response(thumbnail.bytes, {
          headers: {
            "Content-Type": thumbnail.contentType,
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          }
        });
      }
    } catch {
      // fall through
    }

    // 2. Try proxying the public Drive thumbnail from server side
    try {
      const driveRes = await fetch(
        `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w640`,
        { cache: "force-cache" }
      );
      if (driveRes.ok) {
        return new Response(await driveRes.arrayBuffer(), {
          headers: {
            "Content-Type": driveRes.headers.get("content-type") || "image/jpeg",
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          }
        });
      }
    } catch {
      // fall through
    }

    // 3. Try lh3 direct endpoint with file id
    try {
      const lh3Res = await fetch(
        `https://lh3.googleusercontent.com/u/0/d/${encodeURIComponent(fileId)}=w640`,
        { cache: "force-cache" }
      );
      if (lh3Res.ok) {
        return new Response(await lh3Res.arrayBuffer(), {
          headers: {
            "Content-Type": lh3Res.headers.get("content-type") || "image/jpeg",
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          }
        });
      }
    } catch {
      // fall through
    }
  }

  // 4. If ad has an explicit thumbnail URL (e.g. external CDN or public S3/Shopify/etc.)
  if (ad.thumbnail_url && ad.thumbnail_url.startsWith("http")) {
    try {
      const imgRes = await fetch(ad.thumbnail_url);
      if (imgRes.ok) {
        return new Response(await imgRes.arrayBuffer(), {
          headers: {
            "Content-Type": imgRes.headers.get("content-type") || "image/jpeg",
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          }
        });
      }
    } catch {
      // fall through
    }
  }

  // 5. Fall back to product image if available
  if (productImage && productImage.startsWith("http")) {
    try {
      const prodRes = await fetch(productImage);
      if (prodRes.ok) {
        return new Response(await prodRes.arrayBuffer(), {
          headers: {
            "Content-Type": prodRes.headers.get("content-type") || "image/jpeg",
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          }
        });
      }
    } catch {
      // fall through
    }
  }

  // 6. High quality SVG fallback ensuring image never fails to display
  return generateFallbackSvg(ad.name);
}
