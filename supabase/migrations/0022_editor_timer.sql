-- =====================================================================
-- 0022_editor_timer.sql
-- Tracks per-session editing time for each creative.
-- Sessions are opened when editing starts / resumes and closed on
-- pause or submit. A mandatory pause_reason is stored on pause.
-- =====================================================================

create table public.editor_time_logs (
  id                  uuid primary key default gen_random_uuid(),
  ad_id               uuid not null references public.ads(id) on delete cascade,
  editor_id           uuid not null references public.profiles(id) on delete cascade,
  session_started_at  timestamptz not null default now(),
  session_ended_at    timestamptz,
  pause_reason        text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Index for fast per-ad lookups
create index editor_time_logs_ad_id_idx on public.editor_time_logs(ad_id);
-- Index for fast per-editor queries
create index editor_time_logs_editor_id_idx on public.editor_time_logs(editor_id);

-- RLS: service_role only (all access goes through server actions)
alter table public.editor_time_logs enable row level security;

-- No authenticated-user policies — all mutations happen via server actions using
-- the admin/service_role client, matching the pattern used everywhere else.

-- ---------------------------------------------------------------
-- Function: get_editor_total_seconds(p_ad_id)
-- Returns the total number of seconds the editor has been actively
-- editing the given creative (sum of all completed + active sessions).
-- ---------------------------------------------------------------
create or replace function public.get_editor_total_seconds(p_ad_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    sum(
      extract(epoch from coalesce(session_ended_at, now()) - session_started_at)
    )::integer,
    0
  )
  from public.editor_time_logs
  where ad_id = p_ad_id;
$$;

revoke all on function public.get_editor_total_seconds(uuid) from public, anon, authenticated;
grant execute on function public.get_editor_total_seconds(uuid) to service_role;

-- ---------------------------------------------------------------
-- Grant table-level access to service_role only
-- ---------------------------------------------------------------
revoke all on public.editor_time_logs from public, anon, authenticated;
grant all on public.editor_time_logs to service_role;
