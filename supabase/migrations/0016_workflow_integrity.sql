-- The simplified workflow is mutated through validated server actions. Legacy
-- editor policies allowed direct full-row writes that bypassed those checks.
drop policy if exists "editors create own ads" on public.ads;
drop policy if exists "editors update editable own ads" on public.ads;

drop policy if exists "active users create tags" on public.tags;
drop policy if exists "active users attach tags" on public.ad_tags;
drop policy if exists "users attach tags" on public.ad_tags;

create policy "users attach tags to accessible ads"
on public.ad_tags for insert
with check (
  public.current_profile_role() is not null
  and exists (select 1 from public.ads where ads.id = ad_tags.ad_id)
);

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
    where id = p_actor_id and role = 'content_creator' and active = true
  ) then
    raise exception 'Only the assigned content creator can review this creative';
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

create or replace function public.final_review_ad_atomic(
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
  actor_role public.user_role;
  next_stage text;
  next_approval_stage public.approval_stage;
  activity_action text;
begin
  if p_decision not in ('approve', 'request_changes') then
    raise exception 'Invalid final review decision';
  end if;
  if p_decision = 'request_changes' and nullif(trim(p_note), '') is null then
    raise exception 'A change reason is required';
  end if;

  select role into actor_role from public.profiles
  where id = p_actor_id and active = true;
  if actor_role not in ('admin', 'manager') then
    raise exception 'Only managers and admins can complete final review';
  end if;

  select * into current_ad from public.ads where id = p_ad_id for update;
  if not found then raise exception 'Creative not found'; end if;
  if current_ad.production_stage not in ('creator_review', 'final_review')
     and not (actor_role = 'admin' and p_decision = 'request_changes' and current_ad.production_stage = 'approved') then
    raise exception 'Creative is not available for final review';
  end if;

  if p_decision = 'approve' then
    next_stage := 'approved';
    next_approval_stage := 'complete';
    activity_action := 'final_approval_granted';
  else
    next_stage := 'changes_requested';
    next_approval_stage := 'manager_review';
    activity_action := case when current_ad.production_stage = 'approved'
      then 'approved_ad_reopened' else 'final_changes_requested' end;
  end if;

  update public.ads
  set production_stage = next_stage,
      approval_stage = next_approval_stage,
      approved_at = case when p_decision = 'approve' then now() else null end,
      final_approved_at = case when p_decision = 'approve' then now() else null end
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
revoke all on function public.final_review_ad_atomic(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.creator_review_ad_atomic(uuid, uuid, text, text) to service_role;
grant execute on function public.final_review_ad_atomic(uuid, uuid, text, text) to service_role;
