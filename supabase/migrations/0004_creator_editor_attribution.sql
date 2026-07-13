alter table public.ads
add column if not exists creator_id uuid references public.profiles(id);

update public.ads
set creator_id = editor_id
where creator_id is null;

alter table public.ads
alter column editor_id drop not null;

update public.profiles
set role = 'content_creator'
where role = 'editor';

update public.ads
set editor_id = null
where editor_id is not null
  and exists (
    select 1
    from public.profiles
    where profiles.id = ads.editor_id
      and profiles.role = 'content_creator'
  );

create index if not exists ads_creator_idx on public.ads(creator_id);

drop policy if exists "editors create own ads" on public.ads;
drop policy if exists "editors update editable own ads" on public.ads;

create policy "contributors create ads"
on public.ads for insert
with check (
  public.current_profile_role() in ('content_creator', 'editor')
  and (creator_id = auth.uid() or editor_id = auth.uid())
);

create policy "contributors update editable ads"
on public.ads for update
using (
  public.current_profile_role() in ('content_creator', 'editor')
  and status in ('draft', 'changes_requested', 'rejected')
  and (creator_id = auth.uid() or editor_id = auth.uid())
)
with check (
  public.current_profile_role() in ('content_creator', 'editor')
  and (creator_id = auth.uid() or editor_id = auth.uid())
);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text;
  resolved_role public.user_role;
begin
  requested_role := new.raw_user_meta_data->>'role';

  if requested_role in ('admin', 'manager', 'editor', 'content_creator') then
    resolved_role := requested_role::public.user_role;
  elsif not exists (select 1 from public.profiles) then
    resolved_role := 'admin';
  else
    resolved_role := 'content_creator';
  end if;

  insert into public.profiles (id, name, email, role, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    resolved_role,
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
