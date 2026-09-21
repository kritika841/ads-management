"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const campaignSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  productId: z.string().uuid(),
  dailySubmissionTarget: z.number().int().min(1).max(100),
  targetCpa: z.number().positive().max(10_000_000),
  gateDays: z.number().int().min(1).max(30),
  winnerWindowDays: z.number().int().min(1).max(90),
  evaluationMode: z.enum(["cumulative", "daily"]),
  creatorIncentiveAmount: z.number().min(0).max(10_000_000),
  editorIncentiveAmount: z.number().min(0).max(10_000_000),
  startsOn: z.string().date(),
  endsOn: z.string().date().optional().or(z.literal("")),
  active: z.boolean(),
}).refine((value) => value.winnerWindowDays >= value.gateDays, {
  message: "The winner window must be at least as long as the initial gate.",
  path: ["winnerWindowDays"]
}).refine((value) => !value.endsOn || value.endsOn >= value.startsOn, {
  message: "The end date cannot be before the start date.",
  path: ["endsOn"]
});

const creativeSchema = z.object({
  campaignId: z.string().uuid(),
  adId: z.string().uuid(),
  metaAdId: z.string().trim().regex(/^\d+$/, "Meta ad ID must contain only numbers."),
  launchedOn: z.string().date()
});
const creativeBatchSchema = z.object({
  campaignId: z.string().uuid(),
  creatives: z.array(z.object({
    adId: z.string().uuid(),
    metaAdId: z.string().trim().regex(/^\d+$/, "Every Meta ad ID must contain only numbers."),
    launchedOn: z.string().date()
  })).min(1, "Add at least one creative.").max(100)
});

const decisionSchema = z.object({
  id: z.string().uuid(),
  decisionStatus: z.enum(["unreviewed", "winner", "loser", "needs_iteration", "keep_testing"]),
  note: z.string().trim().max(500).optional().or(z.literal("")),
  payoutStatus: z.enum(["not_ready", "pending", "approved", "paid"]).optional()
});
const bulkDecisionSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Select at least one tracked creative.").max(5_000),
  decisionStatus: z.enum(["unreviewed", "winner", "loser", "needs_iteration", "keep_testing"]),
  note: z.string().trim().max(500).optional().or(z.literal(""))
});
const metaAdOutcomeSchema = z.object({
  ids: z.array(z.string().trim().regex(/^\d+$/, "Every Meta ad ID must contain only numbers.")).min(1, "Select at least one ad.").max(5_000),
  outcome: z.enum(["unreviewed", "winner", "loser", "needs_iteration", "keep_testing"]).nullable()
});

function incentiveStatusForDecision(decisionStatus: z.infer<typeof decisionSchema>["decisionStatus"], payoutStatus?: z.infer<typeof decisionSchema>["payoutStatus"]) {
  if (payoutStatus === "paid") return "paid";
  if (payoutStatus === "approved") return "approved_for_payout";
  if (decisionStatus === "winner") return "eligible";
  if (decisionStatus === "loser") return "not_eligible";
  return "pending_testing";
}

export async function saveIncentiveCampaign(payload: z.input<typeof campaignSchema>) {
  const profile = await requireRole(["admin", "manager"]);
  const parsed = campaignSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid campaign." };

  const value = parsed.data;
  const patch = {
    name: value.name,
    product_id: value.productId,
    daily_submission_target: value.dailySubmissionTarget,
    target_cpa: value.targetCpa,
    gate_days: value.gateDays,
    winner_window_days: value.winnerWindowDays,
    evaluation_mode: value.evaluationMode,
    creator_incentive_amount: value.creatorIncentiveAmount,
    editor_incentive_amount: value.editorIncentiveAmount,
    starts_on: value.startsOn,
    ends_on: value.endsOn || null,
    active: value.active,
    created_by: profile.id
  };
  const admin = createSupabaseAdminClient();
  const { data, error } = value.id
    ? await admin.from("incentive_campaigns").update(patch).eq("id", value.id).select("id").single()
    : await admin.from("incentive_campaigns").insert(patch).select("id").single();
  if (error) return { ok: false, message: error.message };

  await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: value.id ? "updated_incentive_campaign" : "created_incentive_campaign",
    target_type: "incentive_campaign",
    target_id: data.id,
    metadata: patch
  });
  revalidatePath("/incentives");
  return { ok: true };
}

export async function deactivateIncentiveCampaign(id: string) {
  const profile = await requireRole(["admin"]);
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, message: "Invalid campaign." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("incentive_campaigns").update({ active: false }).eq("id", parsed.data);
  if (error) return { ok: false, message: error.message };
  await admin.from("audit_logs").insert({ actor_id: profile.id, action: "deactivated_incentive_campaign", target_type: "incentive_campaign", target_id: parsed.data, metadata: {} });
  revalidatePath("/incentives");
  return { ok: true };
}

export async function deleteIncentiveCampaign(id: string) {
  const profile = await requireRole(["admin"]);
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, message: "Invalid campaign." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("incentive_campaigns").delete().eq("id", parsed.data);
  if (error) return { ok: false, message: error.message };
  await admin.from("audit_logs").insert({ actor_id: profile.id, action: "deleted_incentive_campaign", target_type: "incentive_campaign", target_id: parsed.data, metadata: {} });
  revalidatePath("/incentives");
  return { ok: true };
}

export async function linkIncentiveCreative(payload: z.input<typeof creativeSchema>) {
  const profile = await requireProfile();
  const parsed = creativeSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid creative." };
  const value = parsed.data;
  const admin = createSupabaseAdminClient();
  const [{ data: campaign, error: campaignError }, { data: ad, error: adError }] = await Promise.all([
    admin.from("incentive_campaigns").select("id,product_id,starts_on,ends_on,active").eq("id", value.campaignId).maybeSingle(),
    admin.from("ads").select("id,name,product_id,creator_id,editor_id").eq("id", value.adId).maybeSingle()
  ]);
  if (campaignError || !campaign) return { ok: false, message: campaignError?.message ?? "Campaign not found." };
  if (adError || !ad) return { ok: false, message: adError?.message ?? "Creative not found." };
  const reviewer = profile.role === "admin" || profile.role === "manager";
  if (!reviewer && ad.creator_id !== profile.id) return { ok: false, message: "You can only submit your own creatives." };
  if (ad.product_id !== campaign.product_id) return { ok: false, message: "The creative product must match the campaign product." };
  if (value.launchedOn < campaign.starts_on || (campaign.ends_on && value.launchedOn > campaign.ends_on)) {
    return { ok: false, message: "Launch date must fall inside the campaign dates." };
  }

  const { error } = await admin.from("incentive_creatives").insert({
    incentive_campaign_id: value.campaignId,
    ad_id: value.adId,
    meta_ad_id: value.metaAdId,
    launched_on: value.launchedOn,
    creator_id: ad.creator_id,
    editor_id: ad.editor_id,
    attribution_source: "manual",
    created_by: profile.id
  });
  if (error) return { ok: false, message: error.code === "23505" ? "This creative or Meta ad is already linked to the campaign." : error.message };

  await admin.from("audit_logs").insert({ actor_id: profile.id, action: "linked_incentive_creative", target_type: "ad", target_id: ad.id, metadata: { incentive_campaign_id: campaign.id, meta_ad_id: value.metaAdId } });
  revalidatePath("/incentives");
  return { ok: true };
}

export async function linkIncentiveCreatives(payload: z.input<typeof creativeBatchSchema>) {
  const profile = await requireProfile();
  const parsed = creativeBatchSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid creatives." };
  const { campaignId, creatives } = parsed.data;
  const uniqueAds = new Set(creatives.map((item) => item.adId));
  const uniqueMetaAds = new Set(creatives.map((item) => item.metaAdId));
  if (uniqueAds.size !== creatives.length) return { ok: false, message: "Each creative can only appear once in this batch." };
  if (uniqueMetaAds.size !== creatives.length) return { ok: false, message: "Each creative needs a different Meta ad ID." };

  const admin = createSupabaseAdminClient();
  const [{ data: campaign, error: campaignError }, { data: ads, error: adsError }] = await Promise.all([
    admin.from("incentive_campaigns").select("id,product_id,starts_on,ends_on,active").eq("id", campaignId).maybeSingle(),
    admin.from("ads").select("id,name,product_id,creator_id,editor_id").in("id", [...uniqueAds])
  ]);
  if (campaignError || !campaign) return { ok: false, message: campaignError?.message ?? "Campaign not found." };
  if (adsError) return { ok: false, message: adsError.message };
  if ((ads ?? []).length !== creatives.length) return { ok: false, message: "One or more creatives could not be found." };

  const reviewer = profile.role === "admin" || profile.role === "manager";
  for (const ad of ads ?? []) {
    if (!reviewer && ad.creator_id !== profile.id) return { ok: false, message: "You can only submit your own creatives." };
    if (ad.product_id !== campaign.product_id) return { ok: false, message: `“${ad.name}” does not match the campaign product.` };
  }
  for (const creative of creatives) {
    if (creative.launchedOn < campaign.starts_on || (campaign.ends_on && creative.launchedOn > campaign.ends_on)) {
      return { ok: false, message: "Every launch date must fall inside the campaign dates." };
    }
  }

  const adById = new Map((ads ?? []).map((ad) => [ad.id, ad]));
  const { error } = await admin.from("incentive_creatives").insert(creatives.map((creative) => {
    const ad = adById.get(creative.adId)!;
    return {
      incentive_campaign_id: campaignId,
      ad_id: creative.adId,
      meta_ad_id: creative.metaAdId,
      launched_on: creative.launchedOn,
      creator_id: ad.creator_id,
      editor_id: ad.editor_id,
      attribution_source: "manual",
      created_by: profile.id
    };
  }));
  if (error) return { ok: false, message: error.code === "23505" ? "A selected creative or Meta ad is already linked to this campaign." : error.message };

  await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: "linked_incentive_creatives",
    target_type: "incentive_campaign",
    target_id: campaignId,
    metadata: { count: creatives.length, ad_ids: creatives.map((item) => item.adId) }
  });
  revalidatePath("/incentives");
  return { ok: true, count: creatives.length };
}

export async function removeIncentiveCreative(id: string) {
  const profile = await requireRole(["admin", "manager"]);
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, message: "Invalid tracking record." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("incentive_creatives").delete().eq("id", parsed.data);
  if (error) return { ok: false, message: error.message };
  await admin.from("audit_logs").insert({ actor_id: profile.id, action: "removed_incentive_creative", target_type: "incentive_creative", target_id: parsed.data, metadata: {} });
  revalidatePath("/incentives");
  return { ok: true };
}

export async function updateIncentiveDecision(payload: z.input<typeof decisionSchema>) {
  const profile = await requireRole(["admin", "manager"]);
  const parsed = decisionSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid decision." };
  const value = parsed.data;
  const admin = createSupabaseAdminClient();
  const { data: creative, error: creativeError } = await admin
    .from("incentive_creatives")
    .select("id")
    .eq("id", value.id)
    .maybeSingle();
  if (creativeError || !creative) return { ok: false, message: creativeError?.message ?? "Incentive creative not found." };
  const incentiveStatus = incentiveStatusForDecision(value.decisionStatus, value.payoutStatus);
  const { error } = await admin.from("incentive_creatives").update({ decision_status: value.decisionStatus, decision_source: "manual", decision_note: value.note || null, decided_at: new Date().toISOString(), decided_by: profile.id, payout_status: value.payoutStatus ?? "not_ready", incentive_status: incentiveStatus }).eq("id", value.id);
  if (error) return { ok: false, message: error.message };
  await admin.from("audit_logs").insert({ actor_id: profile.id, action: "updated_incentive_decision", target_type: "incentive_creative", target_id: value.id, metadata: value });
  revalidatePath("/incentives");
  return { ok: true };
}

export async function updateIncentiveDecisions(payload: z.input<typeof bulkDecisionSchema>) {
  const profile = await requireRole(["admin", "manager"]);
  const parsed = bulkDecisionSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid bulk decision." };

  const value = parsed.data;
  const ids = [...new Set(value.ids)];
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("incentive_creatives")
    .update({
      decision_status: value.decisionStatus,
      decision_source: "manual",
      decision_note: value.note || null,
      decided_at: now,
      decided_by: profile.id,
      payout_status: "not_ready",
      incentive_status: incentiveStatusForDecision(value.decisionStatus)
    })
    .in("id", ids)
    .select("id");
  if (error) return { ok: false, message: error.message };

  await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: "bulk_updated_incentive_decisions",
    target_type: "incentive_creative",
    target_id: ids[0],
    metadata: { count: data?.length ?? 0, decision_status: value.decisionStatus, note: value.note || null }
  });
  revalidatePath("/incentives");
  return { ok: true, count: data?.length ?? 0 };
}

export async function updateMetaAdOutcomes(payload: z.input<typeof metaAdOutcomeSchema>) {
  const profile = await requireRole(["admin", "manager"]);
  const parsed = metaAdOutcomeSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid ad outcome." };

  const value = parsed.data;
  const ids = [...new Set(value.ids)];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("meta_ads")
    .update({
      manual_outcome: value.outcome,
      manual_outcome_at: value.outcome ? new Date().toISOString() : null,
      manual_outcome_by: value.outcome ? profile.id : null
    })
    .in("id", ids)
    .select("id");
  if (error) return { ok: false, message: error.message };

  await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: "updated_meta_ad_outcomes",
    target_type: "meta_ad",
    target_id: ids[0],
    metadata: { count: data?.length ?? 0, manual_outcome: value.outcome }
  });
  revalidatePath("/incentives");
  return { ok: true, count: data?.length ?? 0 };
}

const campaignDestinationSchema = z.object({
  campaignId: z.string().trim().min(1, "Campaign ID is required."),
  campaignName: z.string().trim().optional().or(z.literal("")),
  destination: z.enum(["default", "testing", "winner", "loser"])
});

export async function updateCampaignDestination(payload: z.input<typeof campaignDestinationSchema>) {
  await requireRole(["admin"]);
  const parsed = campaignDestinationSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid campaign destination." };

  const { campaignId, campaignName, destination } = parsed.data;
  const { saveCampaignDestinationRecord } = await import("@/lib/campaign-destinations");
  const profile = await requireProfile();

  saveCampaignDestinationRecord({
    campaignId,
    campaignName: campaignName || null,
    destination,
    updatedAt: new Date().toISOString(),
    updatedBy: profile.id
  });

  const admin = createSupabaseAdminClient();
  let outcome: "winner" | "loser" | "keep_testing" | null = null;
  if (destination === "winner") outcome = "winner";
  else if (destination === "loser") outcome = "loser";
  else if (destination === "testing") outcome = "keep_testing";
  else outcome = null;

  const now = new Date().toISOString();
  await admin
    .from("meta_ads")
    .update({
      manual_outcome: outcome,
      manual_outcome_at: outcome ? now : null,
      manual_outcome_by: outcome ? profile.id : null
    })
    .eq("campaign_id", campaignId);

  await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: "updated_campaign_destination",
    target_type: "meta_campaign",
    target_id: campaignId,
    metadata: { campaign_name: campaignName, destination, manual_outcome: outcome }
  });

  revalidatePath("/incentives");
  return { ok: true, destination };
}
