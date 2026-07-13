alter table public.app_settings
add column if not exists assignment_start_sla_hours int not null default 12,
add column if not exists editing_sla_hours int not null default 48,
add column if not exists creator_review_sla_hours int not null default 24,
add column if not exists final_review_sla_hours int not null default 24,
add column if not exists revision_sla_hours int not null default 24;

alter table public.app_settings
drop constraint if exists app_settings_analytics_sla_hours_check;

alter table public.app_settings
add constraint app_settings_analytics_sla_hours_check check (
  assignment_start_sla_hours between 1 and 720
  and editing_sla_hours between 1 and 720
  and creator_review_sla_hours between 1 and 720
  and final_review_sla_hours between 1 and 720
  and revision_sla_hours between 1 and 720
);
