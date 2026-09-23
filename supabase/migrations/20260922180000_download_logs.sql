-- Migration: 20260922180000_download_logs.sql
-- Description: Create download_logs table to track creative export archives with 3-day retention

create table if not exists public.download_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  user_name text not null default 'Unknown',
  user_role text not null default 'admin',
  title text not null,
  source text not null default 'creative_library', -- 'creative_library' | 'campaigns' | 'single_ad'
  campaign_id uuid references public.campaigns(id) on delete set null,
  campaign_name text,
  creative_count integer not null default 0,
  creative_ids jsonb not null default '[]'::jsonb,
  creative_names jsonb not null default '[]'::jsonb,
  status text not null default 'preparing', -- 'preparing' | 'building' | 'ready' | 'failed'
  zip_size_bytes bigint,
  zip_file_path text,
  zip_filename text not null,
  error text,
  download_count integer not null default 0,
  last_downloaded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '3 days'),
  created_at timestamptz not null default now()
);

create index if not exists idx_download_logs_user_id on public.download_logs(user_id);
create index if not exists idx_download_logs_status on public.download_logs(status);
create index if not exists idx_download_logs_expires_at on public.download_logs(expires_at);
create index if not exists idx_download_logs_created_at on public.download_logs(created_at desc);

-- RLS policies
alter table public.download_logs enable row level security;

create policy "Admins can view and manage all download logs"
  on public.download_logs
  for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role in ('admin', 'manager')
    )
  );
