alter table public.incentive_creatives
  add column if not exists backfill_classified_at timestamptz;

create index if not exists incentive_creatives_backfill_idx
  on public.incentive_creatives(backfill_classified_at);
