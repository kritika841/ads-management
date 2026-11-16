import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { invalidateLibraryCache } from "@/lib/library-cache";
import { invalidateDashboardCache } from "@/lib/dashboard-cache";

export async function POST(req: Request) {
  try {
    let adId: string | undefined;
    try {
      const body = await req.json();
      adId = body?.adId;
    } catch {}

    invalidateLibraryCache();
    invalidateDashboardCache();

    revalidatePath("/library");
    revalidatePath("/dashboard");
    revalidatePath("/approvals");
    if (adId) {
      revalidatePath(`/ads/${adId}`);
    }

    return NextResponse.json({ ok: true, revalidatedAt: new Date().toISOString() });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to revalidate cache",
      },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const adId = searchParams.get("adId") || undefined;

  invalidateLibraryCache();
  invalidateDashboardCache();

  revalidatePath("/library");
  revalidatePath("/dashboard");
  revalidatePath("/approvals");
  if (adId) {
    revalidatePath(`/ads/${adId}`);
  }

  return NextResponse.json({ ok: true, revalidatedAt: new Date().toISOString() });
}
