-- 20261012120000_media_buyer_library_view_access.sql
-- Allow media buyers to view all ads in the creative library and read Meta catalog assets

drop policy if exists "media buyers view all ads" on public.ads;
create policy "media buyers view all ads"
on public.ads for select
using (public.current_profile_role() = 'media_buyer');

-- Allow media buyers to view meta ads and metrics
drop policy if exists "media buyers view Meta ad catalog" on public.meta_ads;
create policy "media buyers view Meta ad catalog"
on public.meta_ads for select
using (public.current_profile_role() = 'media_buyer');

drop policy if exists "media buyers view Meta ad assets" on public.meta_ad_assets;
create policy "media buyers view Meta ad assets"
on public.meta_ad_assets for select
using (public.current_profile_role() = 'media_buyer');

drop policy if exists "media buyers view Meta ad daily metrics" on public.meta_ad_daily_metrics;
create policy "media buyers view Meta ad daily metrics"
on public.meta_ad_daily_metrics for select
using (public.current_profile_role() = 'media_buyer');

drop policy if exists "media buyers view Meta ad asset daily metrics" on public.meta_ad_asset_daily_metrics;
create policy "media buyers view Meta ad asset daily metrics"
on public.meta_ad_asset_daily_metrics for select
using (public.current_profile_role() = 'media_buyer');

drop policy if exists "media buyers view transcript mappings" on public.meta_ad_transcript_mappings;
create policy "media buyers view transcript mappings"
on public.meta_ad_transcript_mappings for select
using (public.current_profile_role() = 'media_buyer');

notify pgrst, 'reload schema';
