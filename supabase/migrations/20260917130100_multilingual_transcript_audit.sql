-- Preserve the language decision and word-level ASR output for reviewer audit.
alter table public.meta_ad_transcript_mappings
  add column if not exists transcript_language_confidence numeric(5,4),
  add column if not exists transcript_word_timings jsonb;
