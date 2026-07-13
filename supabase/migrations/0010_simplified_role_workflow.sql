alter table public.ads
add column if not exists workflow_status_changed_at timestamptz not null default now(),
add column if not exists editor_notes text;

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
    'changes_requested',
    'approved'
  )
);

update public.ads
set production_stage = 'changes_requested'
where status in ('changes_requested', 'rejected');

update public.ads
set workflow_status_changed_at = coalesce(updated_at, created_at, now());

create or replace function public.sync_ad_workflow_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.production_stage is distinct from old.production_stage then
    new.workflow_status_changed_at = now();
  end if;

  new.status = case
    when new.production_stage in ('creator_review', 'final_review') then 'pending_review'::public.ad_status
    when new.production_stage = 'changes_requested' then 'changes_requested'::public.ad_status
    when new.production_stage = 'approved' then 'approved'::public.ad_status
    else 'draft'::public.ad_status
  end;

  return new;
end;
$$;

drop trigger if exists ads_sync_workflow_status on public.ads;
create trigger ads_sync_workflow_status
before insert or update on public.ads
for each row execute function public.sync_ad_workflow_status();

drop policy if exists "active users view team ads" on public.ads;
drop policy if exists "contributors create ads" on public.ads;
drop policy if exists "contributors update editable ads" on public.ads;
drop policy if exists "creators view own ads" on public.ads;
drop policy if exists "editors view assigned ads" on public.ads;

create policy "creators view own ads"
on public.ads for select
using (
  public.current_profile_role() = 'content_creator'
  and creator_id = auth.uid()
);

create policy "editors view assigned ads"
on public.ads for select
using (
  public.current_profile_role() = 'editor'
  and editor_id = auth.uid()
);

drop policy if exists "versions insertable by active users" on public.ad_versions;
drop policy if exists "versions insertable with ad access" on public.ad_versions;
create policy "versions insertable with ad access"
on public.ad_versions for insert
with check (
  auth.uid() = created_by
  and exists (select 1 from public.ads where ads.id = ad_versions.ad_id)
);

drop policy if exists "active users comment" on public.comments;
drop policy if exists "users comment on accessible ads" on public.comments;
create policy "users comment on accessible ads"
on public.comments for insert
with check (
  auth.uid() = author_id
  and exists (select 1 from public.ads where ads.id = comments.ad_id)
);
