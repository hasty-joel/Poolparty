-- ============================================================
-- POOL PARTY: Flutterwave Mobile Money & Order Tracking Migration
-- Enhances public.tickets with 10-minute reservation expiry
-- Creates public.orders table for high-level transaction records
-- ============================================================

-- 1. Enhance public.tickets with reservation expiry and Flutterwave reference
alter table public.tickets
  add column if not exists order_ref text,
  add column if not exists reserved_until timestamptz,
  add column if not exists flw_transaction_id text;

-- Index for speedy order and expiry lookups
create index if not exists idx_tickets_order_ref on public.tickets(order_ref);
create index if not exists idx_tickets_reserved_until on public.tickets(reserved_until);

-- 2. Create public.orders table for high-level payment and transaction logs
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_ref text unique not null,
  category text not null check (category in ('VIP', 'ORDINARY')),
  quantity integer not null check (quantity > 0 and quantity <= 10),
  unit_price_ugx integer not null check (unit_price_ugx > 0),
  total_amount_ugx integer not null check (total_amount_ugx > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'expired')),
  payment_method text not null default 'mobile_money_uganda',
  network text check (network in ('MTN', 'AIRTEL')),
  buyer_name text not null,
  buyer_email text not null,
  buyer_phone text not null,
  flw_transaction_id text,
  flw_ref text,
  auth_url text,
  reserved_until timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- Index orders
create index if not exists idx_orders_ref on public.orders(order_ref);
create index if not exists idx_orders_phone on public.orders(buyer_phone);

-- 3. Row Level Security on orders table
alter table public.orders enable row level security;

-- Keep orders inaccessible to public anonymous queries (RLS enforced)
create policy "Authenticated and service role orders access" on public.orders
for all using (auth.role() = 'authenticated' or auth.role() = 'service_role');

-- 4. Atomic Function: Release expired unpaid reservations safely
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
      reserved_until = null
    where
      status = 'reserved'
      and payment_status in ('unpaid', 'pending')
      and reserved_until is not null
      and reserved_until < now()
    returning id
  )
  select count(*) into released_count from expired;

  -- Update associated orders to 'expired'
  update public.orders
  set status = 'expired'
  where
    status = 'pending'
    and reserved_until is not null
    and reserved_until < now();

  return released_count;
end;
$$;
