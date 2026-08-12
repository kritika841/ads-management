create table if not exists public.raw_clips (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ads(id) on delete cascade,
  drive_file_id text not null,
  source_raw_footage_url text not null,
  resolved_video_url text not null,
  thumbnail_url text,
  original_name text,
  duration_millis bigint,
  ingest_status text not null default 'pending'
    check (ingest_status in ('pending', 'processing', 'done', 'error')),
  ingest_error text,
  preview_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (drive_file_id)
);

create index if not exists raw_clips_ad_id_idx on public.raw_clips (ad_id);
create index if not exists raw_clips_ingest_status_idx on public.raw_clips (ingest_status);

alter table public.raw_clip_segments
  add column if not exists raw_clip_id uuid references public.raw_clips(id) on delete cascade;

drop function if exists public.match_clip_segments_gemini(vector, int, float);

create or replace function public.match_clip_segments_gemini(
  query_embedding vector(3072),
  match_count int default 40,
  similarity_threshold float default 0.3
)
returns table (
  segment_id uuid,
  raw_clip_id uuid,
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
    s.raw_clip_id,
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
