alter table public.ads
add column if not exists production_stage text not null default 'script_writing',
add column if not exists raw_footage_url text,
add column if not exists script_ready_at timestamptz,
add column if not exists shoot_completed_at timestamptz,
add column if not exists raw_footage_shared_at timestamptz,
add column if not exists editing_started_at timestamptz,
add column if not exists creator_reviewed_at timestamptz,
add column if not exists final_approved_at timestamptz;

alter table public.ads
drop constraint if exists ads_production_stage_check;

alter table public.ads
add constraint ads_production_stage_check check (
  production_stage in (
    'script_writing',
    'ready_to_shoot',
    'shoot_complete',
    'ready_for_edit',
    'editing',
    'creator_review',
    'final_review',
    'approved'
  )
);

update public.ads
set production_stage = case
  when status in ('approved', 'published') then 'approved'
  when status = 'pending_review' then 'final_review'
  when status in ('changes_requested', 'rejected') then 'editing'
  else 'script_writing'
end,
final_approved_at = case
  when status in ('approved', 'published') then coalesce(approved_at, updated_at)
  else final_approved_at
end
where production_stage = 'script_writing';

create index if not exists ads_production_stage_idx on public.ads(production_stage);

update public.app_settings set two_step_approval = false where id = 1;
