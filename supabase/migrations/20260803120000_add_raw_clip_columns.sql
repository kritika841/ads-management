create extension if not exists vector;

alter table ads
  add column if not exists raw_clip_status text default 'pending',
  add column if not exists raw_clip_error_message text,
  add column if not exists raw_clip_description text,
  add column if not exists raw_clip_shot_type text,
  add column if not exists raw_clip_camera_movement text,
  add column if not exists raw_clip_subject text,
  add column if not exists raw_clip_action text,
  add column if not exists raw_clip_products_shown text[],
  add column if not exists raw_clip_setting text,
  add column if not exists raw_clip_mood text,
  add column if not exists raw_clip_color_palette text,
  add column if not exists raw_clip_suggested_edit_use text,
  add column if not exists raw_clip_has_text_overlay boolean,
  add column if not exists raw_clip_has_audio boolean,
  add column if not exists raw_clip_duration_notes text,
  add column if not exists raw_clip_embedding vector(384),
  add column if not exists raw_clip_tagged_at timestamptz;

create index if not exists ads_raw_clip_embedding_idx
  on ads using ivfflat (raw_clip_embedding vector_cosine_ops)
  with (lists = 100);

create or replace function match_raw_clips(
  query_embedding vector(384),
  match_threshold float default 0.25,
  match_count int default 10
)
returns table (
  id uuid,
  name text,
  raw_footage_url text,
  raw_clip_description text,
  raw_clip_shot_type text,
  raw_clip_mood text,
  similarity float
)
language sql stable
as $$
  select
    ads.id,
    ads.name,
    ads.raw_footage_url,
    ads.raw_clip_description,
    ads.raw_clip_shot_type,
    ads.raw_clip_mood,
    1 - (ads.raw_clip_embedding <=> query_embedding) as similarity
  from ads
  where ads.raw_clip_status = 'done'
    and ads.raw_footage_url is not null
    and 1 - (ads.raw_clip_embedding <=> query_embedding) > match_threshold
  order by ads.raw_clip_embedding <=> query_embedding
  limit match_count;
$$;
