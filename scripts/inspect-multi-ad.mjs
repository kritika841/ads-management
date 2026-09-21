import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const envPath = path.resolve(process.cwd(), ".env.local");
dotenv.config({ path: envPath });

const token = process.env.META_ACCESS_TOKEN;
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectMultiAd() {
  // Find the ad with the 10 videos
  const { data: ads } = await supabase
    .from("meta_ads")
    .select("id,name,creative_id")
    .ilike("name", "%HIM0162%")
    .limit(1);

  const ad = ads?.[0];
  console.log("Found ad:", ad);
  if (!ad) return;

  // 1. Fetch ad details from Meta
  const adRes = await fetch(
    `https://graph.facebook.com/v23.0/${ad.id}?fields=id,name,creative{id,name,video_id,asset_feed_spec,object_story_spec}&access_token=${token}`
  );
  const adData = await adRes.json();
  console.log("Meta Ad creative:", JSON.stringify(adData.creative, null, 2));

  // 2. Fetch video_asset breakdown from insights for this ad
  const rawAccountId = process.env.META_AD_ACCOUNT_ID?.replace(/^act_/, "");
  const insRes = await fetch(
    `https://graph.facebook.com/v23.0/act_${rawAccountId}/insights?level=ad&filtering=[{"field":"ad.id","operator":"IN","value":["${ad.id}"]}]&breakdowns=video_asset&fields=ad_id,spend,impressions&access_token=${token}`
  );
  const insData = await insRes.json();
  console.log("Insights video_asset for this ad:", JSON.stringify(insData, null, 2));
}

inspectMultiAd();
