create or replace function public.canonical_daily_target_task(p_role text, p_task_name text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_role = 'content_creator' and lower(regexp_replace(trim(p_task_name), '\s+', ' ', 'g')) = 'script writing' then 'Script writing'
    when p_role = 'content_creator' and lower(regexp_replace(trim(p_task_name), '\s+', ' ', 'g')) = 'video shoots' then 'Video shoots'
    when p_role = 'content_creator' and lower(regexp_replace(trim(p_task_name), '\s+', ' ', 'g')) = 'raw clip generation' then 'Raw clip generation'
    when p_role = 'editor' and lower(regexp_replace(trim(p_task_name), '\s+', ' ', 'g')) = 'ad video edits' then 'Ad video edits'
    when p_role = 'editor' and lower(regexp_replace(trim(p_task_name), '\s+', ' ', 'g')) = 'social media edits' then 'Social media edits'
    else regexp_replace(trim(p_task_name), '\s+', ' ', 'g')
  end
$$;

-- Consolidate any case-only duplicates before enforcing canonical uniqueness.
with grouped as (
  select (array_agg(id order by created_at, id))[1] as keep_id,
    least(sum(target_quantity), 10000)::int as target_quantity,
    least(sum(manual_completed_quantity), 10000)::int as manual_completed_quantity,
    least(sum(auto_completed_quantity), 10000)::int as auto_completed_quantity,
    least(sum(manual_completed_quantity) + sum(auto_completed_quantity), 10000)::int as completed_quantity
  from public.daily_team_targets
  group by user_id, target_date, lower(trim(task_name))
  having count(*) > 1
)
update public.daily_team_targets target
set target_quantity = grouped.target_quantity,
  manual_completed_quantity = grouped.manual_completed_quantity,
  auto_completed_quantity = grouped.auto_completed_quantity,
  completed_quantity = grouped.completed_quantity
from grouped where target.id = grouped.keep_id;

with ranked as (
  select id, row_number() over (partition by user_id, target_date, lower(trim(task_name)) order by created_at, id) as position
  from public.daily_team_targets
)
delete from public.daily_team_targets target using ranked
where target.id = ranked.id and ranked.position > 1;

create unique index if not exists daily_team_targets_user_date_task_ci_idx
on public.daily_team_targets (user_id, target_date, lower(trim(task_name)));

create or replace function public.record_auto_daily_target(p_user_id uuid, p_target_date date, p_task_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  person_role text;
  canonical_name text;
  existing_id uuid;
begin
  if p_user_id is null then return; end if;
  select role::text into person_role from public.profiles where id = p_user_id and active = true;
  if person_role is null or person_role not in ('content_creator', 'editor') then return; end if;
  canonical_name := public.canonical_daily_target_task(person_role, p_task_name);
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || p_target_date::text || lower(canonical_name), 0));
  select id into existing_id from public.daily_team_targets
  where user_id = p_user_id and target_date = p_target_date and lower(trim(task_name)) = lower(canonical_name)
  for update;
  if existing_id is null then
    insert into public.daily_team_targets (user_id, target_date, task_name, target_quantity, completed_quantity, manual_completed_quantity, auto_completed_quantity)
    values (p_user_id, p_target_date, canonical_name, 0, 1, 0, 1);
  else
    update public.daily_team_targets set
      task_name = canonical_name,
      auto_completed_quantity = least(auto_completed_quantity + 1, 10000),
      completed_quantity = least(manual_completed_quantity + auto_completed_quantity + 1, 10000)
    where id = existing_id;
  end if;
end;
$$;

create or replace function public.save_daily_target_batch(p_actor_id uuid, p_user_id uuid, p_target_date date, p_tasks jsonb)
returns setof public.daily_team_targets language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
  person_role text;
  task jsonb;
  task_id uuid;
  existing public.daily_team_targets%rowtype;
  canonical_name text;
  quantity_value int;
  notes_value text;
  seen_names text[] := '{}';
  saved_ids uuid[] := '{}';
  identity_changed boolean;
begin
  select role::text into actor_role from public.profiles where id = p_actor_id and active = true;
  if actor_role is null or actor_role not in ('admin', 'manager') then raise exception 'Only an active admin or manager can manage targets'; end if;
  select role::text into person_role from public.profiles where id = p_user_id and active = true;
  if person_role is null or person_role not in ('content_creator', 'editor') then raise exception 'Choose an active creator or editor'; end if;
  if p_target_date is null or jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) not between 1 and 20 then raise exception 'Provide between 1 and 20 tasks'; end if;

  for task in select value from jsonb_array_elements(p_tasks)
  loop
    canonical_name := public.canonical_daily_target_task(person_role, coalesce(task->>'taskName', ''));
    if char_length(canonical_name) not between 1 and 120 then raise exception 'Task names must contain between 1 and 120 characters'; end if;
    quantity_value := (task->>'quantity')::int;
    if quantity_value not between 0 and 10000 then raise exception 'Target quantity must be between 0 and 10000'; end if;
    notes_value := nullif(trim(coalesce(task->>'notes', '')), '');
    if char_length(coalesce(notes_value, '')) > 500 then raise exception 'Notes cannot exceed 500 characters'; end if;
    if lower(canonical_name) = any(seen_names) then raise exception 'Each task in an assignment must be unique'; end if;
    seen_names := array_append(seen_names, lower(canonical_name));
    task_id := nullif(task->>'id', '')::uuid;

    if task_id is not null then
      select * into existing from public.daily_team_targets where id = task_id for update;
      if not found then raise exception 'The target being edited no longer exists'; end if;
      identity_changed := existing.user_id <> p_user_id or existing.target_date <> p_target_date or lower(trim(existing.task_name)) <> lower(canonical_name);
      update public.daily_team_targets set
        user_id = p_user_id, target_date = p_target_date, task_name = canonical_name,
        target_quantity = quantity_value, notes = notes_value, assigned_by = p_actor_id,
        manual_completed_quantity = case when identity_changed then 0 else manual_completed_quantity end,
        auto_completed_quantity = case when identity_changed then 0 else auto_completed_quantity end,
        completed_quantity = case when identity_changed then 0 else completed_quantity end
      where id = task_id;
      saved_ids := array_append(saved_ids, task_id);
    else
      perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || p_target_date::text || lower(canonical_name), 0));
      select * into existing from public.daily_team_targets
      where user_id = p_user_id and target_date = p_target_date and lower(trim(task_name)) = lower(canonical_name)
      for update;
      if found then
        update public.daily_team_targets set task_name = canonical_name, target_quantity = quantity_value, notes = notes_value, assigned_by = p_actor_id where id = existing.id;
        saved_ids := array_append(saved_ids, existing.id);
      else
        insert into public.daily_team_targets (user_id, target_date, task_name, target_quantity, notes, assigned_by)
        values (p_user_id, p_target_date, canonical_name, quantity_value, notes_value, p_actor_id)
        returning id into task_id;
        saved_ids := array_append(saved_ids, task_id);
      end if;
    end if;
  end loop;
  return query select * from public.daily_team_targets where id = any(saved_ids) order by task_name;
end;
$$;

create or replace function public.save_daily_target_progress(p_actor_id uuid, p_target_id uuid, p_user_id uuid, p_target_date date, p_task_name text, p_quantity int)
returns public.daily_team_targets language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
  person_role text;
  canonical_name text;
  existing public.daily_team_targets%rowtype;
begin
  select role::text into actor_role from public.profiles where id = p_actor_id and active = true;
  if actor_role is null or (p_actor_id <> p_user_id and actor_role not in ('admin', 'manager')) then raise exception 'You cannot update this progress'; end if;
  select role::text into person_role from public.profiles where id = p_user_id and active = true;
  if person_role is null or person_role not in ('content_creator', 'editor') then raise exception 'Choose an active creator or editor'; end if;
  if p_target_date is null or p_target_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Completed work cannot be logged for a future date'; end if;
  if p_quantity not between 0 and 10000 then raise exception 'Completed quantity must be between 0 and 10000'; end if;
  canonical_name := public.canonical_daily_target_task(person_role, p_task_name);
  if char_length(canonical_name) not between 1 and 120 then raise exception 'Task names must contain between 1 and 120 characters'; end if;

  if p_target_id is not null then
    select * into existing from public.daily_team_targets where id = p_target_id and user_id = p_user_id for update;
    if not found then raise exception 'The target being updated no longer exists'; end if;
    if existing.target_date <> p_target_date or lower(trim(existing.task_name)) <> lower(canonical_name) then raise exception 'Progress cannot change a target assignment'; end if;
  else
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || p_target_date::text || lower(canonical_name), 0));
    select * into existing from public.daily_team_targets
    where user_id = p_user_id and target_date = p_target_date and lower(trim(task_name)) = lower(canonical_name)
    for update;
  end if;

  if existing.id is null then
    insert into public.daily_team_targets (user_id, target_date, task_name, target_quantity, completed_quantity, manual_completed_quantity, auto_completed_quantity)
    values (p_user_id, p_target_date, canonical_name, 0, p_quantity, p_quantity, 0)
    returning * into existing;
  else
    update public.daily_team_targets set task_name = canonical_name, manual_completed_quantity = p_quantity,
      completed_quantity = least(p_quantity + auto_completed_quantity, 10000)
    where id = existing.id returning * into existing;
  end if;
  return existing;
end;
$$;

revoke all on function public.save_daily_target_batch(uuid, uuid, date, jsonb) from public, anon, authenticated;
revoke all on function public.save_daily_target_progress(uuid, uuid, uuid, date, text, int) from public, anon, authenticated;
grant execute on function public.save_daily_target_batch(uuid, uuid, date, jsonb) to service_role;
grant execute on function public.save_daily_target_progress(uuid, uuid, uuid, date, text, int) to service_role;
