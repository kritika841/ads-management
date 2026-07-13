create extension if not exists "pgcrypto";

create type public.user_role as enum ('admin', 'manager', 'editor');
create type public.ad_status as enum ('draft', 'pending_review', 'changes_requested', 'approved', 'rejected', 'published');
create type public.ad_type as enum ('video', 'image', 'carousel', 'story', 'reel');
create type public.approval_stage as enum ('manager_review', 'admin_final', 'complete');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  role public.user_role not null default 'editor',
  avatar_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  campaign_id uuid not null references public.campaigns(id),
  editor_id uuid not null references public.profiles(id),
  status public.ad_status not null default 'draft',
  approval_stage public.approval_stage not null default 'manager_review',
  drive_url text,
  drive_file_id text,
  preview_url text,
  thumbnail_url text,
  script_html text,
  script_text text,
  ad_type public.ad_type,
  platforms text[] not null default '{}',
  deadline date,
  notes text,
  live_url text,
  submitted_at timestamptz,
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ad_versions (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ads(id) on delete cascade,
  version_number int not null,
  drive_url text,
  drive_file_id text,
  preview_url text,
  script_html text,
  script_text text,
  feedback_snapshot text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (ad_id, version_number)
);

create table public.review_actions (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ads(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  decision text not null check (decision in ('approve', 'request_changes', 'reject', 'publish')),
  note text,
  created_at timestamptz not null default now()
);

create table public.annotations (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ads(id) on delete cascade,
  version_id uuid references public.ad_versions(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('video_timestamp', 'script_inline')),
  timestamp_seconds int,
  script_anchor text,
  body text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ads(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null,
  mentions text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  ad_id uuid references public.ads(id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid references public.ads(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ads(id) on delete cascade,
  assigned_to uuid not null references public.profiles(id),
  assigned_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (ad_id, assigned_to)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table public.ad_tags (
  ad_id uuid not null references public.ads(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (ad_id, tag_id)
);

create table public.app_settings (
  id int primary key default 1 check (id = 1),
  two_step_approval boolean not null default false,
  email_notifications boolean not null default true,
  deadline_reminder_days int not null default 2,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id) values (1) on conflict do nothing;

create index ads_status_idx on public.ads(status);
create index ads_editor_idx on public.ads(editor_id);
create index ads_campaign_idx on public.ads(campaign_id);
create index ads_deadline_idx on public.ads(deadline);
create index ads_search_idx on public.ads using gin (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(script_text, '')));
create unique index ads_campaign_lower_name_unique on public.ads(campaign_id, lower(name));
create index notifications_user_read_idx on public.notifications(user_id, read_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger campaigns_set_updated_at before update on public.campaigns for each row execute function public.set_updated_at();
create trigger ads_set_updated_at before update on public.ads for each row execute function public.set_updated_at();

create or replace function public.current_profile_role()
returns public.user_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid() and active = true
$$;

create or replace function public.is_reviewer()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_profile_role() in ('admin', 'manager')
$$;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'editor'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.ads enable row level security;
alter table public.ad_versions enable row level security;
alter table public.review_actions enable row level security;
alter table public.annotations enable row level security;
alter table public.comments enable row level security;
alter table public.notifications enable row level security;
alter table public.activity_logs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.assignments enable row level security;
alter table public.tags enable row level security;
alter table public.ad_tags enable row level security;
alter table public.app_settings enable row level security;

create policy "profiles visible to active users"
on public.profiles for select
using (auth.uid() is not null);

create policy "admins manage profiles"
on public.profiles for all
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

create policy "users update their own basic profile"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "campaigns visible to active users"
on public.campaigns for select
using (auth.uid() is not null);

create policy "admins manage campaigns"
on public.campaigns for all
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

create policy "reviewers view all ads"
on public.ads for select
using (public.is_reviewer());

create policy "active users view team ads"
on public.ads for select
using (auth.uid() is not null);

create policy "editors create own ads"
on public.ads for insert
with check (editor_id = auth.uid());

create policy "editors update editable own ads"
on public.ads for update
using (editor_id = auth.uid() and status in ('draft', 'changes_requested', 'rejected'))
with check (editor_id = auth.uid());

create policy "reviewers manage ads"
on public.ads for all
using (public.is_reviewer())
with check (public.is_reviewer());

create policy "admins delete ads"
on public.ads for delete
using (public.current_profile_role() = 'admin');

create policy "versions visible with ad access"
on public.ad_versions for select
using (exists (select 1 from public.ads where ads.id = ad_versions.ad_id));

create policy "versions insertable by active users"
on public.ad_versions for insert
with check (auth.uid() = created_by);

create policy "review actions visible with ad access"
on public.review_actions for select
using (exists (select 1 from public.ads where ads.id = review_actions.ad_id));

create policy "reviewers create review actions"
on public.review_actions for insert
with check (public.is_reviewer() and auth.uid() = reviewer_id);

create policy "annotations visible with ad access"
on public.annotations for select
using (exists (select 1 from public.ads where ads.id = annotations.ad_id));

create policy "reviewers create annotations"
on public.annotations for insert
with check (public.is_reviewer() and auth.uid() = author_id);

create policy "comments visible with ad access"
on public.comments for select
using (exists (select 1 from public.ads where ads.id = comments.ad_id));

create policy "active users comment"
on public.comments for insert
with check (auth.uid() = author_id);

create policy "users read own notifications"
on public.notifications for select
using (user_id = auth.uid());

create policy "users update own notifications"
on public.notifications for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "activity visible with ad access"
on public.activity_logs for select
using (ad_id is null or exists (select 1 from public.ads where ads.id = activity_logs.ad_id));

create policy "admins read audit logs"
on public.audit_logs for select
using (public.current_profile_role() = 'admin');

create policy "reviewers read assignments"
on public.assignments for select
using (public.is_reviewer() or assigned_to = auth.uid());

create policy "reviewers manage assignments"
on public.assignments for all
using (public.is_reviewer())
with check (public.is_reviewer());

create policy "tags visible to active users"
on public.tags for select
using (auth.uid() is not null);

create policy "active users create tags"
on public.tags for insert
with check (auth.uid() is not null);

create policy "ad tags visible with ad access"
on public.ad_tags for select
using (exists (select 1 from public.ads where ads.id = ad_tags.ad_id));

create policy "active users attach tags"
on public.ad_tags for insert
with check (auth.uid() is not null);

create policy "settings visible to active users"
on public.app_settings for select
using (auth.uid() is not null);

create policy "admins update settings"
on public.app_settings for update
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

insert into storage.buckets (id, name, public)
values
  ('profile-photos', 'profile-photos', true),
  ('ad-thumbnails', 'ad-thumbnails', true)
on conflict (id) do nothing;

create policy "active users read profile photos"
on storage.objects for select
using (bucket_id = 'profile-photos' and auth.uid() is not null);

create policy "active users upload profile photos"
on storage.objects for insert
with check (bucket_id = 'profile-photos' and auth.uid() is not null);

create policy "active users read ad thumbnails"
on storage.objects for select
using (bucket_id = 'ad-thumbnails' and auth.uid() is not null);

create policy "active users upload ad thumbnails"
on storage.objects for insert
with check (bucket_id = 'ad-thumbnails' and auth.uid() is not null);
