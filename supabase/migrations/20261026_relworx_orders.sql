-- ============================================================
-- POOL PARTY: Relworx Uganda Mobile Money & Orders Schema Update
-- Non-Destructive Migration: Preserves all existing 70 tickets & data
-- Enforces Least-Privilege RLS (Server service_role only)
-- Venue: Prince Resort, Bunamwaya (Bella), Uganda (11 Dec 2026)
-- ============================================================

-- 1. Ensure pgcrypto extension is enabled
create extension if not exists pgcrypto;

-- 2. Non-destructively ensure columns and indexes exist on public.tickets
alter table public.tickets
  add column if not exists order_ref text,
  add column if not exists reserved_until timestamptz,
  add column if not exists relworx_internal_ref text;

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

-- Ensure columns exist if table was already created
alter table public.orders
  add column if not exists relworx_internal_ref text,
  add column if not exists gateway text default 'relworx';

create index if not exists idx_orders_ref on public.orders(order_ref);
create index if not exists idx_orders_phone on public.orders(buyer_phone);
create index if not exists idx_orders_relworx_ref on public.orders(relworx_internal_ref);

-- 4. HARDEN ROW LEVEL SECURITY (RLS) - LEAST PRIVILEGE AUDIT FIX:
-- Drop insecure broad policies that allowed any authenticated user to view all orders & tickets
alter table public.orders enable row level security;
drop policy if exists "Authenticated and service role orders access" on public.orders;
drop policy if exists "Authenticated access only" on public.orders;
drop policy if exists "Public orders read" on public.orders;

-- Orders contain buyer PII (names, emails, phones, amounts).
-- Strictly restrict access to service_role (the backend Express / Vercel API only).
create policy "Service role only orders access" on public.orders
  for all to service_role
  using (true)
  with check (true);

alter table public.tickets enable row level security;
drop policy if exists "Authenticated access only" on public.tickets;
drop policy if exists "Public tickets view" on public.tickets;

-- Tickets contain sensitive QR tokens and buyer contact details.
-- Strictly restrict direct client queries to service_role.
create policy "Service role only tickets access" on public.tickets
  for all to service_role
  using (true)
  with check (true);

-- 5. Preserve the 70 pre-seeded tickets (VIP-001..020 & ORD-001..050)
-- Never resets, drops, or overwrites existing sales
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

-- 5b. PERSISTENT SERVERLESS RATE LIMITING
create table if not exists public.rate_limits (
  key text primary key,
  count integer not null default 1,
  reset_at timestamptz not null
);

alter table public.rate_limits enable row level security;
drop policy if exists "Service role rate limits access" on public.rate_limits;
create policy "Service role rate limits access" on public.rate_limits
  for all to service_role
  using (true)
  with check (true);

create or replace function public.check_rate_limit(
  p_key text,
  p_max_requests integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_now timestamptz := now();
  v_record public.rate_limits%rowtype;
  v_count integer;
  v_reset timestamptz;
  v_allowed boolean;
begin
  select * into v_record from public.rate_limits where key = p_key for update;
  if not found or v_record.reset_at <= v_now then
    v_count := 1;
    v_reset := v_now + (p_window_seconds || ' seconds')::interval;
    insert into public.rate_limits (key, count, reset_at)
    values (p_key, v_count, v_reset)
    on conflict (key) do update
      set count = 1, reset_at = v_reset;
    v_allowed := true;
  else
    v_count := v_record.count + 1;
    v_reset := v_record.reset_at;
    update public.rate_limits
    set count = v_count
    where key = p_key;
    v_allowed := (v_count <= p_max_requests);
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'count', v_count,
    'reset_at', v_reset,
    'retry_after_seconds', greatest(0, ceil(extract(epoch from (v_reset - v_now))))
  );
end;
$$;

-- 5c. ATOMIC TICKET RESERVATION TO PREVENT OVERSELLING UNDER CONCURRENCY
create or replace function public.reserve_tickets_atomic(
  p_order_ref text,
  p_category text,
  p_quantity integer,
  p_unit_price integer,
  p_total_amount integer,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone text,
  p_network text,
  p_reserved_minutes integer default 10
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_reserved_until timestamptz := now() + (p_reserved_minutes || ' minutes')::interval;
  v_ticket_ids uuid[];
  v_count integer;
begin
  -- First purge any expired reservations to free inventory
  perform public.release_expired_ticket_reservations();

  -- Atomically lock and select available tickets
  select array_agg(id) into v_ticket_ids
  from (
    select id from public.tickets
    where category = p_category
      and status = 'available'
      and (payment_status is null or payment_status = 'unpaid')
    order by ticket_number asc
    limit p_quantity
    for update skip locked
  ) sub;

  v_count := coalesce(array_length(v_ticket_ids, 1), 0);

  if v_count < p_quantity then
    return jsonb_build_object(
      'success', false,
      'error', 'INSUFFICIENT_INVENTORY',
      'available_count', v_count,
      'requested_count', p_quantity
    );
  end if;

  -- Lock these tickets with reservation
  update public.tickets
  set
    status = 'reserved',
    payment_status = 'pending',
    buyer_name = p_buyer_name,
    buyer_email = p_buyer_email,
    buyer_phone = p_buyer_phone,
    order_ref = p_order_ref,
    reserved_until = v_reserved_until
  where id = any(v_ticket_ids);

  -- Insert the order row
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
    gateway,
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
    'relworx',
    v_reserved_until
  );

  return jsonb_build_object(
    'success', true,
    'order_ref', p_order_ref,
    'reserved_count', v_count,
    'reserved_until', v_reserved_until
  );
end;
$$;

-- 6. Safe Atomic Function: Release expired 10-minute unpaid reservations
create or replace function public.release_expired_ticket_reservations()
returns integer
language plpgsql
security definer
as $$
declare
  released_count integer;
begin
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

  update public.orders
  set status = 'expired'
  where
    status = 'pending'
    and reserved_until is not null
    and reserved_until < now();

  return released_count;
end;
$$;

-- 7. Safe Atomic Function: Transactional Payment Confirmation & Ticket Issuance
-- Handles exact amount check, idempotency, and late-payment race recovery
create or replace function public.confirm_order_payment_atomic(
  p_order_ref text,
  p_paid_amount integer,
  p_currency text,
  p_relworx_ref text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_order record;
  v_allocated_count integer := 0;
  v_is_late boolean := false;
  v_now timestamptz := now();
begin
  -- Lock order row for update
  select * into v_order
  from public.orders
  where order_ref = p_order_ref
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  -- Idempotency check: already paid
  if v_order.status = 'paid' then
    return jsonb_build_object(
      'success', true,
      'status', 'already_paid',
      'issued_count', v_order.quantity
    );
  end if;

  -- Exact amount verification
  if p_paid_amount is not null and p_paid_amount != v_order.total_amount_ugx then
    return jsonb_build_object(
      'success', false,
      'error', 'AMOUNT_MISMATCH',
      'expected', v_order.total_amount_ugx,
      'received', p_paid_amount
    );
  end if;

  -- Currency verification
  if p_currency is not null and upper(trim(p_currency)) != 'UGX' then
    return jsonb_build_object(
      'success', false,
      'error', 'CURRENCY_MISMATCH',
      'expected', 'UGX',
      'received', p_currency
    );
  end if;

  if v_order.status = 'expired' or v_order.status = 'cancelled' then
    v_is_late := true;
  end if;

  -- Check if tickets are currently reserved under this order_ref
  update public.tickets
  set
    status = 'issued',
    payment_status = 'paid',
    buyer_name = v_order.buyer_name,
    buyer_email = v_order.buyer_email,
    buyer_phone = v_order.buyer_phone,
    paid_at = v_now,
    relworx_internal_ref = p_relworx_ref
  where order_ref = p_order_ref;

  get diagnostics v_allocated_count = row_count;

  -- If tickets were released due to reservation expiry, recover alternative available tickets
  if v_allocated_count < v_order.quantity then
    with reallocated as (
      update public.tickets
      set
        status = 'issued',
        payment_status = 'paid',
        buyer_name = v_order.buyer_name,
        buyer_email = v_order.buyer_email,
        buyer_phone = v_order.buyer_phone,
        order_ref = p_order_ref,
        paid_at = v_now,
        relworx_internal_ref = p_relworx_ref
      where id in (
        select id from public.tickets
        where category = v_order.category and status = 'available'
        order by ticket_number asc
        limit (v_order.quantity - v_allocated_count)
        for update
      )
      returning id
    )
    select v_allocated_count + count(*) into v_allocated_count from reallocated;
  end if;

  -- Update order record
  update public.orders
  set
    status = 'paid',
    paid_at = v_now,
    relworx_internal_ref = p_relworx_ref
  where order_ref = p_order_ref;

  if v_allocated_count < v_order.quantity then
    return jsonb_build_object(
      'success', true,
      'status', 'overcapacity_manual_review',
      'issued_count', v_allocated_count,
      'requested_count', v_order.quantity,
      'warning', 'CAPACITY_EXCEEDED_AFTER_LATE_PAYMENT'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', case when v_is_late then 'recovered_and_paid' else 'paid' end,
    'issued_count', v_allocated_count
  );
end;
$$;
