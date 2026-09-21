-- Preserve creator/editor attribution and record automatic Meta-to-AdFlow matches.

alter table public.incentive_creatives
  add column if not exists creator_id uuid references public.profiles(id),
  add column if not exists editor_id uuid references public.profiles(id),
  add column if not exists attribution_source text not null default 'manual'
    check (attribution_source in ('manual', 'auto')),
  add column if not exists auto_matched_at timestamptz;

update public.incentive_creatives ic
set creator_id = ads.creator_id,
    editor_id = ads.editor_id
from public.ads
where ads.id = ic.ad_id
  and (ic.creator_id is null or ic.editor_id is null);

create index if not exists incentive_creatives_creator_idx on public.incentive_creatives(creator_id);
create index if not exists incentive_creatives_editor_idx on public.incentive_creatives(editor_id);

alter table public.meta_ads
  add column if not exists matched_ad_id uuid references public.ads(id) on delete set null,
  add column if not exists matched_creator_id uuid references public.profiles(id) on delete set null,
  add column if not exists matched_editor_id uuid references public.profiles(id) on delete set null,
  add column if not exists detected_tag text,
  add column if not exists auto_matched_at timestamptz;

create index if not exists meta_ads_matched_ad_idx on public.meta_ads(matched_ad_id);
