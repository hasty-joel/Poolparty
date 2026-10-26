-- ============================================================
-- POOL PARTY: Relworx Uganda Mobile Money & Orders Schema Update
-- Preserves existing tables (public.tickets & public.orders)
-- Adds Relworx tracking columns and indexes non-destructively
-- ============================================================

-- 1. Ensure pgcrypto extension is available
create extension if not exists pgcrypto;

-- 2. Add Relworx columns to public.tickets if not present
alter table public.tickets
  add column if not exists order_ref text,
  add column if not exists reserved_until timestamptz,
  add column if not exists relworx_internal_ref text;

-- Indexes for performance on lookups and reservation expiration
create index if not exists idx_tickets_order_ref on public.tickets(order_ref);
create index if not exists idx_tickets_reserved_until on public.tickets(reserved_until);
create index if not exists idx_tickets_relworx_ref on public.tickets(relworx_internal_ref);

-- 3. Create or enhance public.orders table
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_ref text unique not null,
  category text not null check (category in ('VIP', 'ORDINARY')),
  quantity integer not null check (quantity > 0 and quantity <= 10),
  unit_price_ugx integer not null check (unit_price_ugx > 0),
  total_amount_ugx integer not null check (total_amount_ugx > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'expired')),
  payment_method text not null default 'relworx_mobile_money',
  network text check (network in ('MTN', 'AIRTEL')),
  buyer_name text not null,
  buyer_email text not null,
  buyer_phone text not null,
  relworx_internal_ref text,
  gateway text not null default 'relworx',
  reserved_until timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- Ensure relworx_internal_ref exists if table was previously created
alter table public.orders
  add column if not exists relworx_internal_ref text,
  add column if not exists gateway text default 'relworx';

-- Indexes on orders
create index if not exists idx_orders_ref on public.orders(order_ref);
create index if not exists idx_orders_phone on public.orders(buyer_phone);
create index if not exists idx_orders_relworx_ref on public.orders(relworx_internal_ref);

-- 4. Enable Row Level Security (RLS) on public.orders
alter table public.orders enable row level security;

-- Keep orders inaccessible to public anonymous queries (RLS enforced)
-- Drop old policy if exists to avoid collision
drop policy if exists "Authenticated and service role orders access" on public.orders;
create policy "Authenticated and service role orders access" on public.orders
for all using (auth.role() = 'authenticated' or auth.role() = 'service_role');

-- 5. Safe Atomic Function: Release expired unpaid reservations
create or replace function public.release_expired_ticket_reservations()
returns integer
language plpgsql
security definer
as $$
declare
  released_count integer;
begin
  -- Release tickets whose 10-minute reservation window expired without payment
  with expired as (
    update public.tickets
    set
      status = 'available',
      payment_status = 'unpaid',
      buyer_name = null,
      buyer_email = null,
      buyer_phone = null,
      order_ref = null,
      reserved_until = null,
      relworx_internal_ref = null
    where
      status = 'reserved'
      and payment_status in ('unpaid', 'pending')
      and reserved_until is not null
      and reserved_until < now()
    returning id
  )
  select count(*) into released_count from expired;

  -- Update associated pending orders to 'expired'
  update public.orders
  set status = 'expired'
  where
    status = 'pending'
    and reserved_until is not null
    and reserved_until < now();

  return released_count;
end;
$$;
