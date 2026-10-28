-- ==============================================================================
-- POOL PARTY — COMPLETE ALL-IN-ONE SUPABASE PRODUCTION DATABASE SETUP
-- Date: 11 December 2026
-- Venue: Prince Resort, Bunamwaya (Bella), Uganda
-- Total Capacity: 370 Passes
--   • 70 Online Passes: 20 VIP (UGX 50,000) & 50 Ordinary (UGX 20,000)
--   • 300 Hardcopy Passes: 100 VIP (UGX 50,000) & 200 Ordinary (UGX 20,000)
--
-- Security & Operational Guarantees:
--   1. Completely idempotent: safe to run on a brand new Supabase project or an
--      existing database. Preserves all existing IDs, statuses, buyer data, and QR tokens.
--   2. Strict Channel Isolation: Online and Hardcopy pools are strictly separated.
--   3. Least-Privilege & Zero-Trust RLS:
--      - All tables have ENABLE ROW LEVEL SECURITY with NO FORCE ROW LEVEL SECURITY.
--      - Table/sequence privileges are revoked from PUBLIC, anon, and authenticated.
--      - Only service_role can query or mutate tables directly.
--   4. Hardened SECURITY DEFINER RPCs:
--      - Pinned `SET search_path = public, extensions` on all functions.
--      - EXECUTE revoked from PUBLIC, anon, and authenticated; granted only to service_role.
--      - Atomic transactional integrity between ticket updates and immutable audit logs.
--   5. End-of-script assertion confirms all 370 tickets are present and intact.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ------------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ------------------------------------------------------------------------------
-- 2. TABLES AND SCHEMAS
-- ------------------------------------------------------------------------------

-- 2a. Public Tickets Table
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
  mtn_transaction_id text,
  ticket_channel text not null default 'online' check (ticket_channel in ('online', 'hardcopy')),
  assigned_agent text,
  activated_by text,
  activated_at timestamptz,
  hardcopy_batch_ref text,

  constraint ticket_number_category_check check (
    (category = 'VIP' and ticket_number like 'VIP-%')
    or
    (category = 'ORDINARY' and ticket_number like 'ORD-%')
  )
);

-- Ensure columns exist if migrating an existing schema non-destructively
alter table public.tickets
  add column if not exists order_ref text,
  add column if not exists reserved_until timestamptz,
  add column if not exists relworx_internal_ref text,
  add column if not exists flw_transaction_id text,
  add column if not exists mtn_transaction_id text,
  add column if not exists ticket_channel text not null default 'online',
  add column if not exists assigned_agent text,
  add column if not exists activated_by text,
  add column if not exists activated_at timestamptz,
  add column if not exists hardcopy_batch_ref text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tickets_ticket_channel_check') then
    alter table public.tickets add constraint tickets_ticket_channel_check check (ticket_channel in ('online', 'hardcopy'));
  end if;
end $$;

-- 2b. Public Orders Table
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
  mtn_transaction_id text,
  payer_phone text,
  verification_status text default 'unsubmitted',
  verified_at timestamptz,
  verified_by text,
  rejection_reason text,
  submission_notes text,
  reserved_until timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- Ensure all order columns exist if table existed prior
alter table public.orders
  add column if not exists relworx_internal_ref text,
  add column if not exists flw_transaction_id text,
  add column if not exists flw_ref text,
  add column if not exists gateway text default 'relworx',
  add column if not exists mtn_transaction_id text,
  add column if not exists payer_phone text,
  add column if not exists verification_status text default 'unsubmitted',
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by text,
  add column if not exists rejection_reason text,
  add column if not exists submission_notes text,
  add column if not exists reserved_until timestamptz default (now() + interval '10 minutes');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_verification_status_check') then
    alter table public.orders add constraint orders_verification_status_check
      check (verification_status in ('unsubmitted', 'pending_verification', 'verified', 'rejected'));
  end if;
end $$;

-- 2c. Public Hardcopy Audit Logs Table
create table if not exists public.hardcopy_audit_logs (
  id uuid primary key default gen_random_uuid(),
  batch_ref text not null check (length(btrim(batch_ref)) between 4 and 120),
  action text not null check (action in ('activate_single', 'activate_range', 'deactivate_return', 'void_cancel')),
  category text not null check (category in ('VIP', 'ORDINARY')),
  ticket_numbers text[] not null check (cardinality(ticket_numbers) between 1 and 200),
  quantity integer not null check (quantity between 1 and 200 and quantity = cardinality(ticket_numbers)),
  unit_price_ugx integer not null check (
    (category = 'VIP' and unit_price_ugx = 50000)
    or (category = 'ORDINARY' and unit_price_ugx = 20000)
  ),
  total_amount_ugx integer not null check (
    (action in ('activate_single', 'activate_range') and total_amount_ugx = unit_price_ugx * quantity)
    or (action in ('deactivate_return', 'void_cancel') and total_amount_ugx = 0)
  ),
  agent_or_seller text not null check (length(btrim(agent_or_seller)) between 2 and 120),
  buyer_name text,
  buyer_phone text,
  performed_by text not null check (length(btrim(performed_by)) between 2 and 80),
  notes text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------------
-- 3. INDEXES FOR PERFORMANCE & INTEGRITY
-- ------------------------------------------------------------------------------
create index if not exists idx_tickets_category_status on public.tickets(category, status);
create index if not exists idx_tickets_channel_category_status on public.tickets(ticket_channel, category, status);
create index if not exists idx_tickets_order_ref on public.tickets(order_ref);
create index if not exists idx_tickets_reserved_until on public.tickets(reserved_until);
create index if not exists idx_tickets_qr_token on public.tickets(qr_token);
create index if not exists idx_tickets_buyer_phone on public.tickets(buyer_phone);
create index if not exists idx_tickets_hardcopy_batch_ref on public.tickets(hardcopy_batch_ref) where hardcopy_batch_ref is not null;

create index if not exists idx_orders_ref on public.orders(order_ref);
create index if not exists idx_orders_phone on public.orders(buyer_phone);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_verification_status on public.orders(verification_status, created_at desc);
create unique index if not exists idx_orders_unique_mtn_transaction_id on public.orders(mtn_transaction_id)
  where mtn_transaction_id is not null and mtn_transaction_id <> '';

create index if not exists idx_hardcopy_audit_logs_created_at on public.hardcopy_audit_logs(created_at desc);
create index if not exists idx_hardcopy_audit_logs_batch_ref on public.hardcopy_audit_logs(batch_ref);

-- ------------------------------------------------------------------------------
-- 4. IDEMPOTENT INVENTORY SEEDING (370 TICKETS TOTAL)
-- ------------------------------------------------------------------------------

-- 4a. 20 Online VIP Tickets: VIP-001..VIP-020 @ UGX 50,000
insert into public.tickets (ticket_number, category, price_ugx, status, payment_status, ticket_channel)
select
  'VIP-' || lpad(n::text, 3, '0'),
  'VIP',
  50000,
  'available',
  'unpaid',
  'online'
from generate_series(1, 20) as n
on conflict (ticket_number) do nothing;

-- 4b. 50 Online Ordinary Tickets: ORD-001..ORD-050 @ UGX 20,000
insert into public.tickets (ticket_number, category, price_ugx, status, payment_status, ticket_channel)
select
  'ORD-' || lpad(n::text, 3, '0'),
  'ORDINARY',
  20000,
  'available',
  'unpaid',
  'online'
from generate_series(1, 50) as n
on conflict (ticket_number) do nothing;

-- 4c. 100 Hardcopy VIP Tickets: VIP-021..VIP-120 @ UGX 50,000
insert into public.tickets (ticket_number, category, price_ugx, status, payment_status, ticket_channel)
select
  'VIP-' || lpad(n::text, 3, '0'),
  'VIP',
  50000,
  'available',
  'unpaid',
  'hardcopy'
from generate_series(21, 120) as n
on conflict (ticket_number) do nothing;

-- 4d. 200 Hardcopy Ordinary Tickets: ORD-051..ORD-250 @ UGX 20,000
insert into public.tickets (ticket_number, category, price_ugx, status, payment_status, ticket_channel)
select
  'ORD-' || lpad(n::text, 3, '0'),
  'ORDINARY',
  20000,
  'available',
  'unpaid',
  'hardcopy'
from generate_series(51, 250) as n
on conflict (ticket_number) do nothing;

-- ------------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY (RLS) & ACCESS CONTROL HARDENING
-- ------------------------------------------------------------------------------

-- Enable RLS with NO FORCE ROW LEVEL SECURITY (allows SECURITY DEFINER table owner routines to execute)
alter table public.tickets enable row level security;
alter table public.tickets no force row level security;

alter table public.orders enable row level security;
alter table public.orders no force row level security;

alter table public.hardcopy_audit_logs enable row level security;
alter table public.hardcopy_audit_logs no force row level security;

-- Revoke all table access from public, anon, and authenticated client roles
revoke all on table public.tickets from public, anon, authenticated;
revoke all on table public.orders from public, anon, authenticated;
revoke all on table public.hardcopy_audit_logs from public, anon, authenticated;

-- Grant least privilege strictly to service_role (backend proxy)
grant select, insert, update on table public.tickets to service_role;
grant select, insert, update on table public.orders to service_role;
grant select, insert on table public.hardcopy_audit_logs to service_role;

-- Revoke sequence grants from public, anon, authenticated
do $$
declare
  seq record;
begin
  for seq in (
    select sequence_name
    from information_schema.sequences
    where sequence_schema = 'public'
  ) loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated;', seq.sequence_name);
    execute format('grant all on sequence public.%I to service_role;', seq.sequence_name);
  end loop;
end $$;

-- Drop all historical permissive or draft policies
drop policy if exists "Authenticated access only" on public.tickets;
drop policy if exists "Authenticated and service role tickets access" on public.tickets;
drop policy if exists "Service role tickets management" on public.tickets;
drop policy if exists "Public ticket read" on public.tickets;
drop policy if exists "Service role only tickets access" on public.tickets;

drop policy if exists "Authenticated and service role orders access" on public.orders;
drop policy if exists "Service role orders management" on public.orders;
drop policy if exists "Service role only orders access" on public.orders;

drop policy if exists "Service role hardcopy audit management" on public.hardcopy_audit_logs;
drop policy if exists "Service role only hardcopy audit access" on public.hardcopy_audit_logs;

-- Recreate strict service-role only policies
create policy "Service role only tickets access" on public.tickets
  for all to service_role using (true) with check (true);

create policy "Service role only orders access" on public.orders
  for all to service_role using (true) with check (true);

create policy "Service role only hardcopy audit access" on public.hardcopy_audit_logs
  for all to service_role using (true) with check (true);

-- ------------------------------------------------------------------------------
-- 6. SECURITY DEFINER RPC FUNCTIONS (PINNED SEARCH_PATH, LEAST-PRIVILEGE GRANTS)
-- ------------------------------------------------------------------------------

-- 6a. release_expired_ticket_reservations
create or replace function public.release_expired_ticket_reservations()
returns integer
language plpgsql
security definer
set search_path = public, extensions
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
      ticket_channel = 'online'
      and status = 'reserved'
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

revoke all on function public.release_expired_ticket_reservations() from public, anon, authenticated;
grant execute on function public.release_expired_ticket_reservations() to service_role;

-- 6b. reserve_tickets_atomic
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
set search_path = public, extensions
as $$
declare
  v_available_count integer;
  v_reserved_ids uuid[];
  v_updated_count integer := 0;
begin
  if p_category not in ('VIP', 'ORDINARY') or p_quantity is null or p_quantity < 1 or p_quantity > 10 then
    return json_build_object(
      'success', false,
      'message', 'Invalid reservation category or quantity (must be 1–10 VIP or ORDINARY tickets).'
    );
  end if;

  perform public.release_expired_ticket_reservations();

  select array_agg(id) into v_reserved_ids
  from (
    select id
    from public.tickets
    where ticket_channel = 'online'
      and category = p_category
      and status = 'available'
    order by ticket_number asc
    limit p_quantity
    for update skip locked
  ) sub;

  if v_reserved_ids is null or coalesce(array_length(v_reserved_ids, 1), 0) < p_quantity then
    select count(*) into v_available_count
    from public.tickets
    where ticket_channel = 'online'
      and category = p_category
      and status = 'available';

    return json_build_object(
      'success', false,
      'message', format('Insufficient tickets available. Only %s %s ticket(s) remaining.', coalesce(v_available_count, 0), p_category)
    );
  end if;

  begin
    update public.tickets
    set
      status = 'reserved',
      payment_status = 'pending',
      buyer_name = p_buyer_name,
      buyer_email = p_buyer_email,
      buyer_phone = p_buyer_phone,
      order_ref = p_order_ref,
      reserved_until = p_reserved_until
    where id = any(v_reserved_ids)
      and ticket_channel = 'online'
      and status = 'available';

    get diagnostics v_updated_count = row_count;
    if v_updated_count <> p_quantity then
      raise exception 'ATOMIC_RESERVE_MISMATCH: expected %, updated %', p_quantity, v_updated_count;
    end if;

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
  exception
    when others then
      return json_build_object(
        'success', false,
        'message', 'Could not complete atomic ticket reservation. Please retry.'
      );
  end;

  return json_build_object(
    'success', true,
    'order_ref', p_order_ref,
    'reserved_ticket_ids', v_reserved_ids,
    'quantity', p_quantity,
    'reserved_until', p_reserved_until
  );
end;
$$;

revoke all on function public.reserve_tickets_atomic(
  text, integer, text, text, text, text, timestamptz, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.reserve_tickets_atomic(
  text, integer, text, text, text, text, timestamptz, text, integer, integer
) to service_role;

-- 6c. mark_order_paid_atomic
create or replace function public.mark_order_paid_atomic(
  p_order_ref text,
  p_relworx_internal_ref text default null,
  p_flw_transaction_id text default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
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
    return json_build_object('success', true, 'message', 'Order is already marked as paid');
  end if;

  update public.orders
  set
    status = 'paid',
    paid_at = coalesce(paid_at, v_now),
    relworx_internal_ref = coalesce(p_relworx_internal_ref, relworx_internal_ref),
    flw_transaction_id = coalesce(p_flw_transaction_id, flw_transaction_id)
  where order_ref = p_order_ref;

  update public.tickets
  set
    status = 'issued',
    payment_status = 'paid',
    paid_at = coalesce(paid_at, v_now),
    relworx_internal_ref = coalesce(p_relworx_internal_ref, relworx_internal_ref)
  where order_ref = p_order_ref
    and coalesce(ticket_channel, 'online') = 'online';

  get diagnostics v_ticket_count = row_count;

  return json_build_object(
    'success', true,
    'order_ref', p_order_ref,
    'tickets_issued', v_ticket_count
  );
end;
$$;

revoke all on function public.mark_order_paid_atomic(text, text, text) from public, anon, authenticated;
grant execute on function public.mark_order_paid_atomic(text, text, text) to service_role;

-- 6d. submit_mtn_payment
create or replace function public.submit_mtn_payment(
  p_order_ref text,
  p_mtn_transaction_id text,
  p_payer_phone text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cleaned_tx text;
  v_existing_order text;
  v_order_status text;
  v_reserved_until timestamptz;
begin
  v_cleaned_tx := upper(trim(coalesce(p_mtn_transaction_id, '')));

  if length(v_cleaned_tx) < 5 then
    return jsonb_build_object(
      'success', false,
      'error', 'INVALID_TRANSACTION_ID',
      'message', 'Transaction ID must be at least 5 characters.'
    );
  end if;

  select order_ref into v_existing_order
  from public.orders
  where upper(trim(coalesce(mtn_transaction_id, ''))) = v_cleaned_tx
    and order_ref <> p_order_ref
  limit 1;

  if v_existing_order is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'DUPLICATE_TRANSACTION_ID',
      'message', 'This MTN Transaction ID has already been registered for another order.'
    );
  end if;

  select status, reserved_until into v_order_status, v_reserved_until
  from public.orders
  where order_ref = p_order_ref
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'ORDER_NOT_FOUND',
      'message', 'Order reference not found.'
    );
  end if;

  if v_order_status = 'paid' then
    return jsonb_build_object(
      'success', true,
      'message', 'Order is already verified and paid.',
      'status', 'paid',
      'verification_status', 'verified'
    );
  end if;

  if v_order_status = 'expired' or (v_reserved_until is not null and now() > v_reserved_until) then
    return jsonb_build_object(
      'success', false,
      'error', 'ORDER_EXPIRED',
      'message', 'Reservation window has expired. Please create a new pass reservation.'
    );
  end if;

  update public.orders
  set
    mtn_transaction_id = v_cleaned_tx,
    payer_phone = trim(coalesce(p_payer_phone, '')),
    verification_status = 'pending_verification',
    submission_notes = p_notes
  where order_ref = p_order_ref;

  update public.tickets
  set mtn_transaction_id = v_cleaned_tx
  where order_ref = p_order_ref
    and coalesce(ticket_channel, 'online') = 'online';

  return jsonb_build_object(
    'success', true,
    'message', 'MTN transaction submitted. Awaiting admin verification.',
    'status', 'pending',
    'verification_status', 'pending_verification',
    'mtn_transaction_id', v_cleaned_tx
  );
end;
$$;

revoke all on function public.submit_mtn_payment(text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_mtn_payment(text, text, text, text) to service_role;

-- 6e. verify_mtn_payment_admin
create or replace function public.verify_mtn_payment_admin(
  p_order_ref text,
  p_admin_name text default 'Admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_now timestamptz := now();
  v_tickets_count integer := 0;
  v_tx_id text;
  v_current_status text;
begin
  select mtn_transaction_id, status into v_tx_id, v_current_status
  from public.orders
  where order_ref = p_order_ref
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Order not found.');
  end if;

  if v_current_status = 'paid' then
    return jsonb_build_object(
      'success', true,
      'message', 'Order is already verified and paid.',
      'tickets_issued', 0
    );
  end if;

  update public.orders
  set
    status = 'paid',
    verification_status = 'verified',
    paid_at = v_now,
    verified_at = v_now,
    verified_by = coalesce(nullif(trim(p_admin_name), ''), 'Admin')
  where order_ref = p_order_ref;

  update public.tickets
  set
    status = 'issued',
    payment_status = 'paid',
    paid_at = v_now,
    mtn_transaction_id = coalesce(v_tx_id, mtn_transaction_id)
  where order_ref = p_order_ref
    and coalesce(ticket_channel, 'online') = 'online';

  get diagnostics v_tickets_count = row_count;

  return jsonb_build_object(
    'success', true,
    'message', 'Payment verified successfully. Tickets issued.',
    'tickets_issued', v_tickets_count
  );
end;
$$;

revoke all on function public.verify_mtn_payment_admin(text, text) from public, anon, authenticated;
grant execute on function public.verify_mtn_payment_admin(text, text) to service_role;

-- 6f. gate_checkin_atomic
create or replace function public.gate_checkin_atomic(
  p_token_or_number text
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clean text := btrim(coalesce(p_token_or_number, ''));
  v_is_uuid boolean;
  v_is_ticket_no boolean;
  v_ticket record;
  v_now timestamptz := now();
  v_updated_count integer := 0;
  v_safe_ticket json;
begin
  if v_clean = '' then
    return json_build_object(
      'status', 'INVALID',
      'message', 'Invalid or unrecognized QR token / ticket number.'
    );
  end if;

  v_is_uuid := v_clean ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_is_ticket_no := v_clean ~* '^(VIP|ORD)-[0-9]{3,4}$';

  if not v_is_uuid and not v_is_ticket_no then
    return json_build_object(
      'status', 'INVALID',
      'message', 'Invalid or unrecognized QR token / ticket number.'
    );
  end if;

  if v_is_uuid then
    select
      id,
      ticket_number,
      category,
      price_ugx,
      status,
      payment_status,
      buyer_name,
      created_at,
      paid_at,
      checked_in_at,
      ticket_channel
    into v_ticket
    from public.tickets
    where qr_token = v_clean::uuid
    for update;
  else
    select
      id,
      ticket_number,
      category,
      price_ugx,
      status,
      payment_status,
      buyer_name,
      created_at,
      paid_at,
      checked_in_at,
      ticket_channel
    into v_ticket
    from public.tickets
    where ticket_number = upper(v_clean)
    for update;
  end if;

  if not found then
    return json_build_object(
      'status', 'INVALID',
      'message', 'Invalid or unrecognized QR token / ticket number.'
    );
  end if;

  -- Mask sensitive PII in client response
  v_safe_ticket := json_build_object(
    'id', v_ticket.id,
    'ticket_number', v_ticket.ticket_number,
    'category', v_ticket.category,
    'price_ugx', v_ticket.price_ugx,
    'status', v_ticket.status,
    'payment_status', v_ticket.payment_status,
    'buyer_name', case when v_ticket.status = 'issued' then v_ticket.buyer_name else null end,
    'buyer_email', null,
    'buyer_phone', null,
    'qr_token', '[REDACTED]',
    'created_at', v_ticket.created_at,
    'paid_at', v_ticket.paid_at,
    'checked_in_at', v_ticket.checked_in_at,
    'ticket_channel', coalesce(v_ticket.ticket_channel, 'online')
  );

  if v_ticket.status = 'cancelled' then
    return json_build_object(
      'status', 'CANCELLED',
      'message', format('Ticket %s has been cancelled or voided. Deny entry.', v_ticket.ticket_number),
      'ticket', v_safe_ticket
    );
  end if;

  if v_ticket.status != 'issued' or (v_ticket.payment_status != 'paid' and v_ticket.payment_status != 'manual_paid') then
    if coalesce(v_ticket.ticket_channel, 'online') = 'hardcopy' then
      return json_build_object(
        'status', 'UNPAID',
        'message', format('Hardcopy ticket %s has not been activated/sold yet. Deny entry.', v_ticket.ticket_number),
        'ticket', v_safe_ticket
      );
    end if;

    return json_build_object(
      'status', 'UNPAID',
      'message', format('Ticket %s is unpaid (%s). Payment required.', v_ticket.ticket_number, v_ticket.status),
      'ticket', v_safe_ticket
    );
  end if;

  if v_ticket.checked_in_at is not null then
    return json_build_object(
      'status', 'ALREADY_USED',
      'message', format('DUPLICATE: Already checked in at %s.', v_ticket.checked_in_at),
      'ticket', v_safe_ticket,
      'checkedInAt', v_ticket.checked_in_at
    );
  end if;

  update public.tickets
  set checked_in_at = v_now
  where id = v_ticket.id
    and status = 'issued'
    and payment_status in ('paid', 'manual_paid')
    and checked_in_at is null;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    return json_build_object(
      'status', 'ALREADY_USED',
      'message', 'Duplicate scan detected. This ticket was just admitted.',
      'ticket', v_safe_ticket
    );
  end if;

  return json_build_object(
    'status', 'ADMITTED',
    'message', format('ADMITTED: Welcome to Pool Party, %s! (%s Pass #%s)', coalesce(v_ticket.buyer_name, 'Guest'), v_ticket.category, v_ticket.ticket_number),
    'ticket', v_safe_ticket,
    'checkedInAt', v_now
  );
end;
$$;

revoke all on function public.gate_checkin_atomic(text) from public, anon, authenticated;
grant execute on function public.gate_checkin_atomic(text) to service_role;

-- 6g. activate_hardcopy_tickets_atomic
create or replace function public.activate_hardcopy_tickets_atomic(
  p_ticket_numbers text[],
  p_category text,
  p_action text,
  p_agent_or_seller text,
  p_performed_by text,
  p_batch_ref text,
  p_buyer_name text default null,
  p_buyer_phone text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_category text := upper(btrim(coalesce(p_category, '')));
  v_seller text := btrim(coalesce(p_agent_or_seller, ''));
  v_actor text := btrim(coalesce(p_performed_by, ''));
  v_batch_ref text := btrim(coalesce(p_batch_ref, ''));
  v_raw_count integer := coalesce(cardinality(p_ticket_numbers), 0);
  v_normalized_numbers text[];
  v_unique_count integer := 0;
  v_invalid_format text[];
  v_prefix_mismatch text[];
  v_online_numbers text[];
  v_out_of_range text[];
  v_found_count integer := 0;
  v_non_hardcopy text[];
  v_wrong_category text[];
  v_wrong_price text[];
  v_unavailable text[];
  v_unit_price integer;
  v_total_amount integer;
  v_updated_numbers text[];
  v_updated_count integer := 0;
  v_now timestamptz := now();
  v_audit_id uuid;
begin
  if v_category not in ('VIP', 'ORDINARY') then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'Invalid category. Must be VIP or ORDINARY.'
    );
  end if;

  if p_action not in ('activate_single', 'activate_range') then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'Invalid activation action. Must be activate_single or activate_range.'
    );
  end if;

  if length(v_seller) < 2 or length(v_seller) > 120 then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'sellerName (assigned agent, promoter, or seller) is required (2–120 characters).'
    );
  end if;

  if length(v_actor) < 2 or length(v_actor) > 80 then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'performedBy (authorizing admin identifier) is required (2–80 characters).'
    );
  end if;

  if length(v_batch_ref) < 4 or length(v_batch_ref) > 120 or v_batch_ref !~ '^[A-Za-z0-9_-]+$' then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'batchRef must be between 4 and 120 alphanumeric characters, hyphens, or underscores.'
    );
  end if;

  if v_raw_count < 1 or v_raw_count > 200 then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'Hardcopy ticket batch must contain between 1 and 200 tickets.'
    );
  end if;

  select array_agg(upper(btrim(num)) order by upper(btrim(num)))
  into v_normalized_numbers
  from unnest(p_ticket_numbers) as num;

  select count(distinct num) into v_unique_count
  from unnest(v_normalized_numbers) as num;

  if v_unique_count <> v_raw_count then
    return jsonb_build_object(
      'success', false,
      'error', 'DUPLICATE_TICKET_NUMBERS',
      'message', 'Duplicate ticket numbers detected in hardcopy activation batch.'
    );
  end if;

  select array_agg(code order by code)
  into v_invalid_format
  from unnest(v_normalized_numbers) as code
  where code !~ '^(VIP|ORD)-[0-9]{3,4}$';

  if v_invalid_format is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'One or more ticket numbers have invalid format. Expected ORD-051..ORD-250 or VIP-021..VIP-120.',
      'conflictingTickets', v_invalid_format
    );
  end if;

  select array_agg(code order by code)
  into v_prefix_mismatch
  from unnest(v_normalized_numbers) as code
  where (v_category = 'ORDINARY' and code !~ '^ORD-')
     or (v_category = 'VIP' and code !~ '^VIP-');

  if v_prefix_mismatch is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'CATEGORY_MISMATCH',
      'message', 'One or more ticket numbers do not match the requested pass category.',
      'conflictingTickets', v_prefix_mismatch
    );
  end if;

  select array_agg(code order by code)
  into v_online_numbers
  from unnest(v_normalized_numbers) as code
  where (v_category = 'ORDINARY' and substring(code from 5)::integer between 1 and 50)
     or (v_category = 'VIP' and substring(code from 5)::integer between 1 and 20);

  if v_online_numbers is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'ONLINE_TICKET_FORBIDDEN',
      'message', 'Online pool tickets cannot be activated through the hardcopy channel.',
      'conflictingTickets', v_online_numbers
    );
  end if;

  select array_agg(code order by code)
  into v_out_of_range
  from unnest(v_normalized_numbers) as code
  where (v_category = 'ORDINARY' and (substring(code from 5)::integer < 51 or substring(code from 5)::integer > 250))
     or (v_category = 'VIP' and (substring(code from 5)::integer < 21 or substring(code from 5)::integer > 120));

  if v_out_of_range is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'OUT_OF_HARDCOPY_RANGE',
      'message', 'Ticket number is outside the valid hardcopy pool (ORD-051..ORD-250 or VIP-021..VIP-120).',
      'conflictingTickets', v_out_of_range
    );
  end if;

  v_unit_price := case when v_category = 'VIP' then 50000 else 20000 end;

  perform 1
  from public.tickets
  where ticket_number = any(v_normalized_numbers)
  order by ticket_number asc
  for update;

  select count(*) into v_found_count
  from public.tickets
  where ticket_number = any(v_normalized_numbers);

  if v_found_count <> v_raw_count then
    return jsonb_build_object(
      'success', false,
      'error', 'TICKETS_NOT_FOUND',
      'message', format('Expected %s hardcopy ticket(s) in database, but found %s.', v_raw_count, v_found_count)
    );
  end if;

  select array_agg(ticket_number order by ticket_number) into v_non_hardcopy
  from public.tickets
  where ticket_number = any(v_normalized_numbers)
    and ticket_channel <> 'hardcopy';

  if v_non_hardcopy is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'ONLINE_TICKET_FORBIDDEN',
      'message', 'Online pool tickets cannot be activated through the hardcopy channel.',
      'conflictingTickets', v_non_hardcopy
    );
  end if;

  select array_agg(ticket_number order by ticket_number) into v_wrong_category
  from public.tickets
  where ticket_number = any(v_normalized_numbers)
    and category <> v_category;

  if v_wrong_category is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'CATEGORY_MISMATCH',
      'message', 'One or more database ticket records do not match the requested pass category.',
      'conflictingTickets', v_wrong_category
    );
  end if;

  select array_agg(ticket_number order by ticket_number) into v_wrong_price
  from public.tickets
  where ticket_number = any(v_normalized_numbers)
    and price_ugx <> v_unit_price;

  if v_wrong_price is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'DATA_INTEGRITY_ERROR',
      'message', 'One or more hardcopy tickets have an unexpected database price and cannot be activated.',
      'conflictingTickets', v_wrong_price
    );
  end if;

  select array_agg(ticket_number order by ticket_number) into v_unavailable
  from public.tickets
  where ticket_number = any(v_normalized_numbers)
    and (status <> 'available' or checked_in_at is not null);

  if v_unavailable is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'TICKETS_NOT_AVAILABLE',
      'message', 'Activation aborted: one or more hardcopy tickets are already activated, cancelled, or checked in.',
      'conflictingTickets', v_unavailable
    );
  end if;

  begin
    with updated as (
      update public.tickets
      set
        status = 'issued',
        payment_status = 'manual_paid',
        paid_at = v_now,
        activated_at = v_now,
        activated_by = v_actor,
        assigned_agent = v_seller,
        hardcopy_batch_ref = v_batch_ref,
        buyer_name = nullif(btrim(coalesce(p_buyer_name, '')), ''),
        buyer_phone = nullif(btrim(coalesce(p_buyer_phone, '')), '')
      where ticket_number = any(v_normalized_numbers)
        and ticket_channel = 'hardcopy'
        and category = v_category
        and price_ugx = v_unit_price
        and status = 'available'
        and checked_in_at is null
      returning ticket_number
    )
    select
      array_agg(ticket_number order by ticket_number),
      count(*)
    into v_updated_numbers, v_updated_count
    from updated;

    if v_updated_count <> v_raw_count or v_updated_numbers is null then
      raise exception 'ATOMIC_UPDATE_MISMATCH: expected %, updated %', v_raw_count, coalesce(v_updated_count, 0);
    end if;

    v_total_amount := v_unit_price * v_updated_count;

    insert into public.hardcopy_audit_logs (
      batch_ref,
      action,
      category,
      ticket_numbers,
      quantity,
      unit_price_ugx,
      total_amount_ugx,
      agent_or_seller,
      buyer_name,
      buyer_phone,
      performed_by,
      notes,
      created_at
    ) values (
      v_batch_ref,
      p_action,
      v_category,
      v_updated_numbers,
      v_updated_count,
      v_unit_price,
      v_total_amount,
      v_seller,
      nullif(btrim(coalesce(p_buyer_name, '')), ''),
      nullif(btrim(coalesce(p_buyer_phone, '')), ''),
      v_actor,
      nullif(btrim(coalesce(p_notes, '')), ''),
      v_now
    )
    returning id into v_audit_id;

    if v_audit_id is null then
      raise exception 'AUDIT_INSERT_FAILED: returned null id';
    end if;

  exception
    when insufficient_privilege then
      return jsonb_build_object(
        'success', false,
        'error', 'INSUFFICIENT_PRIVILEGE',
        'message', 'Database permission denied during atomic hardcopy activation. No tickets were modified.'
      );
    when check_violation then
      return jsonb_build_object(
        'success', false,
        'error', 'CHECK_VIOLATION',
        'message', 'Validation constraint failed during atomic hardcopy activation.'
      );
    when others then
      if SQLERRM like 'ATOMIC_UPDATE_MISMATCH%' then
        return jsonb_build_object(
          'success', false,
          'error', 'ATOMIC_UPDATE_MISMATCH',
          'message', 'Atomic hardcopy activation failed verification: ticket count mismatch. Rolled back with zero tickets modified.'
        );
      elsif SQLERRM like 'AUDIT_INSERT_FAILED%' then
        return jsonb_build_object(
          'success', false,
          'error', 'AUDIT_LOG_FAILED',
          'message', 'Atomic hardcopy activation failed: audit record creation failed. Rolled back with zero tickets modified.'
        );
      else
        raise warning 'Unexpected error in activate_hardcopy_tickets_atomic: % (%)', SQLERRM, SQLSTATE;
        return jsonb_build_object(
          'success', false,
          'error', 'DATABASE_ERROR',
          'message', 'Atomic hardcopy activation failed due to an unexpected database error. Rolled back with zero tickets modified.'
        );
      end if;
  end;

  return jsonb_build_object(
    'success', true,
    'auditId', v_audit_id,
    'batchRef', v_batch_ref,
    'action', p_action,
    'category', v_category,
    'activatedCount', v_updated_count,
    'ticketNumbers', v_updated_numbers,
    'unitPriceUgx', v_unit_price,
    'totalAmountUgx', v_total_amount,
    'sellerName', v_seller,
    'performedBy', v_actor,
    'activatedAt', v_now,
    'message', format('Successfully activated %s hardcopy ticket(s).', v_updated_count)
  );
end;
$$;

revoke all on function public.activate_hardcopy_tickets_atomic(
  text[], text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.activate_hardcopy_tickets_atomic(
  text[], text, text, text, text, text, text, text, text
) to service_role;

-- 6h. update_hardcopy_tickets_status_atomic
create or replace function public.update_hardcopy_tickets_status_atomic(
  p_ticket_numbers text[],
  p_category text,
  p_action text,
  p_agent_or_seller text,
  p_performed_by text,
  p_batch_ref text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_category text := upper(btrim(coalesce(p_category, '')));
  v_seller text := btrim(coalesce(p_agent_or_seller, ''));
  v_actor text := btrim(coalesce(p_performed_by, ''));
  v_batch_ref text := btrim(coalesce(p_batch_ref, ''));
  v_raw_count integer := coalesce(cardinality(p_ticket_numbers), 0);
  v_normalized_numbers text[];
  v_unique_count integer := 0;
  v_invalid_format text[];
  v_prefix_mismatch text[];
  v_online_numbers text[];
  v_out_of_range text[];
  v_found_count integer := 0;
  v_non_hardcopy text[];
  v_wrong_category text[];
  v_wrong_price text[];
  v_checked_in text[];
  v_invalid_state text[];
  v_unit_price integer;
  v_updated_numbers text[];
  v_updated_count integer := 0;
  v_now timestamptz := now();
  v_audit_id uuid;
begin
  if v_category not in ('VIP', 'ORDINARY') then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'Invalid category. Must be VIP or ORDINARY.'
    );
  end if;

  if p_action not in ('deactivate_return', 'void_cancel') then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'Invalid status action. Must be deactivate_return or void_cancel.'
    );
  end if;

  if length(v_seller) < 2 or length(v_seller) > 120 then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'sellerName is required (2–120 characters).'
    );
  end if;

  if length(v_actor) < 2 or length(v_actor) > 80 then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'performedBy (authorizing admin identifier) is required (2–80 characters).'
    );
  end if;

  if length(v_batch_ref) < 4 or length(v_batch_ref) > 120 or v_batch_ref !~ '^[A-Za-z0-9_-]+$' then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'batchRef must be between 4 and 120 alphanumeric characters, hyphens, or underscores.'
    );
  end if;

  if v_raw_count < 1 or v_raw_count > 200 then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'Ticket batch must contain between 1 and 200 tickets.'
    );
  end if;

  select array_agg(upper(btrim(num)) order by upper(btrim(num)))
  into v_normalized_numbers
  from unnest(p_ticket_numbers) as num;

  select count(distinct num) into v_unique_count
  from unnest(v_normalized_numbers) as num;

  if v_unique_count <> v_raw_count then
    return jsonb_build_object(
      'success', false,
      'error', 'DUPLICATE_TICKET_NUMBERS',
      'message', 'Duplicate ticket numbers detected in status update batch.'
    );
  end if;

  select array_agg(code order by code)
  into v_invalid_format
  from unnest(v_normalized_numbers) as code
  where code !~ '^(VIP|ORD)-[0-9]{3,4}$';

  if v_invalid_format is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'One or more ticket numbers have invalid format. Expected ORD-051..ORD-250 or VIP-021..VIP-120.',
      'conflictingTickets', v_invalid_format
    );
  end if;

  select array_agg(code order by code)
  into v_prefix_mismatch
  from unnest(v_normalized_numbers) as code
  where (v_category = 'ORDINARY' and code !~ '^ORD-')
     or (v_category = 'VIP' and code !~ '^VIP-');

  if v_prefix_mismatch is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'CATEGORY_MISMATCH',
      'message', 'One or more ticket numbers do not match the requested pass category.',
      'conflictingTickets', v_prefix_mismatch
    );
  end if;

  select array_agg(code order by code)
  into v_online_numbers
  from unnest(v_normalized_numbers) as code
  where (v_category = 'ORDINARY' and substring(code from 5)::integer between 1 and 50)
     or (v_category = 'VIP' and substring(code from 5)::integer between 1 and 20);

  if v_online_numbers is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'ONLINE_TICKET_FORBIDDEN',
      'message', 'Online pool tickets cannot be modified through hardcopy status controls.',
      'conflictingTickets', v_online_numbers
    );
  end if;

  select array_agg(code order by code)
  into v_out_of_range
  from unnest(v_normalized_numbers) as code
  where (v_category = 'ORDINARY' and (substring(code from 5)::integer < 51 or substring(code from 5)::integer > 250))
     or (v_category = 'VIP' and (substring(code from 5)::integer < 21 or substring(code from 5)::integer > 120));

  if v_out_of_range is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'OUT_OF_HARDCOPY_RANGE',
      'message', 'Ticket number is outside the valid hardcopy pool (ORD-051..ORD-250 or VIP-021..VIP-120).',
      'conflictingTickets', v_out_of_range
    );
  end if;

  v_unit_price := case when v_category = 'VIP' then 50000 else 20000 end;

  perform 1
  from public.tickets
  where ticket_number = any(v_normalized_numbers)
  order by ticket_number asc
  for update;

  select count(*) into v_found_count
  from public.tickets
  where ticket_number = any(v_normalized_numbers);

  if v_found_count <> v_raw_count then
    return jsonb_build_object(
      'success', false,
      'error', 'TICKETS_NOT_FOUND',
      'message', format('Expected %s hardcopy ticket(s) in database, but found %s.', v_raw_count, v_found_count)
    );
  end if;

  select array_agg(ticket_number order by ticket_number) into v_non_hardcopy
  from public.tickets
  where ticket_number = any(v_normalized_numbers)
    and ticket_channel <> 'hardcopy';

  if v_non_hardcopy is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'ONLINE_TICKET_FORBIDDEN',
      'message', 'Online pool tickets cannot be modified through hardcopy status controls.',
      'conflictingTickets', v_non_hardcopy
    );
  end if;

  select array_agg(ticket_number order by ticket_number) into v_wrong_category
  from public.tickets
  where ticket_number = any(v_normalized_numbers)
    and category <> v_category;

  if v_wrong_category is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'CATEGORY_MISMATCH',
      'message', 'One or more database ticket records do not match the requested pass category.',
      'conflictingTickets', v_wrong_category
    );
  end if;

  select array_agg(ticket_number order by ticket_number) into v_wrong_price
  from public.tickets
  where ticket_number = any(v_normalized_numbers)
    and price_ugx <> v_unit_price;

  if v_wrong_price is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'DATA_INTEGRITY_ERROR',
      'message', 'One or more hardcopy tickets have an unexpected database price and cannot be modified.',
      'conflictingTickets', v_wrong_price
    );
  end if;

  select array_agg(ticket_number order by ticket_number) into v_checked_in
  from public.tickets
  where ticket_number = any(v_normalized_numbers)
    and checked_in_at is not null;

  if v_checked_in is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'ALREADY_CHECKED_IN',
      'message', 'Cannot return or void hardcopy tickets that have already been checked in at the gate.',
      'conflictingTickets', v_checked_in
    );
  end if;

  if p_action = 'deactivate_return' then
    select array_agg(ticket_number order by ticket_number) into v_invalid_state
    from public.tickets
    where ticket_number = any(v_normalized_numbers)
      and status <> 'issued';

    if v_invalid_state is not null then
      return jsonb_build_object(
        'success', false,
        'error', 'TICKETS_INVALID_STATE',
        'message', 'Only currently activated (issued) hardcopy tickets can be returned to unactivated stock.',
        'conflictingTickets', v_invalid_state
      );
    end if;
  else
    select array_agg(ticket_number order by ticket_number) into v_invalid_state
    from public.tickets
    where ticket_number = any(v_normalized_numbers)
      and status = 'cancelled';

    if v_invalid_state is not null then
      return jsonb_build_object(
        'success', false,
        'error', 'TICKETS_INVALID_STATE',
        'message', 'One or more hardcopy tickets are already voided/cancelled.',
        'conflictingTickets', v_invalid_state
      );
    end if;
  end if;

  begin
    if p_action = 'deactivate_return' then
      with updated as (
        update public.tickets
        set
          status = 'available',
          payment_status = 'unpaid',
          paid_at = null,
          activated_at = null,
          activated_by = null,
          assigned_agent = null,
          hardcopy_batch_ref = null,
          buyer_name = null,
          buyer_phone = null
        where ticket_number = any(v_normalized_numbers)
          and ticket_channel = 'hardcopy'
          and category = v_category
          and price_ugx = v_unit_price
          and status = 'issued'
          and checked_in_at is null
        returning ticket_number
      )
      select
        array_agg(ticket_number order by ticket_number),
        count(*)
      into v_updated_numbers, v_updated_count
      from updated;
    else
      with updated as (
        update public.tickets
        set
          status = 'cancelled',
          payment_status = 'unpaid',
          hardcopy_batch_ref = v_batch_ref
        where ticket_number = any(v_normalized_numbers)
          and ticket_channel = 'hardcopy'
          and category = v_category
          and price_ugx = v_unit_price
          and status <> 'cancelled'
          and checked_in_at is null
        returning ticket_number
      )
      select
        array_agg(ticket_number order by ticket_number),
        count(*)
      into v_updated_numbers, v_updated_count
      from updated;
    end if;

    if v_updated_count <> v_raw_count or v_updated_numbers is null then
      raise exception 'ATOMIC_UPDATE_MISMATCH: expected %, updated %', v_raw_count, coalesce(v_updated_count, 0);
    end if;

    insert into public.hardcopy_audit_logs (
      batch_ref,
      action,
      category,
      ticket_numbers,
      quantity,
      unit_price_ugx,
      total_amount_ugx,
      agent_or_seller,
      performed_by,
      notes,
      created_at
    ) values (
      v_batch_ref,
      p_action,
      v_category,
      v_updated_numbers,
      v_updated_count,
      v_unit_price,
      0,
      v_seller,
      v_actor,
      nullif(btrim(coalesce(p_notes, '')), ''),
      v_now
    )
    returning id into v_audit_id;

    if v_audit_id is null then
      raise exception 'AUDIT_INSERT_FAILED: returned null id';
    end if;

  exception
    when insufficient_privilege then
      return jsonb_build_object(
        'success', false,
        'error', 'INSUFFICIENT_PRIVILEGE',
        'message', 'Database permission denied during atomic hardcopy status update. No tickets were modified.'
      );
    when check_violation then
      return jsonb_build_object(
        'success', false,
        'error', 'CHECK_VIOLATION',
        'message', format('Validation constraint failed during atomic hardcopy status update: %s', SQLERRM)
      );
    when others then
      if SQLERRM like 'ATOMIC_UPDATE_MISMATCH%' then
        return jsonb_build_object(
          'success', false,
          'error', 'ATOMIC_UPDATE_MISMATCH',
          'message', 'Atomic hardcopy status update failed verification: ticket count mismatch. Rolled back with zero tickets modified.'
        );
      elsif SQLERRM like 'AUDIT_INSERT_FAILED%' then
        return jsonb_build_object(
          'success', false,
          'error', 'AUDIT_LOG_FAILED',
          'message', 'Atomic hardcopy status update failed: audit record creation failed. Rolled back with zero tickets modified.'
        );
      else
        raise warning 'Unexpected error in update_hardcopy_tickets_status_atomic: % (%)', SQLERRM, SQLSTATE;
        return jsonb_build_object(
          'success', false,
          'error', 'DATABASE_ERROR',
          'message', 'Atomic hardcopy status update failed due to an unexpected database error. Rolled back with zero tickets modified.'
        );
      end if;
  end;

  return jsonb_build_object(
    'success', true,
    'auditId', v_audit_id,
    'batchRef', v_batch_ref,
    'action', p_action,
    'category', v_category,
    'updatedCount', v_updated_count,
    'ticketNumbers', v_updated_numbers,
    'updatedAt', v_now,
    'message', case
      when p_action = 'deactivate_return' then format('Returned %s hardcopy ticket(s) to unactivated stock.', v_updated_count)
      else format('Permanently voided %s hardcopy ticket(s).', v_updated_count)
    end
  );
end;
$$;

revoke all on function public.update_hardcopy_tickets_status_atomic(
  text[], text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.update_hardcopy_tickets_status_atomic(
  text[], text, text, text, text, text, text
) to service_role;

-- ------------------------------------------------------------------------------
-- 7. POST-EXECUTION VERIFICATION ASSERTION (VALIDATES ALL 370 TICKETS)
-- ------------------------------------------------------------------------------
do $$
declare
  v_online_vip integer;
  v_online_ord integer;
  v_hardcopy_vip integer;
  v_hardcopy_ord integer;
  v_null_qr integer;
begin
  select count(*) into v_online_vip from public.tickets where coalesce(ticket_channel, 'online') = 'online' and category = 'VIP';
  select count(*) into v_online_ord from public.tickets where coalesce(ticket_channel, 'online') = 'online' and category = 'ORDINARY';
  select count(*) into v_hardcopy_vip from public.tickets where ticket_channel = 'hardcopy' and category = 'VIP';
  select count(*) into v_hardcopy_ord from public.tickets where ticket_channel = 'hardcopy' and category = 'ORDINARY';
  select count(*) into v_null_qr from public.tickets where qr_token is null;

  if (v_online_vip <> 20 or v_online_ord <> 50) then
    raise exception 'Post-setup assertion failed: expected 20 online VIP and 50 online ORD. Found: % VIP, % ORD.', v_online_vip, v_online_ord;
  end if;

  if (v_hardcopy_vip <> 100 or v_hardcopy_ord <> 200) then
    raise exception 'Post-setup assertion failed: expected 100 hardcopy VIP and 200 hardcopy ORD. Found: % VIP, % ORD.', v_hardcopy_vip, v_hardcopy_ord;
  end if;

  if (v_null_qr > 0) then
    raise exception 'Post-setup assertion failed: found % tickets with null qr_token.', v_null_qr;
  end if;
end $$;

-- ------------------------------------------------------------------------------
-- 8. RELOAD POSTGREST SCHEMA CACHE
-- ------------------------------------------------------------------------------
notify pgrst, 'reload schema';
