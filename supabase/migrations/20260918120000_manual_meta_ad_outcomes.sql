-- A reporting outcome belongs to the Meta ad itself. It deliberately does not
-- create or modify an incentive campaign link, incentive calculation, or payout.
alter table public.meta_ads
  add column if not exists manual_outcome text
    check (manual_outcome in ('unreviewed', 'winner', 'loser', 'needs_iteration', 'keep_testing')),
  add column if not exists manual_outcome_at timestamptz,
  add column if not exists manual_outcome_by uuid references public.profiles(id);

create index if not exists meta_ads_manual_outcome_idx
  on public.meta_ads(manual_outcome)
  where manual_outcome is not null;
