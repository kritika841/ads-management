-- Preserve one transcript mapping for every creative/video variant in a Meta ad.
-- This replaces the previous one-row-per-ad key without touching incentive data.
alter table public.meta_ad_transcript_mappings
  add column if not exists mapping_key text;

update public.meta_ad_transcript_mappings
set mapping_key = concat_ws(
  ':',
  'meta',
  meta_ad_id,
  'creative',
  coalesce(meta_creative_id, 'primary'),
  'video',
  coalesce(meta_video_id, 'primary')
)
where mapping_key is null;

alter table public.meta_ad_transcript_mappings
  alter column mapping_key set not null;

alter table public.meta_ad_transcript_mappings
  drop constraint if exists meta_ad_transcript_mappings_pkey;

alter table public.meta_ad_transcript_mappings
  add constraint meta_ad_transcript_mappings_pkey primary key (mapping_key);

create index if not exists meta_ad_transcript_ad_creative_idx
  on public.meta_ad_transcript_mappings(meta_ad_id, meta_creative_id, meta_video_id);
