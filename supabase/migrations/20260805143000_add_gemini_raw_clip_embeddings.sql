alter table public.raw_clip_segments
  add column if not exists embedding_gemini vector(3072);

create index if not exists raw_clip_segments_embedding_gemini_idx
  on public.raw_clip_segments
  using hnsw ((embedding_gemini::halfvec(3072)) halfvec_cosine_ops);

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
    1 - ((s.embedding_gemini::halfvec(3072)) <=> (query_embedding::halfvec(3072))) as similarity
  from public.raw_clip_segments s
  where s.embedding_gemini is not null
    and 1 - ((s.embedding_gemini::halfvec(3072)) <=> (query_embedding::halfvec(3072))) > similarity_threshold
  order by (s.embedding_gemini::halfvec(3072)) <=> (query_embedding::halfvec(3072))
  limit match_count;
$$;

revoke all on function public.match_clip_segments_gemini(vector, int, float) from public, anon, authenticated;
grant execute on function public.match_clip_segments_gemini(vector, int, float) to service_role;