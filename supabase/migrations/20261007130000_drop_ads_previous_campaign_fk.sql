-- `ads.previous_campaign_id` (added in 20261006120000) only remembers which campaign a creative
-- belonged to so a Recycle Bin restore can re-link it. Declaring it as a second foreign key from
-- ads to campaigns made every PostgREST embed `campaign:campaigns(...)` ambiguous ("more than one
-- relationship was found for 'ads' and 'campaigns'"), which broke the Creative Library and every
-- other page that loads creatives with their campaign. Keep the column, drop the constraint.
-- Dangling ids are harmless: purgeCampaign() clears them when a campaign is permanently deleted.
alter table public.ads drop constraint if exists ads_previous_campaign_id_fkey;

notify pgrst, 'reload schema';
