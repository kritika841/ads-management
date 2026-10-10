-- Migration: attendance_logs table
-- Tracks daily attendance check-in and check-out per user for work log integration.

create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text not null,
  user_role text not null,
  date date not null,
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists idx_attendance_logs_user_date on public.attendance_logs(user_id, date);
create index if not exists idx_attendance_logs_date on public.attendance_logs(date);

alter table public.attendance_logs enable row level security;

-- Authenticated users can view attendance
create policy "Attendance logs are viewable by authenticated users"
  on public.attendance_logs for select
  to authenticated
  using (true);

-- Authenticated users can insert/update their own attendance
create policy "Users can record their own attendance"
  on public.attendance_logs for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
