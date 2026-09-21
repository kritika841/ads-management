-- The initial carry-forward helper used a standard SQL string for its regular
-- expression. Use an escaped string so repeated carry-overs retain one stable
-- task name instead of nesting the suffix.
create or replace function public.daily_target_carry_task_name(p_task_name text)
returns text language sql immutable set search_path = public as $$
  select left(
    regexp_replace(trim(p_task_name), E' \\(carried forward\\)$', '', 'i'),
    102
  ) || ' (carried forward)'
$$;
