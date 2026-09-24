import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { matchAdFlowCreative, selectProductCampaign, type AutoMatchAd, type AutoMatchCampaign } from "@/lib/incentive-auto-match";
import { evaluateIncentiveCreative, type IncentiveCampaign, type IncentiveDailyMetric } from "@/lib/incentives";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  assetBreakdownValue,
  assetId,
  assetIdentifier,
  assetLabelScore,
  creativeAssets,
  inferAssetType,
  isCaptionLikeLabel,
  normalizeAssetLabel,
  resolveAssetLabel,
  type MetaAction,
  type MetaAssetBreakdown,
  type MetaInsightRow,
  type MetaCreative,
  type MetaAdRow,
} from "@/lib/meta-asset-labels";

const GRAPH_VERSION = "v23.0";
const PURCHASE_ACTIONS = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
type MetaPayload<T> = { data?: T[]; paging?: { next?: string }; error?: { message?: string } };
type LinkedCreative = { id: string; meta_ad_id: string; launched_on: string; gate_evaluated_at: string | null; winner_evaluated_at: string | null; decision_source?: "automatic" | "manual"; decision_note?: string | null; backfill_classified_at?: string | null; campaign: IncentiveCampaign };
type ExistingLink = { id: string; ad_id: string; meta_ad_id: string; creator_id: string | null; editor_id: string | null; evaluation_status: string };

export const maxDuration = 300;

export async function POST() {
  const profile = await requireRole(["admin", "manager"]);
  return syncMetaIncentives(profile.id);
}

/** Invoked hourly by Vercel Cron with the same CRON_SECRET used by other jobs. */
export async function GET(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!configuredSecret || authorization !== `Bearer ${configuredSecret}`) {
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
  const { data: syncRun } = await admin.from("meta_sync_runs").insert({ actor_id: actorId }).select("id").maybeSingle();
  const syncRunId = syncRun?.id as string | undefined;
  const today = new Date().toISOString().slice(0, 10);
  const catalogStart = addDays(today, -29);
  const accountId = rawAccountId.replace(/^act_/, "");
  const accountBase = `https://graph.facebook.com/${GRAPH_VERSION}/act_${accountId}`;
  const adsUrl = graphUrl(`${accountBase}/ads`, token, { limit: "25", fields: "id,name,status,effective_status,created_time,campaign{id,name},adset{id,name},creative{id,name,thumbnail_url,image_url,video_id,object_story_spec,asset_feed_spec}" });

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
    for (const batch of chunks(chunks(metaAds.map((ad) => ad.id), 10), 3)) {
      const results = await Promise.all(batch.map((adIds) => {
        const insightsUrl = graphUrl(`${accountBase}/insights`, token, { level: "ad", limit: "100", time_increment: "1", time_range: JSON.stringify({ since: catalogStart, until: today }), filtering: JSON.stringify([{ field: "ad.id", operator: "IN", value: adIds }]), fields: "date_start,date_stop,ad_id,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values" });
        return graphPages<MetaInsightRow>(insightsUrl);
      }));
      catalogInsights.push(...results.flat());
      // Asset-breakdown availability differs by Meta API version and account.
      // Never discard the authoritative ad/day response when this optional
      // breakdown is unavailable.
      const assetResults = await Promise.all(batch.map(async (adIds) => fetchAssetBreakdown(accountBase, token, adIds, catalogStart, today, (message) => { assetBreakdownError ??= message; })));
      assetInsights.push(...assetResults.flat());
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
    const assetRows = uniqueAssetRows(assetInsights, metaAds, syncedAt);
    // Once Meta has returned its Creative → Media breakdown, remove only the
    // old generated catalog rows for those ads. Historical media insight rows
    // are retained, while generic `Video <id>`/`Image <hash>` placeholders are
    // replaced by the exact labels Meta reports (for example, `Video X.mp4
    // (123...)`).
    const reportedAdIds = [...new Set(assetInsights.filter((row) => Boolean(assetBreakdownValue(row))).map((row) => row.ad_id))];
    if (reportedAdIds.length) {
      const { error: cleanupError } = await admin.from("meta_ad_assets").delete().in("meta_ad_id", reportedAdIds).eq("source", "meta_creative");
      if (cleanupError) throw cleanupError;
      const reportedAdSet = new Set(reportedAdIds);
      const staleGeneratedIds = metaAds
        .filter((ad) => reportedAdSet.has(ad.id))
        .flatMap((ad) => creativeAssets(ad.creative).map((asset) => assetId(ad.id, asset.label)));
      for (const idBatch of chunks(staleGeneratedIds, 25)) {
        if (!idBatch.length) continue;
        const { error: staleCleanupError } = await admin.from("meta_ad_assets").delete().in("id", idBatch);
        if (staleCleanupError) throw staleCleanupError;
      }
      // Different Meta breakdowns can spell the same media differently (for
      // example, one row is only the numeric video ID while another contains
      // the filename). Collapse those aliases onto the preferred canonical
      // label before they become duplicate dashboard rows.
      if (assetRows.length) {
        const { error: assetError } = await admin.from("meta_ad_assets").upsert(assetRows, { onConflict: "id" });
        if (assetError) throw assetError;
      }
      const canonicalByMediaKey = new Map(assetRows.map((asset) => [`${asset.meta_ad_id}:${assetIdentifier(asset.asset_label) ?? asset.asset_label}`, asset.id]));
      const existingAssetRows: Array<{ id: string; meta_ad_id: string; asset_label: string }> = [];
      for (const adBatch of chunks(reportedAdIds, 25)) {
        const { data: existingBatch, error: existingAssetError } = await admin.from("meta_ad_assets").select("id,meta_ad_id,asset_label").in("meta_ad_id", adBatch);
        if (existingAssetError) throw existingAssetError;
        existingAssetRows.push(...(existingBatch ?? []));
      }
      for (const asset of existingAssetRows) {
        const canonicalId = canonicalByMediaKey.get(`${asset.meta_ad_id}:${assetIdentifier(asset.asset_label) ?? asset.asset_label}`);
        if (canonicalId && canonicalId !== asset.id) {
          await admin.from("meta_ad_asset_daily_metrics").update({ meta_asset_id: canonicalId }).eq("meta_asset_id", asset.id);
        }
      }
      const duplicateIds = existingAssetRows
        .filter((asset) => {
          const canonicalId = canonicalByMediaKey.get(`${asset.meta_ad_id}:${assetIdentifier(asset.asset_label) ?? asset.asset_label}`);
          return Boolean(canonicalId && canonicalId !== asset.id);
        })
        .map((asset) => asset.id);
      for (const idBatch of chunks(duplicateIds, 25)) {
        if (!idBatch.length) continue;
        const { error: duplicateCleanupError } = await admin.from("meta_ad_assets").delete().in("id", idBatch);
        if (duplicateCleanupError) throw duplicateCleanupError;
      }
    } else if (assetRows.length) {
      const { error: assetError } = await admin.from("meta_ad_assets").upsert(assetRows, { onConflict: "id" });
      if (assetError) throw assetError;
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
    const assetMetrics = [...uniqueAssetMetricsMap.values()];
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
        const results = await Promise.all(batch.map((metaAdIds) => graphPages<MetaInsightRow>(graphUrl(`${accountBase}/insights`, token, { level: "ad", limit: "100", time_increment: "1", time_range: JSON.stringify({ since: linkedStart, until: today }), filtering: JSON.stringify([{ field: "ad.id", operator: "IN", value: metaAdIds }]), fields: "date_start,ad_id,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values" }))));
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

async function fetchAssetBreakdown(accountBase: string, token: string, adIds: string[], since: string, until: string, onError: (message: string) => void) {
  const fields = "date_start,date_stop,ad_id,ad_name,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values";
  // Ads Manager can expose the same creative-level report through different
  // breakdowns depending on whether the ad is dynamic creative. Try the same
  // Creative > Media breakdown used by Ads Manager first, then asset-specific
  // fallbacks.
  const collected = new Map<string, MetaInsightRow>();
  const addRows = (rows: MetaInsightRow[], rangeOnly = false) => {
    for (const row of rows) {
      const rawLabel = assetBreakdownValue(row);
      if (!rawLabel) continue;
      const label = normalizeAssetLabel(rawLabel);
      const identifier = assetIdentifier(label) ?? label;
      const key = `${row.ad_id}:${row.date_start}:${row.date_stop ?? ""}:${identifier}`;
      if (rangeOnly && [...collected.keys()].some((existingKey) => existingKey.startsWith(`${row.ad_id}:${row.date_start}:`) && existingKey.endsWith(`:${identifier}`))) continue;
      const candidate = { ...row, ad_format_asset: rawLabel };
      const existing = collected.get(key);
      if (!existing || assetLabelScore(label) > assetLabelScore(normalizeAssetLabel(assetBreakdownValue(existing) ?? ""))) collected.set(key, candidate);
    }
  };
  const fetchBreakdown = async (breakdown: string) => {
    try {
      const rows = await graphPages<MetaInsightRow>(graphUrl(`${accountBase}/insights`, token, { level: "ad", limit: "100", time_increment: "1", time_range: JSON.stringify({ since, until }), filtering: JSON.stringify([{ field: "ad.id", operator: "IN", value: adIds }]), breakdowns: breakdown, fields }));
      addRows(rows);
      return rows;
    } catch (cause) {
      onError(cause instanceof Error ? `${breakdown}: ${cause.message}` : `${breakdown}: ${String(cause)}`);
      return [] as MetaInsightRow[];
    }
  };
  // Query video_asset and image_asset first because in Meta Graph API they contain
  // the exact Creative → Media filenames (e.g. "video_name": "ISH0195.mp4")
  // as displayed in Meta Ads Manager. Fall back to ad_format_asset only if empty.
  await fetchBreakdown("video_asset");
  await fetchBreakdown("image_asset");
  if (!collected.size) {
    await fetchBreakdown("ad_format_asset");
    if (!collected.size) await fetchBreakdown("creative_media_type_breakdown");
  }
  // Some accounts return the Ads Manager asset breakdown only as a range
  // total. Keep that total rather than dropping the creative metrics entirely;
  // it is anchored to date_start and remains visible when the user selects a
  // range that includes that date.
  if (!collected.size) for (const breakdown of ["ad_format_asset", "creative_media_type_breakdown"]) {
    try {
      const rows = await graphPages<MetaInsightRow>(graphUrl(`${accountBase}/insights`, token, { level: "ad", limit: "100", time_range: JSON.stringify({ since, until }), filtering: JSON.stringify([{ field: "ad.id", operator: "IN", value: adIds }]), breakdowns: breakdown, fields }));
      addRows(rows, true);
    } catch (cause) {
      onError(cause instanceof Error ? `${breakdown} total: ${cause.message}` : `${breakdown} total: ${String(cause)}`);
    }
  }
  return [...collected.values()];
}

function mergeActions(left: MetaAction[] | undefined, right: MetaAction[] | undefined) {
  const values = new Map<string, number>();
  for (const action of [...(left ?? []), ...(right ?? [])]) values.set(action.action_type, (values.get(action.action_type) ?? 0) + Number(action.value ?? 0));
  return [...values.entries()].map(([action_type, value]) => ({ action_type, value: String(value) }));
}


function uniqueAssetRows(rows: MetaInsightRow[], ads: MetaAdRow[], syncedAt: string) {
  const assets = new Map<string, { id: string; meta_ad_id: string; asset_label: string; asset_type: string | null; creative_id: string | null; thumbnail_url: string | null; source: string; last_seen_at: string }>();
  const add = (ad: MetaAdRow, label: string, type: string | null, source: string) => {
    const id = assetId(ad.id, label);
    assets.set(id, { id, meta_ad_id: ad.id, asset_label: label, asset_type: type, creative_id: ad.creative?.id ?? null, thumbnail_url: ad.creative?.thumbnail_url ?? ad.creative?.image_url ?? null, source, last_seen_at: syncedAt });
  };

  const reportedByAd = new Map<string, MetaInsightRow[]>();
  for (const row of rows) {
    if (!assetBreakdownValue(row)) continue;
    reportedByAd.set(row.ad_id, [...(reportedByAd.get(row.ad_id) ?? []), row]);
  }

  // Prefer the exact labels returned by Meta's Creative → Media report. Only
  // fall back to the creative payload when that report has no row for an ad.
  // This keeps the dashboard's names identical to Ads Manager instead of
  // surfacing generated `Video <id>`/`Image <hash>` placeholders.
  for (const ad of ads) {
    const reported = reportedByAd.get(ad.id) ?? [];
    if (reported.length) {
      for (const row of reported) {
        const rawLabel = assetBreakdownValue(row);
        if (!rawLabel) continue;
        const label = resolveAssetLabel(ad, rawLabel);
        add(ad, label, inferAssetType(label), "meta_insights");
      }
    } else {
      for (const asset of creativeAssets(ad.creative)) add(ad, asset.label, asset.type, "meta_creative");
    }
  }
  return [...assets.values()];
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
  while (next) {
    const response: Response = await fetch(next, { cache: "no-store" });
    const payload = await response.json() as MetaPayload<T>;
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
