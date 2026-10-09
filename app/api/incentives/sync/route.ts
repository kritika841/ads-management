import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { matchAdFlowCreative, selectProductCampaign, type AutoMatchAd, type AutoMatchCampaign } from "@/lib/incentive-auto-match";
import { evaluateIncentiveCreative, type IncentiveCampaign, type IncentiveDailyMetric } from "@/lib/incentives";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  assetBreakdownValue,
  assetId,
  assetIdentifier,
  assetLabelScore,
  assetMediaFromRow,
  creativeAssets,
  inferAssetType,
  isCaptionLikeLabel,
  normalizeAssetLabel,
  resolveAssetLabel,
  type AssetMedia,
  type MetaAction,
  type MetaAssetBreakdown,
  type MetaInsightRow,
  type MetaCreative,
  type MetaAdRow,
} from "@/lib/meta-asset-labels";

const GRAPH_VERSION = "v23.0";
const PURCHASE_ACTIONS = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
// Meta only lists a creative in the Creative → Media breakdown when it
// delivered inside the requested window. A two-day window silently dropped
// every creative that paused briefly, so look back further for media identity.
const BREAKDOWN_LOOKBACK_DAYS = 14;
// Smaller ad batches keep each paged breakdown response (ads × media × days)
// under graphPages' 20-page ceiling.
const BREAKDOWN_AD_BATCH = 10;
type MetaPayload<T> = { data?: T[]; paging?: { next?: string }; error?: { message?: string } };
type LinkedCreative = { id: string; meta_ad_id: string; launched_on: string; gate_evaluated_at: string | null; winner_evaluated_at: string | null; decision_source?: "automatic" | "manual"; decision_note?: string | null; backfill_classified_at?: string | null; campaign: IncentiveCampaign };
type ExistingLink = { id: string; ad_id: string; meta_ad_id: string; creator_id: string | null; editor_id: string | null; evaluation_status: string };

export const maxDuration = 300;

export async function POST() {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Unauthorized. Please log in to sync metrics." }, { status: 401 });
  }
  if (!profile.active) {
    return NextResponse.json({ error: "Account inactive." }, { status: 403 });
  }
  return syncMetaIncentives(profile.id);
}

/** Invoked hourly by Vercel Cron or by local VPS background cron scheduler. */
export async function GET(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const isInternal = request.headers.get("x-internal-cron") === "1";
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const host = request.headers.get("host") || "";
  const isLocalhost =
    isInternal &&
    (!forwarded || forwarded.includes("127.0.0.1") || forwarded.includes("::1") || host.includes("localhost") || host.includes("127.0.0.1"));

  const isAuthorized =
    (configuredSecret && authorization === `Bearer ${configuredSecret}`) ||
    isLocalhost;

  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return syncMetaIncentives(null);
}

async function syncMetaIncentives(actorId: string | null) {
  const token = process.env.META_ACCESS_TOKEN;
  const rawAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !rawAccountId) return NextResponse.json({ error: "Meta credentials are not configured on the server." }, { status: 503 });

  const admin = createSupabaseAdminClient();
  const syncStartedAt = Date.now();

  // Prevent duplicate concurrent sync runs from thrashing the server or Meta API limits
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: activeSync } = await admin
    .from("meta_sync_runs")
    .select("id, started_at")
    .eq("status", "running")
    .gt("started_at", fiveMinutesAgo)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeSync) {
    return NextResponse.json({
      message: "A sync is already in progress in the background. Please refresh shortly.",
      alreadyRunning: true
    }, { status: 200 });
  }

  const { data: syncRun } = await admin.from("meta_sync_runs").insert({ actor_id: actorId }).select("id").maybeSingle();
  const syncRunId = syncRun?.id as string | undefined;
  const today = new Date().toISOString().slice(0, 10);
  const catalogStart = addDays(today, -1); // Narrowed to 2 days (yesterday & today); historical data is already preserved in DB
  const breakdownStart = addDays(today, -(BREAKDOWN_LOOKBACK_DAYS - 1));
  const accountId = rawAccountId.replace(/^act_/, "");
  const accountBase = `https://graph.facebook.com/${GRAPH_VERSION}/act_${accountId}`;
  const adsUrl = graphUrl(`${accountBase}/ads`, token, {
    limit: "100",
    filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE", "IN_PROCESS", "PENDING_REVIEW"] }]),
    fields: "id,name,status,effective_status,created_time,campaign{id,name},adset{id,name},creative{id,name,thumbnail_url,image_url,video_id,object_story_spec,asset_feed_spec}"
  });

  try {
    const [metaAds, adsResult, campaignsResult, linksResult, existingMetaAdsResult, highConfidenceMappingsResult] = await Promise.all([
      graphPages<MetaAdRow>(adsUrl),
      admin.from("ads").select("id,name,product_id,creator_id,editor_id").not("product_id", "is", null),
      admin.from("incentive_campaigns").select("id,product_id,starts_on,ends_on,active").eq("active", true),
      admin.from("incentive_creatives").select("id,ad_id,meta_ad_id,creator_id,editor_id,evaluation_status"),
      admin.from("meta_ads").select("id,matched_ad_id,matched_creator_id,matched_editor_id,detected_tag,auto_matched_at"),
      admin.from("meta_ad_transcript_mappings").select("meta_ad_id,matched_ad_id,match_confidence,ad:ads(id,name,product_id,creator_id,editor_id)").eq("match_confidence", "high").not("matched_ad_id", "is", null)
    ]);
    if (adsResult.error) throw adsResult.error;
    if (campaignsResult.error) throw campaignsResult.error;
    if (linksResult.error) throw linksResult.error;
    const internalAds = (adsResult.data ?? []) as AutoMatchAd[];
    const campaigns = (campaignsResult.data ?? []) as AutoMatchCampaign[];
    const existingLinks = (linksResult.data ?? []) as ExistingLink[];
    const existingAdIds = new Set(existingLinks.map((link) => link.ad_id));
    const existingMetaIds = new Set(existingLinks.map((link) => link.meta_ad_id));
    const reservedAdIds = new Set(existingAdIds);
    const reservedMetaIds = new Set(existingMetaIds);

    const existingMetaAdsMap = new Map((existingMetaAdsResult.data ?? []).map((m) => [m.id, m]));
    const highMappingMap = new Map((highConfidenceMappingsResult.data ?? []).map((m) => {
      const ad = Array.isArray(m.ad) ? m.ad[0] : m.ad;
      return [m.meta_ad_id, { matched_ad_id: m.matched_ad_id, ad: ad as AutoMatchAd | null }];
    }));

    const attributionByMetaId = new Map<string, { ad: AutoMatchAd; tag: string; launchedOn: string; campaign: AutoMatchCampaign | null }>();
    for (const metaAd of metaAds) {
      const launchedOn = (metaAd.created_time ?? today).slice(0, 10);
      const match = matchAdFlowCreative(metaAd.name ?? "", metaAd.creative?.name, internalAds);
      if (match && match.ad.creator_id) {
        attributionByMetaId.set(metaAd.id, { ad: match.ad, tag: match.tag, launchedOn, campaign: selectProductCampaign(campaigns, match.ad.product_id, launchedOn) });
        continue;
      }

      // Check high confidence AI transcript mapping
      const highMapping = highMappingMap.get(metaAd.id);
      if (highMapping?.ad && highMapping.ad.creator_id) {
        attributionByMetaId.set(metaAd.id, {
          ad: highMapping.ad,
          tag: highMapping.ad.name,
          launchedOn,
          campaign: selectProductCampaign(campaigns, highMapping.ad.product_id, launchedOn)
        });
        continue;
      }

      // Check existing meta_ads attribution
      const existing = existingMetaAdsMap.get(metaAd.id);
      if (existing?.matched_ad_id) {
        const matchedInternalAd = internalAds.find((a) => a.id === existing.matched_ad_id);
        if (matchedInternalAd) {
          attributionByMetaId.set(metaAd.id, {
            ad: matchedInternalAd,
            tag: existing.detected_tag || matchedInternalAd.name,
            launchedOn,
            campaign: selectProductCampaign(campaigns, matchedInternalAd.product_id, launchedOn)
          });
        }
      }
    }
    const catalogInsights: MetaInsightRow[] = [];
    const assetInsights: MetaInsightRow[] = [];
    let assetBreakdownError: string | null = null;
    // Keep the sync below the local Next.js memory ceiling while still using
    // Meta's supported `ad.id IN (...)` filtering. Larger API batches reduce
    // request count; lower fan-out prevents the response pages from being
    // retained concurrently and leaving the dashboard with stale labels.
    for (const batch of chunks(chunks(metaAds.map((ad) => ad.id), 20), 3)) {
      const results = await Promise.all(batch.map((adIds) => {
        const insightsUrl = graphUrl(`${accountBase}/insights`, token, { level: "ad", limit: "100", time_increment: "1", time_range: JSON.stringify({ since: catalogStart, until: today }), filtering: JSON.stringify([{ field: "ad.id", operator: "IN", value: adIds }]), fields: "date_start,date_stop,ad_id,spend,impressions,reach,clicks,inline_link_clicks,cost_per_inline_link_click,actions,action_values" });
        return graphPages<MetaInsightRow>(insightsUrl);
      }));
      catalogInsights.push(...results.flat());
    }
    // Creative → Media breakdown for every synced ad (not only ads that spent
    // in the catalog window) so creatives that delivered earlier in the
    // lookback window still receive their media identity and metrics.
    for (const batch of chunks(chunks(metaAds.map((ad) => ad.id), BREAKDOWN_AD_BATCH), 2)) {
      const results = await Promise.all(batch.map((adIds) => fetchAssetBreakdown(accountBase, token, adIds, breakdownStart, catalogStart, today, (message) => { assetBreakdownError ??= message; })));
      assetInsights.push(...results.flat());
    }
    const syncedAt = new Date().toISOString();
    const insightByAd = aggregateInsightsByAd(catalogInsights);
    const catalogRows = metaAds.map((ad) => {
      const insight = insightByAd.get(ad.id);
      const spend = Number(insight?.spend ?? 0);
      const purchases = actionValue(insight?.actions);
      const attribution = attributionByMetaId.get(ad.id);
      const existing = existingMetaAdsMap.get(ad.id);
      const matchedAdId = attribution?.ad.id ?? existing?.matched_ad_id ?? null;
      const matchedCreatorId = attribution?.ad.creator_id ?? existing?.matched_creator_id ?? null;
      const matchedEditorId = attribution?.ad.editor_id ?? existing?.matched_editor_id ?? null;
      const detectedTag = attribution?.tag ?? existing?.detected_tag ?? null;
      const autoMatchedAt = attribution ? syncedAt : existing?.auto_matched_at ?? null;

      return {
        id: ad.id,
        name: ad.name || `Meta ad ${ad.id}`,
        campaign_id: ad.campaign?.id ?? null,
        campaign_name: ad.campaign?.name ?? null,
        adset_id: ad.adset?.id ?? null,
        adset_name: ad.adset?.name ?? null,
        creative_id: ad.creative?.id ?? null,
        creative_name: ad.creative?.name ?? null,
        thumbnail_url: ad.creative?.thumbnail_url ?? ad.creative?.image_url ?? null,
        status: ad.status ?? null,
        effective_status: ad.effective_status ?? null,
        created_time: ad.created_time ?? null,
        spend,
        impressions: Number(insight?.impressions ?? 0),
        reach: Number(insight?.reach ?? 0),
        clicks: Number(insight?.clicks ?? 0),
        link_clicks: Number(insight?.inline_link_clicks ?? 0),
        purchases,
        revenue: actionValue(insight?.action_values),
        cpa: purchases > 0 ? spend / purchases : null,
        insights_from: catalogStart,
        insights_to: today,
        last_synced_at: syncedAt,
        matched_ad_id: matchedAdId,
        matched_creator_id: matchedCreatorId,
        matched_editor_id: matchedEditorId,
        detected_tag: detectedTag,
        auto_matched_at: autoMatchedAt
      };
    });
    if (catalogRows.length) {
      const { error: catalogError } = await admin.from("meta_ads").upsert(catalogRows, { onConflict: "id" });
      if (catalogError) throw catalogError;
    }
    const uniqueDailyCatalogMap = new Map<string, ReturnType<typeof toDailyMetric>>();
    for (const row of catalogInsights) {
      const metric = toDailyMetric(row, row.ad_id) as ReturnType<typeof toDailyMetric> & { meta_ad_id: string; metric_date: string };
      const key = `${metric.meta_ad_id}:${metric.metric_date}`;
      const existing = uniqueDailyCatalogMap.get(key) as typeof metric | undefined;
      if (!existing) {
        uniqueDailyCatalogMap.set(key, metric);
      } else {
        existing.spend = (Number(existing.spend) || 0) + (Number(metric.spend) || 0);
        existing.impressions = (Number(existing.impressions) || 0) + (Number(metric.impressions) || 0);
        existing.reach = (Number(existing.reach) || 0) + (Number(metric.reach) || 0);
        existing.clicks = (Number(existing.clicks) || 0) + (Number(metric.clicks) || 0);
        existing.link_clicks = (Number(existing.link_clicks) || 0) + (Number(metric.link_clicks) || 0);
        existing.purchases = (Number(existing.purchases) || 0) + (Number(metric.purchases) || 0);
        existing.revenue = (Number(existing.revenue) || 0) + (Number(metric.revenue) || 0);
      }
    }
    const dailyCatalogRows = [...uniqueDailyCatalogMap.values()];
    if (dailyCatalogRows.length) {
      const { error: dailyCatalogError } = await admin.from("meta_ad_daily_metrics").upsert(dailyCatalogRows, { onConflict: "meta_ad_id,metric_date" });
      if (dailyCatalogError) throw dailyCatalogError;
    }
    // Snapshot the stored creatives for every synced ad first: it lets this
    // run keep media IDs learned earlier, avoid re-adding feed-spec rows for
    // media already reported by the breakdown, and prune only stale rows.
    const syncedAdIds = metaAds.map((ad) => ad.id);
    const existingAssetRows: ExistingAssetRow[] = [];
    for (const adBatch of chunks(syncedAdIds, 25)) {
      const { data: existingBatch, error: existingAssetError } = await admin.from("meta_ad_assets").select("id,meta_ad_id,asset_label,source,video_id,image_hash,thumbnail_url").in("meta_ad_id", adBatch);
      if (existingAssetError) throw existingAssetError;
      existingAssetRows.push(...((existingBatch ?? []) as ExistingAssetRow[]));
    }
    // One-time self-heal: rows stored before per-creative media identity
    // existed have no video_id/image_hash. Without it they cannot be matched to
    // the ad's creative spec (and would be listed twice), nor previewed
    // exactly. Learn it from Meta's lifetime media breakdown, only for those ads.
    const reportedNow = new Set(assetInsights.map((row) => `${row.ad_id}:${normalizeAssetLabel(assetBreakdownValue(row) ?? "")}`));
    const adsNeedingIdentity = [...new Set(existingAssetRows.filter((row) => row.source !== "meta_creative" && !row.video_id && !row.image_hash).map((row) => row.meta_ad_id))];
    if (adsNeedingIdentity.length) {
      const adById = new Map(metaAds.map((ad) => [ad.id, ad]));
      const storedById = new Map(existingAssetRows.map((row) => [row.id, row]));
      for (const adIds of chunks(adsNeedingIdentity, BREAKDOWN_AD_BATCH)) {
        const identityRows = await fetchLifetimeMedia(accountBase, token, adIds, (message) => { assetBreakdownError ??= message; });
        for (const row of identityRows) {
          const rawLabel = assetBreakdownValue(row);
          if (!rawLabel || reportedNow.has(`${row.ad_id}:${normalizeAssetLabel(rawLabel)}`)) continue;
          const stored = storedById.get(assetId(row.ad_id, resolveAssetLabel(adById.get(row.ad_id), rawLabel)));
          const media = assetMediaFromRow(row);
          if (!stored || stored.video_id || stored.image_hash || (!media.videoId && !media.imageHash)) continue;
          stored.video_id = media.videoId;
          stored.image_hash = media.imageHash;
          const { error: identityError } = await admin.from("meta_ad_assets").update({ video_id: media.videoId, image_hash: media.imageHash, ...(media.thumbnailUrl ? { thumbnail_url: media.thumbnailUrl } : {}) }).eq("id", stored.id);
          if (identityError) throw identityError;
        }
      }
    }
    const assetRows = uniqueAssetRows(assetInsights, metaAds, syncedAt, existingAssetRows);

    // Batch-resolve distinct thumbnails for any creatives missing one
    const videoAssetsNeedingThumb = assetRows.filter((a) => a.video_id && !a.thumbnail_url);
    if (videoAssetsNeedingThumb.length) {
      const vids = [...new Set(videoAssetsNeedingThumb.map((a) => a.video_id).filter((id): id is string => Boolean(id)))];
      for (const batch of chunks(vids, 50)) {
        try {
          const url = graphUrl(`https://graph.facebook.com/${GRAPH_VERSION}/`, token, { ids: batch.join(","), fields: "picture,thumbnails{uri,is_preferred}" });
          const res = await fetch(url).then((r) => r.json() as Promise<Record<string, { picture?: string; thumbnails?: { data?: Array<{ uri: string; is_preferred?: boolean }> } }>>);
          for (const asset of videoAssetsNeedingThumb) {
            if (!asset.video_id) continue;
            const data = res[asset.video_id];
            const preferred = data?.thumbnails?.data?.find((t) => t.is_preferred)?.uri;
            const pic = preferred || data?.picture;
            if (pic) asset.thumbnail_url = pic;
          }
        } catch { /* non-fatal fallback */ }
      }
    }
    const imageAssetsNeedingThumb = assetRows.filter((a) => a.image_hash && !a.thumbnail_url);
    if (imageAssetsNeedingThumb.length) {
      const hashes = [...new Set(imageAssetsNeedingThumb.map((a) => a.image_hash).filter((h): h is string => Boolean(h)))];
      for (const batch of chunks(hashes, 50)) {
        try {
          const url = graphUrl(`${accountBase}/adimages`, token, { hashes: JSON.stringify(batch), fields: "hash,url,permalink_url" });
          const res = await fetch(url).then((r) => r.json() as Promise<{ data?: Array<{ hash: string; url?: string; permalink_url?: string }> }>);
          const urlByHash = new Map((res.data ?? []).map((img) => [img.hash, img.url || img.permalink_url]));
          for (const asset of imageAssetsNeedingThumb) {
            if (!asset.image_hash) continue;
            const imgUrl = urlByHash.get(asset.image_hash);
            if (imgUrl) asset.thumbnail_url = imgUrl;
          }
        } catch { /* non-fatal fallback */ }
      }
    }

    const assetRowIds = new Set(assetRows.map((asset) => asset.id));
    if (assetRows.length) {
      const { error: assetError } = await admin.from("meta_ad_assets").upsert(assetRows, { onConflict: "id" });
      if (assetError) throw assetError;
    }
    // Creatives that simply did not deliver in the window are kept. Only
    // generated feed-spec rows that are no longer part of the ad's creative,
    // or whose media is now represented by an exact breakdown row, are pruned.
    const staleGeneratedIds = existingAssetRows.filter((asset) => asset.source === "meta_creative" && !assetRowIds.has(asset.id)).map((asset) => asset.id);
    for (const idBatch of chunks(staleGeneratedIds, 25)) {
      const { error: staleCleanupError } = await admin.from("meta_ad_assets").delete().in("id", idBatch);
      if (staleCleanupError) throw staleCleanupError;
    }
    const reportedAdIds = new Set(assetInsights.filter((row) => Boolean(assetBreakdownValue(row))).map((row) => row.ad_id));
    if (reportedAdIds.size) {
      // Different Meta breakdowns can spell the same media differently (for
      // example, one row is only the numeric video ID while another contains
      // the filename). Collapse those aliases onto the preferred canonical
      // label before they become duplicate dashboard rows.
      const canonicalByMediaKey = new Map(assetRows.map((asset) => [`${asset.meta_ad_id}:${assetIdentifier(asset.asset_label) ?? asset.asset_label}`, asset.id]));
      const candidates = existingAssetRows.filter((asset) => reportedAdIds.has(asset.meta_ad_id) && !staleGeneratedIds.includes(asset.id));
      const duplicateIds: string[] = [];
      for (const asset of candidates) {
        const canonicalId = canonicalByMediaKey.get(`${asset.meta_ad_id}:${assetIdentifier(asset.asset_label) ?? asset.asset_label}`);
        if (canonicalId && canonicalId !== asset.id) {
          await admin.from("meta_ad_asset_daily_metrics").update({ meta_asset_id: canonicalId }).eq("meta_asset_id", asset.id);
          duplicateIds.push(asset.id);
        }
      }
      for (const idBatch of chunks(duplicateIds, 25)) {
        const { error: duplicateCleanupError } = await admin.from("meta_ad_assets").delete().in("id", idBatch);
        if (duplicateCleanupError) throw duplicateCleanupError;
      }
    }

    const uniqueAssetMetricsMap = new Map<string, ReturnType<typeof toDailyMetric>>();
    for (const row of assetInsights) {
      const breakdown = assetBreakdownValue(row);
      if (!breakdown) continue;
      const ad = metaAds.find((candidate) => candidate.id === row.ad_id);
      const targetId = assetId(row.ad_id, resolveAssetLabel(ad, breakdown));
      const metric = toDailyMetric(row, targetId) as ReturnType<typeof toDailyMetric> & { meta_asset_id: string; metric_date: string };
      const key = `${metric.meta_asset_id}:${metric.metric_date}`;
      const existing = uniqueAssetMetricsMap.get(key) as typeof metric | undefined;
      if (!existing) {
        uniqueAssetMetricsMap.set(key, metric);
      } else {
        existing.spend = (Number(existing.spend) || 0) + (Number(metric.spend) || 0);
        existing.impressions = (Number(existing.impressions) || 0) + (Number(metric.impressions) || 0);
        existing.reach = (Number(existing.reach) || 0) + (Number(metric.reach) || 0);
        existing.clicks = (Number(existing.clicks) || 0) + (Number(metric.clicks) || 0);
        existing.link_clicks = (Number(existing.link_clicks) || 0) + (Number(metric.link_clicks) || 0);
        existing.purchases = (Number(existing.purchases) || 0) + (Number(metric.purchases) || 0);
        existing.revenue = (Number(existing.revenue) || 0) + (Number(metric.revenue) || 0);
      }
    }
    type AdDailyRow = { meta_ad_id: string; metric_date: string; spend: number; purchases: number; revenue: number };
    type AssetDailyRow = { meta_asset_id: string; metric_date: string; spend: number; purchases: number; revenue: number };
    const assetMetrics = [...uniqueAssetMetricsMap.values()] as AssetDailyRow[];
    // Reconcile asset daily metrics with authoritative parent ad daily metrics
    // Meta's breakdown API frequently drops or underreports offsite pixel conversions (purchases & revenue).
    const parentDailyMetricsByAdDate = new Map((dailyCatalogRows as AdDailyRow[]).map((r) => [`${r.meta_ad_id}:${r.metric_date}`, r]));
    const assetsByAdDate = new Map<string, AssetDailyRow[]>();
    for (const m of assetMetrics) {
      const adId = m.meta_asset_id.split(":")[0];
      const key = `${adId}:${m.metric_date}`;
      const list = assetsByAdDate.get(key) ?? [];
      list.push(m);
      assetsByAdDate.set(key, list);
    }

    for (const [key, group] of assetsByAdDate.entries()) {
      const parent = parentDailyMetricsByAdDate.get(key);
      if (!parent || Number(parent.purchases) <= 0 || Number(parent.spend) <= 0) continue;
      const totalGroupPurchases = group.reduce((s, g) => s + (Number(g.purchases) || 0), 0);
      if (totalGroupPurchases < Number(parent.purchases)) {
        for (const item of group) {
          const ratio = (Number(item.spend) || 0) / Number(parent.spend);
          item.purchases = group.length === 1 ? Number(parent.purchases) : Math.round(Number(parent.purchases) * ratio);
          item.revenue = group.length === 1 ? Number(parent.revenue) : Number((Number(parent.revenue) * ratio).toFixed(2));
        }
      }
    }

    if (assetMetrics.length) {
      const { error: assetMetricError } = await admin.from("meta_ad_asset_daily_metrics").upsert(assetMetrics, { onConflict: "meta_asset_id,metric_date" });
      if (assetMetricError) throw assetMetricError;
    }

    const autoRows = [];
    for (const metaAd of metaAds) {
      const attribution = attributionByMetaId.get(metaAd.id);
      if (!attribution?.campaign || reservedAdIds.has(attribution.ad.id) || reservedMetaIds.has(metaAd.id)) continue;
      autoRows.push({ incentive_campaign_id: attribution.campaign.id, ad_id: attribution.ad.id, meta_ad_id: metaAd.id, launched_on: attribution.launchedOn, creator_id: attribution.ad.creator_id, editor_id: attribution.ad.editor_id, attribution_source: "auto", auto_matched_at: syncedAt, created_by: actorId });
      reservedAdIds.add(attribution.ad.id);
      reservedMetaIds.add(metaAd.id);
    }
    if (autoRows.length) {
      const { error: autoLinkError } = await admin.from("incentive_creatives").insert(autoRows);
      if (autoLinkError) throw autoLinkError;
    }

    for (const link of existingLinks) {
      const ad = internalAds.find((item) => item.id === link.ad_id);
      if (!ad || (link.creator_id === ad.creator_id && (link.editor_id === ad.editor_id || link.editor_id))) continue;
      const patch: { creator_id?: string | null; editor_id?: string | null } = {};
      if (!link.creator_id) patch.creator_id = ad.creator_id;
      if (!link.editor_id && link.evaluation_status !== "winner") patch.editor_id = ad.editor_id;
      if (Object.keys(patch).length) {
        const { error: attributionError } = await admin.from("incentive_creatives").update(patch).eq("id", link.id);
        if (attributionError) throw attributionError;
      }
    }

    const { data: creatives, error: creativesError } = await admin.from("incentive_creatives").select("*,campaign:incentive_campaigns(*)");
    if (creativesError) throw creativesError;

    const dailyRows: MetaInsightRow[] = [];
    if (creatives?.length) {
      const linkedCreatives = creatives as LinkedCreative[];
      const linkedStart = linkedCreatives.map((item) => item.launched_on).sort()[0];
      for (const batch of chunks(chunks(linkedCreatives.map((item) => item.meta_ad_id), 10), 5)) {
        const results = await Promise.all(batch.map((metaAdIds) => graphPages<MetaInsightRow>(graphUrl(`${accountBase}/insights`, token, { level: "ad", limit: "100", time_increment: "1", time_range: JSON.stringify({ since: linkedStart, until: today }), filtering: JSON.stringify([{ field: "ad.id", operator: "IN", value: metaAdIds }]), fields: "date_start,ad_id,spend,impressions,reach,clicks,inline_link_clicks,cost_per_inline_link_click,actions,action_values" }))));
        dailyRows.push(...results.flat());
      }
      await updateLinkedCreatives(admin, linkedCreatives, dailyRows, today, syncedAt);
    }

    if (syncRunId) await admin.from("meta_sync_runs").update({ status: "success", completed_at: new Date().toISOString(), rows_fetched: metaAds.length + catalogInsights.length + assetInsights.length + dailyRows.length, new_ads: catalogRows.length, matched_creatives: attributionByMetaId.size, unmatched_creatives: Math.max(0, metaAds.length - attributionByMetaId.size), duration_ms: Date.now() - syncStartedAt }).eq("id", syncRunId);
    await admin.from("audit_logs").insert({ actor_id: actorId, action: "synced_meta_incentives", target_type: "incentive_campaign", metadata: { catalog_ads: catalogRows.length, atomic_assets: assetRows.length, auto_matched_ads: attributionByMetaId.size, auto_linked_creatives: autoRows.length, linked_creatives: creatives?.length ?? 0, daily_rows: dailyRows.length } });
    return NextResponse.json({ synced: creatives?.length ?? 0, catalogAds: catalogRows.length, atomicAssets: assetRows.length, assetBreakdownError, autoMatched: attributionByMetaId.size, autoLinked: autoRows.length, rows: dailyRows.length, syncedAt });
  } catch (cause) {
    console.error("Meta incentives sync failed", cause);
    const errorMessage = cause instanceof Error ? cause.message : typeof cause === "object" && cause && "message" in cause ? String(cause.message) : String(cause);
    if (syncRunId) await admin.from("meta_sync_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_message: errorMessage, duration_ms: Date.now() - syncStartedAt }).eq("id", syncRunId);
    const isRateLimit = errorMessage.includes("too many calls") || errorMessage.includes("rate limit") || errorMessage.includes("OAuthException");
    const status = isRateLimit ? 429 : 400;
    return NextResponse.json({ error: errorMessage }, { status });
  }
}

function aggregateInsightsByAd(rows: MetaInsightRow[]) {
  const totals = new Map<string, MetaInsightRow>();
  for (const row of rows) {
    const current = totals.get(row.ad_id);
    if (!current) { totals.set(row.ad_id, { ...row }); continue; }
    current.spend = String(Number(current.spend ?? 0) + Number(row.spend ?? 0));
    current.impressions = String(Number(current.impressions ?? 0) + Number(row.impressions ?? 0));
    current.reach = String(Number(current.reach ?? 0) + Number(row.reach ?? 0));
    current.clicks = String(Number(current.clicks ?? 0) + Number(row.clicks ?? 0));
    current.inline_link_clicks = String(Number(current.inline_link_clicks ?? 0) + Number(row.inline_link_clicks ?? 0));
    current.actions = mergeActions(current.actions, row.actions);
    current.action_values = mergeActions(current.action_values, row.action_values);
  }
  return totals;
}

async function fetchAssetBreakdown(accountBase: string, token: string, adIds: string[], since: string, rangeSince: string, until: string, onError: (message: string) => void) {
  const fields = "date_start,date_stop,ad_id,ad_name,spend,impressions,reach,clicks,inline_link_clicks,cost_per_inline_link_click,actions,action_values";
  // Ads Manager can expose the same creative-level report through different
  // breakdowns depending on whether the ad is dynamic creative. Try the same
  // Creative > Media breakdown used by Ads Manager first, then asset-specific
  // fallbacks.
  const collected = new Map<string, MetaInsightRow>();
  const reportedAdIds = new Set<string>();
  const addRows = (rows: MetaInsightRow[], rangeOnly = false) => {
    for (const row of rows) {
      const rawLabel = assetBreakdownValue(row);
      if (!rawLabel) continue;
      const label = normalizeAssetLabel(rawLabel);
      const identifier = assetIdentifier(label) ?? label;
      const key = `${row.ad_id}:${row.date_start}:${row.date_stop ?? ""}:${identifier}`;
      if (rangeOnly && [...collected.keys()].some((existingKey) => existingKey.startsWith(`${row.ad_id}:${row.date_start}:`) && existingKey.endsWith(`:${identifier}`))) continue;
      reportedAdIds.add(row.ad_id);
      const candidate = { ...row, ad_format_asset: rawLabel };
      const existing = collected.get(key);
      if (!existing || assetLabelScore(label) > assetLabelScore(normalizeAssetLabel(assetBreakdownValue(existing) ?? ""))) collected.set(key, candidate);
    }
  };
  const fetchBreakdown = async (breakdown: string, ids: string[], daily = true) => {
    try {
      const rows = await graphPages<MetaInsightRow>(graphUrl(`${accountBase}/insights`, token, { level: "ad", limit: "100", ...(daily ? { time_increment: "1" } : {}), time_range: JSON.stringify({ since: daily ? since : rangeSince, until }), filtering: JSON.stringify([{ field: "ad.id", operator: "IN", value: ids }]), breakdowns: breakdown, fields }));
      addRows(rows, !daily);
      return rows;
    } catch (cause) {
      onError(cause instanceof Error ? `${breakdown}${daily ? "" : " total"}: ${cause.message}` : `${breakdown}: ${String(cause)}`);
      return [] as MetaInsightRow[];
    }
  };
  // Query video_asset and image_asset first in parallel because in Meta Graph API they contain
  // the exact Creative → Media filenames (e.g. "video_name": "ISH0195.mp4")
  // and the per-creative `video_id` / image `hash` used for exact previews.
  await Promise.all([
    fetchBreakdown("video_asset", adIds),
    fetchBreakdown("image_asset", adIds)
  ]);
  // Fall back per ad: an ad missing from the asset breakdowns must not be
  // skipped just because another ad in the same batch was reported.
  const unreported = () => adIds.filter((id) => !reportedAdIds.has(id));
  let missing = unreported();
  if (missing.length) {
    await fetchBreakdown("ad_format_asset", missing);
  }
  // Some accounts return the Ads Manager asset breakdown only as a range
  // total. Keep that total rather than dropping the creative metrics entirely;
  // it is anchored to date_start and remains visible when the user selects a
  // range that includes that date.
  missing = unreported();
  if (missing.length) {
    await fetchBreakdown("ad_format_asset", missing, false);
  }
  return [...collected.values()];
}

/**
 * Lifetime (date_preset=maximum) media breakdown, used only to learn the
 * media identity of creatives stored before video_id/image_hash existed.
 * No metrics are written from these rows.
 */
async function fetchLifetimeMedia(accountBase: string, token: string, adIds: string[], onError: (message: string) => void) {
  const fields = "ad_id,impressions";
  const results = await Promise.all(["video_asset", "image_asset"].map(async (breakdown) => {
    try {
      return await graphPages<MetaInsightRow>(graphUrl(`${accountBase}/insights`, token, { level: "ad", limit: "200", date_preset: "maximum", filtering: JSON.stringify([{ field: "ad.id", operator: "IN", value: adIds }]), breakdowns: breakdown, fields }));
    } catch (cause) {
      onError(`${breakdown} lifetime: ${cause instanceof Error ? cause.message : String(cause)}`);
      return [] as MetaInsightRow[];
    }
  }));
  return results.flat();
}

function mergeActions(left: MetaAction[] | undefined, right: MetaAction[] | undefined) {
  const values = new Map<string, number>();
  for (const action of [...(left ?? []), ...(right ?? [])]) values.set(action.action_type, (values.get(action.action_type) ?? 0) + Number(action.value ?? 0));
  return [...values.entries()].map(([action_type, value]) => ({ action_type, value: String(value) }));
}


type ExistingAssetRow = { id: string; meta_ad_id: string; asset_label: string; source: string; video_id: string | null; image_hash: string | null; thumbnail_url: string | null };
type AssetRow = { id: string; meta_ad_id: string; asset_label: string; asset_type: string | null; creative_id: string | null; thumbnail_url: string | null; video_id: string | null; image_hash: string | null; source: string; last_seen_at: string };

function uniqueAssetRows(rows: MetaInsightRow[], ads: MetaAdRow[], syncedAt: string, existingRows: ExistingAssetRow[] = []) {
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const existingByAd = new Map<string, ExistingAssetRow[]>();
  for (const row of existingRows) existingByAd.set(row.meta_ad_id, [...(existingByAd.get(row.meta_ad_id) ?? []), row]);

  const reportedByAd = new Map<string, MetaInsightRow[]>();
  for (const row of rows) {
    if (!assetBreakdownValue(row)) continue;
    reportedByAd.set(row.ad_id, [...(reportedByAd.get(row.ad_id) ?? []), row]);
  }

  const result: AssetRow[] = [];
  for (const ad of ads) {
    const assets = new Map<string, AssetRow>();
    const adThumb = ad.creative?.thumbnail_url ?? ad.creative?.image_url ?? null;
    const add = (label: string, type: string | null, source: string, media: AssetMedia) => {
      const id = assetId(ad.id, label);
      const previous = assets.get(id);
      const stored = existingById.get(id);
      const videoId = media.videoId ?? previous?.video_id ?? stored?.video_id ?? null;
      const imageHash = videoId ? null : media.imageHash ?? previous?.image_hash ?? stored?.image_hash ?? null;
      const validPreviousThumb = previous?.thumbnail_url && previous.thumbnail_url !== adThumb ? previous.thumbnail_url : null;
      const validStoredThumb = stored?.thumbnail_url && stored.thumbnail_url !== adThumb ? stored.thumbnail_url : null;
      const thumb = media.thumbnailUrl ?? validPreviousThumb ?? validStoredThumb ?? null;

      assets.set(id, {
        id,
        meta_ad_id: ad.id,
        asset_label: label,
        asset_type: videoId ? "video" : imageHash ? "image" : type,
        creative_id: ad.creative?.id ?? null,
        thumbnail_url: thumb,
        video_id: videoId,
        image_hash: imageHash,
        // Never downgrade a row Meta has reported in its breakdown.
        source: previous?.source === "meta_insights" || stored?.source === "meta_insights" ? "meta_insights" : source,
        last_seen_at: syncedAt
      });
    };

    // 1. Exact Creative → Media rows reported by Meta (names match Ads Manager).
    const reported = reportedByAd.get(ad.id) ?? [];
    for (const row of reported) {
      const rawLabel = assetBreakdownValue(row);
      if (!rawLabel) continue;
      const label = resolveAssetLabel(ad, rawLabel);
      add(label, inferAssetType(label), "meta_insights", assetMediaFromRow(row));
    }

    // 2. Every other creative in the ad's spec, so creatives that did not
    // deliver in the breakdown window are still listed. Matched on video ID /
    // image hash against breakdown rows from this run and earlier runs.
    const covered = new Set<string>();
    const cover = (videoId: string | null, imageHash: string | null) => {
      if (videoId) covered.add(`v:${videoId}`);
      if (imageHash) covered.add(`i:${imageHash}`);
    };
    for (const asset of assets.values()) cover(asset.video_id, asset.image_hash);
    const storedInsights = (existingByAd.get(ad.id) ?? []).filter((row) => row.source !== "meta_creative");
    for (const row of storedInsights) cover(row.video_id, row.image_hash);
    const hasBreakdownHistory = reported.length > 0 || storedInsights.length > 0;
    for (const asset of creativeAssets(ad.creative)) {
      const hasMedia = Boolean(asset.videoId || asset.imageHash);
      // The `Creative <id>` placeholder only stands in when nothing better exists.
      if (!hasMedia && hasBreakdownHistory) continue;
      if (covered.has(`v:${asset.videoId}`) || covered.has(`i:${asset.imageHash}`)) continue;
      add(asset.label, asset.type, "meta_creative", { videoId: asset.videoId, imageHash: asset.imageHash, thumbnailUrl: asset.thumbnailUrl });
      cover(asset.videoId, asset.imageHash);
    }

    // The ad-level thumbnail is only accurate when the ad has one creative.
    const adAssets = [...assets.values()];
    const totalCreatives = new Set([...adAssets.map((asset) => asset.id), ...storedInsights.map((row) => row.id)]).size;
    if (totalCreatives === 1) {
      adAssets[0].thumbnail_url ??= adThumb;
    } else {
      // On multi-creative ads, clear any thumbnail that erroneously matches the parent ad's thumbnail
      for (const asset of adAssets) {
        if (asset.thumbnail_url && asset.thumbnail_url === adThumb) {
          asset.thumbnail_url = null;
        }
      }
    }
    result.push(...adAssets);
  }
  return result;
}


function toDailyMetric(row: MetaInsightRow, id: string) {
  const base = { metric_date: row.date_stop ?? row.date_start, spend: Number(row.spend ?? 0), impressions: Number(row.impressions ?? 0), reach: Number(row.reach ?? 0), clicks: Number(row.clicks ?? 0), link_clicks: Number(row.inline_link_clicks ?? 0), purchases: actionValue(row.actions), revenue: actionValue(row.action_values), synced_at: new Date().toISOString() };
  return id.includes(":") ? { ...base, meta_asset_id: id } : { ...base, meta_ad_id: id };
}

async function updateLinkedCreatives(admin: ReturnType<typeof createSupabaseAdminClient>, creatives: LinkedCreative[], insightRows: MetaInsightRow[], today: string, syncedAt: string) {
  const byAdDate = new Map(insightRows.map((row) => [`${row.ad_id}:${row.date_start}`, row]));
  for (const creative of creatives) {
    const campaign = creative.campaign;
    const windowEnd = addDays(creative.launched_on, Number(campaign.gate_days) + Number(campaign.winner_window_days) - 1);
    const metricEnd = windowEnd < today ? windowEnd : today;
    const metrics: IncentiveDailyMetric[] = datesBetween(creative.launched_on, metricEnd).map((metricDate) => {
      const row = byAdDate.get(`${creative.meta_ad_id}:${metricDate}`);
      return { incentive_creative_id: creative.id, metric_date: metricDate, spend: Number(row?.spend ?? 0), impressions: Number(row?.impressions ?? 0), reach: Number(row?.reach ?? 0), clicks: Number(row?.clicks ?? 0), link_clicks: Number(row?.inline_link_clicks ?? 0), purchases: actionValue(row?.actions), revenue: actionValue(row?.action_values), synced_at: syncedAt };
    });
    if (metrics.length) {
      const { error } = await admin.from("incentive_daily_metrics").upsert(metrics, { onConflict: "incentive_creative_id,metric_date" });
      if (error) throw error;
    }
    const evaluation = evaluateIncentiveCreative(campaign, creative.launched_on, metrics);
    const automaticDecision = evaluation.status === "winner" ? "winner" : evaluation.status === "failed" ? "loser" : "unreviewed";
    const isBackfilled = Boolean(creative.backfill_classified_at || creative.decision_note?.startsWith("Backfilled "));
    const patch = { evaluation_status: evaluation.status, gate_evaluated_at: evaluation.gateComplete ? creative.gate_evaluated_at ?? syncedAt : null, winner_evaluated_at: evaluation.status === "winner" ? creative.winner_evaluated_at ?? syncedAt : null, latest_cpa: evaluation.cpa, latest_spend: evaluation.spend, latest_purchases: evaluation.purchases, last_synced_at: syncedAt, ...(creative.decision_source === "manual" || isBackfilled ? {} : { decision_status: automaticDecision, decision_source: "automatic", incentive_status: automaticDecision === "winner" ? "eligible" : automaticDecision === "loser" ? "not_eligible" : "pending_testing", payout_status: "not_ready", decided_at: evaluation.status === "gate_testing" || evaluation.status === "gate_passed" ? null : syncedAt, decided_by: null }) };
    const { error } = await admin.from("incentive_creatives").update(patch).eq("id", creative.id);
    if (error) throw error;
  }
}

async function graphPages<T>(initialUrl: URL) {
  const rows: T[] = [];
  let next: string | undefined = initialUrl.toString();
  let pageCount = 0;
  while (next && pageCount < 20) {
    pageCount++;
    let response: Response;
    try {
      response = await fetch(next, { cache: "no-store", signal: AbortSignal.timeout(25000) });
    } catch (err) {
      throw new Error(`Meta API request timed out: ${err instanceof Error ? err.message : String(err)}`);
    }

    const contentType = response.headers.get("content-type") || "";
    let payload: MetaPayload<T>;
    if (contentType.includes("application/json")) {
      payload = await response.json() as MetaPayload<T>;
    } else {
      const errorText = await response.text();
      const cleanError = errorText.replace(/<[^>]*>/g, "").trim().slice(0, 100);
      throw new Error(`Meta returned HTTP ${response.status}: ${cleanError || "Non-JSON response"}`);
    }

    if (!response.ok || payload.error) throw new Error(payload.error?.message ?? `Meta returned HTTP ${response.status}.`);
    rows.push(...(payload.data ?? []));
    next = payload.paging?.next;
  }
  return rows;
}

function graphUrl(base: string, token: string, params: Record<string, string>) { const url = new URL(base); url.searchParams.set("access_token", token); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value); return url; }
function actionValue(actions: MetaAction[] | undefined) { for (const type of PURCHASE_ACTIONS) { const match = actions?.find((action) => action.action_type === type); if (match) return Number(match.value || 0); } return 0; }
function datesBetween(start: string, end: string) { if (end < start) return []; const dates: string[] = []; for (let current = start; current <= end; current = addDays(current, 1)) dates.push(current); return dates; }
function addDays(date: string, days: number) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function chunks<T>(values: T[], size: number) { const result: T[][] = []; for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size)); return result; }
