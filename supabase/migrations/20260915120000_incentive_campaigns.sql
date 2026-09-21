-- Product-level creative incentive campaigns backed by daily Meta ad performance.

create table public.incentive_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_id uuid not null references public.products(id),
  daily_submission_target integer not null check (daily_submission_target > 0),
  target_cpa numeric(12,2) not null check (target_cpa > 0),
  gate_days integer not null default 3 check (gate_days > 0),
  winner_window_days integer not null default 10 check (winner_window_days >= gate_days),
  evaluation_mode text not null default 'cumulative' check (evaluation_mode in ('cumulative', 'daily')),
  creator_incentive_amount numeric(12,2) not null default 0 check (creator_incentive_amount >= 0),
  editor_incentive_amount numeric(12,2) not null default 0 check (editor_incentive_amount >= 0),
  starts_on date not null,
  ends_on date,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);

create table public.incentive_creatives (
  id uuid primary key default gen_random_uuid(),
  incentive_campaign_id uuid not null references public.incentive_campaigns(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  meta_ad_id text not null,
  launched_on date not null,
  evaluation_status text not null default 'gate_testing'
    check (evaluation_status in ('gate_testing', 'gate_passed', 'winner', 'failed')),
  gate_evaluated_at timestamptz,
  winner_evaluated_at timestamptz,
  latest_cpa numeric(12,2),
  latest_spend numeric(14,2) not null default 0,
  latest_purchases numeric(14,2) not null default 0,
  last_synced_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (incentive_campaign_id, ad_id),
  unique (incentive_campaign_id, meta_ad_id)
);

create table public.incentive_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  incentive_creative_id uuid not null references public.incentive_creatives(id) on delete cascade,
  metric_date date not null,
  spend numeric(14,2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  link_clicks bigint not null default 0,
  purchases numeric(14,2) not null default 0,
  revenue numeric(14,2) not null default 0,
  synced_at timestamptz not null default now(),
  unique (incentive_creative_id, metric_date)
);

create index incentive_campaigns_product_idx on public.incentive_campaigns(product_id);
create index incentive_creatives_ad_idx on public.incentive_creatives(ad_id);
create index incentive_creatives_meta_ad_idx on public.incentive_creatives(meta_ad_id);
create index incentive_daily_metrics_creative_date_idx on public.incentive_daily_metrics(incentive_creative_id, metric_date);

create trigger incentive_campaigns_set_updated_at
before update on public.incentive_campaigns
for each row execute function public.set_updated_at();

create trigger incentive_creatives_set_updated_at
before update on public.incentive_creatives
for each row execute function public.set_updated_at();

alter table public.incentive_campaigns enable row level security;
alter table public.incentive_creatives enable row level security;
alter table public.incentive_daily_metrics enable row level security;

create policy "active users view incentive campaigns"
on public.incentive_campaigns for select
using (public.current_profile_role() is not null);

create policy "reviewers manage incentive campaigns"
on public.incentive_campaigns for all
using (public.is_reviewer())
with check (public.is_reviewer());

create policy "users view their incentive creatives"
on public.incentive_creatives for select
using (
  public.is_reviewer()
  or exists (
    select 1 from public.ads
    where ads.id = incentive_creatives.ad_id
      and (ads.creator_id = auth.uid() or ads.editor_id = auth.uid())
  )
);

create policy "users link their own creatives"
on public.incentive_creatives for insert
with check (
  public.is_reviewer()
  or exists (
    select 1 from public.ads
    where ads.id = incentive_creatives.ad_id
      and ads.creator_id = auth.uid()
  )
);

create policy "reviewers manage incentive creatives"
on public.incentive_creatives for all
using (public.is_reviewer())
with check (public.is_reviewer());

create policy "users view metrics for their incentive creatives"
on public.incentive_daily_metrics for select
using (
  exists (
    select 1
    from public.incentive_creatives ic
    join public.ads on ads.id = ic.ad_id
    where ic.id = incentive_daily_metrics.incentive_creative_id
      and (public.is_reviewer() or ads.creator_id = auth.uid() or ads.editor_id = auth.uid())
  )
);

