-- Add three new detail columns to raw_clip_segments.
-- These capture the structured per-second description fields introduced by the
-- high-detail tagging prompt: verbatim on-screen text, full environment/background
-- description (repeated every second), and visible people appearance/actions.

alter table public.raw_clip_segments
  add column if not exists on_screen_text text,
  add column if not exists environment_description text,
  add column if not exists people_description text;

-- Update match_clip_segments (MiniLM 384-dim path) to return new columns.
-- Must drop first: Postgres does not allow changing a function's return type via CREATE OR REPLACE.
drop function if exists public.match_clip_segments(vector, int, float);
create or replace function public.match_clip_segments(
  query_embedding vector(384),
  match_count int default 40,
  similarity_threshold float default 0.3
)
returns table (
  segment_id uuid,
  ad_id uuid,
  segment_index int,
  start_seconds numeric,
  end_seconds numeric,
  visual_description text,
  spoken_text text,
  on_screen_text text,
  environment_description text,
  people_description text,
  similarity float
)
language sql stable as $$
  select
    s.id as segment_id,
    s.ad_id,
    s.segment_index,
    s.start_seconds,
    s.end_seconds,
    s.visual_description,
    s.spoken_text,
    s.on_screen_text,
    s.environment_description,
    s.people_description,
    1 - (s.embedding <=> query_embedding) as similarity
  from public.raw_clip_segments s
  where s.embedding is not null
    and 1 - (s.embedding <=> query_embedding) > similarity_threshold
  order by s.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_clip_segments(vector, int, float) from public, anon, authenticated;
grant execute on function public.match_clip_segments(vector, int, float) to service_role;

-- Update match_clip_segments_gemini (Gemini 3072-dim path) to return new columns.
-- Must drop first: Postgres does not allow changing a function's return type via CREATE OR REPLACE.
drop function if exists public.match_clip_segments_gemini(vector, int, float);
create or replace function public.match_clip_segments_gemini(
  query_embedding vector(3072),
  match_count int default 40,
  similarity_threshold float default 0.3
)
returns table (
  segment_id uuid,
  ad_id uuid,
  segment_index int,
  start_seconds numeric,
  end_seconds numeric,
  visual_description text,
  spoken_text text,
  on_screen_text text,
  environment_description text,
  people_description text,
  similarity float
)
language sql stable as $$
  select
    s.id as segment_id,
    s.ad_id,
    s.segment_index,
    s.start_seconds,
    s.end_seconds,
    s.visual_description,
    s.spoken_text,
    s.on_screen_text,
    s.environment_description,
    s.people_description,
    1 - ((s.embedding_gemini::halfvec(3072)) <=> (query_embedding::halfvec(3072))) as similarity
  from public.raw_clip_segments s
  where s.embedding_gemini is not null
    and 1 - ((s.embedding_gemini::halfvec(3072)) <=> (query_embedding::halfvec(3072))) > similarity_threshold
  order by (s.embedding_gemini::halfvec(3072)) <=> (query_embedding::halfvec(3072))
  limit match_count;
$$;

revoke all on function public.match_clip_segments_gemini(vector, int, float) from public, anon, authenticated;
grant execute on function public.match_clip_segments_gemini(vector, int, float) to service_role;
