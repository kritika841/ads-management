create table if not exists public.daily_task_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_name text not null check (char_length(trim(task_name)) between 1 and 120),
  target_quantity int not null check (target_quantity between 1 and 10000),
  notes text check (notes is null or char_length(notes) <= 500),
  active boolean not null default true,
  starts_on date not null default (now() at time zone 'Asia/Kolkata')::date,
  ends_on date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);

create table if not exists public.daily_target_day_settings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_date date not null,
  mode text not null check (mode in ('append', 'auto_only')) default 'append',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_date)
);

create table if not exists public.daily_target_subtractions (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.daily_team_targets(id) on delete cascade,
  amount int not null check (amount > 0 and amount <= 10000),
  reason text not null check (char_length(trim(reason)) between 1 and 500),
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists daily_task_rules_user_idx on public.daily_task_rules(user_id, active, starts_on);
create index if not exists daily_target_subtractions_target_idx on public.daily_target_subtractions(target_id);

alter table public.daily_task_rules enable row level security;
alter table public.daily_target_day_settings enable row level security;
alter table public.daily_target_subtractions enable row level security;
create policy "reviewers manage daily task rules" on public.daily_task_rules for all using (public.is_reviewer()) with check (public.is_reviewer());
create policy "team members view own daily task rules" on public.daily_task_rules for select using (user_id = auth.uid());
create policy "reviewers manage daily day settings" on public.daily_target_day_settings for all using (public.is_reviewer()) with check (public.is_reviewer());
create policy "team members view own daily day settings" on public.daily_target_day_settings for select using (user_id = auth.uid());
create policy "reviewers manage daily subtractions" on public.daily_target_subtractions for all using (public.is_reviewer()) with check (public.is_reviewer());
create policy "team members view own daily subtractions" on public.daily_target_subtractions for select using (exists (select 1 from public.daily_team_targets t where t.id = target_id and t.user_id = auth.uid()));

create or replace function public.materialize_daily_task_rules(p_start date, p_end date)
returns void language plpgsql security definer set search_path = public as $$
declare rule_row record; setting_row record; day date; existing_id uuid; day_mode text;
begin
  for setting_row in select user_id, target_date from public.daily_target_day_settings where target_date between p_start and p_end and mode = 'auto_only' loop
    update public.daily_team_targets set target_quantity = 0
      where user_id = setting_row.user_id and target_date = setting_row.target_date and assigned_by is not null;
  end loop;
  for rule_row in select r.*, p.role::text as person_role from public.daily_task_rules r join public.profiles p on p.id = r.user_id
    where r.active and p.active and r.starts_on <= p_end and (r.ends_on is null or r.ends_on >= p_start)
  loop
    day := greatest(p_start, rule_row.starts_on);
    while day <= least(p_end, coalesce(rule_row.ends_on, p_end)) loop
      select mode into day_mode from public.daily_target_day_settings where user_id = rule_row.user_id and target_date = day;
      if extract(isodow from day) between 1 and 6 and coalesce(day_mode, 'append') = 'auto_only' then
        update public.daily_team_targets set target_quantity = 0
          where user_id = rule_row.user_id and target_date = day and assigned_by is not null;
      end if;
      if extract(isodow from day) between 1 and 6 and (coalesce(day_mode, 'append') <> 'auto_only' or not exists (select 1 from public.daily_team_targets where user_id = rule_row.user_id and target_date = day and assigned_by is null)) then
        insert into public.daily_team_targets (user_id, target_date, task_name, target_quantity, notes)
        values (rule_row.user_id, day, public.canonical_daily_target_task(rule_row.person_role, rule_row.task_name), rule_row.target_quantity, rule_row.notes)
        on conflict (user_id, target_date, task_name) do update set target_quantity = excluded.target_quantity, notes = excluded.notes;
      end if;
      day := day + 1;
    end loop;
  end loop;
end;
$$;

revoke all on function public.materialize_daily_task_rules(date, date) from public, anon;
grant execute on function public.materialize_daily_task_rules(date, date) to authenticated, service_role;
