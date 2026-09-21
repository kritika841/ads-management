-- A single Creative Library asset can be delivered through multiple Meta ads.
-- Preserve one incentive record per Meta ad so spend and purchases are never
-- merged or dropped during product-level historical recalibration.
alter table public.incentive_creatives
  drop constraint if exists incentive_creatives_incentive_campaign_id_ad_id_key;
