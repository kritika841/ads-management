-- Additive transcript-to-Creative-Library mapping. Existing incentive and ad workflows do not depend on this table.
create table public.meta_ad_transcript_mappings (
  meta_ad_id text primary key references public.meta_ads(id) on delete cascade,
  transcript text,
  transcript_hash text,
  transcript_language text,
  transcript_source text not null default 'external',
  transcript_status text not null default 'pending'
    check (transcript_status in ('pending', 'available', 'failed')),
  matched_ad_id uuid references public.ads(id) on delete set null,
  match_score numeric(7,4),
  match_confidence text not null default 'unmatched'
    check (match_confidence in ('high', 'medium', 'low', 'unmatched')),
  matched_tokens integer not null default 0,
  transcript_token_count integer not null default 0,
  script_token_count integer not null default 0,
  mapped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index meta_ad_transcript_match_idx on public.meta_ad_transcript_mappings(matched_ad_id);
create index meta_ad_transcript_confidence_idx on public.meta_ad_transcript_mappings(match_confidence);

alter table public.meta_ad_transcript_mappings enable row level security;
create policy "reviewers view transcript mappings"
on public.meta_ad_transcript_mappings for select
using (public.is_reviewer());
create policy "reviewers manage transcript mappings"
on public.meta_ad_transcript_mappings for all
using (public.is_reviewer())
with check (public.is_reviewer());

create trigger meta_ad_transcript_mappings_set_updated_at
before update on public.meta_ad_transcript_mappings
for each row execute function public.set_updated_at();
