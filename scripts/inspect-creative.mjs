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
  const { data: ads, error } = await supabase
    .from("meta_ads")
    .select("id,name,creative_id,creative_name,matched_ad_id,detected_tag")
    .limit(10);

  console.log("Ads:", JSON.stringify(ads, null, 2));

  // Also check if there are ads with matched_ad_id in `ads` table
  const { data: libraryAds } = await supabase
    .from("ads")
    .select("id,name,product_id")
    .limit(10);
  console.log("Library Ads:", JSON.stringify(libraryAds, null, 2));

  // Check meta_ad_transcript_mappings
  const { data: transcriptMappings } = await supabase
    .from("meta_ad_transcript_mappings")
    .select("meta_ad_id,meta_video_id,matched_ad_id")
    .limit(10);
  console.log("Transcript Mappings:", JSON.stringify(transcriptMappings, null, 2));
}

inspect();
