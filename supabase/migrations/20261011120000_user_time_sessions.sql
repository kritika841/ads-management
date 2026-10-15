-- Migration: user_time_sessions table
-- Tracks user application access sessions, 5-minute idle auto-checkouts,
-- and detailed activity logs per user (including admin).

create table if not exists public.user_time_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text not null,
  user_role text not null,
  date date not null,
  session_started_at timestamptz not null default now(),
  session_ended_at timestamptz,
  last_active_at timestamptz not null default now(),
  duration_seconds integer not null default 0,
  end_reason text not null default 'active', -- 'active', 'idle_5m', 'page_closed', 'manual_logout'
  activities jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_time_sessions_user_date on public.user_time_sessions(user_id, date);
create index if not exists idx_user_time_sessions_date on public.user_time_sessions(date);
create index if not exists idx_user_time_sessions_started_at on public.user_time_sessions(session_started_at);

alter table public.user_time_sessions enable row level security;

-- Admins can view all sessions; users can view their own
create policy "Admins can view all user time sessions"
  on public.user_time_sessions for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    ) or auth.uid() = user_id
  );

-- Authenticated users can insert their own sessions
create policy "Users can insert their own time sessions"
  on public.user_time_sessions for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Authenticated users can update their own sessions
create policy "Users can update their own time sessions"
  on public.user_time_sessions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
