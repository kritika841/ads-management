import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const envPath = path.resolve(process.cwd(), ".env.local");
dotenv.config({ path: envPath });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAdFlowMatches() {
  const { data: ads } = await supabase
    .from("meta_ads")
    .select(`
      id,
      name,
      detected_tag,
      matched_ad_id,
      ad:ads!meta_ads_matched_ad_id_fkey(id,name),
      assets:meta_ad_assets(id,asset_label,source)
    `)
    .not("spend", "eq", 0)
    .order("spend", { ascending: false })
    .limit(15);

  console.log(`Found ${ads?.length} active ads:`);
  for (const ad of ads || []) {
    console.log(`\nMeta Ad: "${ad.name}" | Tag: ${ad.detected_tag} | Matched Lib: ${ad.ad?.name ?? "none"}`);
    for (const a of ad.assets || []) {
      console.log(`   Asset [${a.source}]: "${a.asset_label}"`);
    }
  }
}

checkAdFlowMatches();
