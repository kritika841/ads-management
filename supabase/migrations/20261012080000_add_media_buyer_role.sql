-- 20261012080000_add_media_buyer_role.sql
-- Add media_buyer role to user_role enum
alter type public.user_role add value if not exists 'media_buyer';

-- Update create_profile_for_new_user trigger to recognize media_buyer role
create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text;
  resolved_role public.user_role;
  is_first_profile boolean;
begin
  requested_role := new.raw_user_meta_data->>'role';
  select not exists (select 1 from public.profiles) into is_first_profile;

  if requested_role in ('admin', 'manager', 'editor', 'content_creator', 'media_buyer') then
    resolved_role := requested_role::public.user_role;
  elsif is_first_profile then
    resolved_role := 'admin';
  else
    resolved_role := 'content_creator';
  end if;

  insert into public.profiles (id, name, email, role, avatar_url, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    resolved_role,
    new.raw_user_meta_data->>'avatar_url',
    is_first_profile
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Update final_review_ad_atomic to allow media_buyers to request changes,
-- while explicitly preventing them from granting final approval.
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

  select role into actor_role from public.profiles
  where id = p_actor_id and active = true;
  if actor_role not in ('admin', 'manager', 'media_buyer') then
    raise exception 'Only managers, admins, and media buyers can request changes';
  end if;

  if actor_role = 'media_buyer' and p_decision = 'approve' then
    raise exception 'Media buyers cannot grant final approval';
  end if;

  -- Check admin approval hierarchy setting
  select coalesce(allow_manager_final_approval, true) into v_allow_manager from public.app_settings where id = 1;

  select * into current_ad from public.ads where id = p_ad_id for update;
  if not found then raise exception 'Creative not found'; end if;

  -- Allowed stages for review/reopen:
  -- 1) Normal final review: creator_review or final_review
  -- 2) Reopen approved: actor is admin, manager, or media buyer, decision is request_changes, ad is approved
  if current_ad.production_stage not in ('creator_review', 'final_review')
     and not (actor_role in ('admin', 'manager', 'media_buyer') and p_decision = 'request_changes' and current_ad.production_stage = 'approved') then
    raise exception 'Creative is not available for final review';
  end if;

  if p_decision = 'approve' then
    if actor_role = 'manager' and not coalesce(v_allow_manager, true) then
      -- Manager approves, but final approval is restricted to admin:
      next_stage := 'final_review';
      next_status := 'pending_review'::public.ad_status;
      next_approval_stage := 'admin_final';
      activity_action := 'manager_approved';
    else
      -- Admin approval, or manager approval when allow_manager_final_approval is enabled
      next_stage := 'approved';
      next_status := 'approved'::public.ad_status;
      next_approval_stage := 'complete';
      activity_action := 'final_approval_granted';
    end if;
  else
    -- Request changes (from review, intermediate admin_final, or reopening approved)
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
    jsonb_build_object(
      'note', coalesce(trim(p_note), ''),
      'target', coalesce(p_target, ''),
      'previous_stage', current_ad.production_stage,
      'production_stage', next_stage,
      'reopened', (current_ad.production_stage = 'approved' and p_decision = 'request_changes')
    )
  );

  return updated_ad;
end;
$$;
