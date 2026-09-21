import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
dotenv.config({ path: envPath });

const token = process.env.META_ACCESS_TOKEN;
const rawAccountId = process.env.META_AD_ACCOUNT_ID;
const accountId = rawAccountId?.replace(/^act_/, "");

async function checkAllBreakdowns() {
  const breakdowns = [
    "video_asset",
    "image_asset",
    "creative_media_type_breakdown",
    "ad_format_asset",
    "media_format"
  ];
  const fields = "ad_id,ad_name,spend,impressions";
  for (const b of breakdowns) {
    const url = `https://graph.facebook.com/v23.0/act_${accountId}/insights?level=ad&date_preset=maximum&breakdowns=${b}&fields=${fields}&limit=3&access_token=${token}`;
    const res = await fetch(url);
    const data = await res.json();
    console.log(`Breakdown ${b}:`, data.data?.length ? JSON.stringify(data.data[0], null, 2) : "0 rows or error: " + JSON.stringify(data.error?.message || "empty"));
  }
}

checkAllBreakdowns();
