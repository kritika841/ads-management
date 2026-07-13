alter table public.profiles
add column if not exists deleted_at timestamptz;

update public.profiles as profile
set deleted_at = deletion.created_at,
    active = false
from (
  select target_id, max(created_at) as created_at
  from public.audit_logs
  where action = 'deleted_user_access'
    and target_type = 'profile'
  group by target_id
) as deletion
where profile.id::text = deletion.target_id
  and profile.deleted_at is null;

create index if not exists profiles_not_deleted_idx
on public.profiles (active, role)
where deleted_at is null;
