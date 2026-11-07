-- ==============================================================================
-- POOL PARTY TICKETING DATABASE ARCHITECTURE
-- Supabase SQL Migration Script
-- Event: Pool Party (11 December 2026 at Prince Resort, Bunamwaya Bella, Uganda)
-- ==============================================================================

-- 1. Enable pgcrypto extension for secure cryptographic UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Create the tickets table
CREATE TABLE IF NOT EXISTS public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Unique ticket reference code assigned at checkout (e.g., 'POOL-4921')
  ticket_ref VARCHAR(20) UNIQUE NOT NULL,
  
  -- Customer details
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  
  -- Ticket price in Ugandan Shillings (UGX)
  amount INTEGER NOT NULL CHECK (amount > 0),
  
  -- Ticket status lifecycle: 'PENDING' -> 'PAID' -> 'USED' (or 'CANCELLED')
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'CANCELLED', 'USED')),
  
  -- Dedicated cryptographic token for gate QR scanning
  qr_token UUID NOT NULL DEFAULT gen_random_uuid(),
  
  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ,

  -- Ensure ticket_ref adheres strictly to the POOL-XXXX format
  CONSTRAINT ticket_ref_format_check CHECK (ticket_ref ~* '^POOL-[0-9]{4}$')
);

-- 3. Indexes for sub-millisecond lookups
-- B-tree index on ticket_ref: Crucial for /api/ticket-status/:ref polling & SMS webhook matching
CREATE INDEX IF NOT EXISTS idx_tickets_ticket_ref ON public.tickets (ticket_ref);

-- Index on status: For filtering pending vs paid tickets in admin dashboards
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets (status);

-- Index on created_at: For chronological sorting and reservation expiration cleanups
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON public.tickets (created_at DESC);

-- 4. Row Level Security (RLS) Configuration
-- Protect attendee personal information while allowing secure API operations
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

-- Allow public read access strictly for ticket status checks (non-sensitive verification)
DROP POLICY IF EXISTS "Allow public status check by ticket_ref" ON public.tickets;
CREATE POLICY "Allow public status check by ticket_ref"
  ON public.tickets
  FOR SELECT
  USING (true);

-- Allow service_role (used by Express backend server) full administrative control
DROP POLICY IF EXISTS "Allow service role full management" ON public.tickets;
CREATE POLICY "Allow service role full management"
  ON public.tickets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ==============================================================================
-- End of Migration Script
-- ==============================================================================
