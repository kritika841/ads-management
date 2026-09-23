-- 20260923110000_daily_targets_carry_reconciliation_and_triggers.sql
-- 1. Support surplus reconciliation: excess completions on base tasks credit carried forward tasks.
-- 2. Prevent carried forward tasks from persisting when excess daily work has cleared the deficit.
-- 3. Enhance ads_sync_daily_target_progress trigger to catch resubmissions and materialized rule auto-updates.

-- Reconcile surplus completions across daily targets for a given user and date
create or replace function public.reconcile_daily_target_surplus(p_user_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  total_base_surplus int := 0;
  carried_deficit int := 0;
  alloc int := 0;
  base_row record;
  carried_row record;
begin
  -- Calculate total surplus from base (non-carried) targets
  for base_row in
    select id, task_name, target_quantity, completed_quantity
    from public.daily_team_targets
    where user_id = p_user_id
      and target_date = p_date
      and carried_from_target_id is null
      and task_name not like '%(carried forward)%'
      and completed_quantity > target_quantity
  loop
    total_base_surplus := total_base_surplus + (base_row.completed_quantity - base_row.target_quantity);
  end loop;

  if total_base_surplus <= 0 then return; end if;

  -- Apply surplus to carried forward targets on the same date that are incomplete
  for carried_row in
    select id, task_name, target_quantity, completed_quantity, manual_completed_quantity, auto_completed_quantity
    from public.daily_team_targets
    where user_id = p_user_id
      and target_date = p_date
      and (carried_from_target_id is not null or task_name like '%(carried forward)%')
      and target_quantity > completed_quantity
    order by id
    for update
  loop
    carried_deficit := carried_row.target_quantity - carried_row.completed_quantity;
    alloc := least(total_base_surplus, carried_deficit);
    if alloc > 0 then
      update public.daily_team_targets
      set auto_completed_quantity = auto_completed_quantity + alloc,
          completed_quantity = completed_quantity + alloc
      where id = carried_row.id;
      total_base_surplus := total_base_surplus - alloc;
    end if;
    exit when total_base_surplus <= 0;
  end loop;
end;
$$;

-- Enhanced save_daily_target_progress that allows carried forward rows and runs reconciliation
create or replace function public.save_daily_target_progress(
  p_actor_id uuid,
  p_target_id uuid,
  p_user_id uuid,
  p_target_date date,
  p_task_name text,
  p_quantity int
)
returns public.daily_team_targets
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  person_role text;
  canonical_name text;
  existing public.daily_team_targets%rowtype;
begin
  select role::text into actor_role from public.profiles where id = p_actor_id and active = true;
  if actor_role is null or (p_actor_id <> p_user_id and actor_role not in ('admin', 'manager')) then
    raise exception 'You cannot update this progress';
  end if;
  select role::text into person_role from public.profiles where id = p_user_id and active = true;
  if person_role is null or person_role not in ('content_creator', 'editor') then
    raise exception 'Choose an active creator or editor';
  end if;
  if p_target_date is null or p_target_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Completed work cannot be logged for a future date';
  end if;
  if p_quantity not between 0 and 10000 then
    raise exception 'Completed quantity must be between 0 and 10000';
  end if;
  canonical_name := public.canonical_daily_target_task(person_role, p_task_name);
  if char_length(canonical_name) not between 1 and 120 then
    raise exception 'Task names must contain between 1 and 120 characters';
  end if;

  if p_target_id is not null then
    select * into existing from public.daily_team_targets where id = p_target_id and user_id = p_user_id for update;
    if not found then raise exception 'The target being updated no longer exists'; end if;
    if existing.target_date <> p_target_date then
      raise exception 'Progress cannot change a target assignment date';
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || p_target_date::text || lower(canonical_name), 0));
    select * into existing from public.daily_team_targets
    where user_id = p_user_id and target_date = p_target_date and lower(trim(task_name)) = lower(canonical_name)
    for update;
  end if;

  if existing.id is null then
    insert into public.daily_team_targets (
      user_id, target_date, task_name, target_quantity, completed_quantity, manual_completed_quantity, auto_completed_quantity
    )
    values (p_user_id, p_target_date, canonical_name, 0, p_quantity, p_quantity, 0)
    returning * into existing;
  else
    update public.daily_team_targets
    set manual_completed_quantity = p_quantity,
        completed_quantity = least(p_quantity + auto_completed_quantity, 10000)
    where id = existing.id
    returning * into existing;
  end if;

  -- Reconcile surplus across targets for this day
  perform public.reconcile_daily_target_surplus(p_user_id, p_target_date);

  return existing;
end;
$$;

-- Enhanced record_auto_daily_target
create or replace function public.record_auto_daily_target(p_user_id uuid, p_target_date date, p_task_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  person_role text;
  canonical_name text;
  existing_id uuid;
  rule_qty int;
begin
  if p_user_id is null or p_target_date is null then return; end if;

  select role::text into person_role
  from public.profiles
  where id = p_user_id and active = true;

  if person_role is null or person_role not in ('content_creator', 'editor') then return; end if;
  canonical_name := public.canonical_daily_target_task(person_role, p_task_name);

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || p_target_date::text || lower(canonical_name), 0)
  );

  -- 1. Find existing target row for this task (exact canonical name)
  select id into existing_id
  from public.daily_team_targets
  where user_id = p_user_id
    and target_date = p_target_date
    and lower(trim(task_name)) = lower(canonical_name)
  for update;

  -- 2. If no exact row exists, check if there is an active recurring rule for this user
  if existing_id is null then
    select target_quantity into rule_qty
    from public.daily_task_rules
    where user_id = p_user_id
      and active = true
      and starts_on <= p_target_date
      and (ends_on is null or ends_on >= p_target_date)
      and lower(trim(public.canonical_daily_target_task(person_role, task_name))) = lower(canonical_name)
    limit 1;

    if rule_qty is not null and rule_qty > 0 then
      insert into public.daily_team_targets (
        user_id, target_date, task_name, target_quantity, completed_quantity, manual_completed_quantity, auto_completed_quantity
      )
      values (
        p_user_id, p_target_date, canonical_name, rule_qty, 1, 0, 1
      )
      on conflict (user_id, target_date, task_name) do update set
        auto_completed_quantity = least(public.daily_team_targets.auto_completed_quantity + 1, 10000),
        completed_quantity = least(public.daily_team_targets.manual_completed_quantity + public.daily_team_targets.auto_completed_quantity + 1, 10000)
      returning id into existing_id;
    end if;
  else
    update public.daily_team_targets
    set task_name = canonical_name,
        auto_completed_quantity = least(auto_completed_quantity + 1, 10000),
        completed_quantity = least(manual_completed_quantity + auto_completed_quantity + 1, 10000)
    where id = existing_id;
  end if;

  -- 3. Reconcile any surplus to carried forward targets on this date
  perform public.reconcile_daily_target_surplus(p_user_id, p_target_date);
end;
$$;

-- Enhanced sync_daily_target_progress_from_ad to detect resubmissions
create or replace function public.sync_daily_target_progress_from_ad()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  completion_date date;
begin
  if new.script_ready_at is not null and (tg_op = 'INSERT' or old.script_ready_at is null or old.script_ready_at <> new.script_ready_at) then
    completion_date := (new.script_ready_at at time zone 'Asia/Kolkata')::date;
    perform public.record_auto_daily_target(new.creator_id, completion_date, 'Script writing');
  end if;

  if new.shoot_completed_at is not null and (tg_op = 'INSERT' or old.shoot_completed_at is null or old.shoot_completed_at <> new.shoot_completed_at) then
    completion_date := (new.shoot_completed_at at time zone 'Asia/Kolkata')::date;
    perform public.record_auto_daily_target(new.creator_id, completion_date, 'Video shoots');
  end if;

  if new.raw_footage_shared_at is not null and (tg_op = 'INSERT' or old.raw_footage_shared_at is null or old.raw_footage_shared_at <> new.raw_footage_shared_at) then
    completion_date := (new.raw_footage_shared_at at time zone 'Asia/Kolkata')::date;
    perform public.record_auto_daily_target(new.creator_id, completion_date, 'Raw clip generation');
  end if;

  if new.submitted_at is not null and (tg_op = 'INSERT' or old.submitted_at is null or old.submitted_at <> new.submitted_at) then
    completion_date := (new.submitted_at at time zone 'Asia/Kolkata')::date;
    if coalesce(array_length(array_remove(new.platforms, 'Social Media'), 1), 0) = 0 and new.platforms @> array['Social Media'] then
      perform public.record_auto_daily_target(new.editor_id, completion_date, 'Social media edits');
    else
      perform public.record_auto_daily_target(new.editor_id, completion_date, 'Ad video edits');
    end if;
  end if;

  return new;
end;
$$;

-- Enhanced materialize_daily_task_rules that reconciles surplus before carrying over
create or replace function public.materialize_daily_task_rules(p_start date, p_end date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rule_row record;
  source_target record;
  day date;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  carry_day date;
  carry_target_id uuid;
  carry_quantity int;
  user_cur record;
begin
  -- Clean up any legacy carried-forward or auto-delegated rows on Sundays
  delete from public.daily_team_targets
  where extract(isodow from target_date) = 7
    and (carried_from_target_id is not null or task_name like '%(carried forward)%' or assigned_by is null);

  -- 1. Materialize recurring task rules for active users
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

  if p_start > today or p_end < today then return; end if;

  -- 2. Walk days in the month and carry forward unresolved work
  carry_day := date_trunc('month', today)::date;
  while carry_day <= today loop
    if carry_day = date_trunc('month', carry_day)::date then
      carry_day := carry_day + 1;
      continue;
    end if;

    if extract(isodow from carry_day) = 7 then
      carry_day := carry_day + 1;
      continue;
    end if;

    -- Reconcile any surplus completions on previous day before evaluating carry
    for user_cur in select distinct user_id from public.daily_team_targets where target_date = carry_day - 1 loop
      perform public.reconcile_daily_target_surplus(user_cur.user_id, carry_day - 1);
    end loop;

    for source_target in
      select id, user_id, target_date, task_name, target_quantity, completed_quantity
      from public.daily_team_targets
      where (
        case
          when extract(isodow from carry_day) = 1 then
            target_date in (carry_day - 1, carry_day - 2)
            and date_trunc('month', target_date) = date_trunc('month', carry_day)
          else
            target_date = carry_day - 1
        end
      )
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
