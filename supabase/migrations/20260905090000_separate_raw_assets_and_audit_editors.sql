-- Give the Ad Library its own source registry. Creative links are retained only
-- as nullable provenance so neither library owns or cascade-deletes the other.
create table if not exists public.raw_asset_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  drive_url text not null unique,
  provenance_ad_id uuid references public.ads(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.raw_asset_sources (name, drive_url, provenance_ad_id)
select distinct on (a.raw_footage_url)
  coalesce(nullif(trim(a.name), ''), 'Raw asset source'),
  a.raw_footage_url,
  a.id
from public.ads a
where nullif(trim(a.raw_footage_url), '') is not null
order by a.raw_footage_url, a.created_at
on conflict (drive_url) do nothing;

-- Retain orphaned catalog rows too; separation must not depend on the Creative
-- Library row still existing when this migration runs.
insert into public.raw_asset_sources (name, drive_url, provenance_ad_id)
select distinct on (c.source_raw_footage_url)
  coalesce(nullif(trim(c.title), ''), nullif(trim(c.original_name), ''), 'Raw asset source'),
  c.source_raw_footage_url,
  c.ad_id
from public.raw_clips c
where nullif(trim(c.source_raw_footage_url), '') is not null
order by c.source_raw_footage_url, c.created_at
on conflict (drive_url) do nothing;

alter table public.raw_clips add column if not exists source_id uuid references public.raw_asset_sources(id) on delete cascade;

update public.raw_clips c
set source_id = s.id
from public.raw_asset_sources s
where c.source_id is null and s.drive_url = c.source_raw_footage_url;

alter table public.raw_clips alter column source_id set not null;
create index if not exists raw_clips_source_id_idx on public.raw_clips(source_id);

alter table public.raw_clips drop constraint if exists raw_clips_ad_id_fkey;
alter table public.raw_clips alter column ad_id drop not null;
alter table public.raw_clips add constraint raw_clips_ad_id_fkey foreign key (ad_id) references public.ads(id) on delete set null;

-- Preserve legacy segment rows before removing their redundant Creative Library key.
insert into public.raw_clips (source_id, ad_id, title, drive_file_id, source_raw_footage_url, resolved_video_url, ingest_status)
select s.id, a.id, coalesce(nullif(a.name, ''), 'Legacy raw clip'),
       'legacy-segments-' || a.id::text,
       a.raw_footage_url,
       coalesce(a.resolved_video_url, a.raw_footage_url),
       'done'
from public.ads a
join public.raw_asset_sources s on s.drive_url = a.raw_footage_url
where exists (select 1 from public.raw_clip_segments seg where seg.ad_id = a.id and seg.raw_clip_id is null)
  and not exists (select 1 from public.raw_clips c where c.ad_id = a.id)
on conflict (drive_file_id) do nothing;

update public.raw_clip_segments seg
set raw_clip_id = (
  select c.id
  from public.raw_clips c
  join public.ads a on a.id = seg.ad_id
  where c.ad_id = seg.ad_id
  order by (c.drive_file_id = a.drive_file_id) desc, c.created_at asc
  limit 1
)
where seg.raw_clip_id is null;

do $$ begin
  if exists (select 1 from public.raw_clip_segments where raw_clip_id is null) then
    raise exception 'Cannot separate raw segments: legacy raw_clip_id backfill is incomplete';
  end if;
end $$;

alter table public.raw_clip_segments alter column raw_clip_id set not null;
drop index if exists public.raw_clip_segments_ad_id_idx;
alter table public.raw_clip_segments drop constraint if exists raw_clip_segments_ad_id_fkey;
alter table public.raw_clip_segments drop column if exists ad_id;

drop function if exists public.match_clip_segments(vector, int, float);
create function public.match_clip_segments(query_embedding vector(384), match_count int default 40, similarity_threshold float default 0.3)
returns table (segment_id uuid, ad_id uuid, segment_index int, start_seconds numeric, end_seconds numeric, visual_description text, spoken_text text, on_screen_text text, environment_description text, people_description text, similarity float)
language sql stable as $$
  select seg.id, clip.ad_id, seg.segment_index, seg.start_seconds, seg.end_seconds,
         seg.visual_description, seg.spoken_text, seg.on_screen_text, seg.environment_description,
         seg.people_description, 1 - (seg.embedding <=> query_embedding)
  from public.raw_clip_segments seg join public.raw_clips clip on clip.id = seg.raw_clip_id
  where seg.embedding is not null and 1 - (seg.embedding <=> query_embedding) > similarity_threshold
  order by seg.embedding <=> query_embedding limit match_count;
$$;
revoke all on function public.match_clip_segments(vector, int, float) from public, anon, authenticated;
grant execute on function public.match_clip_segments(vector, int, float) to service_role;

drop function if exists public.match_clip_segments_gemini(vector, int, float);
create function public.match_clip_segments_gemini(query_embedding vector(3072), match_count int default 40, similarity_threshold float default 0.3)
returns table (segment_id uuid, raw_clip_id uuid, ad_id uuid, segment_index int, start_seconds numeric, end_seconds numeric, visual_description text, spoken_text text, similarity float)
language sql stable as $$
  select seg.id, seg.raw_clip_id, clip.ad_id, seg.segment_index, seg.start_seconds, seg.end_seconds,
         seg.visual_description, seg.spoken_text,
         1 - ((seg.embedding_gemini::halfvec(3072)) <=> (query_embedding::halfvec(3072)))
  from public.raw_clip_segments seg join public.raw_clips clip on clip.id = seg.raw_clip_id
  where seg.embedding_gemini is not null
    and 1 - ((seg.embedding_gemini::halfvec(3072)) <=> (query_embedding::halfvec(3072))) > similarity_threshold
  order by (seg.embedding_gemini::halfvec(3072)) <=> (query_embedding::halfvec(3072)) limit match_count;
$$;
revoke all on function public.match_clip_segments_gemini(vector, int, float) from public, anon, authenticated;
grant execute on function public.match_clip_segments_gemini(vector, int, float) to service_role;

-- Every future editor change is recorded, including service-role changes.
create table if not exists public.editor_assignment_audit (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ads(id) on delete cascade,
  previous_editor_id uuid references public.profiles(id) on delete set null,
  new_editor_id uuid references public.profiles(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  source text not null default 'database',
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists editor_assignment_audit_ad_id_idx on public.editor_assignment_audit(ad_id, created_at desc);

create or replace function public.audit_editor_assignment_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor_text text;
begin
  if old.editor_id is not distinct from new.editor_id then return new; end if;
  actor_text := coalesce(nullif(current_setting('adflow.actor_id', true), ''), auth.uid()::text);
  insert into public.editor_assignment_audit(ad_id, previous_editor_id, new_editor_id, actor_id, source, reason)
  values (new.id, old.editor_id, new.editor_id,
    case when actor_text ~* '^[0-9a-f-]{36}$' then actor_text::uuid else null end,
    coalesce(nullif(current_setting('adflow.editor_change_source', true), ''), 'database'),
    nullif(current_setting('adflow.editor_change_reason', true), ''));
  return new;
end $$;

drop trigger if exists audit_editor_assignment_change on public.ads;
create trigger audit_editor_assignment_change after update of editor_id on public.ads
for each row execute function public.audit_editor_assignment_change();

alter table public.raw_asset_sources enable row level security;
alter table public.editor_assignment_audit enable row level security;
grant select, insert, update on public.raw_asset_sources to authenticated;
grant select on public.editor_assignment_audit to authenticated;
create policy "reviewers read raw asset sources" on public.raw_asset_sources for select using (public.is_reviewer());
create policy "reviewers manage raw asset sources" on public.raw_asset_sources for all using (public.is_reviewer()) with check (public.is_reviewer());
create policy "reviewers read editor assignment audit" on public.editor_assignment_audit for select using (public.is_reviewer());

create or replace function public.set_ad_editor_assignment_atomic(
  p_ad_id uuid,
  p_actor_id uuid,
  p_editor_id uuid,
  p_deadline date,
  p_reason text default null
)
returns public.ads
language plpgsql
security definer
set search_path = public
as $$
declare
  current_ad public.ads;
  actor_profile public.profiles;
  editor_profile public.profiles;
  updated_ad public.ads;
begin
  select * into actor_profile from public.profiles where id = p_actor_id and active = true;
  if not found then raise exception 'Active user not found'; end if;
  select * into current_ad from public.ads where id = p_ad_id for update;
  if not found then raise exception 'Creative not found'; end if;

  if p_editor_id is null then
    if actor_profile.role not in ('admin', 'manager') then raise exception 'Only managers and admins can clear an editor'; end if;
    if nullif(trim(p_reason), '') is null then raise exception 'A reason is required to clear an editor'; end if;
  else
    if not (actor_profile.role in ('admin', 'manager') or (actor_profile.role = 'content_creator' and current_ad.creator_id = p_actor_id)) then
      raise exception 'User cannot assign this creative';
    end if;
    if p_deadline is null then raise exception 'Deadline is required'; end if;
    select * into editor_profile from public.profiles where id = p_editor_id and role = 'editor' and active = true;
    if not found then raise exception 'Choose an active editor'; end if;
  end if;

  perform set_config('adflow.actor_id', p_actor_id::text, true);
  perform set_config('adflow.editor_change_source', 'editor_assignment_rpc', true);
  perform set_config('adflow.editor_change_reason', coalesce(p_reason, ''), true);
  update public.ads
  set editor_id = p_editor_id,
      assigned_at = case when p_editor_id is null then null when editor_id = p_editor_id then assigned_at else now() end,
      deadline = case when p_editor_id is null then deadline else p_deadline end
  where id = p_ad_id
  returning * into updated_ad;

  insert into public.activity_logs(ad_id, actor_id, action, metadata)
  values (p_ad_id, p_actor_id,
    case when p_editor_id is null then 'editor_cleared' when current_ad.editor_id is null then 'editor_assigned' else 'editor_reassigned' end,
    jsonb_build_object('previous_editor_id', current_ad.editor_id, 'editor_id', p_editor_id, 'deadline', p_deadline, 'reason', p_reason));
  return updated_ad;
end $$;

revoke all on function public.set_ad_editor_assignment_atomic(uuid, uuid, uuid, date, text) from public, anon, authenticated;
grant execute on function public.set_ad_editor_assignment_atomic(uuid, uuid, uuid, date, text) to service_role;
