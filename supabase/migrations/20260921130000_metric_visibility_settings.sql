alter table public.app_settings
add column if not exists hidden_metrics_by_role jsonb not null default '{"content_creator":[],"editor":[],"manager":[]}'::jsonb;
