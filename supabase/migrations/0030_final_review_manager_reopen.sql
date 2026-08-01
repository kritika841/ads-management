create or replace function public.final_review_ad_atomic(
  p_ad_id uuid, p_actor_id uuid, p_decision text, p_note text default null, p_target text default null
)
returns public.ads
language plpgsql security definer set search_path = public
as $$
-- identical body to 0029, only this line changes:
--   and not (actor_role = 'admin' and p_decision = 'request_changes' and current_ad.production_stage = 'approved')
-- becomes:
--   and not (actor_role in ('admin','manager') and p_decision = 'request_changes' and current_ad.production_stage = 'approved')
$$;