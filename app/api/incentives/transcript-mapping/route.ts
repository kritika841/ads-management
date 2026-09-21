import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { buildTranscriptMappingRow } from "@/lib/meta-ad-transcripts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type TranscriptInput = {
  metaAdId: string;
  transcript: string;
  language?: string | null;
  source?: string | null;
};

export async function POST(request: Request) {
  const profile = await requireRole(["admin", "manager"]);
  const body = await request.json() as { items?: TranscriptInput[] } | TranscriptInput;
  const items = Array.isArray((body as { items?: TranscriptInput[] }).items)
    ? (body as { items: TranscriptInput[] }).items
    : [body as TranscriptInput];
  if (!items.length || items.length > 500) return NextResponse.json({ error: "Provide between 1 and 500 transcript items." }, { status: 400 });
  if (items.some((item) => !/^\d+$/.test(item.metaAdId) || !item.transcript?.trim())) return NextResponse.json({ error: "Every item needs a numeric Meta ad ID and a transcript." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const ids = [...new Set(items.map((item) => item.metaAdId))];
  const [{ data: metaAds, error: metaError }, { data: ads, error: adsError }] = await Promise.all([
    admin.from("meta_ads").select("id").in("id", ids),
    admin.from("ads").select("id,script_text").eq("production_stage", "approved").not("script_text", "is", null)
  ]);
  if (metaError) return NextResponse.json({ error: metaError.message }, { status: 502 });
  if (adsError) return NextResponse.json({ error: adsError.message }, { status: 502 });
  const knownMetaIds = new Set((metaAds ?? []).map((ad) => ad.id));
  const candidates = (ads ?? []) as { id: string; script_text: string | null }[];
  const rows = items.filter((item) => knownMetaIds.has(item.metaAdId)).map((item) => {
    const transcript = item.transcript.trim();
    return { ...buildTranscriptMappingRow({ metaAdId: item.metaAdId, creativeId: null, videoId: null, transcript, transcriptHash: createHash("sha256").update(transcript).digest("hex"), error: null }, candidates), transcript_language: item.language ?? null, transcript_source: item.source?.trim() || "external" };
  });
  if (!rows.length) return NextResponse.json({ error: "None of the Meta ad IDs exist in the imported catalog." }, { status: 404 });
  const { error } = await admin.from("meta_ad_transcript_mappings").upsert(rows, { onConflict: "mapping_key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  await admin.from("audit_logs").insert({ actor_id: profile.id, action: "mapped_meta_ad_transcripts", target_type: "meta_ad_transcript_mapping", metadata: { received: items.length, mapped: rows.length, unmatched: rows.filter((row) => !row.matched_ad_id).length } });
  return NextResponse.json({ mapped: rows.length, unmatched: rows.filter((row) => !row.matched_ad_id).length, skippedUnknownMetaAds: items.length - rows.length });
}
