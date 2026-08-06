create extension if not exists vector;

create table if not exists public.raw_clip_segments (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ads(id) on delete cascade,
  segment_index int not null,
  start_seconds numeric not null,
  end_seconds numeric not null,
  visual_description text not null,
  spoken_text text not null default '',
  embedding vector(384),
  created_at timestamptz not null default now(),
  unique (ad_id, segment_index)
);

create index if not exists raw_clip_segments_embedding_idx
  on public.raw_clip_segments using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create index if not exists raw_clip_segments_ad_id_idx
  on public.raw_clip_segments (ad_id);

alter table public.ads
  add column if not exists segment_ingest_status text
    check (segment_ingest_status in ('pending','processing','done','error'))
    default 'pending';

alter table public.ads
  add column if not exists segment_ingest_error text;

alter table public.ads
  add column if not exists raw_footage_original_name text;

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
    1 - (s.embedding <=> query_embedding) as similarity
  from public.raw_clip_segments s
  where s.embedding is not null
    and 1 - (s.embedding <=> query_embedding) > similarity_threshold
  order by s.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_clip_segments(vector, int, float) from public, anon, authenticated;
grant execute on function public.match_clip_segments(vector, int, float) to service_role;

create or replace function public.reset_stale_segment_ingest(stale_minutes int default 15)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  update public.ads
  set segment_ingest_status = 'pending'
  where segment_ingest_status = 'processing'
    and updated_at < now() - (stale_minutes || ' minutes')::interval;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.reset_stale_segment_ingest(int) from public, anon, authenticated;
grant execute on function public.reset_stale_segment_ingest(int) to service_role;