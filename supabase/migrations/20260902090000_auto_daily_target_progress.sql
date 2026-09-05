alter table public.daily_team_targets add column if not exists manual_completed_quantity int not null default 0 check (manual_completed_quantity between 0 and 10000);
alter table public.daily_team_targets add column if not exists auto_completed_quantity int not null default 0 check (auto_completed_quantity between 0 and 10000);

update public.daily_team_targets
set manual_completed_quantity = completed_quantity
where manual_completed_quantity = 0 and completed_quantity > 0;

create or replace function public.record_auto_daily_target(p_user_id uuid, p_target_date date, p_task_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null then return; end if;
  insert into public.daily_team_targets (user_id, target_date, task_name, target_quantity, completed_quantity, manual_completed_quantity, auto_completed_quantity)
  values (p_user_id, p_target_date, p_task_name, 0, 1, 0, 1)
  on conflict (user_id, target_date, task_name) do update set
    auto_completed_quantity = public.daily_team_targets.auto_completed_quantity + 1,
    completed_quantity = public.daily_team_targets.manual_completed_quantity + public.daily_team_targets.auto_completed_quantity + 1;
end;
$$;

create or replace function public.sync_daily_target_progress_from_ad()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  completion_date date;
begin
  if new.script_ready_at is not null and (tg_op = 'INSERT' or old.script_ready_at is null) then
    completion_date := (new.script_ready_at at time zone 'Asia/Kolkata')::date;
    perform public.record_auto_daily_target(new.creator_id, completion_date, 'Script writing');
  end if;
  if new.shoot_completed_at is not null and (tg_op = 'INSERT' or old.shoot_completed_at is null) then
    completion_date := (new.shoot_completed_at at time zone 'Asia/Kolkata')::date;
    perform public.record_auto_daily_target(new.creator_id, completion_date, 'Video shoots');
  end if;
  if new.raw_footage_shared_at is not null and (tg_op = 'INSERT' or old.raw_footage_shared_at is null) then
    completion_date := (new.raw_footage_shared_at at time zone 'Asia/Kolkata')::date;
    perform public.record_auto_daily_target(new.creator_id, completion_date, 'Raw clip generation');
  end if;
  if new.submitted_at is not null and (tg_op = 'INSERT' or old.submitted_at is null) then
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

drop trigger if exists ads_sync_daily_target_progress on public.ads;
create trigger ads_sync_daily_target_progress after insert or update of script_ready_at, shoot_completed_at, raw_footage_shared_at, submitted_at on public.ads
for each row execute function public.sync_daily_target_progress_from_ad();
