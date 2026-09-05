create table if not exists public.daily_team_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_date date not null,
  task_name text not null check (char_length(trim(task_name)) between 1 and 120),
  target_quantity int not null default 0 check (target_quantity between 0 and 10000),
  completed_quantity int not null default 0 check (completed_quantity between 0 and 10000),
  notes text check (notes is null or char_length(notes) <= 500),
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, target_date, task_name)
);

create index if not exists daily_team_targets_user_date_idx on public.daily_team_targets(user_id, target_date);
create index if not exists daily_team_targets_date_idx on public.daily_team_targets(target_date);

drop trigger if exists daily_team_targets_set_updated_at on public.daily_team_targets;
create trigger daily_team_targets_set_updated_at before update on public.daily_team_targets
for each row execute function public.set_updated_at();

alter table public.daily_team_targets enable row level security;

drop policy if exists "reviewers view all daily targets" on public.daily_team_targets;
create policy "reviewers view all daily targets" on public.daily_team_targets for select using (public.is_reviewer());
drop policy if exists "team members view own daily targets" on public.daily_team_targets;
create policy "team members view own daily targets" on public.daily_team_targets for select using (user_id = auth.uid());
drop policy if exists "reviewers manage daily targets" on public.daily_team_targets;
create policy "reviewers manage daily targets" on public.daily_team_targets for all using (public.is_reviewer()) with check (public.is_reviewer());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_team_targets') then
    alter publication supabase_realtime add table public.daily_team_targets;
  end if;
end
$$;
