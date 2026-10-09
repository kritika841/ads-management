-- Managers and admins can author creatives (see lib/creators.ts), so they must be
-- able to complete the creator-review step for creatives they own, exactly like a
-- content creator. Only the role check changes versus 0016_workflow_integrity.sql.
create or replace function public.creator_review_ad_atomic(
  p_ad_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_note text default null
)
returns public.ads
language plpgsql
security definer
set search_path = public
as $$
declare
  current_ad public.ads;
  updated_ad public.ads;
  next_stage text;
  next_approval_stage public.approval_stage;
  activity_action text;
begin
  if p_decision not in ('approve', 'request_changes') then
    raise exception 'Invalid creator review decision';
  end if;
  if p_decision = 'request_changes' and nullif(trim(p_note), '') is null then
    raise exception 'A change reason is required';
  end if;

  select * into current_ad from public.ads where id = p_ad_id for update;
  if not found then raise exception 'Creative not found'; end if;
  if current_ad.production_stage <> 'creator_review' then
    raise exception 'Creative is not waiting for creator review';
  end if;
  if current_ad.creator_id <> p_actor_id or not exists (
    select 1 from public.profiles
    where id = p_actor_id and role in ('content_creator', 'manager', 'admin') and active = true
  ) then
    raise exception 'Only the assigned creator can review this creative';
  end if;

  if p_decision = 'approve' then
    next_stage := 'final_review';
    next_approval_stage := 'admin_final';
    activity_action := 'creator_approved_edit';
  else
    next_stage := 'changes_requested';
    next_approval_stage := 'manager_review';
    activity_action := 'creator_requested_changes';
  end if;

  update public.ads
  set production_stage = next_stage,
      approval_stage = next_approval_stage,
      creator_reviewed_at = case when p_decision = 'approve' then now() else creator_reviewed_at end
  where id = p_ad_id
  returning * into updated_ad;

  insert into public.review_actions (ad_id, reviewer_id, decision, note)
  values (p_ad_id, p_actor_id, p_decision, nullif(trim(p_note), ''));

  insert into public.activity_logs (ad_id, actor_id, action, metadata)
  values (
    p_ad_id,
    p_actor_id,
    activity_action,
    jsonb_build_object(
      'note', coalesce(p_note, ''),
      'previous_stage', current_ad.production_stage,
      'production_stage', next_stage
    )
  );

  return updated_ad;
end;
$$;

revoke all on function public.creator_review_ad_atomic(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.creator_review_ad_atomic(uuid, uuid, text, text) to service_role;
