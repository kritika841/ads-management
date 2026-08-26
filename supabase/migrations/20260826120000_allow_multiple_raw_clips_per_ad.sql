-- One creative can have many raw source clips. Segment position is only meaningful
-- inside an individual raw clip, so the legacy per-ad uniqueness key is invalid.
alter table public.raw_clip_segments
  drop constraint if exists raw_clip_segments_ad_id_segment_index_key;

alter table public.raw_clip_segments
  add constraint raw_clip_segments_raw_clip_id_segment_index_key
  unique (raw_clip_id, segment_index);
