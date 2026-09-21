-- Performance views, manual decisions, payout workflow, and sync run history.
alter table public.incentive_creatives
  add column if not exists decision_status text not null default 'unreviewed'
    check (decision_status in ('unreviewed', 'winner', 'loser', 'needs_iteration', 'keep_testing')),
  add column if not exists decision_source text not null default 'automatic'
    check (decision_source in ('automatic', 'manual')),
  add column if not exists incentive_status text not null default 'pending_testing'
    check (incentive_status in ('eligible', 'not_eligible', 'pending_testing', 'failed_cpa', 'approved_for_payout', 'paid')),
  add column if not exists payout_status text not null default 'not_ready'
    check (payout_status in ('not_ready', 'pending', 'approved', 'paid')),
  add column if not exists payout_month text,
  add column if not exists decision_note text,
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by uuid references public.profiles(id);

create index if not exists incentive_creatives_decision_idx on public.incentive_creatives(decision_status);
create index if not exists incentive_creatives_payout_idx on public.incentive_creatives(payout_status, payout_month);

create table if not exists public.meta_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  rows_fetched integer not null default 0,
  new_ads integer not null default 0,
  matched_creatives integer not null default 0,
  unmatched_creatives integer not null default 0,
  error_message text,
  duration_ms integer,
  actor_id uuid references public.profiles(id)
);
alter table public.meta_sync_runs enable row level security;
drop policy if exists "reviewers view Meta sync runs" on public.meta_sync_runs;
create policy "reviewers view Meta sync runs" on public.meta_sync_runs for select using (public.is_reviewer());
drop policy if exists "reviewers insert Meta sync runs" on public.meta_sync_runs;
create policy "reviewers insert Meta sync runs" on public.meta_sync_runs for insert with check (public.is_reviewer());
