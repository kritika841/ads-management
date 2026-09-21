import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { matchTranscriptToScripts } from "@/lib/transcript-matching";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const profile = await requireRole(["admin", "manager"]);
  const admin = createSupabaseAdminClient();
  const [{ data: scripts, error: scriptsError }, { data: mappings, error: mappingsError }] = await Promise.all([
    admin.from("ads").select("id,script_text").eq("production_stage", "approved").not("script_text", "is", null),
    admin.from("meta_ad_transcript_mappings").select("mapping_key,transcript,transcript_source").eq("transcript_status", "available").not("transcript", "is", null).limit(500)
  ]);
  if (scriptsError || mappingsError) return NextResponse.json({ error: scriptsError?.message ?? mappingsError?.message }, { status: 502 });

  const candidates = scripts ?? [];
  const updates = (mappings ?? [])
    .filter((mapping) => mapping.transcript_source !== "exact_creative_id")
    .map((mapping) => {
      const match = matchTranscriptToScripts(mapping.transcript!, candidates);
      return {
        mapping_key: mapping.mapping_key,
        matched_ad_id: match.adId,
        match_score: match.score,
        match_confidence: match.confidence,
        matched_tokens: match.matchedTokens,
        transcript_token_count: match.transcriptTokens,
        script_token_count: match.scriptTokens,
        mapped_at: new Date().toISOString()
      };
    });
  if (updates.length) {
    for (let index = 0; index < updates.length; index += 25) {
      const results = await Promise.all(updates.slice(index, index + 25).map(({ mapping_key, ...patch }) => admin.from("meta_ad_transcript_mappings").update(patch).eq("mapping_key", mapping_key)));
      const error = results.find((result) => result.error)?.error;
      if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    }
  }
  const matched = updates.filter((row) => row.matched_ad_id).length;
  await admin.from("audit_logs").insert({ actor_id: profile.id, action: "rematched_deepgram_transcripts", target_type: "meta_ad_transcript_mapping", metadata: { reviewed: updates.length, matched, approved_script_candidates: candidates.length } });
  return NextResponse.json({ reviewed: updates.length, matched, approvedScripts: candidates.length });
}
