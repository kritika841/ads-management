-- Account-wide Meta ad catalog. Incentive creatives may optionally link to these rows.

create table public.meta_ads (
  id text primary key,
  name text not null,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  creative_id text,
  creative_name text,
  thumbnail_url text,
  status text,
  effective_status text,
  created_time timestamptz,
  spend numeric(14,2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  link_clicks bigint not null default 0,
  purchases numeric(14,2) not null default 0,
  revenue numeric(14,2) not null default 0,
  cpa numeric(12,2),
  insights_from date,
  insights_to date,
  last_synced_at timestamptz not null default now()
);

create index meta_ads_campaign_idx on public.meta_ads(campaign_id);
create index meta_ads_effective_status_idx on public.meta_ads(effective_status);
create index meta_ads_last_synced_idx on public.meta_ads(last_synced_at desc);

alter table public.meta_ads enable row level security;

create policy "reviewers view Meta ad catalog"
on public.meta_ads for select
using (public.is_reviewer());

