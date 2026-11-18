-- Additional campaigns share the original creative and its workflow history.
create table if not exists public.ad_campaigns (
  ad_id uuid not null references public.ads(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  primary key (ad_id, campaign_id)
);

create index if not exists ad_campaigns_campaign_id_idx on public.ad_campaigns (campaign_id);
alter table public.ad_campaigns enable row level security;
drop policy if exists "Users can read campaign links for visible ads" on public.ad_campaigns;
create policy "Users can read campaign links for visible ads"
  on public.ad_campaigns for select to authenticated
  using (exists (select 1 from public.ads where ads.id = ad_campaigns.ad_id));
grant select on public.ad_campaigns to authenticated;
grant all on public.ad_campaigns to service_role;
notify pgrst, 'reload schema';
