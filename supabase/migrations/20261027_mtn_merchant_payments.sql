-- ==============================================================================
-- POOL PARTY: MTN Mobile Money Merchant Payments & Verification Migration
-- Non-destructive: Adds columns to public.orders and public.tickets
-- Enforces uniqueness on mtn_transaction_id to prevent duplicate payment claims
-- ==============================================================================

-- 1. Ensure columns exist on public.orders
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS mtn_transaction_id text,
  ADD COLUMN IF NOT EXISTS payer_phone text,
  ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'unsubmitted',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS submission_notes text;

-- Add check constraint for verification_status if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_verification_status_check'
  ) THEN
    ALTER TABLE public.orders 
      ADD CONSTRAINT orders_verification_status_check 
      CHECK (verification_status IN ('unsubmitted', 'pending_verification', 'verified', 'rejected'));
  END IF;
END $$;

-- 2. Add mtn_transaction_id to public.tickets
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS mtn_transaction_id text;

-- 3. Create unique index to guarantee no duplicate MTN transaction IDs are reused
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_mtn_transaction_id 
  ON public.orders (mtn_transaction_id) 
  WHERE mtn_transaction_id IS NOT NULL AND mtn_transaction_id <> '';

-- 4. Create index on verification_status for fast admin filtering
CREATE INDEX IF NOT EXISTS idx_orders_verification_status 
  ON public.orders (verification_status, created_at DESC);

-- 5. Atomic function to submit an MTN transaction ID (guards against concurrent duplicates)
CREATE OR REPLACE FUNCTION public.submit_mtn_payment(
  p_order_ref text,
  p_mtn_transaction_id text,
  p_payer_phone text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cleaned_tx text;
  v_existing_order text;
  v_order_status text;
  v_reserved_until timestamptz;
BEGIN
  v_cleaned_tx := upper(trim(p_mtn_transaction_id));

  IF length(v_cleaned_tx) < 5 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_TRANSACTION_ID',
      'message', 'Transaction ID must be at least 5 characters.'
    );
  END IF;

  -- Check for existing duplicate transaction ID
  SELECT order_ref INTO v_existing_order
  FROM public.orders
  WHERE upper(trim(mtn_transaction_id)) = v_cleaned_tx
    AND order_ref <> p_order_ref
  LIMIT 1;

  IF v_existing_order IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'DUPLICATE_TRANSACTION_ID',
      'message', 'This MTN Transaction ID has already been registered for another order.'
    );
  END IF;

  -- Verify target order exists and is not expired
  SELECT status, reserved_until INTO v_order_status, v_reserved_until
  FROM public.orders
  WHERE order_ref = p_order_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ORDER_NOT_FOUND',
      'message', 'Order reference not found.'
    );
  END IF;

  IF v_order_status = 'paid' THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Order is already verified and paid.',
      'status', 'paid',
      'verification_status', 'verified'
    );
  END IF;

  IF v_order_status = 'expired' OR (v_reserved_until IS NOT NULL AND now() > v_reserved_until) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ORDER_EXPIRED',
      'message', 'Reservation window has expired. Please create a new pass reservation.'
    );
  END IF;

  -- Update order with pending verification status
  UPDATE public.orders
  SET 
    mtn_transaction_id = v_cleaned_tx,
    payer_phone = p_payer_phone,
    verification_status = 'pending_verification',
    submission_notes = p_notes
  WHERE order_ref = p_order_ref;

  -- Also update reserved tickets
  UPDATE public.tickets
  SET mtn_transaction_id = v_cleaned_tx
  WHERE order_ref = p_order_ref;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'MTN transaction submitted. Awaiting admin verification.',
    'status', 'pending',
    'verification_status', 'pending_verification',
    'mtn_transaction_id', v_cleaned_tx
  );
END;
$$;

-- 6. Atomic function for Admin to verify MTN transaction and issue tickets
CREATE OR REPLACE FUNCTION public.verify_mtn_payment_admin(
  p_order_ref text,
  p_admin_name text DEFAULT 'Admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now timestamptz := now();
  v_tickets_count integer;
  v_tx_id text;
BEGIN
  -- Verify order exists
  SELECT mtn_transaction_id INTO v_tx_id
  FROM public.orders
  WHERE order_ref = p_order_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order not found.');
  END IF;

  -- Update order to paid
  UPDATE public.orders
  SET 
    status = 'paid',
    verification_status = 'verified',
    paid_at = v_now,
    verified_at = v_now,
    verified_by = p_admin_name
  WHERE order_ref = p_order_ref;

  -- Issue tickets atomically
  UPDATE public.tickets
  SET 
    status = 'issued',
    payment_status = 'paid',
    paid_at = v_now,
    mtn_transaction_id = COALESCE(v_tx_id, mtn_transaction_id)
  WHERE order_ref = p_order_ref;

  GET DIAGNOSTICS v_tickets_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Payment verified successfully. Tickets issued.',
    'tickets_issued', v_tickets_count
  );
END;
$$;

-- 7. Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
