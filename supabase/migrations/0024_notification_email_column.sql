-- =====================================================================
-- 0024_notification_email_column.sql
-- Adds emailed_at to track whether a 1-hour follow-up email has been
-- sent for an unread notification.
-- =====================================================================

alter table public.notifications
  add column if not exists emailed_at timestamptz;

-- Index to speed up the cron query that finds un-emailed old notifications
create index if not exists notifications_unread_email_idx
  on public.notifications (user_id, created_at)
  where read_at is null and emailed_at is null;
