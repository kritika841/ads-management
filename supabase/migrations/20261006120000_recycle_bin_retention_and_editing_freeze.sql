-- Migration: 20261006120000_recycle_bin_retention_and_editing_freeze.sql
-- Description:
--   1. Admin-editable retention windows (download logs, recycle bin)
--   2. Recycle bin: soft-delete columns for campaigns and creatives
--   3. Per-creative editing freeze/unfreeze that overrides the editor concurrency limit
--   4. Creatives may exist without a campaign: deleting a campaign only severs the link
-- Safe to run more than once.

-- 1. Retention settings ------------------------------------------------------
alter table public.app_settings
  add column if not exists download_retention_days int not null default 3,
  add column if not exists recycle_bin_retention_days int not null default 7;

alter table public.app_settings drop constraint if exists app_settings_download_retention_days_check;
alter table public.app_settings
  add constraint app_settings_download_retention_days_check check (download_retention_days between 1 and 365);

alter table public.app_settings drop constraint if exists app_settings_recycle_bin_retention_days_check;
alter table public.app_settings
  add constraint app_settings_recycle_bin_retention_days_check check (recycle_bin_retention_days between 1 and 365);

-- 2. Recycle bin (soft delete) ----------------------------------------------
alter table public.campaigns
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

alter table public.ads
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  -- The campaign a creative belonged to before that campaign was deleted. Used only to
  -- offer re-linking when the campaign is restored; it never keeps the campaign alive.
  add column if not exists previous_campaign_id uuid; -- deliberately no FK: a 2nd ads→campaigns FK makes PostgREST embeds ambiguous

-- A creative can exist without a campaign. Deleting (or purging) a campaign clears the
-- association instead of deleting or blocking on its creatives.
alter table public.ads alter column campaign_id drop not null;
alter table public.ads drop constraint if exists ads_campaign_id_fkey;
alter table public.ads
  add constraint ads_campaign_id_fkey foreign key (campaign_id) references public.campaigns(id) on delete set null;

create index if not exists idx_campaigns_deleted_at on public.campaigns(deleted_at) where deleted_at is not null;
create index if not exists idx_ads_deleted_at on public.ads(deleted_at) where deleted_at is not null;
create index if not exists idx_ads_previous_campaign on public.ads(previous_campaign_id) where previous_campaign_id is not null;

-- A binned campaign/creative must not block re-using its name, so uniqueness only
-- applies to live rows. Restoring into a taken name is reported by the application.
alter table public.campaigns drop constraint if exists campaigns_name_key;
create unique index if not exists campaigns_name_live_unique on public.campaigns(name) where deleted_at is null;

drop index if exists public.ads_campaign_lower_name_unique;
create unique index if not exists ads_campaign_lower_name_live_unique on public.ads(campaign_id, lower(name)) where deleted_at is null;

-- 3. Editing freeze ----------------------------------------------------------
-- null       = default behaviour (editor concurrency limit applies)
-- 'frozen'   = editor may not start/resume/submit editing
-- 'unfrozen' = manager/admin override: bypasses the concurrency limit and is not counted toward it
alter table public.ads
  add column if not exists editing_freeze text,
  add column if not exists editing_freeze_by uuid references public.profiles(id) on delete set null,
  add column if not exists editing_freeze_at timestamptz;

alter table public.ads drop constraint if exists ads_editing_freeze_check;
alter table public.ads
  add constraint ads_editing_freeze_check check (editing_freeze is null or editing_freeze in ('frozen', 'unfrozen'));

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
    if current_ad.editing_freeze = 'frozen' then raise exception 'Editing is frozen for this creative by a manager'; end if;
    -- A manager/admin "unfrozen" override beats the editor's active editing limit.
    if coalesce(current_ad.editing_freeze, '') <> 'unfrozen' then
      select count(*) into active_count from public.ads
      where editor_id = p_actor_id
        and production_stage in ('editing', 'changes_requested')
        and deleted_at is null
        and coalesce(editing_freeze, '') not in ('unfrozen', 'frozen');
      select max_concurrent_edits into max_edits from public.app_settings where id = 1;
      if active_count >= coalesce(max_edits, 5) then raise exception 'Editor has reached the active editing limit'; end if;
    end if;
    update public.ads set production_stage = 'editing', editing_started_at = now() where id = p_ad_id returning * into updated_ad;
    insert into public.editor_time_logs (ad_id, editor_id, session_started_at, is_active)
    values (p_ad_id, p_actor_id, now(), true);
    activity_action := 'editing_started';
    activity_metadata := jsonb_build_object('previous_stage', current_ad.production_stage, 'production_stage', 'editing');
  elsif p_action = 'force_start_editing' then
    if actor_profile.role not in ('admin', 'manager') then raise exception 'Only managers and admins can unfreeze editing'; end if;
    if current_ad.production_stage <> 'ready_for_edit' then raise exception 'Assignment is not waiting to start'; end if;
    if current_ad.editor_id is null then raise exception 'Assign an editor before unfreezing editing'; end if;
    update public.ads
    set production_stage = 'editing',
        editing_started_at = now(),
        editing_freeze = 'unfrozen',
        editing_freeze_by = p_actor_id,
        editing_freeze_at = now()
    where id = p_ad_id returning * into updated_ad;
    insert into public.editor_time_logs (ad_id, editor_id, session_started_at, is_active)
    values (p_ad_id, current_ad.editor_id, now(), true);
    activity_action := 'editor_unfrozen_for_editing';
    activity_metadata := jsonb_build_object(
      'previous_stage', current_ad.production_stage,
      'production_stage', 'editing',
      'editor_id', current_ad.editor_id,
      'bypassed_active_limit', true
    );
  elsif p_action = 'assign_editor' then
    if not (actor_profile.role in ('admin', 'manager') or (actor_profile.role = 'content_creator' and current_ad.creator_id = p_actor_id)) then raise exception 'User cannot assign this creative'; end if;
    if current_ad.production_stage <> 'shoot_complete' then raise exception 'Creative is not waiting for editor assignment'; end if;
    if p_deadline is null then raise exception 'Deadline is required'; end if;
    select * into editor_profile from public.profiles where id = p_editor_id and role = 'editor' and active = true;
    if not found then raise exception 'Choose an active editor'; end if;
    update public.ads set editor_id = p_editor_id, assigned_at = now(), production_stage = 'ready_for_edit', deadline = p_deadline where id = p_ad_id returning * into updated_ad;
    activity_action := 'editor_assigned';
    activity_metadata := jsonb_build_object('editor_id', p_editor_id, 'deadline', p_deadline, 'previous_stage', current_ad.production_stage, 'production_stage', 'ready_for_edit');
  elsif p_action = 'reassign_editor' then
    if actor_profile.role not in ('admin', 'manager') then raise exception 'Only managers and admins can reassign editing work'; end if;
    if current_ad.production_stage not in ('ready_for_edit', 'editing', 'changes_requested') then raise exception 'Editing can no longer be reassigned'; end if;
    if p_deadline is null or nullif(trim(p_reason), '') is null then raise exception 'Deadline and reassignment reason are required'; end if;
    select * into editor_profile from public.profiles where id = p_editor_id and role = 'editor' and active = true;
    if not found then raise exception 'Choose an active editor'; end if;
    if current_ad.editor_id = p_editor_id then raise exception 'Editor is already assigned'; end if;
    update public.ads set editor_id = p_editor_id, assigned_at = now(), production_stage = 'ready_for_edit', deadline = p_deadline, editing_started_at = null where id = p_ad_id returning * into updated_ad;
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
