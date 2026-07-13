alter table public.app_settings
add column if not exists max_concurrent_edits int not null default 2;

alter table public.app_settings
drop constraint if exists app_settings_max_concurrent_edits_check;

alter table public.app_settings
add constraint app_settings_max_concurrent_edits_check check (max_concurrent_edits >= 1);
