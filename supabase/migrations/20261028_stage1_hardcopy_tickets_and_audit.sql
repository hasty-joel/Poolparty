-- ==============================================================================
-- POOL PARTY — STAGE 1 (HARDENED): 300 HARDCOPY TICKETS, CHANNEL ISOLATION,
-- LEAST-PRIVILEGE RPC SECURITY & IMMUTABLE AUDIT LOGS
-- Non-destructive, idempotent migration for existing Supabase project.
--
-- Verified against existing migrations:
--   • 20261026_init_ticketing.sql
--   • 20261026_flutterwave_orders.sql
--   • 20261026_relworx_orders.sql
--   • 20261026_supabase_ticketing_production.sql
--   • 20261027_mtn_merchant_payments.sql
--   • 20261027_safe_non_destructive_schema_sync.sql
--
-- Security & Integrity Guarantees:
--   1. Preserves all 70 existing online tickets (VIP-001..VIP-020, ORD-001..ORD-050),
--      their UUIDs, QR tokens, statuses, and buyer records.
--   2. Detects any pre-existing conflicting rows in ORD-051..ORD-250 or
--      VIP-021..VIP-120 with wrong channel, category, or price and aborts
--      instead of silently treating corrupted rows as valid hardcopy tickets.
--   3. Restricts public.hardcopy_audit_logs strictly to service_role (revokes
--      PUBLIC, anon, and authenticated; append-only SELECT/INSERT grants).
--   4. Revokes PUBLIC/anon/authenticated EXECUTE on SECURITY DEFINER RPCs and
--      grants EXECUTE exclusively to service_role with fixed search_path.
--   5. Never exposes buyer_email, buyer_phone, qr_token, order_ref, or payment
--      references in gate_checkin_atomic responses.
--   6. Preserves exact parameter names, defaults, and return types of existing
--      RPCs (release_expired_ticket_reservations, reserve_tickets_atomic,
--      gate_checkin_atomic).
--   7. Rejects duplicate ticket numbers, validates category/price/seller/actor/
--      batch_ref consistently in both hardcopy RPCs, logs the exact updated
--      ticket_numbers from RETURNING, and rolls back atomically on count mismatch.
-- ==============================================================================

-- 1. Ensure pgcrypto is enabled for gen_random_uuid()
create extension if not exists pgcrypto;

-- 2. Ensure reservation & hardcopy tracking columns exist non-destructively
-- Existing 70 tickets automatically receive ticket_channel = 'online'.
alter table public.tickets
  add column if not exists order_ref text,
  add column if not exists reserved_until timestamptz,
  add column if not exists relworx_internal_ref text,
  add column if not exists ticket_channel text not null default 'online',
  add column if not exists assigned_agent text,
  add column if not exists activated_by text,
  add column if not exists activated_at timestamptz,
  add column if not exists hardcopy_batch_ref text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tickets_ticket_channel_check'
  ) then
    alter table public.tickets
      add constraint tickets_ticket_channel_check
      check (ticket_channel in ('online', 'hardcopy'));
  end if;
end $$;

create index if not exists idx_tickets_channel_category_status
  on public.tickets (ticket_channel, category, status);

create index if not exists idx_tickets_hardcopy_batch_ref
  on public.tickets (hardcopy_batch_ref)
  where hardcopy_batch_ref is not null;

-- 3. Pre-Seed Conflict Check, Idempotent 300-Ticket Seed & Post-Seed Verification
-- Detects any pre-existing ticket numbers with wrong channel, category, or price
-- rather than silently ignoring them via ON CONFLICT DO NOTHING.
do $$
declare
  v_online_conflicts text[];
  v_pre_hardcopy_conflicts text[];
  v_post_hardcopy_conflicts text[];
  v_ord_count integer;
  v_vip_count integer;
begin
  -- 3a. Verify existing online pool (VIP-001..VIP-020, ORD-001..ORD-050) has not been mis-tagged as hardcopy
  select array_agg(t.ticket_number order by t.ticket_number)
  into v_online_conflicts
  from public.tickets t
  where (
      t.ticket_number in (select 'ORD-' || lpad(n::text, 3, '0') from generate_series(1, 50) as n)
      or t.ticket_number in (select 'VIP-' || lpad(n::text, 3, '0') from generate_series(1, 20) as n)
    )
    and t.ticket_channel <> 'online';

  if v_online_conflicts is not null then
    raise exception
      'Hardcopy migration aborted: online pool ticket(s) % have non-online ticket_channel.',
      array_to_string(v_online_conflicts, ', ');
  end if;

  -- 3b. Detect any pre-existing rows in ORD-051..ORD-250 or VIP-021..VIP-120 with wrong channel, category, or price
  with expected_hardcopy as (
    select
      'ORD-' || lpad(n::text, 3, '0') as ticket_number,
      'ORDINARY'::text as expected_category,
      20000::integer as expected_price_ugx
    from generate_series(51, 250) as n
    union all
    select
      'VIP-' || lpad(n::text, 3, '0') as ticket_number,
      'VIP'::text as expected_category,
      50000::integer as expected_price_ugx
    from generate_series(21, 120) as n
  )
  select array_agg(
    format(
      '%s (channel=%s, category=%s, price_ugx=%s)',
      t.ticket_number,
      coalesce(t.ticket_channel, 'null'),
      coalesce(t.category, 'null'),
      coalesce(t.price_ugx::text, 'null')
    )
    order by t.ticket_number
  )
  into v_pre_hardcopy_conflicts
  from expected_hardcopy e
  join public.tickets t
    on t.ticket_number = e.ticket_number
  where t.ticket_channel <> 'hardcopy'
     or t.category <> e.expected_category
     or t.price_ugx <> e.expected_price_ugx;

  if v_pre_hardcopy_conflicts is not null then
    raise exception
      'Hardcopy migration aborted: conflicting existing ticket number(s) detected before seeding: %',
      array_to_string(v_pre_hardcopy_conflicts, '; ');
  end if;

  -- 3c. Idempotently seed 200 Ordinary hardcopy tickets: ORD-051..ORD-250 @ UGX 20,000
  insert into public.tickets (
    id,
    ticket_number,
    category,
    price_ugx,
    status,
    payment_status,
    qr_token,
    ticket_channel
  )
  select
    gen_random_uuid(),
    'ORD-' || lpad(n::text, 3, '0'),
    'ORDINARY',
    20000,
    'available',
    'unpaid',
    gen_random_uuid(),
    'hardcopy'
  from generate_series(51, 250) as n
  on conflict (ticket_number) do nothing;

  -- 3d. Idempotently seed 100 VIP hardcopy tickets: VIP-021..VIP-120 @ UGX 50,000
  insert into public.tickets (
    id,
    ticket_number,
    category,
    price_ugx,
    status,
    payment_status,
    qr_token,
    ticket_channel
  )
  select
    gen_random_uuid(),
    'VIP-' || lpad(n::text, 3, '0'),
    'VIP',
    50000,
    'available',
    'unpaid',
    gen_random_uuid(),
    'hardcopy'
  from generate_series(21, 120) as n
  on conflict (ticket_number) do nothing;

  -- 3e. Post-seed verification: confirm all 300 expected rows exist with exact channel, category, and price
  with expected_hardcopy as (
    select
      'ORD-' || lpad(n::text, 3, '0') as ticket_number,
      'ORDINARY'::text as expected_category,
      20000::integer as expected_price_ugx
    from generate_series(51, 250) as n
    union all
    select
      'VIP-' || lpad(n::text, 3, '0') as ticket_number,
      'VIP'::text as expected_category,
      50000::integer as expected_price_ugx
    from generate_series(21, 120) as n
  )
  select array_agg(e.ticket_number order by e.ticket_number)
  into v_post_hardcopy_conflicts
  from expected_hardcopy e
  left join public.tickets t
    on t.ticket_number = e.ticket_number
  where t.id is null
     or t.ticket_channel <> 'hardcopy'
     or t.category <> e.expected_category
     or t.price_ugx <> e.expected_price_ugx
     or t.qr_token is null;

  if v_post_hardcopy_conflicts is not null then
    raise exception
      'Hardcopy migration post-seed verification failed for ticket(s): %',
      array_to_string(v_post_hardcopy_conflicts, ', ');
  end if;

  select count(*) into v_ord_count
  from public.tickets
  where ticket_channel = 'hardcopy'
    and category = 'ORDINARY'
    and price_ugx = 20000;

  select count(*) into v_vip_count
  from public.tickets
  where ticket_channel = 'hardcopy'
    and category = 'VIP'
    and price_ugx = 50000;

  if v_ord_count <> 200 or v_vip_count <> 100 then
    raise exception
      'Hardcopy migration count mismatch: expected 200 ORDINARY and 100 VIP hardcopy tickets, found % ORDINARY and % VIP.',
      v_ord_count,
      v_vip_count;
  end if;
end $$;

-- 4. Dedicated Audit Table for Hardcopy Sales, Range Activations, Returns & Voids
-- Restricted strictly to server service_role (no PUBLIC, anon, or authenticated access).
create table if not exists public.hardcopy_audit_logs (
  id uuid primary key default gen_random_uuid(),
  batch_ref text not null
    check (length(btrim(batch_ref)) between 4 and 120),
  action text not null
    check (action in ('activate_single', 'activate_range', 'deactivate_return', 'void_cancel')),
  category text not null
    check (category in ('VIP', 'ORDINARY')),
  ticket_numbers text[] not null
    check (cardinality(ticket_numbers) between 1 and 200),
  quantity integer not null
    check (quantity between 1 and 200 and quantity = cardinality(ticket_numbers)),
  unit_price_ugx integer not null
    check (
      (category = 'VIP' and unit_price_ugx = 50000)
      or (category = 'ORDINARY' and unit_price_ugx = 20000)
    ),
  total_amount_ugx integer not null
    check (
      (action in ('activate_single', 'activate_range') and total_amount_ugx = unit_price_ugx * quantity)
      or (action in ('deactivate_return', 'void_cancel') and total_amount_ugx = 0)
    ),
  agent_or_seller text not null
    check (length(btrim(agent_or_seller)) between 2 and 120),
  buyer_name text,
  buyer_phone text,
  performed_by text not null
    check (length(btrim(performed_by)) between 2 and 80),
  notes text,
  created_at timestamptz not null default now()
);

-- Ensure strict integrity constraints exist even if table was created by an earlier draft
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hardcopy_audit_logs_qty_cardinality_check'
  ) then
    alter table public.hardcopy_audit_logs
      add constraint hardcopy_audit_logs_qty_cardinality_check
      check (quantity = cardinality(ticket_numbers) and quantity between 1 and 200);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'hardcopy_audit_logs_required_fields_check'
  ) then
    alter table public.hardcopy_audit_logs
      add constraint hardcopy_audit_logs_required_fields_check
      check (
        length(btrim(batch_ref)) between 4 and 120
        and length(btrim(agent_or_seller)) between 2 and 120
        and length(btrim(performed_by)) between 2 and 80
      );
  end if;
end $$;

create index if not exists idx_hardcopy_audit_logs_created_at
  on public.hardcopy_audit_logs (created_at desc);

create index if not exists idx_hardcopy_audit_logs_batch_ref
  on public.hardcopy_audit_logs (batch_ref);

-- Enforce strict server-only access on hardcopy_audit_logs
alter table public.hardcopy_audit_logs enable row level security;
alter table public.hardcopy_audit_logs force row level security;

revoke all on table public.hardcopy_audit_logs from public, anon, authenticated;
grant select, insert on table public.hardcopy_audit_logs to service_role;

drop policy if exists "Service role hardcopy audit management" on public.hardcopy_audit_logs;
drop policy if exists "Service role only hardcopy audit access" on public.hardcopy_audit_logs;

create policy "Service role only hardcopy audit access" on public.hardcopy_audit_logs
  for all
  to service_role
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- 5. Update Expired Online Reservation Cleanup to Exclude Hardcopy Pool
-- Preserves exact signature: public.release_expired_ticket_reservations() -> integer
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

  if to_regclass('public.orders') is not null then
    update public.orders
    set status = 'expired'
    where
      status = 'pending'
      and reserved_until is not null
      and reserved_until < now();
  end if;

  return released_count;
end;
$$;

revoke all on function public.release_expired_ticket_reservations() from public, anon, authenticated;
grant execute on function public.release_expired_ticket_reservations() to service_role;

-- 6. Update Online Atomic Reservation RPC to Strictly Exclude Hardcopy Tickets
-- Preserves exact 10-argument signature, defaults, and json return format from
-- 20261026_supabase_ticketing_production.sql & 20261027_safe_non_destructive_schema_sync.sql.
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
    when SQLSTATE '42P01' then
      -- Re-raise missing relation (e.g. if public.orders not created) so server fallback handles it identically
      raise;
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

-- 7. Atomic Gate Check-In RPC (PII-Redacted, Row-Locked, Online + Activated Hardcopy)
-- Preserves exact signature: public.gate_checkin_atomic(p_token_or_number text) -> json
-- NEVER returns buyer_email, buyer_phone, qr_token, order_ref, or payment references.
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

  -- Build minimal non-PII ticket payload (never exposes email, phone, qr_token, order_ref, or payment refs)
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

  v_safe_ticket := json_build_object(
    'id', v_ticket.id,
    'ticket_number', v_ticket.ticket_number,
    'category', v_ticket.category,
    'price_ugx', v_ticket.price_ugx,
    'status', v_ticket.status,
    'payment_status', v_ticket.payment_status,
    'buyer_name', v_ticket.buyer_name,
    'buyer_email', null,
    'buyer_phone', null,
    'qr_token', '[REDACTED]',
    'created_at', v_ticket.created_at,
    'paid_at', v_ticket.paid_at,
    'checked_in_at', v_now,
    'ticket_channel', coalesce(v_ticket.ticket_channel, 'online')
  );

  return json_build_object(
    'status', 'ADMITTED',
    'message', format(
      'ADMITTED: Welcome to Pool Party, %s! (%s Pass #%s)',
      coalesce(nullif(btrim(coalesce(v_ticket.buyer_name, '')), ''), 'Guest'),
      v_ticket.category,
      v_ticket.ticket_number
    ),
    'ticket', v_safe_ticket,
    'checkedInAt', v_now
  );
end;
$$;

revoke all on function public.gate_checkin_atomic(text) from public, anon, authenticated;
grant execute on function public.gate_checkin_atomic(text) to service_role;

-- 8. Atomic Hardcopy Activation RPC (Single or Range + Verified Audit Log)
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
  -- 1. Validate category, action, and mandatory seller / actor / batch_ref fields
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
      'message', 'A valid alphanumeric batch reference (4–120 characters) is required.'
    );
  end if;

  -- 2. Validate array cardinality, non-empty elements, duplicates, and action-count consistency
  if p_ticket_numbers is null or array_ndims(p_ticket_numbers) <> 1 or v_raw_count < 1 or v_raw_count > 200 then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'Ticket selection must be a 1-D list of 1 to 200 hardcopy tickets.'
    );
  end if;

  if exists (
    select 1
    from unnest(p_ticket_numbers) as raw_code
    where raw_code is null or btrim(raw_code) = ''
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'Ticket list cannot contain null or blank ticket numbers.'
    );
  end if;

  select count(distinct upper(btrim(raw_code)))
  into v_unique_count
  from unnest(p_ticket_numbers) as raw_code;

  if v_unique_count <> v_raw_count then
    return jsonb_build_object(
      'success', false,
      'error', 'DUPLICATE_TICKET_NUMBERS',
      'message', 'Duplicate ticket numbers are not permitted in a batch.'
    );
  end if;

  if p_action = 'activate_single' and v_raw_count <> 1 then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'activate_single requires exactly 1 ticket number.'
    );
  end if;

  if p_action = 'activate_range' and v_raw_count < 2 then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'activate_range requires at least 2 ticket numbers.'
    );
  end if;

  select array_agg(upper(btrim(raw_code)) order by upper(btrim(raw_code)))
  into v_normalized_numbers
  from unnest(p_ticket_numbers) as raw_code;

  -- 3. Validate canonical ticket code format, category prefix, and hardcopy vs online range bounds
  select array_agg(code order by code)
  into v_invalid_format
  from unnest(v_normalized_numbers) as code
  where code !~ '^(VIP|ORD)-[0-9]{3}$';

  if v_invalid_format is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'Invalid ticket number format. Expected canonical ORD-051..ORD-250 or VIP-021..VIP-120.',
      'conflictingTickets', v_invalid_format
    );
  end if;

  select array_agg(code order by code)
  into v_prefix_mismatch
  from unnest(v_normalized_numbers) as code
  where (v_category = 'VIP' and code not like 'VIP-%')
     or (v_category = 'ORDINARY' and code not like 'ORD-%');

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

  -- 4. Lock all target rows in deterministic ascending order to prevent deadlocks
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
      'message', format(
        'Expected %s hardcopy ticket(s) in database, but found %s. Ensure the 300-hardcopy migration has been applied.',
        v_raw_count,
        v_found_count
      )
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

  -- 5. Atomic update + RETURNING verification + audit log insert inside subtransaction
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
      raise exception 'AUDIT_INSERT_FAILED';
    end if;
  exception
    when others then
      -- Subtransaction rolls back both ticket updates and audit writes automatically
      return jsonb_build_object(
        'success', false,
        'error', 'ATOMIC_UPDATE_MISMATCH',
        'message', 'Atomic hardcopy activation failed verification and was rolled back with zero tickets modified.'
      );
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
    'message', format('Successfully activated %s %s hardcopy ticket(s).', v_updated_count, v_category)
  );
end;
$$;

revoke all on function public.activate_hardcopy_tickets_atomic(
  text[], text, text, text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.activate_hardcopy_tickets_atomic(
  text[], text, text, text, text, text, text, text, text
) to service_role;

-- 9. Atomic Hardcopy Deactivation / Void RPC (Preserves Printed QR Tokens)
create or replace function public.update_hardcopy_tickets_status_atomic(
  p_ticket_numbers text[],
  p_category text,
  p_action text, -- 'deactivate_return' or 'void_cancel'
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
  -- 1. Validate category, action, and mandatory seller / actor / batch_ref fields consistently
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
      'message', 'sellerName (agent/seller reference) is required (2–120 characters).'
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
      'message', 'A valid alphanumeric batch reference (4–120 characters) is required.'
    );
  end if;

  -- 2. Validate array cardinality, non-empty elements, and reject duplicates
  if p_ticket_numbers is null or array_ndims(p_ticket_numbers) <> 1 or v_raw_count < 1 or v_raw_count > 200 then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'Ticket selection must be a 1-D list of 1 to 200 hardcopy tickets.'
    );
  end if;

  if exists (
    select 1
    from unnest(p_ticket_numbers) as raw_code
    where raw_code is null or btrim(raw_code) = ''
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'Ticket list cannot contain null or blank ticket numbers.'
    );
  end if;

  select count(distinct upper(btrim(raw_code)))
  into v_unique_count
  from unnest(p_ticket_numbers) as raw_code;

  if v_unique_count <> v_raw_count then
    return jsonb_build_object(
      'success', false,
      'error', 'DUPLICATE_TICKET_NUMBERS',
      'message', 'Duplicate ticket numbers are not permitted in a batch.'
    );
  end if;

  select array_agg(upper(btrim(raw_code)) order by upper(btrim(raw_code)))
  into v_normalized_numbers
  from unnest(p_ticket_numbers) as raw_code;

  -- 3. Validate canonical ticket code format, category prefix, and hardcopy vs online range bounds
  select array_agg(code order by code)
  into v_invalid_format
  from unnest(v_normalized_numbers) as code
  where code !~ '^(VIP|ORD)-[0-9]{3}$';

  if v_invalid_format is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'VALIDATION_ERROR',
      'message', 'Invalid ticket number format. Expected canonical ORD-051..ORD-250 or VIP-021..VIP-120.',
      'conflictingTickets', v_invalid_format
    );
  end if;

  select array_agg(code order by code)
  into v_prefix_mismatch
  from unnest(v_normalized_numbers) as code
  where (v_category = 'VIP' and code not like 'VIP-%')
     or (v_category = 'ORDINARY' and code not like 'ORD-%');

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

  -- 4. Lock target rows in deterministic ascending order
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
      'message', format(
        'Expected %s hardcopy ticket(s) in database, but found %s.',
        v_raw_count,
        v_found_count
      )
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

  -- Ensure every ticket in the batch actually changes state so audit logs never record no-op updates
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

  -- 5. Atomic update + RETURNING verification + audit log insert inside subtransaction
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
      raise exception 'AUDIT_INSERT_FAILED';
    end if;
  exception
    when others then
      return jsonb_build_object(
        'success', false,
        'error', 'ATOMIC_UPDATE_MISMATCH',
        'message', 'Atomic hardcopy status update failed verification and was rolled back with zero tickets modified.'
      );
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

-- 10. Reload PostgREST schema cache
notify pgrst, 'reload schema';
