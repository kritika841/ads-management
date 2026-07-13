update public.ads
set editor_id = null
where editor_id is not null
  and exists (
    select 1
    from public.profiles
    where profiles.id = ads.editor_id
      and profiles.role <> 'editor'
  );
