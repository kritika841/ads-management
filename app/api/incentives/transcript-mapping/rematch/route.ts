import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { matchTranscriptSemantically } from "@/lib/semantic-transcript-matcher";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const profile = await requireRole(["admin", "manager"]);
  const admin = createSupabaseAdminClient();
  const [{ data: scripts, error: scriptsError }, { data: mappings, error: mappingsError }] = await Promise.all([
    admin.from("ads").select("id,name,script_text,creator_id,editor_id,product_id").eq("production_stage", "approved").not("script_text", "is", null),
    admin.from("meta_ad_transcript_mappings").select("mapping_key,meta_ad_id,transcript,transcript_source").eq("transcript_status", "available").not("transcript", "is", null).limit(5000)
  ]);
  if (scriptsError || mappingsError) return NextResponse.json({ error: scriptsError?.message ?? mappingsError?.message }, { status: 502 });

  const candidates = scripts ?? [];
  const scriptMap = new Map(candidates.map((s) => [s.id, s]));
  const updates = (mappings ?? [])
    .filter((mapping) => mapping.transcript_source !== "exact_creative_id")
    .map((mapping) => {
      const match = matchTranscriptSemantically(mapping.transcript!, candidates);
      return {
        mapping_key: mapping.mapping_key,
        meta_ad_id: mapping.meta_ad_id,
        matched_ad_id: match.adId,
        match_score: match.score,
        match_confidence: match.confidence,
        matched_tokens: match.matchedTokens,
        transcript_token_count: match.transcriptTokens,
        script_token_count: match.scriptTokens,
        transcript_source: match.adId ? "ai_semantic_match" : mapping.transcript_source,
        review_note: match.rationale,
        mapped_at: new Date().toISOString()
      };
    });
  if (updates.length) {
    for (let index = 0; index < updates.length; index += 25) {
      const chunk = updates.slice(index, index + 25);
      const results = await Promise.all(chunk.map(({ mapping_key, meta_ad_id, ...patch }) => admin.from("meta_ad_transcript_mappings").update(patch).eq("mapping_key", mapping_key)));
      const error = results.find((result) => result.error)?.error;
      if (error) return NextResponse.json({ error: error.message }, { status: 502 });

      // Update meta_ads for high confidence matches
      const highMatches = chunk.filter((c) => c.match_confidence === "high" && c.matched_ad_id);
      for (const hm of highMatches) {
        const matchedScript = hm.matched_ad_id ? scriptMap.get(hm.matched_ad_id) : undefined;
        await admin.from("meta_ads").update({
          matched_ad_id: hm.matched_ad_id,
          matched_creator_id: matchedScript?.creator_id ?? null,
          matched_editor_id: matchedScript?.editor_id ?? null,
          auto_matched_at: new Date().toISOString()
        }).eq("id", hm.meta_ad_id);
      }
    }
  }
  const matched = updates.filter((row) => row.matched_ad_id).length;
  await admin.from("audit_logs").insert({ actor_id: profile.id, action: "rematched_deepgram_transcripts", target_type: "meta_ad_transcript_mapping", metadata: { reviewed: updates.length, matched, approved_script_candidates: candidates.length } });
  return NextResponse.json({ reviewed: updates.length, matched, approvedScripts: candidates.length });
}
