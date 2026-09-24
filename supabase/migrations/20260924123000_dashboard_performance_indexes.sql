-- =====================================================================
-- 20260924123000_dashboard_performance_indexes.sql
-- Optimizes queries on ads, activity_logs, review_actions, and editor_time_logs
-- to prevent Postgres statement timeouts (57014) on dashboard and library views.
-- =====================================================================

create index if not exists activity_logs_ad_id_idx on public.activity_logs(ad_id);
create index if not exists activity_logs_ad_id_created_at_idx on public.activity_logs(ad_id, created_at desc);

create index if not exists review_actions_ad_id_idx on public.review_actions(ad_id);
create index if not exists review_actions_ad_id_created_at_idx on public.review_actions(ad_id, created_at desc);

create index if not exists ads_production_stage_idx on public.ads(production_stage);
create index if not exists ads_updated_at_idx on public.ads(updated_at desc);
create index if not exists ads_production_stage_updated_at_idx on public.ads(production_stage, updated_at desc);

create index if not exists editor_time_logs_session_started_idx on public.editor_time_logs(session_started_at desc);
create index if not exists editor_time_logs_active_session_idx on public.editor_time_logs(is_active, session_ended_at);
