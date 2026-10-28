-- ==============================================================================
-- POOL PARTY — RECONCILE HARDCOPY AND ONLINE TICKET INVENTORY (SAFE & IDEMPOTENT)
-- Migration: 20261030_reconcile_hardcopy_online_inventory.sql
--
-- Target Inventory Allocation:
--   • Ordinary (UGX 20,000):
--       - Hardcopy Pool: ORD-001 to ORD-150 (150 tickets)
--       - Online Pool:   ORD-151 to ORD-250 (100 tickets)
--       - Total Ordinary: 250 tickets
--   • VIP (UGX 50,000):
--       - Hardcopy Pool: VIP-001 to VIP-050 (50 tickets)
--       - Online Pool:   VIP-051 to VIP-120 (70 tickets)
--       - Total VIP: 120 tickets
--   • Overall Totals: 200 Hardcopy + 170 Online = 370 Total Tickets
--
-- Previous Database Allocation:
--   • Ordinary: Online ORD-001..ORD-050 (50), Hardcopy ORD-051..ORD-250 (200)
--   • VIP:      Online VIP-001..VIP-020 (20), Hardcopy VIP-021..VIP-120 (100)
--
-- Safety & Non-Destructive Guarantees:
--   1. NEVER regenerates, rotates, or modifies any qr_token UUID or ticket ID.
--   2. NEVER deletes or recreates tickets; only updates ticket_channel.
--   3. NEVER modifies ticket numbers already printed for physical distribution.
--   4. Asserts that all 370 tickets exist with non-null, unique QR tokens.
--   5. Fails closed and ABORTS if any ticket moving from online to hardcopy
--      (ORD-001..ORD-050 or VIP-001..VIP-020) has an existing reservation,
--      paid order, issued status, or check-in record.
--   6. Fails closed and ABORTS if any ticket moving from hardcopy to online
--      (ORD-151..ORD-250 or VIP-051..VIP-120) has been activated, assigned,
--      distributed, or referenced in public.hardcopy_audit_logs.
--   7. Updates activate_hardcopy_tickets_atomic and update_hardcopy_tickets_status_atomic
--      with exact new range bounds and security definitions.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- STEP 1: PRE-MIGRATION INVENTORY INTEGRITY ASSERTIONS
-- ------------------------------------------------------------------------------
do $$
declare
  v_total_tickets integer;
  v_null_qr_count integer;
  v_dup_qr_count integer;
  v_dup_number_count integer;
begin
  -- 1a. Verify total tickets equals exactly 370
  select count(*) into v_total_tickets from public.tickets;
  if v_total_tickets <> 370 then
    raise exception
      'Migration pre-assertion failed: expected 370 total tickets in public.tickets, found %.',
      v_total_tickets;
  end if;

  -- 1b. Verify zero null QR tokens
  select count(*) into v_null_qr_count from public.tickets where qr_token is null;
  if v_null_qr_count > 0 then
    raise exception
      'Migration pre-assertion failed: % ticket(s) have NULL qr_token.',
      v_null_qr_count;
  end if;

  -- 1c. Verify QR tokens are strictly unique across all 370 tickets
  select count(*) - count(distinct qr_token) into v_dup_qr_count from public.tickets;
  if v_dup_qr_count > 0 then
    raise exception
      'Migration pre-assertion failed: detected % duplicate qr_token(s).',
      v_dup_qr_count;
  end if;

  -- 1d. Verify ticket numbers are strictly unique across all 370 tickets
  select count(*) - count(distinct ticket_number) into v_dup_number_count from public.tickets;
  if v_dup_number_count > 0 then
    raise exception
      'Migration pre-assertion failed: detected % duplicate ticket_number(s).',
      v_dup_number_count;
  end if;
end $$;

-- ------------------------------------------------------------------------------
-- STEP 2: PRE-MIGRATION CONFLICT DETECTION (ABORTS IF ANY TICKET IS SOLD/ACTIVE)
-- ------------------------------------------------------------------------------
do $$
declare
  v_online_to_hardcopy_conflicts text[];
  v_hardcopy_to_online_conflicts text[];
  v_audit_log_conflicts text[];
begin
  -- 2a. Detect any tickets in ORD-001..ORD-050 or VIP-001..VIP-020 that are currently
  -- reserved, paid, issued, checked-in, or attached to an order.
  select array_agg(
    format(
      '%s (status=%s, payment_status=%s, order_ref=%s, checked_in_at=%s)',
      ticket_number,
      coalesce(status, 'null'),
      coalesce(payment_status, 'null'),
      coalesce(order_ref, 'none'),
      coalesce(checked_in_at::text, 'none')
    ) order by ticket_number
  )
  into v_online_to_hardcopy_conflicts
  from public.tickets
  where (
      ticket_number in (select 'ORD-' || lpad(n::text, 3, '0') from generate_series(1, 50) as n)
      or ticket_number in (select 'VIP-' || lpad(n::text, 3, '0') from generate_series(1, 20) as n)
    )
    and (
      status <> 'available'
      or payment_status <> 'unpaid'
      or order_ref is not null
      or checked_in_at is not null
      or buyer_name is not null
      or buyer_phone is not null
      or buyer_email is not null
    );

  if v_online_to_hardcopy_conflicts is not null then
    raise exception
      'SAFETY ABORT: Cannot reclassify online tickets to hardcopy. The following ticket(s) have active reservations, sales, or check-ins: %',
      array_to_string(v_online_to_hardcopy_conflicts, '; ');
  end if;

  -- 2b. Detect any tickets in ORD-151..ORD-250 or VIP-051..VIP-120 that have been activated,
  -- issued, paid, assigned to an agent, given a hardcopy batch ref, or checked-in.
  select array_agg(
    format(
      '%s (status=%s, payment_status=%s, batch_ref=%s, assigned_agent=%s, checked_in_at=%s)',
      ticket_number,
      coalesce(status, 'null'),
      coalesce(payment_status, 'null'),
      coalesce(hardcopy_batch_ref, 'none'),
      coalesce(assigned_agent, 'none'),
      coalesce(checked_in_at::text, 'none')
    ) order by ticket_number
  )
  into v_hardcopy_to_online_conflicts
  from public.tickets
  where (
      ticket_number in (select 'ORD-' || lpad(n::text, 3, '0') from generate_series(151, 250) as n)
      or ticket_number in (select 'VIP-' || lpad(n::text, 3, '0') from generate_series(51, 120) as n)
    )
    and (
      status <> 'available'
      or payment_status <> 'unpaid'
      or hardcopy_batch_ref is not null
      or assigned_agent is not null
      or activated_at is not null
      or activated_by is not null
      or checked_in_at is not null
    );

  if v_hardcopy_to_online_conflicts is not null then
    raise exception
      'SAFETY ABORT: Cannot reclassify hardcopy tickets to online. The following ticket(s) have hardcopy activation/batch records: %',
      array_to_string(v_hardcopy_to_online_conflicts, '; ');
  end if;

  -- 2c. Check if public.hardcopy_audit_logs contains any tickets in ORD-151..ORD-250 or VIP-051..VIP-120
  if to_regclass('public.hardcopy_audit_logs') is not null then
    select array_agg(distinct t.ticket_number order by t.ticket_number)
    into v_audit_log_conflicts
    from (
      select unnest(ticket_numbers) as ticket_number
      from public.hardcopy_audit_logs
    ) a
    join public.tickets t on t.ticket_number = a.ticket_number
    where (
      t.ticket_number in (select 'ORD-' || lpad(n::text, 3, '0') from generate_series(151, 250) as n)
      or t.ticket_number in (select 'VIP-' || lpad(n::text, 3, '0') from generate_series(51, 120) as n)
    );

    if v_audit_log_conflicts is not null then
      raise exception
        'SAFETY ABORT: Ticket(s) slated for online reallocation appear in public.hardcopy_audit_logs: %',
        array_to_string(v_audit_log_conflicts, ', ');
    end if;
  end if;
end $$;

-- ------------------------------------------------------------------------------
-- STEP 3: ATOMIC, IDEMPOTENT CHANNEL RECLASSIFICATION
-- ------------------------------------------------------------------------------
-- 3a. Reclassify ORD-001..ORD-050 from online to hardcopy (50 tickets)
update public.tickets
set ticket_channel = 'hardcopy'
where ticket_number in (select 'ORD-' || lpad(n::text, 3, '0') from generate_series(1, 50) as n)
  and ticket_channel = 'online'
  and status = 'available';

-- 3b. Reclassify VIP-001..VIP-020 from online to hardcopy (20 tickets)
update public.tickets
set ticket_channel = 'hardcopy'
where ticket_number in (select 'VIP-' || lpad(n::text, 3, '0') from generate_series(1, 20) as n)
  and ticket_channel = 'online'
  and status = 'available';

-- 3c. Reclassify ORD-151..ORD-250 from hardcopy to online (100 tickets)
update public.tickets
set ticket_channel = 'online'
where ticket_number in (select 'ORD-' || lpad(n::text, 3, '0') from generate_series(151, 250) as n)
  and ticket_channel = 'hardcopy'
  and status = 'available';

-- 3d. Reclassify VIP-051..VIP-120 from hardcopy to online (70 tickets)
update public.tickets
set ticket_channel = 'online'
where ticket_number in (select 'VIP-' || lpad(n::text, 3, '0') from generate_series(51, 120) as n)
  and ticket_channel = 'hardcopy'
  and status = 'available';

-- ------------------------------------------------------------------------------
-- STEP 4: UPDATE STORED PROCEDURES WITH NEW HARDCOPY & ONLINE POOL BOUNDS
-- ------------------------------------------------------------------------------

-- 4a. Update Hardcopy Activation RPC: public.activate_hardcopy_tickets_atomic
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
      'message', 'Invalid ticket number format. Expected canonical ORD-001..ORD-150 or VIP-001..VIP-050.',
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

  -- New online range bounds: ORD-151..ORD-250, VIP-051..VIP-120
  select array_agg(code order by code)
  into v_online_numbers
  from unnest(v_normalized_numbers) as code
  where (v_category = 'ORDINARY' and substring(code from 5)::integer between 151 and 250)
     or (v_category = 'VIP' and substring(code from 5)::integer between 51 and 120);

  if v_online_numbers is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'ONLINE_TICKET_FORBIDDEN',
      'message', 'Online pool tickets cannot be activated through the hardcopy channel.',
      'conflictingTickets', v_online_numbers
    );
  end if;

  -- New hardcopy range bounds: ORD-001..ORD-150, VIP-001..VIP-050
  select array_agg(code order by code)
  into v_out_of_range
  from unnest(v_normalized_numbers) as code
  where (v_category = 'ORDINARY' and (substring(code from 5)::integer < 1 or substring(code from 5)::integer > 150))
     or (v_category = 'VIP' and (substring(code from 5)::integer < 1 or substring(code from 5)::integer > 50));

  if v_out_of_range is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'OUT_OF_HARDCOPY_RANGE',
      'message', 'Ticket number is outside the valid hardcopy pool (ORD-001..ORD-150 or VIP-001..VIP-050).',
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

-- 4b. Update Hardcopy Status RPC: public.update_hardcopy_tickets_status_atomic
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
      'message', 'Invalid ticket number format. Expected canonical ORD-001..ORD-150 or VIP-001..VIP-050.',
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

  -- New online range bounds: ORD-151..ORD-250, VIP-051..VIP-120
  select array_agg(code order by code)
  into v_online_numbers
  from unnest(v_normalized_numbers) as code
  where (v_category = 'ORDINARY' and substring(code from 5)::integer between 151 and 250)
     or (v_category = 'VIP' and substring(code from 5)::integer between 51 and 120);

  if v_online_numbers is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'ONLINE_TICKET_FORBIDDEN',
      'message', 'Online pool tickets cannot be modified through hardcopy status controls.',
      'conflictingTickets', v_online_numbers
    );
  end if;

  -- New hardcopy range bounds: ORD-001..ORD-150, VIP-001..VIP-050
  select array_agg(code order by code)
  into v_out_of_range
  from unnest(v_normalized_numbers) as code
  where (v_category = 'ORDINARY' and (substring(code from 5)::integer < 1 or substring(code from 5)::integer > 150))
     or (v_category = 'VIP' and (substring(code from 5)::integer < 1 or substring(code from 5)::integer > 50));

  if v_out_of_range is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'OUT_OF_HARDCOPY_RANGE',
      'message', 'Ticket number is outside the valid hardcopy pool (ORD-001..ORD-150 or VIP-001..VIP-050).',
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
      'error', 'TICKETS_ALREADY_CHECKED_IN',
      'message', 'Cannot deactivate or void tickets that have already been checked in at the gate.',
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
        'error', 'INVALID_TICKET_STATE',
        'message', 'Return aborted: deactivate_return can only be performed on currently issued hardcopy tickets.',
        'conflictingTickets', v_invalid_state
      );
    end if;
  elsif p_action = 'void_cancel' then
    select array_agg(ticket_number order by ticket_number) into v_invalid_state
    from public.tickets
    where ticket_number = any(v_normalized_numbers)
      and status not in ('available', 'issued');

    if v_invalid_state is not null then
      return jsonb_build_object(
        'success', false,
        'error', 'INVALID_TICKET_STATE',
        'message', 'Void aborted: void_cancel can only be performed on available or issued hardcopy tickets.',
        'conflictingTickets', v_invalid_state
      );
    end if;
  end if;

  -- 5. Atomic state update + audit record
  begin
    if p_action = 'deactivate_return' then
      with updated as (
        update public.tickets
        set
          status = 'available',
          payment_status = 'unpaid',
          paid_at = null,
          buyer_name = null,
          buyer_phone = null,
          buyer_email = null,
          order_ref = null,
          assigned_agent = null,
          activated_by = null,
          activated_at = null,
          hardcopy_batch_ref = null
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
    elsif p_action = 'void_cancel' then
      with updated as (
        update public.tickets
        set
          status = 'cancelled',
          payment_status = case when payment_status = 'manual_paid' then 'refunded' else 'unpaid' end,
          activated_by = v_actor,
          hardcopy_batch_ref = v_batch_ref
        where ticket_number = any(v_normalized_numbers)
          and ticket_channel = 'hardcopy'
          and category = v_category
          and price_ugx = v_unit_price
          and status in ('available', 'issued')
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
      0,
      v_seller,
      null,
      null,
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
        'message', 'Atomic hardcopy status change failed verification and was rolled back with zero tickets modified.'
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
    'unitPriceUgx', v_unit_price,
    'sellerName', v_seller,
    'performedBy', v_actor,
    'updatedAt', v_now,
    'message', format('Successfully performed %s on %s %s hardcopy ticket(s).', p_action, v_updated_count, v_category)
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
-- STEP 5: POST-MIGRATION INVENTORY VERIFICATION ASSERTIONS
-- ------------------------------------------------------------------------------
do $$
declare
  v_ord_hardcopy_count integer;
  v_ord_online_count integer;
  v_vip_hardcopy_count integer;
  v_vip_online_count integer;
  v_total_hardcopy integer;
  v_total_online integer;
  v_misallocated text[];
begin
  -- 5a. Verify Ordinary counts
  select count(*) into v_ord_hardcopy_count
  from public.tickets
  where category = 'ORDINARY' and ticket_channel = 'hardcopy';

  select count(*) into v_ord_online_count
  from public.tickets
  where category = 'ORDINARY' and ticket_channel = 'online';

  if v_ord_hardcopy_count <> 150 or v_ord_online_count <> 100 then
    raise exception
      'Migration verification failed: expected 150 Hardcopy & 100 Online Ordinary tickets, found % Hardcopy and % Online.',
      v_ord_hardcopy_count,
      v_ord_online_count;
  end if;

  -- 5b. Verify VIP counts
  select count(*) into v_vip_hardcopy_count
  from public.tickets
  where category = 'VIP' and ticket_channel = 'hardcopy';

  select count(*) into v_vip_online_count
  from public.tickets
  where category = 'VIP' and ticket_channel = 'online';

  if v_vip_hardcopy_count <> 50 or v_vip_online_count <> 70 then
    raise exception
      'Migration verification failed: expected 50 Hardcopy & 70 Online VIP tickets, found % Hardcopy and % Online.',
      v_vip_hardcopy_count,
      v_vip_online_count;
  end if;

  -- 5c. Verify exact channel totals
  select count(*) into v_total_hardcopy from public.tickets where ticket_channel = 'hardcopy';
  select count(*) into v_total_online from public.tickets where ticket_channel = 'online';

  if v_total_hardcopy <> 200 or v_total_online <> 170 then
    raise exception
      'Migration verification failed: expected exactly 200 Hardcopy & 170 Online tickets, found % Hardcopy and % Online.',
      v_total_hardcopy,
      v_total_online;
  end if;

  -- 5d. Verify no ticket is outside its expected range bounds
  select array_agg(ticket_number order by ticket_number)
  into v_misallocated
  from public.tickets
  where (
      category = 'ORDINARY'
      and ticket_channel = 'hardcopy'
      and substring(ticket_number from 5)::integer > 150
    ) or (
      category = 'ORDINARY'
      and ticket_channel = 'online'
      and substring(ticket_number from 5)::integer < 151
    ) or (
      category = 'VIP'
      and ticket_channel = 'hardcopy'
      and substring(ticket_number from 5)::integer > 50
    ) or (
      category = 'VIP'
      and ticket_channel = 'online'
      and substring(ticket_number from 5)::integer < 51
    );

  if v_misallocated is not null then
    raise exception
      'Migration verification failed: detected misallocated tickets: %',
      array_to_string(v_misallocated, ', ');
  end if;
end $$;
