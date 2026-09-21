import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const envPath = path.resolve(process.cwd(), ".env.local");
dotenv.config({ path: envPath });

const token = process.env.META_ACCESS_TOKEN;
const rawAccountId = process.env.META_AD_ACCOUNT_ID?.replace(/^act_/, "");
const accountBase = `https://graph.facebook.com/v23.0/act_${rawAccountId}`;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function chunks(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
  return result;
}

async function fetchAllPages(url) {
  const rows = [];
  let current = url;
  while (current) {
    const res = await fetch(current);
    const data = await res.json();
    if (data.data) rows.push(...data.data);
    current = data.paging?.next ?? null;
  }
  return rows;
}

async function fullResync() {
  console.log("1. Loading all active ads from database...");
  const { data: ads } = await supabase
    .from("meta_ads")
    .select("id,name,spend,detected_tag")
    .gt("spend", 0)
    .order("spend", { ascending: false });

  console.log(`Found ${ads?.length} active ads with spend > 0.`);
  const adIds = ads.map(a => a.id);

  console.log("2. Querying Meta API with limit=100 & pagination for video_asset and image_asset breakdowns...");
  const metaAssets = [];

  for (const batch of chunks(adIds, 10)) {
    const vUrl = `${accountBase}/insights?level=ad&limit=100&date_preset=maximum&breakdowns=video_asset&fields=ad_id,ad_name,spend,impressions&filtering=[{"field":"ad.id","operator":"IN","value":${JSON.stringify(batch)}}]&access_token=${token}`;
    const vRows = await fetchAllPages(vUrl);
    for (const row of vRows) {
      const va = row.video_asset;
      if (!va) continue;
      const filename = va.video_name || va.name;
      const id = va.id;
      const videoId = va.video_id;
      if (filename && id) {
        metaAssets.push({
          adId: row.ad_id,
          id,
          videoId,
          filename,
          type: "video",
          label: /\.(mp4|mov|m4v|webm)$/i.test(filename) ? `Video ${filename} (${id})` : `Video ${filename}`
        });
      }
    }

    const iUrl = `${accountBase}/insights?level=ad&limit=100&date_preset=maximum&breakdowns=image_asset&fields=ad_id,ad_name,spend,impressions&filtering=[{"field":"ad.id","operator":"IN","value":${JSON.stringify(batch)}}]&access_token=${token}`;
    const iRows = await fetchAllPages(iUrl);
    for (const row of iRows) {
      const ia = row.image_asset;
      if (!ia) continue;
      const filename = ia.name || ia.filename;
      const id = ia.id || ia.hash;
      if (filename && id) {
        metaAssets.push({
          adId: row.ad_id,
          id,
          filename,
          type: "image",
          label: `Image ${filename} (${id})`
        });
      }
    }
  }

  console.log(`Retrieved ${metaAssets.length} canonical media assets from Meta.`);

  console.log("3. Fetching current meta_ad_assets from Supabase...");
  const { data: currentAssets } = await supabase
    .from("meta_ad_assets")
    .select("id,meta_ad_id,asset_label");

  let updatedCount = 0;
  let insertedCount = 0;

  for (const ma of metaAssets) {
    const newId = `${ma.adId}:${encodeURIComponent(ma.label)}`;
    // Find matching existing asset by adId and id or videoId
    const matching = (currentAssets || []).filter(ca =>
      ca.meta_ad_id === ma.adId &&
      (ca.asset_label.includes(ma.id) || (ma.videoId && ca.asset_label.includes(ma.videoId)) || ca.id.includes(ma.id))
    );

    if (matching.length) {
      for (const existing of matching) {
        if (existing.asset_label !== ma.label || existing.id !== newId) {
          console.log(`Updating ad ${ma.adId}:\n  OLD: "${existing.asset_label}"\n  NEW: "${ma.label}"`);
          // 1. Insert new canonical row
          await supabase.from("meta_ad_assets").upsert({
            id: newId,
            meta_ad_id: ma.adId,
            asset_label: ma.label,
            asset_type: ma.type,
            source: "meta_insights",
            last_seen_at: new Date().toISOString()
          });

          // 2. Migrate daily metrics
          await supabase.from("meta_ad_asset_daily_metrics")
            .update({ meta_asset_id: newId })
            .eq("meta_asset_id", existing.id);

          // 3. Delete old row if different ID
          if (existing.id !== newId) {
            await supabase.from("meta_ad_assets").delete().eq("id", existing.id);
          }
          updatedCount++;
        }
      }
    } else {
      // New asset not in DB
      const { error: insErr } = await supabase.from("meta_ad_assets").upsert({
        id: newId,
        meta_ad_id: ma.adId,
        asset_label: ma.label,
        asset_type: ma.type,
        source: "meta_insights",
        last_seen_at: new Date().toISOString()
      });
      if (!insErr) insertedCount++;
    }
  }

  console.log(`\nDONE! Summary:`);
  console.log(`- Canonical Meta assets retrieved: ${metaAssets.length}`);
  console.log(`- Updated to canonical filenames: ${updatedCount}`);
  console.log(`- Inserted new canonical assets: ${insertedCount}`);
}

fullResync().catch(console.error);
