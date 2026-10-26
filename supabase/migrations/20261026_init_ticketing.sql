-- ============================================================
-- POOL PARTY: initial inventory of 70 tickets
-- Date: 11 December 2026
-- Venue: Prince Resort, Bunamwaya (Bella), Uganda
-- Inventory: 20 VIP (UGX 50,000) & 50 Ordinary (UGX 20,000)
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),

  ticket_number text unique not null,
  category text not null
    check (category in ('VIP', 'ORDINARY')),

  price_ugx integer not null
    check (price_ugx > 0),

  status text not null default 'available'
    check (status in (
      'available', 'reserved', 'issued', 'cancelled'
    )),

  payment_status text not null default 'unpaid'
    check (payment_status in (
      'unpaid', 'pending', 'paid',
      'failed', 'refunded', 'manual_paid'
    )),

  buyer_name text,
  buyer_email text,
  buyer_phone text,

  qr_token uuid not null unique default gen_random_uuid(),

  created_at timestamptz not null default now(),
  paid_at timestamptz,
  checked_in_at timestamptz,

  constraint ticket_number_category_check check (
    (category = 'VIP' and ticket_number like 'VIP-%')
    or
    (category = 'ORDINARY' and ticket_number like 'ORD-%')
  )
);

-- Keep ticket records inaccessible to public API roles.
alter table public.tickets enable row level security;

-- Authenticated admins and service role manage tickets securely
create policy "Authenticated access only" on public.tickets
for all using (auth.role() = 'authenticated' or auth.role() = 'service_role');

-- Create exactly 20 VIP tickets (VIP-001 to VIP-020)
insert into public.tickets (ticket_number, category, price_ugx)
select
  'VIP-' || lpad(n::text, 3, '0'),
  'VIP',
  50000
from generate_series(1, 20) as n
on conflict (ticket_number) do nothing;

-- Create exactly 50 Ordinary tickets (ORD-001 to ORD-050)
insert into public.tickets (ticket_number, category, price_ugx)
select
  'ORD-' || lpad(n::text, 3, '0'),
  'ORDINARY',
  20000
from generate_series(1, 50) as n
on conflict (ticket_number) do nothing;

-- Inventory health check
select
  category,
  count(*) as total_tickets,
  count(*) filter (
    where status = 'available'
  ) as available
from public.tickets
group by category
order by category;
