import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
dotenv.config({ path: envPath });

const token = process.env.META_ACCESS_TOKEN;
const rawAccountId = process.env.META_AD_ACCOUNT_ID;
const accountId = rawAccountId?.replace(/^act_/, "");

async function checkMeta() {
  if (!token || !accountId) {
    console.log("No token or account ID");
    return;
  }

  // Check one ad: 120251208058330128 (ISH0175) or 120251208058400128 (TAM0147)
  const adId = "120251208058330128";
  console.log("Fetching ad info for", adId);

  const adRes = await fetch(
    `https://graph.facebook.com/v23.0/${adId}?fields=id,name,creative{id,name,title,body,thumbnail_url,video_id,object_story_spec,asset_feed_spec}&access_token=${token}`
  );
  const adJson = await adRes.json();
  console.log("Ad info:", JSON.stringify(adJson, null, 2));

  if (adJson.creative?.video_id) {
    const videoRes = await fetch(
      `https://graph.facebook.com/v23.0/${adJson.creative.video_id}?fields=id,title,description,source,published&access_token=${token}`
    );
    console.log("Video info:", JSON.stringify(await videoRes.json(), null, 2));
  }

  // Check insights breakdown for this ad
  const insightsRes = await fetch(
    `https://graph.facebook.com/v23.0/act_${accountId}/insights?level=ad&filtering=[{"field":"ad.id","operator":"IN","value":["${adId}"]}]&breakdowns=ad_format_asset&fields=ad_id,ad_format_asset,spend,impressions&access_token=${token}`
  );
  console.log("Insights ad_format_asset:", JSON.stringify(await insightsRes.json(), null, 2));

  const insightsVideoRes = await fetch(
    `https://graph.facebook.com/v23.0/act_${accountId}/insights?level=ad&filtering=[{"field":"ad.id","operator":"IN","value":["${adId}"]}]&breakdowns=video_asset&fields=ad_id,video_asset,spend,impressions&access_token=${token}`
  );
  console.log("Insights video_asset:", JSON.stringify(await insightsVideoRes.json(), null, 2));
}

checkMeta();
