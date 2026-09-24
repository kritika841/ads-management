-- Announcements and User Acknowledgements

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  images jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  author_role text not null,
  target_type text not null default 'all' check (target_type in ('all', 'roles', 'users')),
  target_roles jsonb not null default '[]'::jsonb,
  target_user_ids jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.announcement_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null,
  user_role text not null,
  acknowledged_at timestamptz not null default now(),
  unique(announcement_id, user_id)
);

create index if not exists idx_announcements_status on public.announcements(status);
create index if not exists idx_announcements_created_at on public.announcements(created_at desc);
create index if not exists idx_announcement_ack_announcement_id on public.announcement_acknowledgements(announcement_id);
create index if not exists idx_announcement_ack_user_id on public.announcement_acknowledgements(user_id);

alter table public.announcements enable row level security;
alter table public.announcement_acknowledgements enable row level security;

-- Policies
create policy "Authenticated users can view active announcements"
  on public.announcements for select
  to authenticated
  using (true);

create policy "Admins and managers can manage announcements"
  on public.announcements for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'manager')
    )
  );

create policy "Users can view acknowledgements"
  on public.announcement_acknowledgements for select
  to authenticated
  using (true);

create policy "Users can record their own acknowledgement"
  on public.announcement_acknowledgements for insert
  to authenticated
  with check (user_id = auth.uid());
