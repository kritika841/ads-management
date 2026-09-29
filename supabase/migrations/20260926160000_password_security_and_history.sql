-- 20260926160000_password_security_and_history.sql
-- Password history and security tracking table for 30-day lifecycle and reuse prevention.

create table if not exists public.password_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  password_hash text not null,
  salt text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_history_user on public.password_history(user_id);
create index if not exists idx_password_history_created on public.password_history(created_at desc);

alter table public.password_history enable row level security;

-- Admin can read and write all password histories
create policy "Admins can view and manage all password history"
  on public.password_history
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

-- Users can view their own password history
create policy "Users can view their own password history"
  on public.password_history
  for select
  to authenticated
  using (user_id = auth.uid());
