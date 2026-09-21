-- Meta Insights is the reporting source of truth. Keep daily rows at both the
-- ad and atomic creative-asset grain so dashboard date filters never rely on
-- bundled preview data.

create table if not exists public.meta_ad_daily_metrics (
  meta_ad_id text not null references public.meta_ads(id) on delete cascade,
  metric_date date not null,
  spend numeric(14,2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  link_clicks bigint not null default 0,
  purchases numeric(14,2) not null default 0,
  revenue numeric(14,2) not null default 0,
  synced_at timestamptz not null default now(),
  primary key (meta_ad_id, metric_date)
);

create index if not exists meta_ad_daily_metrics_date_idx
  on public.meta_ad_daily_metrics(metric_date desc);

create table if not exists public.meta_ad_assets (
  id text primary key,
  meta_ad_id text not null references public.meta_ads(id) on delete cascade,
  asset_label text not null,
  asset_type text,
  creative_id text,
  thumbnail_url text,
  source text not null default 'meta_insights',
  last_seen_at timestamptz not null default now(),
  unique (meta_ad_id, asset_label)
);

create index if not exists meta_ad_assets_ad_idx on public.meta_ad_assets(meta_ad_id);

create table if not exists public.meta_ad_asset_daily_metrics (
  meta_asset_id text not null references public.meta_ad_assets(id) on delete cascade,
  metric_date date not null,
  spend numeric(14,2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  link_clicks bigint not null default 0,
  purchases numeric(14,2) not null default 0,
  revenue numeric(14,2) not null default 0,
  synced_at timestamptz not null default now(),
  primary key (meta_asset_id, metric_date)
);

create index if not exists meta_ad_asset_daily_metrics_date_idx
  on public.meta_ad_asset_daily_metrics(metric_date desc);

alter table public.meta_ad_daily_metrics enable row level security;
alter table public.meta_ad_assets enable row level security;
alter table public.meta_ad_asset_daily_metrics enable row level security;

drop policy if exists "reviewers view Meta ad daily metrics" on public.meta_ad_daily_metrics;
create policy "reviewers view Meta ad daily metrics"
  on public.meta_ad_daily_metrics for select using (public.is_reviewer());

drop policy if exists "reviewers view Meta ad assets" on public.meta_ad_assets;
create policy "reviewers view Meta ad assets"
  on public.meta_ad_assets for select using (public.is_reviewer());

drop policy if exists "reviewers view Meta ad asset daily metrics" on public.meta_ad_asset_daily_metrics;
create policy "reviewers view Meta ad asset daily metrics"
  on public.meta_ad_asset_daily_metrics for select using (public.is_reviewer());
