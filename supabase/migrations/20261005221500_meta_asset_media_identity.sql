-- Per-creative media identity for Meta ad assets.
--
-- Previously every asset row inherited its parent ad's creative thumbnail and
-- had no media identifier, so previews could only resolve the ad's primary
-- video. These columns store the exact media Meta reports for each creative
-- (from the video_asset / image_asset breakdowns or the creative's
-- asset_feed_spec). `asset_label` is intentionally unchanged so existing rows
-- and their daily metrics keep lining up.
alter table public.meta_ad_assets add column if not exists video_id text;
alter table public.meta_ad_assets add column if not exists image_hash text;

comment on column public.meta_ad_assets.video_id is 'Meta video ID of this specific creative (not the parent ad primary video).';
comment on column public.meta_ad_assets.image_hash is 'Meta image hash of this specific creative.';
comment on column public.meta_ad_assets.thumbnail_url is 'Thumbnail of this specific creative; falls back to the ad thumbnail only for single-creative ads.';

create index if not exists meta_ad_assets_video_idx on public.meta_ad_assets(meta_ad_id, video_id) where video_id is not null;
