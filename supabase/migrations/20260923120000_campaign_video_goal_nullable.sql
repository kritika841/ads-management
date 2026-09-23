-- Allow video_goal to be nullable on campaigns table
alter table public.campaigns alter column video_goal drop not null;
alter table public.campaigns alter column video_goal drop default;
