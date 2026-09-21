import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { buildTranscriptMappingRow, extractMetaAdTranscript } from "@/lib/meta-ad-transcripts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

type ExtractRequest = {
  metaAdIds?: string[];
  limit?: number;
  retryFailed?: boolean;
};

export async function POST(request: Request) {
  const profile = await requireRole(["admin", "manager"]);
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: "META_ACCESS_TOKEN is not configured on the server." }, { status: 503 });

  const body = await request.json().catch(() => ({})) as ExtractRequest;
  const requestedIds = [...new Set((body.metaAdIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
  if (requestedIds.some((id) => !/^\d+$/.test(id))) return NextResponse.json({ error: "Every Meta ad ID must be numeric." }, { status: 400 });
  const limit = Math.min(Math.max(Number(body.limit ?? 5), 1), 25);

  const admin = createSupabaseAdminClient();
  const [{ data: scripts, error: scriptsError }, { data: existingMappings, error: mappingError }] = await Promise.all([
    admin.from("ads").select("id,script_text").eq("production_stage", "approved").not("script_text", "is", null),
    admin.from("meta_ad_transcript_mappings").select("meta_ad_id,transcript_status")
  ]);
  if (scriptsError) return NextResponse.json({ error: scriptsError.message }, { status: 502 });
  if (mappingError) return NextResponse.json({ error: mappingError.message }, { status: 502 });

  const skippedStatuses = new Set(body.retryFailed ? ["available"] : ["available", "failed"]);
  const alreadyHandled = new Set((existingMappings ?? []).filter((row) => skippedStatuses.has(row.transcript_status)).map((row) => row.meta_ad_id));
  const candidates = (scripts ?? []) as { id: string; script_text: string | null }[];

  const metaQuery = admin.from("meta_ads").select("id").order("spend", { ascending: false }).limit(requestedIds.length ? requestedIds.length : limit);
  const { data: metaAds, error: metaError } = requestedIds.length ? await metaQuery.in("id", requestedIds) : await metaQuery;
  if (metaError) return NextResponse.json({ error: metaError.message }, { status: 502 });

  const ids = (metaAds ?? []).map((ad) => ad.id).filter((id) => requestedIds.length || !alreadyHandled.has(id)).slice(0, limit);
  if (!ids.length) return NextResponse.json({ processed: 0, mapped: 0, failed: 0, unmatched: 0, skippedAlreadyHandled: (metaAds ?? []).length });

  const rows = [];
  for (const metaAdId of ids) {
    const extracted = await extractMetaAdTranscript(metaAdId, token);
    rows.push(buildTranscriptMappingRow(extracted, candidates));
  }

  const { error: upsertError } = await admin.from("meta_ad_transcript_mappings").upsert(rows, { onConflict: "mapping_key" });
  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 502 });

  const mapped = rows.filter((row) => row.matched_ad_id).length;
  const failed = rows.filter((row) => row.transcript_status === "failed").length;
  const unmatched = rows.filter((row) => row.transcript_status === "available" && !row.matched_ad_id).length;
  await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: "extracted_meta_ad_transcripts",
    target_type: "meta_ad_transcript_mapping",
    metadata: { requested: requestedIds.length || null, processed: rows.length, mapped, failed, unmatched }
  });

  return NextResponse.json({ processed: rows.length, mapped, failed, unmatched, limit, retryFailed: Boolean(body.retryFailed) });
}
