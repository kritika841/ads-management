-- Downloaded is operational state, not a user-managed creative tag. Keep the
-- existing marker when ordinary tags are edited and ignore attempts to add it
-- through the general tag-sync function.
create or replace function public.sync_ad_tags_atomic(
  p_ad_id uuid,
  p_tags text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.ads where id = p_ad_id) then
    raise exception 'Creative not found';
  end if;

  insert into public.tags (name)
  select distinct lower(trim(value))
  from unnest(coalesce(p_tags, '{}'::text[])) as value
  where trim(value) <> '' and lower(trim(value)) <> 'downloaded'
  on conflict (name) do nothing;

  delete from public.ad_tags ad_tag
  using public.tags tag
  where ad_tag.ad_id = p_ad_id
    and ad_tag.tag_id = tag.id
    and tag.name <> 'downloaded';

  insert into public.ad_tags (ad_id, tag_id)
  select p_ad_id, tags.id
  from public.tags
  where tags.name in (
    select distinct lower(trim(value))
    from unnest(coalesce(p_tags, '{}'::text[])) as value
    where trim(value) <> '' and lower(trim(value)) <> 'downloaded'
  );
end;
$$;

revoke all on function public.sync_ad_tags_atomic(uuid, text[]) from public, anon, authenticated;
grant execute on function public.sync_ad_tags_atomic(uuid, text[]) to service_role;
