create or replace function public.sync_ad_tags_atomic(
  p_ad_id uuid,
  p_tags text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.ads where id = p_ad_id) then
    raise exception 'Creative not found';
  end if;

  insert into public.tags (name)
  select distinct lower(trim(value))
  from unnest(coalesce(p_tags, '{}'::text[])) as value
  where trim(value) <> ''
  on conflict (name) do nothing;

  delete from public.ad_tags where ad_id = p_ad_id;

  insert into public.ad_tags (ad_id, tag_id)
  select p_ad_id, tags.id
  from public.tags
  where tags.name in (
    select distinct lower(trim(value))
    from unnest(coalesce(p_tags, '{}'::text[])) as value
    where trim(value) <> ''
  );
end;
$$;

create or replace function public.submit_edited_video_atomic(
  p_ad_id uuid,
  p_actor_id uuid,
  p_drive_url text,
  p_drive_file_id text,
  p_preview_url text,
  p_thumbnail_url text,
  p_editor_notes text
)
returns public.ads
language plpgsql
security definer
set search_path = public
as $$
declare
  current_ad public.ads;
  updated_ad public.ads;
  activity_action text;
begin
  select * into current_ad from public.ads where id = p_ad_id for update;
  if not found then raise exception 'Creative not found'; end if;
  if current_ad.editor_id <> p_actor_id or not exists (
    select 1 from public.profiles where id = p_actor_id and role = 'editor' and active = true
  ) then
    raise exception 'Only the assigned editor can submit this video';
  end if;
  if current_ad.production_stage not in ('editing', 'changes_requested') then
    raise exception 'Creative is not ready for video submission';
  end if;

  activity_action := case when current_ad.production_stage = 'changes_requested'
    then 'edited_video_resubmitted' else 'edited_video_submitted' end;

  update public.ads
  set drive_url = p_drive_url,
      drive_file_id = p_drive_file_id,
      preview_url = p_preview_url,
      thumbnail_url = coalesce(nullif(p_thumbnail_url, ''), thumbnail_url),
      editor_notes = nullif(trim(p_editor_notes), ''),
      production_stage = 'creator_review',
      submitted_at = now(),
      approval_stage = 'manager_review',
      creator_reviewed_at = null,
      final_approved_at = null
  where id = p_ad_id
  returning * into updated_ad;

  perform public.snapshot_ad_version(p_ad_id, p_actor_id);

  insert into public.activity_logs (ad_id, actor_id, action, metadata)
  values (
    p_ad_id,
    p_actor_id,
    activity_action,
    jsonb_build_object(
      'previous_stage', current_ad.production_stage,
      'production_stage', 'creator_review'
    )
  );

  return updated_ad;
end;
$$;

revoke all on function public.sync_ad_tags_atomic(uuid, text[]) from public, anon, authenticated;
revoke all on function public.submit_edited_video_atomic(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.sync_ad_tags_atomic(uuid, text[]) to service_role;
grant execute on function public.submit_edited_video_atomic(uuid, uuid, text, text, text, text, text) to service_role;
