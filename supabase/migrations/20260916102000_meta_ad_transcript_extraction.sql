-- Additive extraction metadata for Meta ad transcript matching.
alter table public.meta_ads
  add column if not exists creative_video_id text;

alter table public.meta_ad_transcript_mappings
  add column if not exists meta_creative_id text,
  add column if not exists meta_video_id text,
  add column if not exists transcript_error text;

create index if not exists meta_ad_transcript_video_idx
on public.meta_ad_transcript_mappings(meta_video_id);
