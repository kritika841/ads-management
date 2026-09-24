import { getCampaignDestinations } from "@/lib/campaign-destinations";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readMetricVisibilityFile } from "@/lib/metric-visibility-server";
import type { Profile } from "@/lib/types";
import type { IncentiveCampaign, IncentiveCreative, MetaAd } from "@/lib/incentives";

export async function getIncentiveDashboard(profile: Profile) {
  const admin = createSupabaseAdminClient();
  const visibilityConfig = await readMetricVisibilityFile();
  const managerScope = visibilityConfig.manager_creative_scope ?? "all";
  const isManagerScoped = profile.role === "manager" && managerScope === "own";
  const isScoped = profile.role === "content_creator" || profile.role === "editor" || isManagerScoped;
  const reviewer = profile.role === "admin" || (profile.role === "manager" && !isManagerScoped);

  let creativesQuery = admin
    .from("incentive_creatives")
    .select(`
      *,
      campaign:incentive_campaigns(*,product:products(id,name,sku)),
      creator:profiles!incentive_creatives_creator_id_fkey(id,name),
      editor:profiles!incentive_creatives_editor_id_fkey(id,name),
      ad:ads(id,name,creator_id,editor_id,thumbnail_url,preview_url,drive_file_id,resolved_video_url,
        creator:profiles!ads_creator_id_fkey(id,name),
        editor:profiles!ads_editor_id_fkey(id,name)),
      metrics:incentive_daily_metrics(*)
    `)
    .order("created_at", { ascending: false });

  let userAds: Array<{
    id: string;
    name: string;
    product_id: string | null;
    creator_id: string | null;
    editor_id: string | null;
    thumbnail_url: string | null;
    drive_file_id: string | null;
    preview_url: string | null;
    resolved_video_url: string | null;
    status: string;
    production_stage: string;
    creator: { id: string; name: string } | null;
    editor: { id: string; name: string } | null;
  }> = [];

  if (isScoped) {
    let userAdsQuery = admin
      .from("ads")
      .select("id,name,product_id,creator_id,editor_id,thumbnail_url,drive_file_id,preview_url,resolved_video_url,status,production_stage,creator:profiles!ads_creator_id_fkey(id,name),editor:profiles!ads_editor_id_fkey(id,name)");

    if (profile.role === "content_creator") {
      userAdsQuery = userAdsQuery.eq("creator_id", profile.id);
    } else if (profile.role === "editor") {
      userAdsQuery = userAdsQuery.eq("editor_id", profile.id);
    } else if (profile.role === "manager") {
      userAdsQuery = userAdsQuery.or(`creator_id.eq.${profile.id},editor_id.eq.${profile.id}`);
    }

    const { data: adsData, error: adsError } = await userAdsQuery;
    if (adsError) throw adsError;
    userAds = (adsData ?? []).map((ad) => ({
      ...ad,
      creator: Array.isArray(ad.creator) ? ad.creator[0] ?? null : ad.creator,
      editor: Array.isArray(ad.editor) ? ad.editor[0] ?? null : ad.editor
    }));

    const userAdIds = userAds.map((ad) => ad.id);
    if (profile.role === "content_creator") {
      if (userAdIds.length) {
        creativesQuery = creativesQuery.or(`creator_id.eq.${profile.id},ad_id.in.(${userAdIds.join(",")})`);
      } else {
        creativesQuery = creativesQuery.eq("creator_id", profile.id);
      }
    } else if (profile.role === "editor") {
      if (userAdIds.length) {
        creativesQuery = creativesQuery.or(`editor_id.eq.${profile.id},ad_id.in.(${userAdIds.join(",")})`);
      } else {
        creativesQuery = creativesQuery.eq("editor_id", profile.id);
      }
    } else if (profile.role === "manager") {
      if (userAdIds.length) {
        creativesQuery = creativesQuery.or(`creator_id.eq.${profile.id},editor_id.eq.${profile.id},ad_id.in.(${userAdIds.join(",")})`);
      } else {
        creativesQuery = creativesQuery.or(`creator_id.eq.${profile.id},editor_id.eq.${profile.id}`);
      }
    }
  }

  const [campaignResult, creativeResult, allAdsResult, metaAdsResult, transcriptMappingsResult] = await Promise.all([
    admin.from("incentive_campaigns").select("*,product:products(id,name,sku)").order("created_at", { ascending: false }),
    creativesQuery,
    admin.from("ads").select("id,name,product_id,creator_id,editor_id,thumbnail_url,drive_file_id,preview_url,resolved_video_url,status,production_stage,creator:profiles!ads_creator_id_fkey(id,name),editor:profiles!ads_editor_id_fkey(id,name)").order("created_at", { ascending: false }),
    loadMetaAds(admin),
    admin.from("meta_ad_transcript_mappings").select("mapping_key,meta_ad_id,meta_creative_id,meta_video_id,transcript,transcript_language,transcript_language_confidence,transcript_source,transcript_status,transcript_error,review_status,reviewed_at,review_note,matched_ad_id,match_score,match_confidence,matched_tokens,transcript_token_count,script_token_count,mapped_at,ad:ads!meta_ad_transcript_mappings_matched_ad_id_fkey(id,name,creator_id,editor_id,script_text,thumbnail_url,preview_url,drive_file_id,drive_url,resolved_video_url,product:products(name))").order("mapped_at", { ascending: false })
  ]);

  if (campaignResult.error) throw campaignResult.error;
  if (creativeResult.error) throw creativeResult.error;
  if (allAdsResult.error) throw allAdsResult.error;
  if (metaAdsResult.error) throw metaAdsResult.error;
  if (transcriptMappingsResult.error) throw transcriptMappingsResult.error;

  const allAdsData = (allAdsResult.data ?? []).map((ad) => ({
    ...ad,
    creator: Array.isArray(ad.creator) ? ad.creator[0] ?? null : ad.creator,
    editor: Array.isArray(ad.editor) ? ad.editor[0] ?? null : ad.editor
  }));
  const eligibleAds = allAdsData;
  const allAdsById = new Map(allAdsData.map((ad) => [ad.id, ad]));

  const highConfidenceTranscriptMap = new Map<string, typeof transcriptMappingsResult.data[0]>();
  for (const mapping of transcriptMappingsResult.data ?? []) {
    if (mapping.match_confidence === "high" && mapping.matched_ad_id) {
      if (!highConfidenceTranscriptMap.has(mapping.meta_ad_id)) {
        highConfidenceTranscriptMap.set(mapping.meta_ad_id, mapping);
      }
    }
  }

  const userAdIds = new Set(userAds.map((a) => a.id));
  const userAdNames = new Set(
    userAds.map((a) => a.name.trim().toUpperCase()).filter(Boolean)
  );

  // Filter meta ads for scoped roles so users only see their matching ads
  const rawMetaAds = (metaAdsResult.data ?? []).map((ad) => {
    const highMatch = highConfidenceTranscriptMap.get(ad.id);
    const matchedAdId = ad.matched_ad_id || highMatch?.matched_ad_id || null;
    const dbAd = matchedAdId ? allAdsById.get(matchedAdId) : null;
    const highMatchAd = Array.isArray(highMatch?.ad) ? highMatch?.ad[0] : highMatch?.ad;
    const matchedCreatorId = ad.matched_creator_id || highMatchAd?.creator_id || dbAd?.creator_id || null;
    const matchedEditorId = ad.matched_editor_id || highMatchAd?.editor_id || dbAd?.editor_id || null;
    const matchedCreativeName = dbAd?.name || highMatchAd?.name || null;
    const matchConfidence = highMatch ? "high" : ad.matched_ad_id ? "high" : null;

    return {
      ...ad,
      matched_ad_id: matchedAdId,
      matched_creator_id: matchedCreatorId,
      matched_editor_id: matchedEditorId,
      matched_creative_name: matchedCreativeName,
      match_confidence: matchConfidence,
      spend: Number(ad.spend),
      purchases: Number(ad.purchases),
      revenue: Number(ad.revenue),
      cpa: numberOrNull(ad.cpa),
      daily_metrics: (ad.daily_metrics ?? []).map(normalizeMetric),
      assets: (ad.assets ?? []).map((asset: Record<string, unknown>) => ({
        ...asset,
        daily_metrics: (asset.daily_metrics as Record<string, unknown>[] ?? []).map(normalizeMetric)
      }))
    };
  }) as MetaAd[];

  const metaAds = !isScoped
    ? rawMetaAds
    : rawMetaAds
        .map((ad) => {
          // If ad has multiple media assets, filter to only those belonging to this user
          if (ad.assets && ad.assets.length > 1) {
            const userAssets = ad.assets.filter((asset) => {
              const assetName = (asset.asset_label || "").toUpperCase();
              return [...userAdNames].some((name) => assetName.includes(name));
            });
            if (userAssets.length > 0) {
              return { ...ad, assets: userAssets };
            }
          }
          return ad;
        })
        .filter((ad) => {
          // Direct ID mapping to user's authored/edited creative
          if (ad.matched_ad_id && userAdIds.has(ad.matched_ad_id)) return true;
          if ((profile.role === "content_creator" || profile.role === "manager") && ad.matched_creator_id === profile.id) return true;
          if ((profile.role === "editor" || profile.role === "manager") && ad.matched_editor_id === profile.id) return true;

          // Tag matching on detected tag (only if it matches user's creative tag)
          if (ad.detected_tag && userAdNames.has(ad.detected_tag.toUpperCase())) return true;

          // Tag matching strictly on creative name (NOT ad name)
          if (ad.creative_name) {
            const upperCreativeName = ad.creative_name.toUpperCase();
            for (const name of userAdNames) {
              if (upperCreativeName.includes(name)) return true;
            }
          }

          // Tag matching on child media asset breakdown names (e.g. TAM0173.mp4)
          if (ad.assets?.length) {
            for (const asset of ad.assets) {
              const assetName = (asset.asset_label || "").toUpperCase();
              for (const name of userAdNames) {
                if (assetName.includes(name)) return true;
              }
            }
          }

          return false;
        });

  const campaignDestinations = getCampaignDestinations();
  const matchedMetaAdIds = new Set(metaAds.map((ad) => ad.id));

  const userCreativeList = (creativeResult.data ?? []).filter((creative) => {
    if (!isScoped) return true;
    if (creative.meta_ad_id && matchedMetaAdIds.has(creative.meta_ad_id)) return true;
    if (profile.role === "content_creator") {
      return (
        creative.creator_id === profile.id ||
        (creative.ad && creative.ad.creator_id === profile.id) ||
        (creative.ad_id && userAdIds.has(creative.ad_id))
      );
    }
    if (profile.role === "editor") {
      return (
        creative.editor_id === profile.id ||
        (creative.ad && creative.ad.editor_id === profile.id) ||
        (creative.ad_id && userAdIds.has(creative.ad_id))
      );
    }
    if (profile.role === "manager") {
      return (
        creative.creator_id === profile.id ||
        creative.editor_id === profile.id ||
        (creative.ad && (creative.ad.creator_id === profile.id || creative.ad.editor_id === profile.id)) ||
        (creative.ad_id && userAdIds.has(creative.ad_id))
      );
    }
    return false;
  });

  return {
    campaigns: (campaignResult.data ?? []).map(normalizeCampaign),
    creatives: userCreativeList.map((creative) => ({
      ...creative,
      decision_status: creative.decision_status ?? (creative.evaluation_status === "winner" ? "winner" : "unreviewed"),
      decision_source: creative.decision_source ?? "automatic",
      incentive_status: creative.incentive_status ?? (creative.evaluation_status === "winner" ? "eligible" : creative.evaluation_status === "failed" ? "failed_cpa" : "pending_testing"),
      payout_status: creative.payout_status ?? "not_ready",
      payout_month: creative.payout_month ?? null,
      decision_note: creative.decision_note ?? null,
      decided_at: creative.decided_at ?? null,
      decided_by: creative.decided_by ?? null,
      latest_cpa: numberOrNull(creative.latest_cpa),
      latest_spend: Number(creative.latest_spend),
      latest_purchases: Number(creative.latest_purchases),
      campaign: normalizeCampaign(creative.campaign),
      metrics: (creative.metrics ?? []).map((metric: Record<string, unknown>) => ({ ...metric, spend: Number(metric.spend), purchases: Number(metric.purchases), revenue: Number(metric.revenue) }))
    })) as IncentiveCreative[],
    eligibleAds,
    metaAds,
    syncRuns: reviewer ? await loadSyncRuns(admin) : [],
    transcriptMappings: transcriptMappingsResult.data ?? [],
    campaignDestinations
  };
}

async function loadMetaAds(admin: ReturnType<typeof createSupabaseAdminClient>) {
  const detailed = await admin
    .from("meta_ads")
    .select("*,daily_metrics:meta_ad_daily_metrics(*),assets:meta_ad_assets(*,daily_metrics:meta_ad_asset_daily_metrics(*))")
    .order("spend", { ascending: false });

  // The catalog remains usable on deployments that have not yet received the
  // daily-insights migration. Do not take down the entire Incentives screen
  // while that operational database update is pending.
  if (detailed.error?.code !== "PGRST200") return detailed;

  return admin.from("meta_ads").select("*").order("spend", { ascending: false });
}

async function loadSyncRuns(admin: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await admin.from("meta_sync_runs").select("*").order("started_at", { ascending: false }).limit(10);
  return error ? [] : (data ?? []);
}

function normalizeCampaign(campaign: Record<string, unknown>) {
  return {
    ...campaign,
    meta_campaign_ids: Array.isArray(campaign.meta_campaign_ids) ? campaign.meta_campaign_ids : [],
    target_cpa: Number(campaign.target_cpa),
    creator_incentive_amount: Number(campaign.creator_incentive_amount),
    editor_incentive_amount: Number(campaign.editor_incentive_amount)
  } as IncentiveCampaign;
}

function numberOrNull(value: unknown) {
  return value == null ? null : Number(value);
}

function normalizeMetric(metric: Record<string, unknown>) {
  return {
    ...metric,
    spend: Number(metric.spend),
    impressions: Number(metric.impressions),
    reach: Number(metric.reach),
    clicks: Number(metric.clicks),
    link_clicks: Number(metric.link_clicks),
    purchases: Number(metric.purchases),
    revenue: Number(metric.revenue)
  };
}
