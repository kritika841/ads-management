alter table public.incentive_campaigns
  add column if not exists meta_campaign_ids text[] not null default '{}';

create index if not exists incentive_campaigns_meta_ids_idx
  on public.incentive_campaigns using gin(meta_campaign_ids);
