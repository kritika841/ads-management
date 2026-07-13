create or replace function public.transition_editor_work_atomic(
  p_ad_id uuid,
  p_actor_id uuid,
  p_action text,
  p_editor_id uuid default null,
  p_deadline date default null,
  p_reason text default null
)
returns public.ads
language plpgsql
security definer
set search_path = public
as $$
declare
  current_ad public.ads;
  updated_ad public.ads;
  actor_profile public.profiles;
  editor_profile public.profiles;
  active_count integer;
  max_edits integer;
  activity_metadata jsonb;
  activity_action text;
begin
  select * into actor_profile from public.profiles where id = p_actor_id and active = true;
  if not found then raise exception 'Active user not found'; end if;
  select * into current_ad from public.ads where id = p_ad_id for update;
  if not found then raise exception 'Creative not found'; end if;

  if p_action = 'start_editing' then
    if actor_profile.role <> 'editor' or current_ad.editor_id <> p_actor_id then raise exception 'Only the assigned editor can start editing'; end if;
    if current_ad.production_stage <> 'ready_for_edit' then raise exception 'Assignment is not waiting to start'; end if;
    select count(*) into active_count from public.ads where editor_id = p_actor_id and production_stage in ('editing', 'changes_requested');
    select max_concurrent_edits into max_edits from public.app_settings where id = 1;
    if active_count >= coalesce(max_edits, 5) then raise exception 'Editor has reached the active editing limit'; end if;
    update public.ads set production_stage = 'editing', editing_started_at = now() where id = p_ad_id returning * into updated_ad;
    activity_action := 'editing_started';
    activity_metadata := jsonb_build_object('previous_stage', current_ad.production_stage, 'production_stage', 'editing');
  elsif p_action = 'assign_editor' then
    if not (actor_profile.role in ('admin', 'manager') or (actor_profile.role = 'content_creator' and current_ad.creator_id = p_actor_id)) then raise exception 'User cannot assign this creative'; end if;
    if current_ad.production_stage <> 'shoot_complete' then raise exception 'Creative is not waiting for editor assignment'; end if;
    if p_deadline is null then raise exception 'Deadline is required'; end if;
    select * into editor_profile from public.profiles where id = p_editor_id and role = 'editor' and active = true;
    if not found then raise exception 'Choose an active editor'; end if;
    update public.ads set editor_id = p_editor_id, production_stage = 'ready_for_edit', deadline = p_deadline where id = p_ad_id returning * into updated_ad;
    activity_action := 'editor_assigned';
    activity_metadata := jsonb_build_object('editor_id', p_editor_id, 'deadline', p_deadline, 'previous_stage', current_ad.production_stage, 'production_stage', 'ready_for_edit');
  elsif p_action = 'reassign_editor' then
    if actor_profile.role not in ('admin', 'manager') then raise exception 'Only managers and admins can reassign editing work'; end if;
    if current_ad.production_stage not in ('ready_for_edit', 'editing', 'changes_requested') then raise exception 'Editing can no longer be reassigned'; end if;
    if p_deadline is null or nullif(trim(p_reason), '') is null then raise exception 'Deadline and reassignment reason are required'; end if;
    select * into editor_profile from public.profiles where id = p_editor_id and role = 'editor' and active = true;
    if not found then raise exception 'Choose an active editor'; end if;
    if current_ad.editor_id = p_editor_id then raise exception 'Editor is already assigned'; end if;
    update public.ads set editor_id = p_editor_id, production_stage = 'ready_for_edit', deadline = p_deadline, editing_started_at = null where id = p_ad_id returning * into updated_ad;
    activity_action := 'editor_reassigned';
    activity_metadata := jsonb_build_object('previous_editor_id', current_ad.editor_id, 'editor_id', p_editor_id, 'deadline', p_deadline, 'reason', p_reason, 'previous_stage', current_ad.production_stage, 'production_stage', 'ready_for_edit');
  else
    raise exception 'Invalid editor transition';
  end if;

  insert into public.activity_logs (ad_id, actor_id, action, metadata) values (p_ad_id, p_actor_id, activity_action, activity_metadata);
  return updated_ad;
end;
$$;

revoke all on function public.transition_editor_work_atomic(uuid, uuid, text, uuid, date, text) from public, anon, authenticated;
grant execute on function public.transition_editor_work_atomic(uuid, uuid, text, uuid, date, text) to service_role;
