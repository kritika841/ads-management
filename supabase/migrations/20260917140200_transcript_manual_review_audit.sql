-- Human-reviewed decisions are separate from automated transcript evidence.
alter table public.meta_ad_transcript_mappings
  add column if not exists review_status text not null default 'pending'
    check (review_status in ('pending', 'confirmed_match', 'confirmed_unmatched')),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

create index if not exists meta_ad_transcript_review_status_idx
  on public.meta_ad_transcript_mappings(review_status);
