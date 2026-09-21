import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
dotenv.config({ path: envPath });

const token = process.env.META_ACCESS_TOKEN;
const rawAccountId = process.env.META_AD_ACCOUNT_ID;
const accountId = rawAccountId?.replace(/^act_/, "");

async function checkRecentVideoAssets() {
  const fields = "ad_id,ad_name,spend,impressions";
  // Filter for the last 30 days
  const url = `https://graph.facebook.com/v23.0/act_${accountId}/insights?level=ad&date_preset=last_30d&breakdowns=video_asset&fields=${fields}&limit=10&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  console.log("Found rows:", data.data?.length);
  for (const row of data.data || []) {
    console.log(`\nAd "${row.ad_name}" (${row.ad_id})`);
    console.log("video_asset:", JSON.stringify(row.video_asset, null, 2));
  }
}

checkRecentVideoAssets();
