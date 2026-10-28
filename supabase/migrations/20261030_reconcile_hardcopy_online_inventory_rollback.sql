-- ==============================================================================
-- POOL PARTY — ROLLBACK SCRIPT FOR INVENTORY RECONCILIATION
-- Migration: 20261030_reconcile_hardcopy_online_inventory_rollback.sql
--
-- Restores previous database allocation:
--   • Ordinary (250 tickets):
--       - Online:   ORD-001 to ORD-050 (50 tickets)
--       - Hardcopy: ORD-051 to ORD-250 (200 tickets)
--   • VIP (120 tickets):
--       - Online:   VIP-001 to VIP-020 (20 tickets)
--       - Hardcopy: VIP-021 to VIP-120 (100 tickets)
--   • Total: 70 Online + 300 Hardcopy = 370 Total Tickets
--
-- Safety Guarantees:
--   1. NEVER touches or modifies qr_token UUIDs or ticket numbers.
--   2. Aborts if any ticket that would change channel has active reservations,
--      paid orders, hardcopy activations, or gate check-ins.
--   3. Restores RPC bounds to ORD-051..ORD-250 and VIP-021..VIP-120.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- STEP 1: SAFETY CHECKS BEFORE ROLLBACK
-- ------------------------------------------------------------------------------
do $$
declare
  v_active_conflicts text[];
begin
  select array_agg(
    format('%s (channel=%s, status=%s, payment_status=%s)', ticket_number, ticket_channel, status, payment_status)
    order by ticket_number
  )
  into v_active_conflicts
  from public.tickets
  where (
      -- Tickets that would move back to online: ORD-001..050, VIP-001..020
      ticket_number in (select 'ORD-' || lpad(n::text, 3, '0') from generate_series(1, 50) as n)
      or ticket_number in (select 'VIP-' || lpad(n::text, 3, '0') from generate_series(1, 20) as n)
      -- Tickets that would move back to hardcopy: ORD-151..250, VIP-051..120
      or ticket_number in (select 'ORD-' || lpad(n::text, 3, '0') from generate_series(151, 250) as n)
      or ticket_number in (select 'VIP-' || lpad(n::text, 3, '0') from generate_series(51, 120) as n)
    )
    and (
      status <> 'available'
      or payment_status <> 'unpaid'
      or order_ref is not null
      or hardcopy_batch_ref is not null
      or checked_in_at is not null
    );

  if v_active_conflicts is not null then
    raise exception
      'ROLLBACK ABORTED: The following tickets have active state and cannot be safely rolled back: %',
      array_to_string(v_active_conflicts, '; ');
  end if;
end $$;

-- ------------------------------------------------------------------------------
-- STEP 2: REVERSE CHANNEL ALLOCATION
-- ------------------------------------------------------------------------------
-- Move ORD-001..ORD-050 back to online
update public.tickets
set ticket_channel = 'online'
where ticket_number in (select 'ORD-' || lpad(n::text, 3, '0') from generate_series(1, 50) as n)
  and ticket_channel = 'hardcopy'
  and status = 'available';

-- Move VIP-001..VIP-020 back to online
update public.tickets
set ticket_channel = 'online'
where ticket_number in (select 'VIP-' || lpad(n::text, 3, '0') from generate_series(1, 20) as n)
  and ticket_channel = 'hardcopy'
  and status = 'available';

-- Move ORD-151..ORD-250 back to hardcopy
update public.tickets
set ticket_channel = 'hardcopy'
where ticket_number in (select 'ORD-' || lpad(n::text, 3, '0') from generate_series(151, 250) as n)
  and ticket_channel = 'online'
  and status = 'available';

-- Move VIP-051..VIP-120 back to hardcopy
update public.tickets
set ticket_channel = 'hardcopy'
where ticket_number in (select 'VIP-' || lpad(n::text, 3, '0') from generate_series(51, 120) as n)
  and ticket_channel = 'online'
  and status = 'available';

-- ------------------------------------------------------------------------------
-- STEP 3: RESTORE RPCs TO ORIGINAL HARDCOPY BOUNDS (ORD 51..250, VIP 21..120)
-- ------------------------------------------------------------------------------
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
    return jsonb_build_object('success', false, 'error', 'VALIDATION_ERROR', 'message', 'Invalid category. Must be VIP or ORDINARY.');
  end if;

  if p_action not in ('activate_single', 'activate_range') then
    return jsonb_build_object('success', false, 'error', 'VALIDATION_ERROR', 'message', 'Invalid activation action.');
  end if;

  if length(v_seller) < 2 or length(v_seller) > 120 or length(v_actor) < 2 or length(v_actor) > 80 or length(v_batch_ref) < 4 or length(v_batch_ref) > 120 then
    return jsonb_build_object('success', false, 'error', 'VALIDATION_ERROR', 'message', 'Invalid metadata parameters.');
  end if;

  if p_ticket_numbers is null or array_ndims(p_ticket_numbers) <> 1 or v_raw_count < 1 or v_raw_count > 200 then
    return jsonb_build_object('success', false, 'error', 'VALIDATION_ERROR', 'message', 'Invalid ticket numbers list.');
  end if;

  select count(distinct upper(btrim(raw_code))) into v_unique_count from unnest(p_ticket_numbers) as raw_code;
  if v_unique_count <> v_raw_count then
    return jsonb_build_object('success', false, 'error', 'DUPLICATE_TICKET_NUMBERS', 'message', 'Duplicate ticket numbers.');
  end if;

  select array_agg(upper(btrim(raw_code)) order by upper(btrim(raw_code)))
  into v_normalized_numbers
  from unnest(p_ticket_numbers) as raw_code;

  select array_agg(code order by code) into v_online_numbers
  from unnest(v_normalized_numbers) as code
  where (v_category = 'ORDINARY' and substring(code from 5)::integer between 1 and 50)
     or (v_category = 'VIP' and substring(code from 5)::integer between 1 and 20);

  if v_online_numbers is not null then
    return jsonb_build_object('success', false, 'error', 'ONLINE_TICKET_FORBIDDEN', 'message', 'Online pool tickets forbidden.', 'conflictingTickets', v_online_numbers);
  end if;

  select array_agg(code order by code) into v_out_of_range
  from unnest(v_normalized_numbers) as code
  where (v_category = 'ORDINARY' and (substring(code from 5)::integer < 51 or substring(code from 5)::integer > 250))
     or (v_category = 'VIP' and (substring(code from 5)::integer < 21 or substring(code from 5)::integer > 120));

  if v_out_of_range is not null then
    return jsonb_build_object('success', false, 'error', 'OUT_OF_HARDCOPY_RANGE', 'message', 'Out of hardcopy range.', 'conflictingTickets', v_out_of_range);
  end if;

  v_unit_price := case when v_category = 'VIP' then 50000 else 20000 end;

  perform 1 from public.tickets where ticket_number = any(v_normalized_numbers) order by ticket_number asc for update;
  select count(*) into v_found_count from public.tickets where ticket_number = any(v_normalized_numbers);
  if v_found_count <> v_raw_count then
    return jsonb_build_object('success', false, 'error', 'TICKETS_NOT_FOUND', 'message', 'Tickets not found.');
  end if;

  begin
    with updated as (
      update public.tickets
      set status = 'issued', payment_status = 'manual_paid', paid_at = v_now, activated_at = v_now,
          activated_by = v_actor, assigned_agent = v_seller, hardcopy_batch_ref = v_batch_ref,
          buyer_name = nullif(btrim(coalesce(p_buyer_name, '')), ''), buyer_phone = nullif(btrim(coalesce(p_buyer_phone, '')), '')
      where ticket_number = any(v_normalized_numbers)
        and ticket_channel = 'hardcopy' and category = v_category and price_ugx = v_unit_price and status = 'available' and checked_in_at is null
      returning ticket_number
    )
    select array_agg(ticket_number order by ticket_number), count(*) into v_updated_numbers, v_updated_count from updated;

    if v_updated_count <> v_raw_count then
      raise exception 'ATOMIC_UPDATE_MISMATCH';
    end if;

    v_total_amount := v_unit_price * v_updated_count;
    insert into public.hardcopy_audit_logs (batch_ref, action, category, ticket_numbers, quantity, unit_price_ugx, total_amount_ugx, agent_or_seller, buyer_name, buyer_phone, performed_by, notes, created_at)
    values (v_batch_ref, p_action, v_category, v_updated_numbers, v_updated_count, v_unit_price, v_total_amount, v_seller, nullif(btrim(coalesce(p_buyer_name, '')), ''), nullif(btrim(coalesce(p_buyer_phone, '')), ''), v_actor, nullif(btrim(coalesce(p_notes, '')), ''), v_now)
    returning id into v_audit_id;
  exception
    when others then
      return jsonb_build_object('success', false, 'error', 'ATOMIC_UPDATE_MISMATCH', 'message', 'Activation rolled back.');
  end;

  return jsonb_build_object('success', true, 'auditId', v_audit_id, 'batchRef', v_batch_ref, 'activatedCount', v_updated_count, 'ticketNumbers', v_updated_numbers);
end;
$$;

revoke all on function public.activate_hardcopy_tickets_atomic(text[], text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.activate_hardcopy_tickets_atomic(text[], text, text, text, text, text, text, text, text) to service_role;

-- ------------------------------------------------------------------------------
-- STEP 4: VERIFY RESTORED ALLOCATION (70 ONLINE, 300 HARDCOPY)
-- ------------------------------------------------------------------------------
do $$
declare
  v_online_count integer;
  v_hardcopy_count integer;
begin
  select count(*) into v_online_count from public.tickets where ticket_channel = 'online';
  select count(*) into v_hardcopy_count from public.tickets where ticket_channel = 'hardcopy';

  if v_online_count <> 70 or v_hardcopy_count <> 300 then
    raise exception 'Rollback failed: expected 70 Online & 300 Hardcopy tickets, found % and %.', v_online_count, v_hardcopy_count;
  end if;
end $$;
