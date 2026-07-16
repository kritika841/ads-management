create or replace function public.add_ad_tags_bulk(
  p_ad_ids uuid[],
  p_tags text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tags (name)
  select distinct lower(trim(value))
  from unnest(coalesce(p_tags, '{}'::text[])) as value
  where trim(value) <> ''
  on conflict (name) do nothing;

  insert into public.ad_tags (ad_id, tag_id)
  select ad_id, tags.id
  from unnest(coalesce(p_ad_ids, '{}'::uuid[])) as ad_id
  cross join public.tags
  where tags.name in (
    select distinct lower(trim(value))
    from unnest(coalesce(p_tags, '{}'::text[])) as value
    where trim(value) <> ''
  )
  on conflict (ad_id, tag_id) do nothing;
end;
$$;

revoke all on function public.add_ad_tags_bulk(uuid[], text[]) from public, anon, authenticated;
grant execute on function public.add_ad_tags_bulk(uuid[], text[]) to service_role;
