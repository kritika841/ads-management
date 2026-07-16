create table public.ad_collaborators (
  ad_id uuid not null references public.ads(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (ad_id, profile_id)
);

alter table public.ad_collaborators enable row level security;

create policy "ad collaborators visible to active users"
on public.ad_collaborators for select
using (auth.uid() is not null);

create policy "reviewers grant ad access"
on public.ad_collaborators for insert
with check (public.is_reviewer());

create policy "reviewers revoke ad access"
on public.ad_collaborators for delete
using (public.is_reviewer());
