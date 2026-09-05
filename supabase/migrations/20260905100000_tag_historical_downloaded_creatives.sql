-- "Downloaded" means a final creative has either been downloaded from the
-- library or, for the historical backfill, predates the five-day cutoff.
insert into public.tags (name)
values ('downloaded')
on conflict (name) do nothing;

insert into public.ad_tags (ad_id, tag_id)
select ad.id, tag.id
from public.ads ad
cross join public.tags tag
where tag.name = 'downloaded'
  and ad.drive_file_id is not null
  and ad.created_at < now() - interval '5 days'
on conflict (ad_id, tag_id) do nothing;
