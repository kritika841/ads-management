-- Announcement show popup option and App Settings bulk campaign roles

alter table public.announcements
add column if not exists show_popup boolean not null default true;

alter table public.app_settings
add column if not exists bulk_add_to_campaign_roles jsonb not null default '["admin"]'::jsonb;
