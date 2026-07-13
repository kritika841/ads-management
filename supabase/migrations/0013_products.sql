create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sku text,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();

alter table public.ads
add column if not exists product_id uuid references public.products(id);

create index if not exists ads_product_idx on public.ads(product_id);

alter table public.products enable row level security;

create policy "products visible to active users"
on public.products for select
using (public.current_profile_role() is not null);

create policy "admins manage products"
on public.products for all
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');
