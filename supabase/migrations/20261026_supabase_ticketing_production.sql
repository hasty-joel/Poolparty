-- ============================================================
-- POOL PARTY: Production Supabase Ticketing & Order Migration
-- Date: 11 December 2026
-- Venue: Prince Resort, Bunamwaya (Bella), Uganda
-- Total Capacity: 70 Passes (20 VIP @ UGX 50,000 & 50 Ordinary @ UGX 20,000)
-- ============================================================

-- 1. Ensure required extensions
create extension if not exists pgcrypto;

-- 2. Public Tickets Table
-- Preserves all existing records, IDs, ticket numbers, and buyer info.
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text unique not null,
  category text not null check (category in ('VIP', 'ORDINARY')),
  price_ugx integer not null check (price_ugx > 0),
  status text not null default 'available' check (status in ('available', 'reserved', 'issued', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'refunded', 'manual_paid')),
  buyer_name text,
  buyer_email text,
  buyer_phone text,
  qr_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  checked_in_at timestamptz,
  order_ref text,
  reserved_until timestamptz,
  relworx_internal_ref text,
  flw_transaction_id text,

  constraint ticket_number_category_check check (
    (category = 'VIP' and ticket_number like 'VIP-%')
    or
    (category = 'ORDINARY' and ticket_number like 'ORD-%')
  )
);

-- Ensure any existing table has all required columns
alter table public.tickets
  add column if not exists order_ref text,
  add column if not exists reserved_until timestamptz,
  add column if not exists relworx_internal_ref text,
  add column if not exists flw_transaction_id text;

-- Indexes for performance & concurrency
create index if not exists idx_tickets_category_status on public.tickets(category, status);
create index if not exists idx_tickets_order_ref on public.tickets(order_ref);
create index if not exists idx_tickets_reserved_until on public.tickets(reserved_until);
create index if not exists idx_tickets_qr_token on public.tickets(qr_token);
create index if not exists idx_tickets_buyer_phone on public.tickets(buyer_phone);

-- 3. Public Orders Table
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
  flw_transaction_id text,
  flw_ref text,
  gateway text not null default 'relworx',
  reserved_until timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- Ensure all order columns exist if created earlier
alter table public.orders
  add column if not exists relworx_internal_ref text,
  add column if not exists flw_transaction_id text,
  add column if not exists flw_ref text,
  add column if not exists gateway text default 'relworx',
  add column if not exists reserved_until timestamptz default (now() + interval '10 minutes');

-- Indexes on orders
create index if not exists idx_orders_ref on public.orders(order_ref);
create index if not exists idx_orders_phone on public.orders(buyer_phone);
create index if not exists idx_orders_status on public.orders(status);

-- 4. Enable Row Level Security (RLS) on both tables
alter table public.tickets enable row level security;
alter table public.orders enable row level security;

-- Drop obsolete or permissive policies to ensure least-privilege security
drop policy if exists "Authenticated access only" on public.tickets;
drop policy if exists "Authenticated and service role tickets access" on public.tickets;
drop policy if exists "Authenticated and service role orders access" on public.orders;
drop policy if exists "Public ticket read" on public.tickets;

-- Least privilege: Anonymous users CANNOT read tickets or orders directly.
-- Privileged server-side client (service_role) and authenticated users have full access.
create policy "Service role tickets management" on public.tickets
  for all using (auth.role() = 'authenticated' or auth.role() = 'service_role');

create policy "Service role orders management" on public.orders
  for all using (auth.role() = 'authenticated' or auth.role() = 'service_role');

-- 5. Safe Idempotent Inventory Population (20 VIP & 50 Ordinary)
-- Strictly preserves existing ticket records and buyer information.
insert into public.tickets (ticket_number, category, price_ugx)
select
  'VIP-' || lpad(n::text, 3, '0'),
  'VIP',
  50000
from generate_series(1, 20) as n
on conflict (ticket_number) do nothing;

insert into public.tickets (ticket_number, category, price_ugx)
select
  'ORD-' || lpad(n::text, 3, '0'),
  'ORDINARY',
  20000
from generate_series(1, 50) as n
on conflict (ticket_number) do nothing;

-- 6. Atomic Function: Release expired unpaid reservations (10-minute window)
create or replace function public.release_expired_ticket_reservations()
returns integer
language plpgsql
security definer
as $$
declare
  released_count integer := 0;
begin
  -- Release tickets whose 10-minute reservation window expired without confirmed payment
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

  -- Mark corresponding pending orders as 'expired'
  update public.orders
  set status = 'expired'
  where
    status = 'pending'
    and reserved_until is not null
    and reserved_until < now();

  return released_count;
end;
$$;

-- 7. Atomic Function: Reserve Tickets (Locks rows with FOR UPDATE SKIP LOCKED)
create or replace function public.reserve_tickets_atomic(
  p_category text,
  p_quantity integer,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone text,
  p_order_ref text,
  p_reserved_until timestamptz,
  p_network text default 'MTN',
  p_unit_price integer default 20000,
  p_total_amount integer default 20000
)
returns json
language plpgsql
security definer
as $$
declare
  v_available_count integer;
  v_reserved_ids uuid[];
begin
  -- Clean up expired reservations first
  perform public.release_expired_ticket_reservations();

  -- Select and lock candidate tickets with FOR UPDATE SKIP LOCKED
  select array_agg(id) into v_reserved_ids
  from (
    select id
    from public.tickets
    where category = p_category
      and status = 'available'
    order by ticket_number asc
    limit p_quantity
    for update skip locked
  ) sub;

  if v_reserved_ids is null or coalesce(array_length(v_reserved_ids, 1), 0) < p_quantity then
    select count(*) into v_available_count
    from public.tickets
    where category = p_category and status = 'available';

    return json_build_object(
      'success', false,
      'message', format('Insufficient tickets available. Only %s %s ticket(s) remaining.', coalesce(v_available_count, 0), p_category)
    );
  end if;

  -- Lock the selected tickets with buyer info and expiry
  update public.tickets
  set
    status = 'reserved',
    payment_status = 'pending',
    buyer_name = p_buyer_name,
    buyer_email = p_buyer_email,
    buyer_phone = p_buyer_phone,
    order_ref = p_order_ref,
    reserved_until = p_reserved_until
  where id = any(v_reserved_ids);

  -- Insert order record
  insert into public.orders (
    order_ref,
    category,
    quantity,
    unit_price_ugx,
    total_amount_ugx,
    status,
    payment_method,
    network,
    buyer_name,
    buyer_email,
    buyer_phone,
    reserved_until
  ) values (
    p_order_ref,
    p_category,
    p_quantity,
    p_unit_price,
    p_total_amount,
    'pending',
    'relworx_mobile_money',
    p_network,
    p_buyer_name,
    p_buyer_email,
    p_buyer_phone,
    p_reserved_until
  );

  return json_build_object(
    'success', true,
    'order_ref', p_order_ref,
    'reserved_ticket_ids', v_reserved_ids,
    'quantity', p_quantity,
    'reserved_until', p_reserved_until
  );
end;
$$;

-- 8. Atomic Function: Idempotent Payment Confirmation & Ticket Issuance
create or replace function public.mark_order_paid_atomic(
  p_order_ref text,
  p_relworx_internal_ref text default null,
  p_flw_transaction_id text default null
)
returns json
language plpgsql
security definer
as $$
declare
  v_order record;
  v_ticket_count integer := 0;
  v_now timestamptz := now();
begin
  select * into v_order
  from public.orders
  where order_ref = p_order_ref
  for update;

  if not found then
    return json_build_object('success', false, 'message', 'Order not found');
  end if;

  if v_order.status = 'paid' then
    -- Idempotent: already paid, do not re-process
    return json_build_object('success', true, 'message', 'Order is already marked as paid');
  end if;

  -- Update order record
  update public.orders
  set
    status = 'paid',
    paid_at = coalesce(paid_at, v_now),
    relworx_internal_ref = coalesce(p_relworx_internal_ref, relworx_internal_ref),
    flw_transaction_id = coalesce(p_flw_transaction_id, flw_transaction_id)
  where order_ref = p_order_ref;

  -- Update tickets to issued and paid
  update public.tickets
  set
    status = 'issued',
    payment_status = 'paid',
    paid_at = coalesce(paid_at, v_now),
    relworx_internal_ref = coalesce(p_relworx_internal_ref, relworx_internal_ref)
  where order_ref = p_order_ref;

  get diagnostics v_ticket_count = row_count;

  return json_build_object(
    'success', true,
    'order_ref', p_order_ref,
    'tickets_issued', v_ticket_count
  );
end;
$$;

-- 9. Atomic Function: Gate Check-in Verification
create or replace function public.gate_checkin_atomic(
  p_token_or_number text
)
returns json
language plpgsql
security definer
as $$
declare
  v_ticket record;
  v_now timestamptz := now();
begin
  select * into v_ticket
  from public.tickets
  where qr_token::text = p_token_or_number or ticket_number = p_token_or_number
  for update;

  if not found then
    return json_build_object(
      'status', 'INVALID',
      'message', 'Invalid or unrecognized QR token / ticket number.'
    );
  end if;

  if v_ticket.status = 'cancelled' then
    return json_build_object(
      'status', 'CANCELLED',
      'message', format('Ticket %s has been cancelled or revoked. Deny entry.', v_ticket.ticket_number),
      'ticket', row_to_json(v_ticket)
    );
  end if;

  if v_ticket.status != 'issued' or (v_ticket.payment_status != 'paid' and v_ticket.payment_status != 'manual_paid') then
    return json_build_object(
      'status', 'UNPAID',
      'message', format('Ticket %s is unpaid (%s). Payment required.', v_ticket.ticket_number, v_ticket.status),
      'ticket', row_to_json(v_ticket)
    );
  end if;

  if v_ticket.checked_in_at is not null then
    return json_build_object(
      'status', 'ALREADY_USED',
      'message', format('DUPLICATE: Already checked in at %s.', v_ticket.checked_in_at),
      'ticket', row_to_json(v_ticket),
      'checkedInAt', v_ticket.checked_in_at
    );
  end if;

  -- Mark admission
  update public.tickets
  set checked_in_at = v_now
  where id = v_ticket.id;

  v_ticket.checked_in_at := v_now;

  return json_build_object(
    'status', 'ADMITTED',
    'message', format('ADMITTED: Welcome to Pool Party, %s! (%s Pass #%s)', coalesce(v_ticket.buyer_name, 'Guest'), v_ticket.category, v_ticket.ticket_number),
    'ticket', row_to_json(v_ticket),
    'checkedInAt', v_now
  );
end;
$$;
