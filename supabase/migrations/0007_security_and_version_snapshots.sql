-- Only active, approved profiles may use application data through the public API.
drop policy if exists "profiles visible to active users" on public.profiles;
create policy "profiles visible to active users"
on public.profiles for select
using (public.current_profile_role() is not null);

-- This policy allowed users to update protected fields such as role and active.
-- Profile administration is performed by the service-role-backed admin actions.
drop policy if exists "users update their own basic profile" on public.profiles;

drop policy if exists "campaigns visible to active users" on public.campaigns;
create policy "campaigns visible to active users"
on public.campaigns for select
using (public.current_profile_role() is not null);

drop policy if exists "active users view team ads" on public.ads;
create policy "active users view team ads"
on public.ads for select
using (public.current_profile_role() is not null);

drop policy if exists "versions insertable by active users" on public.ad_versions;
create policy "versions insertable by active users"
on public.ad_versions for insert
with check (public.current_profile_role() is not null and auth.uid() = created_by);

drop policy if exists "active users comment" on public.comments;
create policy "active users comment"
on public.comments for insert
with check (public.current_profile_role() is not null and auth.uid() = author_id);

drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications"
on public.notifications for select
using (public.current_profile_role() is not null and user_id = auth.uid());

drop policy if exists "users update own notifications" on public.notifications;
create policy "users update own notifications"
on public.notifications for update
using (public.current_profile_role() is not null and user_id = auth.uid())
with check (public.current_profile_role() is not null and user_id = auth.uid());

drop policy if exists "tags visible to active users" on public.tags;
create policy "tags visible to active users"
on public.tags for select
using (public.current_profile_role() is not null);

drop policy if exists "active users create tags" on public.tags;
create policy "active users create tags"
on public.tags for insert
with check (public.current_profile_role() is not null);

drop policy if exists "active users attach tags" on public.ad_tags;
create policy "active users attach tags"
on public.ad_tags for insert
with check (public.current_profile_role() is not null);

drop policy if exists "settings visible to active users" on public.app_settings;
create policy "settings visible to active users"
on public.app_settings for select
using (public.current_profile_role() is not null);

drop policy if exists "active users read profile photos" on storage.objects;
create policy "active users read profile photos"
on storage.objects for select
using (bucket_id = 'profile-photos' and public.current_profile_role() is not null);

drop policy if exists "active users upload profile photos" on storage.objects;
create policy "active users upload profile photos"
on storage.objects for insert
with check (bucket_id = 'profile-photos' and public.current_profile_role() is not null);

drop policy if exists "active users read ad thumbnails" on storage.objects;
create policy "active users read ad thumbnails"
on storage.objects for select
using (bucket_id = 'ad-thumbnails' and public.current_profile_role() is not null);

drop policy if exists "active users upload ad thumbnails" on storage.objects;
create policy "active users upload ad thumbnails"
on storage.objects for insert
with check (bucket_id = 'ad-thumbnails' and public.current_profile_role() is not null);

-- Snapshot the current ad under a row lock so concurrent submissions cannot
-- create duplicate version numbers. This is service-role only.
create or replace function public.snapshot_ad_version(p_ad_id uuid, p_created_by uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_ad public.ads%rowtype;
  next_version integer;
  feedback text;
begin
  select *
  into current_ad
  from public.ads
  where id = p_ad_id
  for update;

  if not found then
    raise exception 'Ad not found';
  end if;

  select coalesce(max(version_number), 0) + 1
  into next_version
  from public.ad_versions
  where ad_id = p_ad_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'decision', decision,
        'note', note,
        'reviewer_id', reviewer_id,
        'created_at', created_at
      ) order by created_at
    ),
    '[]'::jsonb
  )::text
  into feedback
  from public.review_actions
  where ad_id = p_ad_id
    and created_at > coalesce(
      (select max(created_at) from public.ad_versions where ad_id = p_ad_id),
      '-infinity'::timestamptz
    );

  insert into public.ad_versions (
    ad_id,
    version_number,
    drive_url,
    drive_file_id,
    preview_url,
    script_html,
    script_text,
    feedback_snapshot,
    created_by
  ) values (
    current_ad.id,
    next_version,
    current_ad.drive_url,
    current_ad.drive_file_id,
    current_ad.preview_url,
    current_ad.script_html,
    current_ad.script_text,
    feedback,
    p_created_by
  );

  return next_version;
end;
$$;

revoke all on function public.snapshot_ad_version(uuid, uuid) from public, anon, authenticated;
grant execute on function public.snapshot_ad_version(uuid, uuid) to service_role;
