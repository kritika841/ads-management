-- Add video_goal column to campaigns table for internal campaign video targets
alter table public.campaigns
  add column if not exists video_goal integer not null default 10;
