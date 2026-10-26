import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type ReviewRequest = { mappingKey?: string; action?: "approve" | "reject" };

/** Manual reviewer decision for an AI transcript → Creative Library match. */
export async function POST(request: Request) {
  const profile = await requireRole(["admin", "manager"]);
  const body = (await request.json().catch(() => ({}))) as ReviewRequest;
  if (!body.mappingKey || (body.action !== "approve" && body.action !== "reject")) {
    return NextResponse.json({ error: "mappingKey and action (approve | reject) are required." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: mapping, error } = await admin
    .from("meta_ad_transcript_mappings")
    .select("mapping_key,meta_ad_id,matched_ad_id")
    .eq("mapping_key", body.mappingKey)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  if (!mapping) return NextResponse.json({ error: "Mapping not found." }, { status: 404 });

  const now = new Date().toISOString();
  if (body.action === "approve") {
    if (!mapping.matched_ad_id) return NextResponse.json({ error: "There is no suggested Creative Library match to approve." }, { status: 400 });
    const { data: ad } = await admin.from("ads").select("id,creator_id,editor_id").eq("id", mapping.matched_ad_id).maybeSingle();
    if (!ad) return NextResponse.json({ error: "The matched creative no longer exists." }, { status: 404 });

    const { error: updateError } = await admin
      .from("meta_ad_transcript_mappings")
      .update({ review_status: "confirmed_match", reviewed_at: now, match_confidence: "high" })
      .eq("mapping_key", mapping.mapping_key);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 502 });

    // Attribution lives on the creative (video) row. Ad-level attribution is only valid when the Meta ad contains a single creative.
    const { count: creativeCount } = await admin.from("meta_ad_transcript_mappings").select("mapping_key", { count: "exact", head: true }).eq("meta_ad_id", mapping.meta_ad_id);
    if ((creativeCount ?? 1) <= 1) {
      const { error: attributionError } = await admin
        .from("meta_ads")
        .update({ matched_ad_id: ad.id, matched_creator_id: ad.creator_id ?? null, matched_editor_id: ad.editor_id ?? null, auto_matched_at: now })
        .eq("id", mapping.meta_ad_id);
      if (attributionError) return NextResponse.json({ error: attributionError.message }, { status: 502 });
    }
  } else {
    const { error: updateError } = await admin
      .from("meta_ad_transcript_mappings")
      .update({ review_status: "confirmed_unmatched", reviewed_at: now, matched_ad_id: null, match_confidence: "unmatched" })
      .eq("mapping_key", mapping.mapping_key);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 502 });
    if (mapping.matched_ad_id) await admin.from("meta_ads").update({ matched_ad_id: null, matched_creator_id: null, matched_editor_id: null, auto_matched_at: null }).eq("id", mapping.meta_ad_id).eq("matched_ad_id", mapping.matched_ad_id);
  }

  await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: body.action === "approve" ? "approved_transcript_match" : "rejected_transcript_match",
    target_type: "meta_ad_transcript_mapping",
    metadata: { mapping_key: mapping.mapping_key, meta_ad_id: mapping.meta_ad_id, matched_ad_id: mapping.matched_ad_id }
  });
  return NextResponse.json({ ok: true, reviewStatus: body.action === "approve" ? "confirmed_match" : "confirmed_unmatched" });
}
