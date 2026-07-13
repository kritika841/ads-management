create or replace function public.get_user_sync_state()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'ads_count', (select count(*) from public.ads),
    'ads_latest', (select max(updated_at) from public.ads),
    'new_assignments', (
      select count(*)
      from public.ads
      where editor_id = auth.uid()
        and production_stage = 'ready_for_edit'
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
      select count(*) from public.notifications where user_id = auth.uid()
    ),
    'notifications_latest', (
      select max(greatest(created_at, coalesce(read_at, created_at)))
      from public.notifications
      where user_id = auth.uid()
    ),
    'notifications_unread', (
      select count(*)
      from public.notifications
      where user_id = auth.uid() and read_at is null
    )
  );
$$;

revoke all on function public.get_user_sync_state() from public, anon;
grant execute on function public.get_user_sync_state() to authenticated;
