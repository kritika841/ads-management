import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { spawn } from "child_process";
import path from "path";

/**
 * Cron job: /api/cron/ingest-clips
 *
 * Runs daily to:
 *  1. Reset clips stuck in "processing" (stale) back to "pending"
 *  2. Reset clips in "error" state back to "pending" so they are retried
 *  3. Spawn the ingest + backfill scripts as detached background processes
 *
 * Secured with a CRON_SECRET bearer token (same as the deadlines cron).
 * In vercel.json this fires at 00:30 IST (19:00 UTC) every day.
 */
export async function GET(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) {
    return NextResponse.json(
      { error: "Cron secret is not configured." },
      { status: 503 }
    );
  }

  const authorization = request.headers.get("authorization");
  const suppliedSecret = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  if (suppliedSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  // 1. Reset stale "processing" rows (stuck > 15 min)
  const { data: staleReset, error: staleError } = await admin.rpc(
    "reset_stale_segment_ingest",
    { stale_minutes: 15 }
  );
  if (staleError) {
    console.error("[ingest-clips cron] Failed to reset stale rows:", staleError.message);
  }

  // 2. Reset all "error" clips back to "pending" so they get retried this run
  const { error: errorResetErr } = await admin
    .from("ads")
    .update({ segment_ingest_status: "pending", segment_ingest_error: null })
    .eq("segment_ingest_status", "error")
    .not("raw_footage_url", "is", null);

  if (errorResetErr) {
    console.error("[ingest-clips cron] Failed to reset error rows:", errorResetErr.message);
  }

  // 3. Count how many pending clips we have
  const { count: pendingCount } = await admin
    .from("ads")
    .select("id", { count: "exact", head: true })
    .eq("segment_ingest_status", "pending")
    .not("raw_footage_url", "is", null);

  const projectRoot = path.resolve(process.cwd());

  // 4. Spawn ingest script detached (fires-and-forgets — survives beyond HTTP response)
  const ingestChild = spawn(
    process.execPath,
    ["-r", "dotenv/config", "scripts/ingest-ads-clip-segments.cjs", "dotenv_config_path=.env.local"],
    {
      cwd: projectRoot,
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    }
  );
  ingestChild.unref();

  // 5. Spawn backfill-gemini-embeddings script detached after a short delay
  //    (uses a wrapper so we can add the delay without blocking the response)
  setTimeout(() => {
    const backfillChild = spawn(
      process.execPath,
      ["-r", "dotenv/config", "scripts/backfill-gemini-embeddings.cjs", "dotenv_config_path=.env.local"],
      {
        cwd: projectRoot,
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      }
    );
    backfillChild.unref();
  }, 5 * 60 * 1000); // start backfill 5 min after ingest begins

  console.log(
    `[ingest-clips cron] Triggered. Stale reset: ${staleReset ?? 0}, Pending clips: ${pendingCount ?? 0}`
  );

  return NextResponse.json({
    ok: true,
    staleReset: staleReset ?? 0,
    pendingClips: pendingCount ?? 0,
    message: "Ingest and backfill scripts spawned in background.",
  });
}
