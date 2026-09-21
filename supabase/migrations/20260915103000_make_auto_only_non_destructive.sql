-- “Automatic tasks only” controls what is shown for the day. It must not erase
-- appended work, because the manager can switch the day back to append mode.
create or replace function public.materialize_daily_task_rules(p_start date, p_end date)
returns void language plpgsql security definer set search_path = public as $$
declare rule_row record; day date;
begin
  for rule_row in select r.*, p.role::text as person_role from public.daily_task_rules r join public.profiles p on p.id = r.user_id
    where r.active and p.active and r.starts_on <= p_end and (r.ends_on is null or r.ends_on >= p_start)
  loop
    day := greatest(p_start, rule_row.starts_on, (now() at time zone 'Asia/Kolkata')::date);
    while day <= least(p_end, coalesce(rule_row.ends_on, p_end)) loop
      if extract(isodow from day) between 1 and 6 then
        insert into public.daily_team_targets (user_id, target_date, task_name, target_quantity, notes)
        values (rule_row.user_id, day, public.canonical_daily_target_task(rule_row.person_role, rule_row.task_name), rule_row.target_quantity, rule_row.notes)
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
end;
$$;
