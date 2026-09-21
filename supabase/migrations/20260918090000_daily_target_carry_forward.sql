-- Keep the original daily assignment and its completion record intact. Any
-- shortfall is represented by a separate target on the following day, making
-- the carry-over auditable and preventing a completed count from being moved.
alter table public.daily_team_targets
  add column if not exists carried_from_target_id uuid references public.daily_team_targets(id) on delete cascade;

create unique index if not exists daily_team_targets_carry_source_idx
  on public.daily_team_targets(carried_from_target_id)
  where carried_from_target_id is not null;

create or replace function public.daily_target_carry_task_name(p_task_name text)
returns text language sql immutable set search_path = public as $$
  select left(
    regexp_replace(trim(p_task_name), E' \\(carried forward\\)$', '', 'i'),
    102
  ) || ' (carried forward)'
$$;

-- Materialize normal recurring work as before, then bring forward only the
-- unfinished portion of yesterday's targets. The first day of a month has no
-- source day, so no task can cross a month boundary.
create or replace function public.materialize_daily_task_rules(p_start date, p_end date)
returns void language plpgsql security definer set search_path = public as $$
declare
  rule_row record;
  source_target record;
  day date;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  carry_day date;
  carry_target_id uuid;
  carry_quantity int;
begin
  for rule_row in
    select r.*, p.role::text as person_role
    from public.daily_task_rules r
    join public.profiles p on p.id = r.user_id
    where r.active
      and p.active
      and r.starts_on <= p_end
      and (r.ends_on is null or r.ends_on >= p_start)
  loop
    day := greatest(p_start, rule_row.starts_on, today);
    while day <= least(p_end, coalesce(rule_row.ends_on, p_end)) loop
      if extract(isodow from day) between 1 and 6 then
        insert into public.daily_team_targets (user_id, target_date, task_name, target_quantity, notes)
        values (
          rule_row.user_id,
          day,
          public.canonical_daily_target_task(rule_row.person_role, rule_row.task_name),
          rule_row.target_quantity,
          rule_row.notes
        )
        on conflict (user_id, target_date, task_name) do update set
          target_quantity = greatest(0, excluded.target_quantity - coalesce((
            select sum(subtraction.amount)
            from public.daily_target_subtractions subtraction
            where subtraction.target_id = daily_team_targets.id
          ), 0)),
          notes = excluded.notes;
      end if;
      day := day + 1;
    end loop;
  end loop;

  -- Rebuild the chain through today so a carry is not lost if nobody opens the
  -- sheet for a few days. Historical-month views and future-month views remain
  -- read-only: this only ever writes within the current month.
  if p_start > today or p_end < today then return; end if;
  carry_day := date_trunc('month', today)::date;
  while carry_day <= today loop
    if carry_day = date_trunc('month', carry_day)::date then
      carry_day := carry_day + 1;
      continue;
    end if;

    for source_target in
      select id, user_id, target_date, task_name, target_quantity, completed_quantity
      from public.daily_team_targets
      where target_date = carry_day - 1
        and target_quantity > completed_quantity
    loop
      carry_quantity := least(source_target.target_quantity - source_target.completed_quantity, 10000);
      if carry_quantity < 1 then continue; end if;

      select id into carry_target_id
      from public.daily_team_targets
      where carried_from_target_id = source_target.id
      for update;

      if found then
        update public.daily_team_targets
        set target_quantity = carry_quantity,
            notes = format('Carried forward from %s', source_target.target_date)
        where id = carry_target_id;
      else
        insert into public.daily_team_targets (
          user_id,
          target_date,
          task_name,
          target_quantity,
          notes,
          carried_from_target_id
        )
        values (
          source_target.user_id,
          carry_day,
          public.daily_target_carry_task_name(source_target.task_name),
          carry_quantity,
          format('Carried forward from %s', source_target.target_date),
          source_target.id
        )
        on conflict (user_id, target_date, task_name) do update set
          target_quantity = case
            when daily_team_targets.carried_from_target_id is not null
              then least(10000, daily_team_targets.target_quantity + excluded.target_quantity)
            else daily_team_targets.target_quantity
          end,
          notes = case
            when daily_team_targets.carried_from_target_id is not null then excluded.notes
            else daily_team_targets.notes
          end;
      end if;
    end loop;
    carry_day := carry_day + 1;
  end loop;
end;
$$;
