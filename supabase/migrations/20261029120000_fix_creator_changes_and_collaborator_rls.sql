begin;

-- 1. Allow 'creator_changes_requested' in ads_production_stage_check
alter table public.ads
drop constraint if exists ads_production_stage_check;

alter table public.ads
add constraint ads_production_stage_check check (
  production_stage in (
    'script_writing',
    'ready_to_shoot',
    'shoot_complete',
    'ready_for_edit',
    'editing',
    'creator_review',
    'final_review',
    'creator_changes_requested',
    'changes_requested',
    'approved'
  )
);

-- 2. Sync status properly when production_stage is 'creator_changes_requested'
create or replace function public.sync_ad_workflow_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.production_stage is distinct from old.production_stage then
    new.workflow_status_changed_at = now();
  end if;

  new.status = case
    when new.production_stage in ('creator_review', 'final_review') then 'pending_review'::public.ad_status
    when new.production_stage in ('changes_requested', 'creator_changes_requested') then 'changes_requested'::public.ad_status
    when new.production_stage = 'approved' then 'approved'::public.ad_status
    else 'draft'::public.ad_status
  end;

  return new;
end;
$$;

update public.ads
set status = 'changes_requested'
where production_stage in ('changes_requested', 'creator_changes_requested')
  and status is distinct from 'changes_requested';

update public.ads
set status = 'pending_review'
where production_stage in ('creator_review', 'final_review')
  and status is distinct from 'pending_review';

-- 3. Allow final_review_ad_atomic to route/re-route change requests to creator or editor
create or replace function public.final_review_ad_atomic(
  p_ad_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_note text default null,
  p_target text default null
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
  v_allow_manager boolean;
  v_has_media_buyer_changes boolean;
  next_stage text;
  next_status public.ad_status;
  next_approval_stage public.approval_stage;
  activity_action text;
begin
  if p_decision not in ('approve', 'request_changes') then
    raise exception 'Invalid final review decision';
  end if;
  if p_decision = 'request_changes' and nullif(trim(p_note), '') is null then
    raise exception 'A change reason is required';
  end if;

  if p_decision = 'request_changes' and p_target = 'media_buyer' then
    raise exception 'Changes cannot be requested from media buyers as they are not primary creators';
  end if;

  select role into actor_role from public.profiles
  where id = p_actor_id and active = true;
  if actor_role not in ('admin', 'manager', 'media_buyer') then
    raise exception 'Only managers, admins, and media buyers can review ads';
  end if;

  if actor_role = 'media_buyer' and p_decision = 'approve' then
    select exists (
      select 1 from public.review_actions
      where ad_id = p_ad_id and reviewer_id = p_actor_id and decision = 'request_changes'
    ) into v_has_media_buyer_changes;

    if not coalesce(v_has_media_buyer_changes, false) then
      raise exception 'Media buyers cannot grant final approval; they can only approve changes they previously requested';
    end if;
  end if;

  select coalesce(allow_manager_final_approval, true) into v_allow_manager from public.app_settings where id = 1;

  select * into current_ad from public.ads where id = p_ad_id for update;
  if not found then raise exception 'Creative not found'; end if;

  if current_ad.production_stage not in ('creator_review', 'final_review')
     and not (
       actor_role in ('admin', 'manager', 'media_buyer')
       and p_decision = 'request_changes'
       and current_ad.production_stage in ('approved', 'changes_requested', 'creator_changes_requested')
     ) then
    raise exception 'Creative is not available for final review';
  end if;

  if p_decision = 'approve' then
    if actor_role = 'media_buyer' then
      next_stage := case when current_ad.production_stage = 'creator_review' then 'final_review' else current_ad.production_stage end;
      next_status := 'pending_review'::public.ad_status;
      next_approval_stage := 'admin_final';
      activity_action := 'media_buyer_approved_changes';
    elsif actor_role = 'manager' and not coalesce(v_allow_manager, true) then
      next_stage := 'final_review';
      next_status := 'pending_review'::public.ad_status;
      next_approval_stage := 'admin_final';
      activity_action := 'manager_approved';
    else
      next_stage := 'approved';
      next_status := 'approved'::public.ad_status;
      next_approval_stage := 'complete';
      activity_action := 'final_approval_granted';
    end if;
  else
    next_status := 'changes_requested'::public.ad_status;
    next_approval_stage := 'manager_review';

    if p_target = 'creator' then
      next_stage := 'creator_changes_requested';
      activity_action := case when current_ad.production_stage = 'approved'
        then 'approved_ad_reopened' else 'final_changes_requested_to_creator' end;
    elsif p_target = 'editor' then
      next_stage := 'changes_requested';
      activity_action := case when current_ad.production_stage = 'approved'
        then 'approved_ad_reopened' else 'final_changes_requested_to_editor' end;
    elsif current_ad.production_stage = 'creator_review' then
      next_stage := 'changes_requested';
      activity_action := 'final_changes_requested';
    else
      next_stage := 'creator_changes_requested';
      activity_action := case when current_ad.production_stage = 'approved'
        then 'approved_ad_reopened' else 'final_changes_requested_to_creator' end;
    end if;
  end if;

  update public.ads
  set production_stage = next_stage,
      status = next_status,
      approval_stage = next_approval_stage,
      creator_reviewed_at = case when current_ad.production_stage = 'creator_review' then coalesce(current_ad.creator_reviewed_at, now()) else creator_reviewed_at end,
      approved_at = case when next_stage = 'approved' then now() else null end,
      final_approved_at = case when next_stage = 'approved' then now() else null end,
      workflow_status_changed_at = now(),
      updated_at = now()
  where id = p_ad_id
  returning * into updated_ad;

  insert into public.review_actions (
    ad_id,
    reviewer_id,
    decision,
    note
  ) values (
    p_ad_id,
    p_actor_id,
    p_decision,
    nullif(trim(p_note), '')
  );

  insert into public.activity_logs (
    ad_id,
    actor_id,
    action,
    metadata
  ) values (
    p_ad_id,
    p_actor_id,
    activity_action,
    jsonb_strip_nulls(jsonb_build_object(
      'note', nullif(trim(p_note), ''),
      'previous_stage', current_ad.production_stage,
      'production_stage', next_stage,
      'target', case when p_decision = 'request_changes' then coalesce(p_target, 'creator') else null end,
      'reopened', case when current_ad.production_stage = 'approved' then true else null end
    ))
  );

  return updated_ad;
end;
$$;

revoke all on function public.final_review_ad_atomic(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.final_review_ad_atomic(uuid, uuid, text, text, text) to service_role;

-- 4. Allow creators and editors to view ads where they are collaborators
drop policy if exists "creators view own ads" on public.ads;
create policy "creators view own ads" on public.ads
  for select using (
    (select public.current_profile_role()) = 'content_creator'::public.user_role
    and (
      creator_id = (select auth.uid())
      or exists (
        select 1 from public.ad_collaborators
        where ad_collaborators.ad_id = ads.id
          and ad_collaborators.profile_id = (select auth.uid())
      )
    )
  );

drop policy if exists "editors view assigned ads" on public.ads;
create policy "editors view assigned ads" on public.ads
  for select using (
    (select public.current_profile_role()) = 'editor'::public.user_role
    and (
      editor_id = (select auth.uid())
      or exists (
        select 1 from public.ad_collaborators
        where ad_collaborators.ad_id = ads.id
          and ad_collaborators.profile_id = (select auth.uid())
      )
    )
  );

commit;
