-- Production incident fix: get_user_sync_state() averaged ~2.2s (max 8s = statement_timeout)
-- across 356k calls, saturating the database and causing 500s plus Server Component render
-- failures for every other query.
--
-- Root cause: RLS policies on public.ads called current_profile_role() / is_reviewer() /
-- auth.uid() once PER ROW. Because comments, annotations, review_actions and activity_logs
-- policies use EXISTS (select 1 from ads ...), every row in those tables re-ran the ads
-- policies too -> tens of thousands of profile lookups per request.
--
-- Fix (Supabase-recommended RLS pattern): wrap the functions in a scalar sub-select so
-- Postgres evaluates them ONCE per statement as an InitPlan instead of once per row.
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
-- Policy semantics are unchanged.

begin;

-- ads -----------------------------------------------------------------------------------
drop policy if exists "admins delete ads" on public.ads;
create policy "admins delete ads" on public.ads
  for delete using ((select public.current_profile_role()) = 'admin'::public.user_role);

drop policy if exists "creators view own ads" on public.ads;
create policy "creators view own ads" on public.ads
  for select using (
    (select public.current_profile_role()) = 'content_creator'::public.user_role
    and creator_id = (select auth.uid())
  );

drop policy if exists "editors view assigned ads" on public.ads;
create policy "editors view assigned ads" on public.ads
  for select using (
    (select public.current_profile_role()) = 'editor'::public.user_role
    and editor_id = (select auth.uid())
  );

drop policy if exists "media buyers view all ads" on public.ads;
create policy "media buyers view all ads" on public.ads
  for select using ((select public.current_profile_role()) = 'media_buyer'::public.user_role);

drop policy if exists "reviewers manage ads" on public.ads;
create policy "reviewers manage ads" on public.ads
  for all using ((select public.is_reviewer())) with check ((select public.is_reviewer()));

drop policy if exists "reviewers view all ads" on public.ads;
create policy "reviewers view all ads" on public.ads
  for select using ((select public.is_reviewer()));

-- notifications ---------------------------------------------------------------------------
drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications" on public.notifications
  for select using (
    (select public.current_profile_role()) is not null
    and user_id = (select auth.uid())
  );

-- Supports "latest 25 notifications for user" (shell layout) and the sync-state max().
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- Sync-state RPC: same output, but resolve auth.uid() once.
create or replace function public.get_user_sync_state()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with me as (select auth.uid() as uid)
  select jsonb_build_object(
    'ads_count', (select count(*) from public.ads),
    'ads_latest', (select max(updated_at) from public.ads),
    'new_assignments', (
      select count(*) from public.ads, me
      where editor_id = me.uid and production_stage = 'ready_for_edit'
    ),
    'comments_count', (select count(*) from public.comments),
    'comments_latest', (select max(created_at) from public.comments),
    'reviews_count', (select count(*) from public.review_actions),
    'reviews_latest', (select max(created_at) from public.review_actions),
    'annotations_count', (select count(*) from public.annotations),
    'annotations_latest', (select max(created_at) from public.annotations),
    'activity_count', (select count(*) from public.activity_logs),
    'activity_latest', (select max(created_at) from public.activity_logs),
    'notifications_count', (
      select count(*) from public.notifications, me where user_id = me.uid
    ),
    'notifications_latest', (
      select max(greatest(created_at, coalesce(read_at, created_at)))
      from public.notifications, me where user_id = me.uid
    ),
    'notifications_unread', (
      select count(*) from public.notifications, me
      where user_id = me.uid and read_at is null
    )
  );
$$;

revoke all on function public.get_user_sync_state() from public, anon;
grant execute on function public.get_user_sync_state() to authenticated;

commit;
