create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text;
  resolved_role public.user_role;
  is_first_profile boolean;
begin
  requested_role := new.raw_user_meta_data->>'role';
  select not exists (select 1 from public.profiles) into is_first_profile;

  if requested_role in ('admin', 'manager', 'editor', 'content_creator') then
    resolved_role := requested_role::public.user_role;
  elsif is_first_profile then
    resolved_role := 'admin';
  else
    resolved_role := 'content_creator';
  end if;

  insert into public.profiles (id, name, email, role, avatar_url, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    resolved_role,
    new.raw_user_meta_data->>'avatar_url',
    is_first_profile
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
