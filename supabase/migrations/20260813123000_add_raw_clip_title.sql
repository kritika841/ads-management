alter table public.raw_clips
  add column if not exists title text;
