import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { matchAdFlowCreative, type AutoMatchAd } from "@/lib/incentive-auto-match";
import { evaluateIncentiveCreativeBackfill, isDiscontinuedMetaStatus, type IncentiveCampaign, type IncentiveDailyMetric } from "@/lib/incentives";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const profile = await requireRole(["admin", "manager"]);
  const admin = createSupabaseAdminClient();
  const classifiedAt = new Date().toISOString();
  const [{ data: creatives, error: creativeError }, { data: metaAds, error: metaError }, { data: ads, error: adsError }, { data: campaigns, error: campaignError }, { data: transcriptMappings, error: transcriptMappingError }] = await Promise.all([
    admin.from("incentive_creatives").select("id,meta_ad_id,launched_on,decision_source,decision_note,campaign:incentive_campaigns(*),metrics:incentive_daily_metrics(*)"),
    admin.from("meta_ads").select("id,name,campaign_id,status,effective_status,created_time,matched_ad_id,detected_tag"),
    admin.from("ads").select("id,name,product_id,creator_id,editor_id,product:products(name)").not("product_id", "is", null),
    admin.from("incentive_campaigns").select("id,product_id,starts_on,ends_on,active,meta_campaign_ids,product:products(name)").eq("active", true),
    admin.from("meta_ad_transcript_mappings").select("meta_ad_id,matched_ad_id").not("matched_ad_id", "is", null)
  ]);
  if (creativeError) return NextResponse.json({ error: creativeError.message }, { status: 500 });
  if (metaError) return NextResponse.json({ error: metaError.message }, { status: 500 });
  if (adsError) return NextResponse.json({ error: adsError.message }, { status: 500 });
  if (campaignError) return NextResponse.json({ error: campaignError.message }, { status: 500 });
  if (transcriptMappingError) return NextResponse.json({ error: transcriptMappingError.message }, { status: 500 });

  const metaById = new Map((metaAds ?? []).map((ad) => [ad.id, ad]));
  let mappedCandidates = 0;
  let pricingPasses = 0;
  let linked = 0;
  let unmatchedInternal = 0;
  let ambiguousCampaign = 0;
  let unmappedCampaign = 0;
  const adById = new Map((ads ?? []).map((ad) => [ad.id, ad]));
  const transcriptMatchByMetaId = new Map((transcriptMappings ?? []).map((mapping) => [mapping.meta_ad_id, mapping.matched_ad_id]));
  // A mapping is the identity proof that lets a Meta delivery row participate
  // in an incentive outcome. Name/tag heuristics can create a tracked row, but
  // can never by themselves award a winner.
  const reliablyMappedMetaIds = new Set([
    ...(metaAds ?? []).filter((ad) => ad.matched_ad_id).map((ad) => ad.id),
    ...(transcriptMappings ?? []).map((mapping) => mapping.meta_ad_id)
  ]);
  const matchableAds = (ads ?? []) as AutoMatchAd[];
  const campaignByProduct = new Map<string, typeof campaigns>();
  for (const campaign of campaigns ?? []) campaignByProduct.set(campaign.product_id, [...(campaignByProduct.get(campaign.product_id) ?? []), campaign]);
  const linkedMetaIds = new Set((creatives ?? []).map((creative) => creative.meta_ad_id));
  const linksToCreate = (metaAds ?? []).flatMap((meta) => {
    if (linkedMetaIds.has(meta.id)) return [];
    const mappedCampaigns = (campaigns ?? []).filter((campaign) => campaign.meta_campaign_ids?.includes(meta.campaign_id ?? ""));
    const matchedAdId = meta.matched_ad_id ?? transcriptMatchByMetaId.get(meta.id);
    const matched = matchedAdId
      ? adById.get(matchedAdId)
      : matchAdFlowCreative(meta.name ?? "", meta.detected_tag, matchableAds)?.ad;
    const ad = matched;
    if (!ad) { unmatchedInternal++; return []; }
    // Campaign IDs are optional for backfill. When they are absent, infer the
    // CPA campaign from the matched AdFlow creative's product. An explicit
    // Meta mapping still wins when one has been configured.
    const exactProductMatches = campaignByProduct.get(ad.product_id) ?? [];
    // Historical Creative Library product names predate the incentive product
    // catalog for these two product families. Keep these aliases intentionally
    // narrow: they permit a known historical name, not fuzzy product matching.
    const aliasMatches = (campaigns ?? []).filter((campaign) => matchesIncentiveProduct(campaign, ad as { product?: { name?: string | null } | Array<{ name?: string | null }> | null }));
    // Product identity is more specific than a Meta campaign association: the
    // same Meta campaign can carry ads for several incentive products.
    const matches = exactProductMatches.length ? exactProductMatches : aliasMatches.length ? aliasMatches : mappedCampaigns;
    if (!matches.length) { unmappedCampaign++; return []; }
    mappedCandidates++;
    if (matches.length !== 1) { ambiguousCampaign++; return []; }
    const campaign = matches[0];
    return [{ incentive_campaign_id: campaign.id, ad_id: ad.id, meta_ad_id: meta.id, launched_on: meta.created_time?.slice(0, 10) ?? campaign.starts_on, creator_id: ad.creator_id, editor_id: ad.editor_id, attribution_source: "auto", auto_matched_at: classifiedAt, created_by: profile.id }];
  });
  if (linksToCreate.length) {
    const { data: createdLinks, error } = await admin.from("incentive_creatives").insert(linksToCreate).select("id,meta_ad_id");
    if (error && error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
    if (createdLinks?.length) {
      linked += createdLinks.length;
      const { data: sourceMetrics } = await admin.from("meta_ad_daily_metrics").select("meta_ad_id,metric_date,spend,impressions,reach,clicks,link_clicks,purchases,revenue").in("meta_ad_id", createdLinks.map((link) => link.meta_ad_id));
      const linkIdByMeta = new Map(createdLinks.map((link) => [link.meta_ad_id, link.id]));
      const metrics = (sourceMetrics ?? []).map((metric) => ({ ...metric, incentive_creative_id: linkIdByMeta.get(metric.meta_ad_id) })).filter((metric) => metric.incentive_creative_id).map(({ meta_ad_id: _metaAdId, ...metric }) => metric);
      if (metrics.length) await admin.from("incentive_daily_metrics").upsert(metrics, { onConflict: "incentive_creative_id,metric_date" });
    }
  }
  let winners = 0;
  let losers = 0;
  let skippedManual = 0;
  const { data: refreshedCreatives, error: refreshedError } = linksToCreate.length
    ? await admin.from("incentive_creatives").select("id,meta_ad_id,launched_on,decision_source,decision_note,campaign:incentive_campaigns(*),metrics:incentive_daily_metrics(*)")
    : { data: creatives, error: null };
  if (refreshedError) return NextResponse.json({ error: refreshedError.message }, { status: 500 });
  for (const raw of refreshedCreatives ?? []) {
    if (raw.decision_source === "manual") { skippedManual++; continue; }
    const campaign = Array.isArray(raw.campaign) ? raw.campaign[0] : raw.campaign;
    if (!campaign) continue;
    const evaluation = evaluateIncentiveCreativeBackfill(campaign as IncentiveCampaign, raw.launched_on, (raw.metrics ?? []) as IncentiveDailyMetric[]);
    const meta = metaById.get(raw.meta_ad_id);
    const discontinued = isDiscontinuedMetaStatus(meta?.effective_status ?? meta?.status);
    const hasReliableMapping = reliablyMappedMetaIds.has(raw.meta_ad_id);
    const isMappedWinner = hasReliableMapping && evaluation.passesPricingCriteria;
    const isLosingCreative = hasReliableMapping && !evaluation.passesPricingCriteria && (discontinued || historicalWindowHasElapsed(raw.launched_on, campaign as IncentiveCampaign));
    if (hasReliableMapping && evaluation.passesPricingCriteria) pricingPasses++;
    if (!isMappedWinner && !isLosingCreative) {
      if (hasReliableMapping) {
        const { error } = await admin.from("incentive_creatives").update({ latest_cpa: evaluation.cpa, latest_spend: evaluation.spend, latest_purchases: evaluation.purchases, last_synced_at: classifiedAt }).eq("id", raw.id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      continue;
    }
    const decisionStatus = isMappedWinner ? "winner" : "loser";
    const { error } = await admin.from("incentive_creatives").update({
      decision_status: decisionStatus,
      evaluation_status: isMappedWinner ? "winner" : "failed",
      incentive_status: isMappedWinner ? "eligible" : "not_eligible",
      latest_cpa: evaluation.cpa,
      latest_spend: evaluation.spend,
      latest_purchases: evaluation.purchases,
      decision_source: "automatic",
      backfill_classified_at: classifiedAt,
      decision_note: `Backfilled ${classifiedAt}: ${evaluation.observedDays} observed day${evaluation.observedDays === 1 ? "" : "s"}; testing-day gate ignored.`
    }).eq("id", raw.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (isMappedWinner) winners++; else losers++;
  }
  await admin.from("audit_logs").insert({ actor_id: profile.id, action: "backfilled_incentive_outcomes", target_type: "incentive_campaign", metadata: { winners, losers, skipped_manual: skippedManual } });
  return NextResponse.json({ winners, losers, skippedManual, linked, mappedCandidates, pricingPasses, unmatchedInternal, ambiguousCampaign, unmappedCampaign });
}

function matchesIncentiveProduct(campaign: { product?: { name?: string | null } | Array<{ name?: string | null }> | null }, ad: { product?: { name?: string | null } | Array<{ name?: string | null }> | null }) {
  const campaignProduct = normalizeProductName(Array.isArray(campaign.product) ? campaign.product[0]?.name : campaign.product?.name);
  const creativeProduct = normalizeProductName(Array.isArray(ad.product) ? ad.product[0]?.name : ad.product?.name);
  if (campaignProduct === "trial box") return creativeProduct === "trial pack incense" || creativeProduct === "trial pack";
  return campaignProduct === "incense stick" && creativeProduct.includes("incense stick") && !creativeProduct.includes("pack of 3");
}

function normalizeProductName(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function historicalWindowHasElapsed(launchedOn: string, campaign: Pick<IncentiveCampaign, "gate_days" | "winner_window_days">) {
  const windowEnd = new Date(`${launchedOn}T00:00:00Z`);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + Number(campaign.gate_days) + Number(campaign.winner_window_days) - 1);
  return windowEnd.getTime() < Date.now();
}
