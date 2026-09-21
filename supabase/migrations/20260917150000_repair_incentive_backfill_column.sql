-- Repair for a previously skipped, duplicate-version migration. Keep this
-- independently versioned so hosted Supabase can record it unambiguously.
alter table public.incentive_creatives
  add column if not exists backfill_classified_at timestamptz;

create index if not exists incentive_creatives_backfill_idx
  on public.incentive_creatives(backfill_classified_at);
