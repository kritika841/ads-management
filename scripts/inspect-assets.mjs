import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const envPath = path.resolve(process.cwd(), ".env.local");
dotenv.config({ path: envPath });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspect() {
  const { data: assets, error: assetErr } = await supabase
    .from("meta_ad_assets")
    .select("id,meta_ad_id,asset_label,source")
    .limit(30);

  if (assetErr) {
    console.error("Asset error:", assetErr);
  } else {
    console.log("Found", assets?.length, "assets:");
    for (const a of assets || []) {
      console.log(`- [${a.source}] ad:${a.meta_ad_id} => "${a.asset_label}" (id: ${a.id})`);
    }
  }

  const { data: ads } = await supabase
    .from("meta_ads")
    .select("id,name,spend,assets:meta_ad_assets(id,asset_label,source)")
    .order("spend", { ascending: false })
    .limit(5);

  console.log("\nTop 5 Ads with assets:");
  for (const ad of ads || []) {
    console.log(`\nAd "${ad.name}" (${ad.id}) - spend: ${ad.spend}`);
    for (const a of ad.assets || []) {
      console.log(`   -> [${a.source}] "${a.asset_label}"`);
    }
  }
}

inspect();
