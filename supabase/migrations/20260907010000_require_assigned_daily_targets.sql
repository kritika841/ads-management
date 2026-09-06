-- Automatic workflow events may increase an assigned task's completed count,
-- but they must never manufacture a zero-target row. The target sheet remains
-- an assignment ledger: if no matching task was assigned for that person and
-- date, there is nothing to update.
create or replace function public.record_auto_daily_target(p_user_id uuid, p_target_date date, p_task_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  person_role text;
  canonical_name text;
  existing_id uuid;
begin
  if p_user_id is null then return; end if;

  select role::text into person_role
  from public.profiles
  where id = p_user_id and active = true;

  if person_role is null or person_role not in ('content_creator', 'editor') then return; end if;
  canonical_name := public.canonical_daily_target_task(person_role, p_task_name);

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || p_target_date::text || lower(canonical_name), 0)
  );

  select id into existing_id
  from public.daily_team_targets
  where user_id = p_user_id
    and target_date = p_target_date
    and lower(trim(task_name)) = lower(canonical_name)
  for update;

  if existing_id is null then return; end if;

  update public.daily_team_targets
  set task_name = canonical_name,
      auto_completed_quantity = least(auto_completed_quantity + 1, 10000),
      completed_quantity = least(manual_completed_quantity + auto_completed_quantity + 1, 10000)
  where id = existing_id;
end;
$$;
