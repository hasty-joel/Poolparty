-- ============================================================
-- POOL PARTY: Safe Non-Destructive Schema Sync & Cache Reload
-- Safely upgrades an existing initial 70-ticket Supabase database
-- WITHOUT resetting, deleting, or overwriting any ticket records.
-- ============================================================

-- 1. Add missing reservation & Relworx columns to public.tickets
alter table public.tickets
  add column if not exists order_ref text,
  add column if not exists reserved_until timestamptz,
  add column if not exists relworx_internal_ref text,
  add column if not exists flw_transaction_id text;

create index if not exists idx_tickets_category_status on public.tickets(category, status);
create index if not exists idx_tickets_order_ref on public.tickets(order_ref);
create index if not exists idx_tickets_reserved_until on public.tickets(reserved_until);
create index if not exists idx_tickets_relworx_ref on public.tickets(relworx_internal_ref);

-- 2. Create public.orders table if missing (non-destructive)
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

alter table public.orders
  add column if not exists relworx_internal_ref text,
  add column if not exists flw_transaction_id text,
  add column if not exists flw_ref text,
  add column if not exists gateway text default 'relworx',
  add column if not exists reserved_until timestamptz default (now() + interval '10 minutes');

create index if not exists idx_orders_ref on public.orders(order_ref);
create index if not exists idx_orders_phone on public.orders(buyer_phone);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_relworx_ref on public.orders(relworx_internal_ref);

-- 3. Ensure Row Level Security on public.orders
alter table public.orders enable row level security;

drop policy if exists "Service role orders management" on public.orders;
create policy "Service role orders management" on public.orders
  for all using (auth.role() = 'authenticated' or auth.role() = 'service_role');

-- 4. Safe Atomic Function: Release expired unpaid reservations (10-minute window)
create or replace function public.release_expired_ticket_reservations()
returns integer
language plpgsql
security definer
as $$
declare
  released_count integer := 0;
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

-- 5. Safe Atomic Function: Reserve Tickets (FOR UPDATE SKIP LOCKED)
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
  perform public.release_expired_ticket_reservations();

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

-- 6. Reload PostgREST schema cache immediately
notify pgrst, 'reload schema';
