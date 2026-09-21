import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
dotenv.config({ path: envPath });

const token = process.env.META_ACCESS_TOKEN;
const rawAccountId = process.env.META_AD_ACCOUNT_ID;
const accountId = rawAccountId?.replace(/^act_/, "");

async function checkBreakdowns() {
  const adId = "120251208058330128";
  
  // Notice: In Graph API, breakdown fields are NOT included in `fields=`, only in `breakdowns=`
  const fields = "ad_id,ad_name,spend,impressions";
  const url = `https://graph.facebook.com/v23.0/act_${accountId}/insights?level=ad&filtering=[{"field":"ad.id","operator":"IN","value":["${adId}"]}]&breakdowns=ad_format_asset&fields=${fields}&access_token=${token}`;
  
  const res = await fetch(url);
  const data = await res.json();
  console.log("Insights with breakdown ad_format_asset:", JSON.stringify(data, null, 2));

  // Also check without filtering to see some ads with breakdowns
  const sampleUrl = `https://graph.facebook.com/v23.0/act_${accountId}/insights?level=ad&date_preset=last_30d&breakdowns=ad_format_asset&fields=${fields}&limit=5&access_token=${token}`;
  const sampleRes = await fetch(sampleUrl);
  const sampleData = await sampleRes.json();
  console.log("Sample 5 breakdown rows:", JSON.stringify(sampleData, null, 2));
}

checkBreakdowns();
