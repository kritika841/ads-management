create or replace function public.materialize_daily_task_rules(p_start date, p_end date)
returns void language plpgsql security definer set search_path = public as $$
declare rule_row record; setting_row record; day date; day_mode text;
begin
  for setting_row in select user_id, target_date from public.daily_target_day_settings where target_date between p_start and p_end and mode = 'auto_only' loop
    update public.daily_team_targets set target_quantity = 0
      where user_id = setting_row.user_id and target_date = setting_row.target_date and assigned_by is not null;
  end loop;
  for rule_row in select r.*, p.role::text as person_role from public.daily_task_rules r join public.profiles p on p.id = r.user_id
    where r.active and p.active and r.starts_on <= p_end and (r.ends_on is null or r.ends_on >= p_start)
  loop
    day := greatest(p_start, rule_row.starts_on, (now() at time zone 'Asia/Kolkata')::date);
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
