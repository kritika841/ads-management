-- Deterministic mapping: the Creative Library and Meta catalogue share the same
-- human creative code (for example TAM0017). These rows do not depend on ASR.
insert into public.meta_ad_transcript_mappings (
  mapping_key,
  meta_ad_id,
  meta_creative_id,
  meta_video_id,
  transcript,
  transcript_hash,
  transcript_language,
  transcript_source,
  transcript_status,
  transcript_error,
  matched_ad_id,
  match_score,
  match_confidence,
  matched_tokens,
  transcript_token_count,
  script_token_count,
  mapped_at
)
select
  concat_ws(':', 'meta', m.id, 'creative', coalesce(m.creative_id, 'named'), 'video', 'id-match'),
  m.id,
  m.creative_id,
  null,
  null,
  null,
  null,
  'exact_creative_id',
  'available',
  null,
  a.id,
  1.0,
  'high',
  0,
  0,
  0,
  now()
from public.meta_ads m
join public.ads a
  on upper(trim(m.name)) = upper(trim(a.name))
where m.name is not null
  and a.name is not null
  and trim(m.name) <> ''
on conflict (mapping_key) do update
set
  matched_ad_id = excluded.matched_ad_id,
  match_score = 1.0,
  match_confidence = 'high',
  transcript_source = 'exact_creative_id',
  transcript_status = 'available',
  transcript_error = null,
  mapped_at = now();
