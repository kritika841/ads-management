import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const payloadSchema = z.object({
  ids: z.array(z.string().trim().regex(/^\d+$/, "Every Meta ad ID must contain only numbers.")).min(1, "Select at least one ad.").max(5_000),
  outcome: z.enum(["unreviewed", "winner", "loser", "needs_iteration", "keep_testing"]).nullable()
});

export async function POST(request: NextRequest) {
  const profile = await requireRole(["admin", "manager"]);
  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Invalid ad outcome." }, { status: 400 });

  const ids = [...new Set(parsed.data.ids)];
  const outcome = parsed.data.outcome;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("meta_ads")
    .update({
      manual_outcome: outcome,
      manual_outcome_at: outcome ? new Date().toISOString() : null,
      manual_outcome_by: outcome ? profile.id : null
    })
    .in("id", ids)
    .select("id");
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });

  const count = data?.length ?? 0;
  if (count !== ids.length) return NextResponse.json({ ok: false, message: `Updated ${count} of ${ids.length} selected ads. Refresh and try again.` }, { status: 409 });
  await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: "updated_meta_ad_outcomes",
    target_type: "meta_ad",
    target_id: ids[0],
    metadata: { count, manual_outcome: outcome }
  });
  revalidatePath("/incentives");
  return NextResponse.json({ ok: true, count, outcome });
}
