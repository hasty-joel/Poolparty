-- ==============================================================================
-- POOL PARTY — PHASE 2: DATABASE SECURITY HARDENING (REVISED)
-- Non-destructive, forward-only, idempotent migration for Supabase.
-- Applied after: 20261028_stage1_hardcopy_tickets_and_audit.sql
--
-- Security Objectives & Governance:
--   1. Inventory Integrity Verification:
--      - Validates the exact identities, channels, categories, prices, and non-null
--        QR tokens for all 70 online tickets (VIP-001..VIP-020, ORD-001..ORD-050)
--        and all 300 hardcopy tickets (VIP-021..VIP-120, ORD-051..ORD-250).
--      - Aborts before modifying any permissions if any ticket is missing or corrupted.
--      - Re-verifies all 370 tickets post-migration.
--      - Never deletes, recreates, or regenerates tickets or QR tokens.
--
--   2. Strict Policy & Grant Enumeration (Zero Unreviewed Access Paths):
--      - Queries pg_policies for public.tickets, public.orders, and public.hardcopy_audit_logs.
--      - Whitelists only known, reviewed historical policy names.
--      - Aborts immediately with descriptive exception if ANY unexpected policy exists.
--      - Revokes ALL table and sequence grants from PUBLIC, anon, and authenticated.
--      - Grants least-privilege operations (SELECT, INSERT, UPDATE) exclusively to service_role.
--
--   3. Architectural RLS Justification (FORCE vs. NO FORCE):
--      - ENABLE ROW LEVEL SECURITY remains active on public.tickets, public.orders,
--        and public.hardcopy_audit_logs. Under standard PostgreSQL RLS, non-owner
--        roles (anon, authenticated, PUBLIC) are 100% evaluated and denied access.
--      - NO FORCE ROW LEVEL SECURITY is applied so that SECURITY DEFINER routines
--        running under the database table owner (postgres/supabase_admin) are not
--        blocked by owner-level RLS recursion or missing owner-specific policies.
--      - This preserves the single PostgreSQL transaction contract: ticket mutations
--        and immutable audit log inserts succeed or roll back atomically together.
--
--   4. Legacy RPC Hardening:
--      - Pins `search_path = public, extensions` on mark_order_paid_atomic,
--        submit_mtn_payment, and verify_mtn_payment_admin to prevent search path hijacking.
--      - Revokes EXECUTE from PUBLIC, anon, and authenticated.
--      - Grants EXECUTE exclusively to service_role (invoked only by verified backend).
--      - Enforces channel isolation: payment verification routines strictly update
--        online tickets (ticket_channel = 'online') and never affect hardcopy stock.
--
--   5. Sanitized, Precise Exception Handling:
--      - activate_hardcopy_tickets_atomic and update_hardcopy_tickets_status_atomic
--        classify specific exceptions (insufficient_privilege, check_violation,
--        AUDIT_INSERT_FAILED, ATOMIC_UPDATE_MISMATCH) and roll back atomically.
--      - Generic errors emit a server warning without leaking sensitive SQL internals,
--        table definitions, or stack traces to callers.
-- ==============================================================================

-- 1. Ensure required cryptographic extensions
create extension if not exists pgcrypto;

-- 2. Pre-Migration Safety Assertion: Validate exact 370-ticket inventory
do $$
declare
  v_online_vip_count integer;
  v_online_ord_count integer;
  v_hardcopy_vip_count integer;
  v_hardcopy_ord_count integer;
  v_missing_or_corrupted text[];
begin
  -- 2a. Validate exact 20 online VIP passes (VIP-001..VIP-020 @ UGX 50,000)
  with expected_online_vip as (
    select 'VIP-' || lpad(n::text, 3, '0') as ticket_number
    from generate_series(1, 20) as n
  )
  select array_agg(e.ticket_number order by e.ticket_number)
  into v_missing_or_corrupted
  from expected_online_vip e
  left join public.tickets t on t.ticket_number = e.ticket_number
  where t.id is null
     or coalesce(t.ticket_channel, 'online') <> 'online'
     or t.category <> 'VIP'
     or t.price_ugx <> 50000
     or t.qr_token is null;

  if v_missing_or_corrupted is not null then
    raise exception
      'Phase 2 pre-check aborted: online VIP ticket pool compromised for ticket(s): %',
      array_to_string(v_missing_or_corrupted, ', ');
  end if;

  -- 2b. Validate exact 50 online Ordinary passes (ORD-001..ORD-050 @ UGX 20,000)
  with expected_online_ord as (
    select 'ORD-' || lpad(n::text, 3, '0') as ticket_number
    from generate_series(1, 50) as n
  )
  select array_agg(e.ticket_number order by e.ticket_number)
  into v_missing_or_corrupted
  from expected_online_ord e
  left join public.tickets t on t.ticket_number = e.ticket_number
  where t.id is null
     or coalesce(t.ticket_channel, 'online') <> 'online'
     or t.category <> 'ORDINARY'
     or t.price_ugx <> 20000
     or t.qr_token is null;

  if v_missing_or_corrupted is not null then
    raise exception
      'Phase 2 pre-check aborted: online Ordinary ticket pool compromised for ticket(s): %',
      array_to_string(v_missing_or_corrupted, ', ');
  end if;

  -- 2c. Validate exact 100 hardcopy VIP passes (VIP-021..VIP-120 @ UGX 50,000)
  with expected_hardcopy_vip as (
    select 'VIP-' || lpad(n::text, 3, '0') as ticket_number
    from generate_series(21, 120) as n
  )
  select array_agg(e.ticket_number order by e.ticket_number)
  into v_missing_or_corrupted
  from expected_hardcopy_vip e
  left join public.tickets t on t.ticket_number = e.ticket_number
  where t.id is null
     or t.ticket_channel <> 'hardcopy'
     or t.category <> 'VIP'
     or t.price_ugx <> 50000
     or t.qr_token is null;

  if v_missing_or_corrupted is not null then
    raise exception
      'Phase 2 pre-check aborted: hardcopy VIP ticket pool compromised for ticket(s): %',
      array_to_string(v_missing_or_corrupted, ', ');
  end if;

  -- 2d. Validate exact 200 hardcopy Ordinary passes (ORD-051..ORD-250 @ UGX 20,000)
  with expected_hardcopy_ord as (
    select 'ORD-' || lpad(n::text, 3, '0') as ticket_number
    from generate_series(51, 250) as n
  )
  select array_agg(e.ticket_number order by e.ticket_number)
  into v_missing_or_corrupted
  from expected_hardcopy_ord e
  left join public.tickets t on t.ticket_number = e.ticket_number
  where t.id is null
     or t.ticket_channel <> 'hardcopy'
     or t.category <> 'ORDINARY'
     or t.price_ugx <> 20000
     or t.qr_token is null;

  if v_missing_or_corrupted is not null then
    raise exception
      'Phase 2 pre-check aborted: hardcopy Ordinary ticket pool compromised for ticket(s): %',
      array_to_string(v_missing_or_corrupted, ', ');
  end if;

  -- 2e. Summary count checks
  select count(*) into v_online_vip_count from public.tickets where coalesce(ticket_channel, 'online') = 'online' and category = 'VIP';
  select count(*) into v_online_ord_count from public.tickets where coalesce(ticket_channel, 'online') = 'online' and category = 'ORDINARY';
  select count(*) into v_hardcopy_vip_count from public.tickets where ticket_channel = 'hardcopy' and category = 'VIP';
  select count(*) into v_hardcopy_ord_count from public.tickets where ticket_channel = 'hardcopy' and category = 'ORDINARY';

  if (v_online_vip_count <> 20 or v_online_ord_count <> 50 or v_hardcopy_vip_count <> 100 or v_hardcopy_ord_count <> 200) then
    raise exception
      'Phase 2 pre-check aborted: expected 20 online VIP, 50 online ORD, 100 hardcopy VIP, 200 hardcopy ORD. Found: % / % / % / %.',
      v_online_vip_count, v_online_ord_count, v_hardcopy_vip_count, v_hardcopy_ord_count;
  end if;
end $$;

-- 3. Policy & Grant Enumeration: Detect and Abort on Unexpected Policies
do $$
declare
  r record;
  v_unexpected_policies text[];
  v_known_policies text[] := array[
    'Authenticated access only',
    'Authenticated and service role tickets access',
    'Service role tickets management',
    'Public ticket read',
    'Service role only tickets access',
    'Authenticated and service role orders access',
    'Service role orders management',
    'Service role only orders access',
    'Service role hardcopy audit management',
    'Service role only hardcopy audit access'
  ];
begin
  select array_agg(format('%s.%s', tablename, policyname) order by tablename, policyname)
  into v_unexpected_policies
  from pg_policies
  where schemaname = 'public'
    and tablename in ('tickets', 'orders', 'hardcopy_audit_logs')
    and policyname <> all(v_known_policies);

  if v_unexpected_policies is not null then
    raise exception
      'Phase 2 migration aborted: unreviewed unexpected policy/policies detected: %. Manual security audit required.',
      array_to_string(v_unexpected_policies, ', ');
  end if;
end $$;

-- 4. Table Access & Sequence Grants Hardening: public.tickets
alter table public.tickets enable row level security;
alter table public.tickets no force row level security;

revoke all on table public.tickets from public, anon, authenticated;
grant select, insert, update on table public.tickets to service_role;

-- Revoke all sequence grants associated with tickets table if any exist
do $$
declare
  seq record;
begin
  for seq in (
    select sequence_name
    from information_schema.sequences
    where sequence_schema = 'public'
      and sequence_name like '%ticket%'
  ) loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated;', seq.sequence_name);
    execute format('grant all on sequence public.%I to service_role;', seq.sequence_name);
  end loop;
end $$;

drop policy if exists "Authenticated access only" on public.tickets;
drop policy if exists "Authenticated and service role tickets access" on public.tickets;
drop policy if exists "Service role tickets management" on public.tickets;
drop policy if exists "Public ticket read" on public.tickets;
drop policy if exists "Service role only tickets access" on public.tickets;

create policy "Service role only tickets access" on public.tickets
  for all
  to service_role
  using (true)
  with check (true);

-- 5. Table Access & Sequence Grants Hardening: public.orders
alter table public.orders enable row level security;
alter table public.orders no force row level security;

revoke all on table public.orders from public, anon, authenticated;
grant select, insert, update on table public.orders to service_role;

do $$
declare
  seq record;
begin
  for seq in (
    select sequence_name
    from information_schema.sequences
    where sequence_schema = 'public'
      and sequence_name like '%order%'
  ) loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated;', seq.sequence_name);
    execute format('grant all on sequence public.%I to service_role;', seq.sequence_name);
  end loop;
end $$;

drop policy if exists "Authenticated and service role orders access" on public.orders;
drop policy if exists "Service role orders management" on public.orders;
drop policy if exists "Service role only orders access" on public.orders;

create policy "Service role only orders access" on public.orders
  for all
  to service_role
  using (true)
  with check (true);

-- 6. Audit Table RLS Coordination: public.hardcopy_audit_logs
-- NO FORCE ROW LEVEL SECURITY allows the table owner running SECURITY DEFINER RPCs
-- to insert audit records without RLS recursion.
-- ENABLE ROW LEVEL SECURITY remains in effect, strictly blocking non-owners (anon, authenticated, PUBLIC).
alter table public.hardcopy_audit_logs enable row level security;
alter table public.hardcopy_audit_logs no force row level security;

revoke all on table public.hardcopy_audit_logs from public, anon, authenticated;
grant select, insert on table public.hardcopy_audit_logs to service_role;

drop policy if exists "Service role hardcopy audit management" on public.hardcopy_audit_logs;
drop policy if exists "Service role only hardcopy audit access" on public.hardcopy_audit_logs;

create policy "Service role only hardcopy audit access" on public.hardcopy_audit_logs
  for all
  to service_role
  using (true)
  with check (true);

-- 7. Legacy RPC Security: mark_order_paid_atomic
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

-- 8. Legacy RPC Security: submit_mtn_payment
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

-- 9. Legacy RPC Security: verify_mtn_payment_admin
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

-- 10. Hardcopy Audit Log Transactionality & Sanitized Error Classification
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

-- 11. Hardcopy Status RPC: update_hardcopy_tickets_status_atomic
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

-- 12. Reaffirm Least-Privilege Grants on Prior Hardened RPCs (Idempotent)
revoke all on function public.release_expired_ticket_reservations() from public, anon, authenticated;
grant execute on function public.release_expired_ticket_reservations() to service_role;

revoke all on function public.reserve_tickets_atomic(
  text, integer, text, text, text, text, timestamptz, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.reserve_tickets_atomic(
  text, integer, text, text, text, text, timestamptz, text, integer, integer
) to service_role;

revoke all on function public.gate_checkin_atomic(text) from public, anon, authenticated;
grant execute on function public.gate_checkin_atomic(text) to service_role;

-- 13. Post-Migration Verification Assertion: Re-verify all 370 tickets
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
    raise exception 'Post-migration assertion failed: expected 20 online VIP and 50 online ORD. Found: % VIP, % ORD.', v_online_vip, v_online_ord;
  end if;

  if (v_hardcopy_vip <> 100 or v_hardcopy_ord <> 200) then
    raise exception 'Post-migration assertion failed: expected 100 hardcopy VIP and 200 hardcopy ORD. Found: % VIP, % ORD.', v_hardcopy_vip, v_hardcopy_ord;
  end if;

  if (v_null_qr > 0) then
    raise exception 'Post-migration assertion failed: found % tickets with null qr_token.', v_null_qr;
  end if;
end $$;

-- 14. Reload PostgREST schema cache
notify pgrst, 'reload schema';
