import path from "node:path";
import dotenv from "dotenv";
import {
  normalizeAssetLabel,
  assetBreakdownValue,
  assetIdentifier,
  assetLabelScore
} from "../lib/meta-asset-labels.js";

const envPath = path.resolve(process.cwd(), ".env.local");
dotenv.config({ path: envPath });

const token = process.env.META_ACCESS_TOKEN;
const rawAccountId = process.env.META_AD_ACCOUNT_ID?.replace(/^act_/, "");
const accountBase = `https://graph.facebook.com/v23.0/act_${rawAccountId}`;

async function testFetch() {
  const fields = "date_start,date_stop,ad_id,ad_name,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values";
  
  // Test with video_asset breakdown on last 30 days
  const url = `${accountBase}/insights?level=ad&limit=25&time_range=${JSON.stringify({ since: "2026-08-20", until: "2026-09-19" })}&breakdowns=video_asset&fields=${fields}&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  
  console.log("Returned rows:", data.data?.length);
  for (const row of (data.data || []).slice(0, 8)) {
    const raw = assetBreakdownValue(row);
    const norm = normalizeAssetLabel(raw);
    console.log(`Ad "${row.ad_name}" (${row.ad_id}) => Raw:`, raw, `\nNormalized: "${norm}" | Score: ${assetLabelScore(raw)}`);
  }
}

testFetch();
