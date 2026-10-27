import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  RelworxService,
  CUSTOMER_PAYMENTS_UNAVAILABLE_MESSAGE,
  sanitizeDiagnosticText,
} from './relworxService.js';
import { MtnMoMoService } from './mtnMoMoService.js';
import type { OrderRecord, OrderStatus, PaymentNetwork, VerificationStatus } from '../types/order.js';

dotenv.config();

type InitiationResult = {
  success: boolean;
  orderRef?: string;
  message: string;
  relworxInternalRef?: string | null;
  reservedUntil?: string;
  totalAmountUgx?: number;
  gateway?: 'relworx';
  error?: string;
  code?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
  reusedExistingOrder?: boolean;
};

// Coalesces concurrent identical submissions to prevent duplicate orders and duplicate charges
const _inFlightInitiations = new Map<string, Promise<InitiationResult>>();
const _recentIdempotencyResults = new Map<string, { expiresAt: number; result: InitiationResult }>();

interface MtnSubmissionRecord {
  orderRef: string;
  mtnTransactionId: string;
  payerPhone: string;
  verificationStatus: VerificationStatus;
  submittedAt: string;
  verifiedAt?: string;
  verifiedBy?: string;
  rejectionReason?: string;
  notes?: string;
}

const _mtnSubmissionsByTxId = new Map<string, MtnSubmissionRecord>();
const _mtnSubmissionsByOrderRef = new Map<string, MtnSubmissionRecord>();

function sanitizeEnv(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const cleaned = val.trim().replace(/^["']|["']$/g, '').trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function getSupabaseEnv() {
  const url = sanitizeEnv(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const serviceKey = sanitizeEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return { url, serviceKey };
}

function detectJwtRole(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf-8');
    const payload = JSON.parse(json);
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

function isSupabaseEnvValid(url?: string, serviceKey?: string): boolean {
  return Boolean(
    url &&
      serviceKey &&
      !url.includes('your-project') &&
      !url.includes('placeholder') &&
      !url.includes('example') &&
      url.startsWith('https://') &&
      serviceKey.length > 20 &&
      !serviceKey.includes('your-supabase-service-role-key')
  );
}

let _cachedClient: SupabaseClient | null = null;
let _cachedKeySig = '';

function getSupabaseClient(): { client: SupabaseClient | null; configError?: string } {
  const { url, serviceKey } = getSupabaseEnv();

  if (!isSupabaseEnvValid(url, serviceKey)) {
    return {
      client: null,
      configError: 'Ticketing database is not configured on the server. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    };
  }

  const jwtRole = detectJwtRole(serviceKey);
  if (jwtRole === 'anon') {
    return {
      client: null,
      configError: 'Server database configuration error: SUPABASE_SERVICE_ROLE_KEY is set to an anon key instead of the service_role key.',
    };
  }

  const sig = `${url}|${serviceKey}`;
  if (!_cachedClient || _cachedKeySig !== sig) {
    _cachedClient = createClient(url!, serviceKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    _cachedKeySig = sig;
  }

  return { client: _cachedClient };
}

const initialEnv = getSupabaseEnv();
export const isLiveSupabaseAvailable = isSupabaseEnvValid(initialEnv.url, initialEnv.serviceKey);
export const supabaseAdmin: SupabaseClient | null = getSupabaseClient().client;

export interface PublicInventoryCounts {
  VIP: {
    total: number;
    available: number;
    priceUgx: number;
  };
  ORDINARY: {
    total: number;
    available: number;
    priceUgx: number;
  };
  totalAvailable: number;
  isLiveSupabase: boolean;
}

export interface TicketRow {
  id: string;
  ticket_number: string;
  category: 'VIP' | 'ORDINARY';
  price_ugx: number;
  status: 'available' | 'reserved' | 'issued' | 'cancelled';
  payment_status: 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded' | 'manual_paid';
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  qr_token: string;
  created_at: string;
  paid_at: string | null;
  checked_in_at: string | null;
  order_ref?: string | null;
  reserved_until?: string | null;
  mtn_transaction_id?: string | null;
  relworx_internal_ref?: string | null;
  flw_transaction_id?: string | null;
}

export type OrderRow = OrderRecord;

function isMissingRpcError(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('could not find the function') ||
    (msg.includes('function') && msg.includes('does not exist'))
  );
}

function isMissingRelationError(err: any, relationName?: string): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  const isRelationMissing =
    code === 'PGRST205' ||
    code === '42P01' ||
    msg.includes('could not find the table') ||
    (msg.includes('relation') && msg.includes('does not exist'));

  if (!isRelationMissing) return false;
  if (!relationName) return true;
  return msg.includes(relationName.toLowerCase());
}

function classifySchemaError(err: any, fallbackMessage: string): { message: string; error: string } {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  const lower = msg.toLowerCase();

  if (code === 'PGRST204' || code === '42703' || (lower.includes('column') && (lower.includes('schema cache') || lower.includes('does not exist')))) {
    return {
      message:
        "Database schema update or cache reload required on public.tickets (missing order_ref, reserved_until, or relworx_internal_ref, or PostgREST schema cache not refreshed).",
      error: 'SCHEMA_MISMATCH',
    };
  }

  if (isMissingRelationError(err)) {
    return {
      message:
        "Database schema setup is incomplete or schema cache has not refreshed yet. Run NOTIFY pgrst, 'reload schema'; in Supabase SQL Editor and retry.",
      error: 'SCHEMA_MISMATCH',
    };
  }

  return {
    message: fallbackMessage,
    error: 'DATABASE_ERROR',
  };
}

export const SupabaseServerService = {
  /**
   * Health Check: Read-only connection & schema readiness check against live Supabase project
   */
  async checkConnection(): Promise<{
    connected: boolean;
    count: number;
    ticketsSchemaReady?: boolean;
    ordersTableReady?: boolean;
    schemaWarning?: string;
    error?: string;
  }> {
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        connected: false,
        count: 0,
        error: configError || 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.',
      };
    }

    try {
      const { count, error } = await client
        .from('tickets')
        .select('*', { count: 'exact', head: true });

      if (error) {
        return { connected: false, count: 0, error: 'Database query failed while checking tickets table.' };
      }

      const { error: ticketColsErr } = await client
        .from('tickets')
        .select('id, order_ref, reserved_until, relworx_internal_ref')
        .limit(1);

      const { error: ordersErr } = await client
        .from('orders')
        .select('id, order_ref, status')
        .limit(1);

      const ticketsSchemaReady = !ticketColsErr;
      const ordersTableReady = !ordersErr;
      const warnings: string[] = [];

      if (!ticketsSchemaReady) {
        warnings.push("public.tickets is missing reservation columns (order_ref, reserved_until, relworx_internal_ref) or PostgREST schema cache needs reload.");
      }
      if (!ordersTableReady) {
        warnings.push('public.orders table is not created yet (falling back to public.tickets reservation tracking).');
      }

      return {
        connected: true,
        count: count ?? 0,
        ticketsSchemaReady,
        ordersTableReady,
        schemaWarning: warnings.length > 0 ? warnings.join(' ') : undefined,
      };
    } catch {
      return { connected: false, count: 0, error: 'Connection to Supabase failed.' };
    }
  },

  /**
   * Safe Atomic Cleanup: Release 10-Minute Expired Unpaid Reservations
   * Ensures capacity returns to 'available' automatically if customer doesn't pay
   */
  async releaseExpiredReservations(): Promise<number> {
    const { client } = getSupabaseClient();
    if (!client) {
      return 0;
    }

    // Try PostgreSQL stored procedure first
    try {
      const { data: rpcCount, error: rpcErr } = await client.rpc('release_expired_ticket_reservations');
      if (!rpcErr && typeof rpcCount === 'number') {
        return rpcCount;
      }
    } catch {
      // Proceed to direct table update fallback
    }

    const nowIso = new Date().toISOString();

    try {
      let { data: expiredTickets, error: tErr } = await client
        .from('tickets')
        .update({
          status: 'available',
          payment_status: 'unpaid',
          buyer_name: null,
          buyer_email: null,
          buyer_phone: null,
          order_ref: null,
          reserved_until: null,
          relworx_internal_ref: null,
        })
        .eq('status', 'reserved')
        .in('payment_status', ['unpaid', 'pending'])
        .lt('reserved_until', nowIso)
        .select('id');

      // Fallback if optional relworx_internal_ref column is not yet present on public.tickets
      if (tErr && (tErr.code === 'PGRST204' || tErr.code === '42703')) {
        const retry = await client
          .from('tickets')
          .update({
            status: 'available',
            payment_status: 'unpaid',
            buyer_name: null,
            buyer_email: null,
            buyer_phone: null,
            order_ref: null,
            reserved_until: null,
          })
          .eq('status', 'reserved')
          .in('payment_status', ['unpaid', 'pending'])
          .lt('reserved_until', nowIso)
          .select('id');
        expiredTickets = retry.data;
        tErr = retry.error;
      }

      if (!tErr && expiredTickets && expiredTickets.length > 0) {
        await client
          .from('orders')
          .update({ status: 'expired' })
          .eq('status', 'pending')
          .lt('reserved_until', nowIso);

        return expiredTickets.length;
      }
    } catch (err: any) {
      console.warn('Error releasing expired reservations in Supabase:', sanitizeDiagnosticText(err?.message || ''));
    }

    return 0;
  },

  /**
   * Public Inventory Counts ONLY: Read VIP and Ordinary availability from Supabase.
   * VIP: UGX 50,000 each; Ordinary: UGX 20,000 each.
   * Never exposes buyer details, personal phone numbers, or QR tokens.
   */
  async getPublicCounts(): Promise<{ success: boolean; counts?: PublicInventoryCounts; error?: string }> {
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        error: configError || 'Ticketing database is currently offline.',
      };
    }

    await this.releaseExpiredReservations();

    try {
      const { data, error } = await client
        .from('tickets')
        .select('category, status');

      if (error) {
        console.error('[Supabase getPublicCounts Error]', error.code, error.message);
        return { success: false, error: 'Unable to load live ticket inventory at this time.' };
      }

      if (!data || data.length === 0) {
        return {
          success: false,
          error: 'Ticket inventory has not been initialized or is inaccessible. Verify database setup and service role key.',
        };
      }

      const vipTotal = data.filter((t) => t.category === 'VIP').length;
      const vipAvail = data.filter((t) => t.category === 'VIP' && t.status === 'available').length;

      const ordTotal = data.filter((t) => t.category === 'ORDINARY').length;
      const ordAvail = data.filter((t) => t.category === 'ORDINARY' && t.status === 'available').length;

      return {
        success: true,
        counts: {
          VIP: { total: vipTotal, available: vipAvail, priceUgx: 50000 },
          ORDINARY: { total: ordTotal, available: ordAvail, priceUgx: 20000 },
          totalAvailable: vipAvail + ordAvail,
          isLiveSupabase: true,
        },
      };
    } catch (err: any) {
      console.error('[Supabase getPublicCounts Exception]', err?.message || err);
      return { success: false, error: 'Unable to reach the ticketing database.' };
    }
  },

  /**
   * MTN Mobile Money Merchant Reservation:
   * 1. Validates inputs & calculates trusted server price (UGX 20,000 Ordinary, UGX 50,000 VIP)
   * 2. Atomically reserves tickets in Supabase with a 15-minute hold
   * 3. Creates a pending order record with verification_status = 'unsubmitted'
   * 4. Returns official MTN Merchant payment instructions and unique order reference
   */
  async initiateMtnMerchantReservation(params: {
    category: 'VIP' | 'ORDINARY';
    quantity: number;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
  }): Promise<{
    success: boolean;
    orderRef?: string;
    reservedUntil?: string;
    totalAmountUgx?: number;
    category?: 'VIP' | 'ORDINARY';
    quantity?: number;
    merchantCode?: string;
    merchantName?: string;
    isConfigured?: boolean;
    message: string;
    error?: string;
  }> {
    const { category, quantity, buyerName, buyerEmail, buyerPhone } = params;

    if (!quantity || quantity < 1 || quantity > 10) {
      return {
        success: false,
        message: 'Invalid ticket quantity (minimum 1, maximum 10).',
        error: 'VALIDATION_ERROR',
      };
    }

    if (category !== 'VIP' && category !== 'ORDINARY') {
      return {
        success: false,
        message: 'Invalid ticket category. Must be VIP or ORDINARY.',
        error: 'VALIDATION_ERROR',
      };
    }

    if (!buyerName || buyerName.trim().length < 2) {
      return {
        success: false,
        message: 'Please provide your full legal name for the ticket.',
        error: 'VALIDATION_ERROR',
      };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!buyerEmail || !emailRegex.test(buyerEmail.trim())) {
      return {
        success: false,
        message: 'Please provide a valid email address.',
        error: 'VALIDATION_ERROR',
      };
    }

    const phoneCheck = MtnMoMoService.formatUgandaPhone(buyerPhone);
    if (!phoneCheck.valid) {
      return {
        success: false,
        message: 'Please enter a valid Uganda MTN Mobile Money phone number (e.g. 0775 198 484 or +256 775 198484).',
        error: 'VALIDATION_ERROR',
      };
    }

    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        message: configError || 'Database offline. Cannot reserve tickets at this time.',
        error: 'DATABASE_OFFLINE',
      };
    }

    const unitPrice = category === 'VIP' ? 50000 : 20000;
    const totalAmount = unitPrice * quantity;

    // Release any stale expired reservations first
    await this.releaseExpiredReservations();

    // Generate unique order reference (e.g. PP-MTN-1729900000-1234)
    const timestamp = Date.now();
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderRef = `PP-MTN-${timestamp}-${randomSuffix}`;
    const reservedUntil = new Date(timestamp + 15 * 60 * 1000).toISOString(); // 15-minute hold

    try {
      // Find and atomically lock available tickets
      const { data: available, error: fetchErr } = await client
        .from('tickets')
        .select('id, ticket_number')
        .eq('category', category)
        .eq('status', 'available')
        .order('ticket_number', { ascending: true })
        .limit(quantity);

      if (fetchErr || !available || available.length < quantity) {
        const count = available?.length || 0;
        return {
          success: false,
          message: `Sold out or insufficient inventory. Only ${count} ${category} ticket(s) currently available.`,
          error: 'INSUFFICIENT_INVENTORY',
        };
      }

      const allocatedIds = available.map((t) => t.id);

      // Lock tickets
      const { error: lockErr } = await client
        .from('tickets')
        .update({
          status: 'reserved',
          payment_status: 'pending',
          buyer_name: buyerName.trim(),
          buyer_email: buyerEmail.trim(),
          buyer_phone: buyerPhone.trim(),
          order_ref: orderRef,
          reserved_until: reservedUntil,
        })
        .in('id', allocatedIds)
        .eq('status', 'available');

      if (lockErr) {
        console.error('[MTN Reservation Lock Error]', lockErr);
        return {
          success: false,
          message: 'Could not lock ticket reservation in database.',
          error: 'DATABASE_ERROR',
        };
      }

      // Record pending order
      const { error: orderErr } = await client.from('orders').insert({
        order_ref: orderRef,
        category,
        quantity,
        unit_price_ugx: unitPrice,
        total_amount_ugx: totalAmount,
        status: 'pending',
        verification_status: 'unsubmitted',
        payment_method: 'mtn_momo_merchant',
        gateway: 'mtn_momo',
        network: 'MTN',
        buyer_name: buyerName.trim(),
        buyer_email: buyerEmail.trim(),
        buyer_phone: buyerPhone.trim(),
        reserved_until: reservedUntil,
      });

      if (orderErr) {
        if (!isMissingRelationError(orderErr, 'orders')) {
          console.warn('[Supabase orders insert warning]', orderErr.message);
        }
      }

      const merchantCode = MtnMoMoService.getMerchantCode();
      const merchantName = MtnMoMoService.getMerchantName();
      const isConfigured = MtnMoMoService.isConfigured();

      return {
        success: true,
        orderRef,
        reservedUntil,
        totalAmountUgx: totalAmount,
        category,
        quantity,
        merchantCode,
        merchantName,
        isConfigured,
        message: 'Pass reserved for 15 minutes. Pay to the MTN Merchant Code and submit your transaction ID.',
      };
    } catch (err: any) {
      console.error('[MTN Reservation Exception]', err?.message || err);
      return {
        success: false,
        message: 'Server error while creating ticket reservation.',
        error: 'SERVER_ERROR',
      };
    }
  },

  /**
   * Submit MTN Transaction ID for Admin Verification:
   * 1. Validates transaction ID format and checks for duplicate reuse
   * 2. Prevents duplicate transaction IDs across all orders and tickets
   * 3. Sets verification_status = 'pending_verification'
   * 4. NEVER marks as paid or issues QR codes on submission!
   */
  async submitMtnTransaction(params: {
    orderRef: string;
    mtnTransactionId: string;
    payerPhone: string;
    notes?: string;
  }): Promise<{
    success: boolean;
    message: string;
    orderRef?: string;
    verificationStatus?: VerificationStatus;
    mtnTransactionId?: string;
    error?: string;
  }> {
    const { orderRef, mtnTransactionId, payerPhone, notes } = params;

    if (!orderRef || typeof orderRef !== 'string') {
      return { success: false, message: 'Order reference is required.', error: 'INVALID_ORDER_REF' };
    }

    const txCheck = MtnMoMoService.sanitizeTransactionId(mtnTransactionId);
    if (!txCheck.valid) {
      return { success: false, message: txCheck.error || 'Invalid MTN Transaction ID.', error: 'INVALID_TRANSACTION_ID' };
    }
    const cleanTxId = txCheck.cleaned;

    const phoneCheck = MtnMoMoService.formatUgandaPhone(payerPhone);
    const cleanPhone = phoneCheck.valid ? phoneCheck.msisdn : payerPhone.trim();

    const { client, configError } = getSupabaseClient();
    if (!client) {
      return { success: false, message: configError || 'Database offline.', error: 'DATABASE_OFFLINE' };
    }

    // Try stored procedure first if available
    try {
      const { data: rpcRes, error: rpcErr } = await client.rpc('submit_mtn_payment', {
        p_order_ref: orderRef,
        p_mtn_transaction_id: cleanTxId,
        p_payer_phone: cleanPhone,
        p_notes: notes || null,
      });

      if (!rpcErr && rpcRes) {
        return rpcRes;
      }
    } catch {
      // Fallback to table queries
    }

    // Memory-level duplicate prevention (works even if migration is not yet run in remote Supabase)
    const memSub = _mtnSubmissionsByTxId.get(cleanTxId);
    if (memSub && memSub.orderRef !== orderRef && memSub.verificationStatus !== 'rejected') {
      return {
        success: false,
        error: 'DUPLICATE_TRANSACTION_ID',
        message: 'This MTN Transaction ID has already been submitted for another order. Each payment transaction ID can only be registered once.',
      };
    }

    try {
      // 1. DUPLICATE CHECK: Verify that this mtn_transaction_id has NOT been used by any other order
      const { data: existingTxOrders } = await client
        .from('orders')
        .select('order_ref, status')
        .ilike('mtn_transaction_id', cleanTxId)
        .neq('order_ref', orderRef)
        .limit(1);

      if (existingTxOrders && existingTxOrders.length > 0) {
        return {
          success: false,
          error: 'DUPLICATE_TRANSACTION_ID',
          message: 'This MTN Transaction ID has already been submitted for another order. Each payment transaction ID can only be registered once.',
        };
      }

      // Check tickets table as well
      const { data: existingTxTickets } = await client
        .from('tickets')
        .select('order_ref')
        .ilike('mtn_transaction_id', cleanTxId)
        .neq('order_ref', orderRef)
        .limit(1);

      if (existingTxTickets && existingTxTickets.length > 0) {
        return {
          success: false,
          error: 'DUPLICATE_TRANSACTION_ID',
          message: 'This MTN Transaction ID is already associated with another ticket issuance.',
        };
      }

      // 2. Fetch target order
      const { data: order, error: orderErr } = await client
        .from('orders')
        .select('*')
        .eq('order_ref', orderRef)
        .maybeSingle();

      if (orderErr && !isMissingRelationError(orderErr, 'orders')) {
        console.warn('[Submit MTN Order Fetch Error]', orderErr);
      }

      if (order && order.status === 'paid') {
        return {
          success: true,
          orderRef,
          message: 'Order is already verified and paid. Your tickets are issued.',
          verificationStatus: 'verified',
        };
      }

      // 3. Update order with pending verification state
      let updatedOrders = false;
      if (order) {
        const updatePayload: Record<string, any> = {
          mtn_transaction_id: cleanTxId,
          payer_phone: cleanPhone,
          verification_status: 'pending_verification',
        };
        if (notes) updatePayload.submission_notes = notes;

        const { error: updErr } = await client
          .from('orders')
          .update(updatePayload)
          .eq('order_ref', orderRef);

        if (!updErr) updatedOrders = true;
      }

      // 4. Update tickets with mtn_transaction_id (remains reserved, NOT paid!)
      await client
        .from('tickets')
        .update({
          mtn_transaction_id: cleanTxId,
        })
        .eq('order_ref', orderRef);

      // Record in memory tracker for instant deduplication and dashboard visibility
      const subRecord: MtnSubmissionRecord = {
        orderRef,
        mtnTransactionId: cleanTxId,
        payerPhone: cleanPhone,
        verificationStatus: 'pending_verification',
        submittedAt: new Date().toISOString(),
        notes,
      };
      _mtnSubmissionsByTxId.set(cleanTxId, subRecord);
      _mtnSubmissionsByOrderRef.set(orderRef, subRecord);

      return {
        success: true,
        orderRef,
        verificationStatus: 'pending_verification',
        mtnTransactionId: cleanTxId,
        message: 'MTN payment submitted successfully! Our event admin will verify against the MTN Merchant portal before tickets are issued.',
      };
    } catch (err: any) {
      console.error('[Submit MTN Transaction Exception]', err?.message || err);
      return {
        success: false,
        message: 'Unexpected error while submitting transaction ID. Please try again.',
        error: 'SUBMISSION_ERROR',
      };
    }
  },

  /**
   * Admin Verification of MTN Merchant Payment:
   * Only called after admin verifies transaction ID against real MTN merchant SMS/portal.
   * Atomically marks order as 'paid', issues tickets, and activates QR codes.
   */
  async verifyMtnPaymentAdmin(params: {
    orderRef: string;
    adminName?: string;
    notes?: string;
  }): Promise<{ success: boolean; message: string; error?: string }> {
    const { orderRef, adminName = 'Admin' } = params;

    const { client, configError } = getSupabaseClient();
    if (!client) {
      return { success: false, message: configError || 'Database offline.', error: 'DATABASE_OFFLINE' };
    }

    // Try RPC first
    try {
      const { data: rpcRes, error: rpcErr } = await client.rpc('verify_mtn_payment_admin', {
        p_order_ref: orderRef,
        p_admin_name: adminName,
      });

      if (!rpcErr && rpcRes && rpcRes.success) {
        return rpcRes;
      }
    } catch {
      // Proceed to direct update
    }

    const now = new Date().toISOString();

    try {
      // Get order
      const { data: order } = await client
        .from('orders')
        .select('*')
        .eq('order_ref', orderRef)
        .maybeSingle();

      const txId = order?.mtn_transaction_id || null;

      // Update order to paid
      await client
        .from('orders')
        .update({
          status: 'paid',
          verification_status: 'verified',
          paid_at: now,
          verified_at: now,
          verified_by: adminName,
        })
        .eq('order_ref', orderRef);

      // Update memory record
      const memSub = _mtnSubmissionsByOrderRef.get(orderRef);
      if (memSub) {
        memSub.verificationStatus = 'verified';
        memSub.verifiedAt = now;
        memSub.verifiedBy = adminName;
      }

      // Issue tickets atomically
      const ticketUpdate: Record<string, any> = {
        status: 'issued',
        payment_status: 'paid',
        paid_at: now,
      };
      if (txId) ticketUpdate.mtn_transaction_id = txId;

      let { error: ticketErr } = await client
        .from('tickets')
        .update(ticketUpdate)
        .eq('order_ref', orderRef);

      if (ticketErr && (ticketErr.code === 'PGRST204' || ticketErr.code === '42703')) {
        const fallback = await client
          .from('tickets')
          .update({
            status: 'issued',
            payment_status: 'paid',
            paid_at: now,
          })
          .eq('order_ref', orderRef);
        ticketErr = fallback.error;
      }

      if (ticketErr) {
        console.error('[Verify MTN Ticket Update Error]', ticketErr);
        return { success: false, message: 'Failed to update ticket records to issued in database.' };
      }

      return {
        success: true,
        message: `MTN payment verified for Order ${orderRef}. Official QR tickets have been activated and issued.`,
      };
    } catch (err: any) {
      console.error('[Verify MTN Admin Exception]', err?.message || err);
      return { success: false, message: 'Server error while verifying MTN payment.' };
    }
  },

  /**
   * Admin Rejection of MTN Merchant Payment:
   * Called if transaction ID is invalid, fake, unconfirmed, or underpaid.
   * Marks order as 'failed' and releases reserved tickets back to available capacity immediately.
   */
  async rejectMtnPaymentAdmin(params: {
    orderRef: string;
    reason: string;
    adminName?: string;
  }): Promise<{ success: boolean; message: string }> {
    const { orderRef, reason, adminName = 'Admin' } = params;

    const { client } = getSupabaseClient();
    if (!client) {
      return { success: false, message: 'Database offline.' };
    }

    try {
      // 0. Update memory tracking record
      const memSub = _mtnSubmissionsByOrderRef.get(orderRef);
      if (memSub) {
        memSub.verificationStatus = 'rejected';
        memSub.rejectionReason = reason.trim() || 'Payment not matched in MTN merchant account.';
      }

      // 1. Update order status to failed / rejected
      await client
        .from('orders')
        .update({
          status: 'failed',
          verification_status: 'rejected',
          rejection_reason: reason.trim() || 'Payment not matched in MTN merchant account.',
          verified_by: adminName,
        })
        .eq('order_ref', orderRef);

      // 2. Release reserved tickets back to inventory
      let { error: releaseErr } = await client
        .from('tickets')
        .update({
          status: 'available',
          payment_status: 'unpaid',
          buyer_name: null,
          buyer_email: null,
          buyer_phone: null,
          order_ref: null,
          reserved_until: null,
          mtn_transaction_id: null,
        })
        .eq('order_ref', orderRef)
        .eq('status', 'reserved');

      if (releaseErr && (releaseErr.code === 'PGRST204' || releaseErr.code === '42703')) {
        await client
          .from('tickets')
          .update({
            status: 'available',
            payment_status: 'unpaid',
            buyer_name: null,
            buyer_email: null,
            buyer_phone: null,
            order_ref: null,
            reserved_until: null,
          })
          .eq('order_ref', orderRef)
          .eq('status', 'reserved');
      }

      return {
        success: true,
        message: `Order ${orderRef} rejected (${reason}). Reserved tickets released back to available inventory.`,
      };
    } catch (err: any) {
      console.error('[Reject MTN Admin Exception]', err?.message || err);
      return { success: false, message: 'Error rejecting order.' };
    }
  },

  /**
   * Uganda Mobile Money Checkout Initiation (MTN MoMo & Airtel Money)
   * 1. Validates inputs & calculates trusted server price (UGX 20,000 Ordinary, UGX 50,000 VIP)
   * 2. Atomically reserves tickets in Supabase with a 10-minute expiry
   * 3. Triggers Relworx Mobile Money Request-Payment push to customer handset
   */
  async initiateRelworxPayment(params: {
    category: 'VIP' | 'ORDINARY';
    quantity: number;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
    network: PaymentNetwork;
    idempotencyKey?: string;
  }): Promise<InitiationResult> {
    const { category, quantity, buyerName, buyerEmail, buyerPhone, network, idempotencyKey } = params;

    if (!quantity || quantity < 1 || quantity > 10) {
      return {
        success: false,
        message: 'Invalid ticket quantity (minimum 1, maximum 10).',
        error: 'VALIDATION_ERROR',
        retryable: false,
      };
    }

    if (category !== 'VIP' && category !== 'ORDINARY') {
      return {
        success: false,
        message: 'Invalid ticket category. Must be VIP or ORDINARY.',
        error: 'VALIDATION_ERROR',
        retryable: false,
      };
    }

    if (network !== 'MTN' && network !== 'AIRTEL') {
      return {
        success: false,
        message: 'Invalid mobile money network. Must be MTN or AIRTEL.',
        error: 'VALIDATION_ERROR',
        retryable: false,
      };
    }

    if (!buyerName || buyerName.trim().length < 2) {
      return {
        success: false,
        message: 'Please provide the attendee full name.',
        error: 'VALIDATION_ERROR',
        retryable: false,
      };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!buyerEmail || !emailRegex.test(buyerEmail.trim())) {
      return {
        success: false,
        message: 'Please provide a valid email address.',
        error: 'VALIDATION_ERROR',
        retryable: false,
      };
    }

    const phoneCheck = RelworxService.formatUgandaMsisdn(buyerPhone);
    if (!phoneCheck.valid) {
      return {
        success: false,
        message: 'Please enter a valid Uganda Mobile Money phone number (e.g. 0775 198 484).',
        error: 'VALIDATION_ERROR',
        retryable: false,
      };
    }

    // 1. Check database and payment gateway configuration BEFORE locking inventory
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        message: configError || 'Ticketing database is currently unavailable. Please try again later.',
        error: 'SUPABASE_NOT_CONFIGURED',
        retryable: true,
      };
    }

    if (!RelworxService.isConfigured()) {
      return {
        success: false,
        message: CUSTOMER_PAYMENTS_UNAVAILABLE_MESSAGE,
        error: 'RELWORX_NOT_CONFIGURED',
        code: 'PROVIDER_NOT_CONFIGURED',
        retryable: true,
      };
    }

    // 2. Do NOT lock tickets or repeatedly call Relworx while API_DISABLED cooldown is active
    const disabledCooldown = RelworxService.getDisabledCooldownRemainingSeconds();
    if (disabledCooldown > 0) {
      return {
        success: false,
        message: CUSTOMER_PAYMENTS_UNAVAILABLE_MESSAGE,
        error: 'PAYMENT_PROVIDER_UNAVAILABLE',
        code: 'API_DISABLED',
        retryable: true,
        retryAfterSeconds: disabledCooldown,
      };
    }

    // 3. Deduplicate rapid/concurrent retries for the same idempotencyKey or buyer+tier+quantity
    const cleanIdempotencyKey =
      typeof idempotencyKey === 'string' && idempotencyKey.trim().length >= 8
        ? idempotencyKey.trim().slice(0, 80)
        : undefined;

    if (cleanIdempotencyKey) {
      const cached = _recentIdempotencyResults.get(cleanIdempotencyKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
      }
      _recentIdempotencyResults.delete(cleanIdempotencyKey);
    }

    const dedupeLockKey = cleanIdempotencyKey || `${phoneCheck.msisdn}|${category}|${quantity}|${network}`;
    const existingInFlight = _inFlightInitiations.get(dedupeLockKey);
    if (existingInFlight) {
      return existingInFlight;
    }

    const executionPromise = this._executeRelworxInitiation({
      client,
      category,
      quantity,
      buyerName: buyerName.trim(),
      buyerEmail: buyerEmail.trim(),
      buyerPhone: buyerPhone.trim(),
      msisdn: phoneCheck.msisdn,
      localPhone: phoneCheck.local,
      network,
    });

    _inFlightInitiations.set(dedupeLockKey, executionPromise);

    try {
      const result = await executionPromise;
      // Cache successful pending order initiation briefly for idempotencyKey network retries
      if (cleanIdempotencyKey && result.success && result.orderRef) {
        _recentIdempotencyResults.set(cleanIdempotencyKey, {
          expiresAt: Date.now() + 9 * 60 * 1000,
          result: { ...result, reusedExistingOrder: true },
        });
      }
      return result;
    } finally {
      _inFlightInitiations.delete(dedupeLockKey);
    }
  },

  /**
   * Internal execution path for Relworx checkout initiation (protected by concurrency/idempotency lock)
   */
  async _executeRelworxInitiation(params: {
    client: SupabaseClient;
    category: 'VIP' | 'ORDINARY';
    quantity: number;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
    msisdn: string;
    localPhone: string;
    network: PaymentNetwork;
  }): Promise<InitiationResult> {
    const { client, category, quantity, buyerName, buyerEmail, buyerPhone, msisdn, localPhone, network } = params;

    // Trusted prices enforced strictly on server — never trust client submission
    const unitPrice = category === 'VIP' ? 50000 : 20000;
    const totalAmount = unitPrice * quantity;

    // Release any stale expired reservations first
    await this.releaseExpiredReservations();

    // Prevent duplicate active orders & duplicate charges if buyer retries while a prompt is already live
    const reusableOrder = await this.findReusableActivePendingOrder(client, {
      buyerPhone,
      msisdn,
      localPhone,
      category,
      quantity,
    });

    if (reusableOrder) {
      return reusableOrder;
    }

    // Generate unique order reference (8-36 alphanumeric/hyphen characters)
    const timestamp = Date.now();
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderRef = `PP-RWX-${timestamp}-${randomSuffix}`;
    const reservedUntil = new Date(timestamp + 10 * 60 * 1000).toISOString();

    // 1. Reserve tickets & create pending order atomically (never paid before verification)
    let reservedViaRpc = false;
    try {
      const { data: rpcRes, error: rpcErr } = await client.rpc('reserve_tickets_atomic', {
        p_category: category,
        p_quantity: quantity,
        p_buyer_name: buyerName,
        p_buyer_email: buyerEmail,
        p_buyer_phone: buyerPhone,
        p_order_ref: orderRef,
        p_reserved_until: reservedUntil,
        p_network: network,
        p_unit_price: unitPrice,
        p_total_amount: totalAmount,
      });

      if (!rpcErr && rpcRes) {
        if (!rpcRes.success) {
          return {
            success: false,
            message: rpcRes.message || `Insufficient ${category} tickets available.`,
            error: 'INSUFFICIENT_INVENTORY',
            retryable: false,
          };
        }
        reservedViaRpc = true;
      } else if (rpcErr && !isMissingRpcError(rpcErr)) {
        if (!isMissingRelationError(rpcErr, 'orders')) {
          console.error('[Supabase reserve_tickets_atomic Error]', rpcErr.code, sanitizeDiagnosticText(rpcErr.message));
          const classified = classifySchemaError(
            rpcErr,
            'Could not reserve tickets in the database. Please ensure the latest Supabase schema migration has been applied.'
          );
          return {
            success: false,
            message: classified.message,
            error: classified.error,
            retryable: true,
          };
        }
      }
    } catch (rpcException: any) {
      console.warn('[Supabase RPC Exception, falling back to direct reservation]', sanitizeDiagnosticText(rpcException?.message));
    }

    if (!reservedViaRpc) {
      const directResult = await this.reserveTicketsDirect(
        category,
        quantity,
        buyerName,
        buyerEmail,
        buyerPhone,
        orderRef,
        reservedUntil,
        network,
        unitPrice,
        totalAmount
      );
      if (!directResult.success) {
        return {
          success: false,
          message: directResult.message,
          error: directResult.error || 'DATABASE_ERROR',
          retryable: directResult.error !== 'INSUFFICIENT_INVENTORY',
        };
      }
    }

    // 2. Call Relworx Payments API once (never retries a disabled API)
    const relworxRes = await RelworxService.requestPayment({
      reference: orderRef,
      phone: buyerPhone,
      amount: totalAmount,
      description: `Pool Party 2026 - ${quantity}x ${category} Pass`,
      category,
      buyerName,
    });

    if (!relworxRes.success) {
      // Immediately release ticket reservation and mark order 'failed' so tickets are NEVER left reserved
      await this.releaseReservationByOrderRef(orderRef, 'failed');
      return {
        success: false,
        message: relworxRes.message || CUSTOMER_PAYMENTS_UNAVAILABLE_MESSAGE,
        error: relworxRes.error || 'RELWORX_REQUEST_FAILED',
        code: relworxRes.code,
        retryable: relworxRes.retryable ?? true,
        retryAfterSeconds: relworxRes.retryAfterSeconds,
      };
    }

    const internalRef = relworxRes.internal_reference || null;
    if (internalRef) {
      try {
        await client
          .from('orders')
          .update({ relworx_internal_ref: internalRef })
          .eq('order_ref', orderRef);

        await client
          .from('tickets')
          .update({ relworx_internal_ref: internalRef })
          .eq('order_ref', orderRef);
      } catch {
        console.warn('[Supabase] Could not attach relworx_internal_ref for order', orderRef);
      }
    }

    return {
      success: true,
      orderRef,
      message: relworxRes.message || 'Payment prompt initiated. Check your phone to enter PIN.',
      relworxInternalRef: internalRef,
      reservedUntil,
      totalAmountUgx: totalAmount,
      gateway: 'relworx',
    };
  },

  /**
   * Checks if the same buyer already has a non-expired pending order for the same tier & quantity.
   * Reuses an active live prompt instead of creating duplicate orders or pushing a second charge,
   * and cleans up any uninitiated/failed stale reservation automatically.
   */
  async findReusableActivePendingOrder(
    client: SupabaseClient,
    params: {
      buyerPhone: string;
      msisdn: string;
      localPhone: string;
      category: 'VIP' | 'ORDINARY';
      quantity: number;
    }
  ): Promise<InitiationResult | null> {
    const nowIso = new Date().toISOString();
    try {
      const phoneCandidates = Array.from(new Set([params.buyerPhone, params.msisdn, params.localPhone]));
      const { data: pendingOrders, error } = await client
        .from('orders')
        .select('*')
        .eq('status', 'pending')
        .eq('category', params.category)
        .eq('quantity', params.quantity)
        .in('buyer_phone', phoneCandidates)
        .gt('reserved_until', nowIso)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error || !pendingOrders || pendingOrders.length === 0) {
        return null;
      }

      const existing = pendingOrders[0];

      // If no provider reference was ever recorded, this was an incomplete initiation — release it cleanly
      if (!existing.relworx_internal_ref) {
        await this.releaseReservationByOrderRef(existing.order_ref, 'failed');
        return null;
      }

      // Verify with Relworx whether the earlier prompt is still pending or already failed
      if (RelworxService.getDisabledCooldownRemainingSeconds() === 0) {
        const statusCheck = await RelworxService.checkRequestStatus({
          internalReference: existing.relworx_internal_ref,
          reference: existing.order_ref,
        });

        if (statusCheck.status === 'failed') {
          await this.releaseReservationByOrderRef(existing.order_ref, 'failed');
          return null;
        }

        if (statusCheck.success && statusCheck.status === 'success') {
          await this.markOrderAsPaid(existing.order_ref, {
            relworx: statusCheck,
            relworx_internal_ref: statusCheck.internal_reference,
          });
        }
      }

      return {
        success: true,
        orderRef: existing.order_ref,
        message: 'Resuming your active Mobile Money payment request. Check your phone to approve.',
        relworxInternalRef: existing.relworx_internal_ref,
        reservedUntil: existing.reserved_until,
        totalAmountUgx: existing.total_amount_ugx,
        gateway: 'relworx',
        reusedExistingOrder: true,
      };
    } catch {
      return null;
    }
  },

  /**
   * Direct reservation against Supabase tables with strict rollback on partial/order failure
   */
  async reserveTicketsDirect(
    category: 'VIP' | 'ORDINARY',
    quantity: number,
    buyerName: string,
    buyerEmail: string,
    buyerPhone: string,
    orderRef: string,
    reservedUntil: string,
    network: PaymentNetwork,
    unitPrice: number,
    totalAmount: number
  ): Promise<{ success: boolean; message: string; error?: string }> {
    const { client } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        message: 'Ticketing database is not connected.',
        error: 'SUPABASE_NOT_CONFIGURED',
      };
    }

    try {
      const { data: available, error: fetchErr } = await client
        .from('tickets')
        .select('id, ticket_number')
        .eq('category', category)
        .eq('status', 'available')
        .order('ticket_number', { ascending: true })
        .limit(quantity);

      if (fetchErr) {
        console.error('[Supabase reserveTicketsDirect fetchErr]', fetchErr.code, sanitizeDiagnosticText(fetchErr.message));
        return {
          success: false,
          message: 'Unable to read available ticket inventory.',
          error: 'DATABASE_ERROR',
        };
      }

      if (!available || available.length < quantity) {
        return {
          success: false,
          message: `Insufficient tickets available. Only ${available?.length || 0} ${category} pass(es) currently remaining.`,
          error: 'INSUFFICIENT_INVENTORY',
        };
      }

      const allocatedTicketIds = available.map((t) => t.id);

      const { data: lockedRows, error: lockErr } = await client
        .from('tickets')
        .update({
          status: 'reserved',
          payment_status: 'pending',
          buyer_name: buyerName.trim(),
          buyer_email: buyerEmail.trim(),
          buyer_phone: buyerPhone.trim(),
          order_ref: orderRef,
          reserved_until: reservedUntil,
        })
        .in('id', allocatedTicketIds)
        .eq('status', 'available')
        .select('id');

      if (lockErr) {
        console.error('[Supabase reserveTicketsDirect lockErr]', lockErr.code, sanitizeDiagnosticText(lockErr.message));
        const classified = classifySchemaError(
          lockErr,
          'Could not lock ticket reservation in database. Ensure order_ref and reserved_until exist on public.tickets.'
        );
        return {
          success: false,
          message: classified.message,
          error: classified.error,
        };
      }

      if (!lockedRows || lockedRows.length < quantity) {
        await this.releaseReservationByOrderRef(orderRef);
        return {
          success: false,
          message: 'Those passes were just claimed by another guest. Please try again.',
          error: 'INSUFFICIENT_INVENTORY',
        };
      }

      const { error: orderErr } = await client.from('orders').insert({
        order_ref: orderRef,
        category,
        quantity,
        unit_price_ugx: unitPrice,
        total_amount_ugx: totalAmount,
        status: 'pending',
        payment_method: 'relworx_mobile_money',
        network,
        buyer_name: buyerName.trim(),
        buyer_email: buyerEmail.trim(),
        buyer_phone: buyerPhone.trim(),
        reserved_until: reservedUntil,
      });

      if (orderErr) {
        if (isMissingRelationError(orderErr, 'orders')) {
          // Safe fallback: public.tickets already holds the 10-minute reservation, order_ref, and buyer details
          console.warn(
            `[Supabase] public.orders table not found (${orderErr.code}); tracking reservation ${orderRef} via public.tickets.`
          );
        } else {
          console.error('[Supabase orders insert error]', orderErr.code, sanitizeDiagnosticText(orderErr.message));
          await this.releaseReservationByOrderRef(orderRef);
          const classified = classifySchemaError(
            orderErr,
            'Could not create order record in database. Ensure the public.orders schema is up to date.'
          );
          return {
            success: false,
            message: classified.message,
            error: classified.error,
          };
        }
      }

      return { success: true, message: 'Tickets reserved.' };
    } catch (err: any) {
      console.error('[Supabase reserveTicketsDirect Exception]', sanitizeDiagnosticText(err?.message || ''));
      await this.releaseReservationByOrderRef(orderRef);
      return {
        success: false,
        message: 'Unexpected database error while reserving tickets.',
        error: 'DATABASE_ERROR',
      };
    }
  },

  resetDeduplicationStateForTests(): void {
    _inFlightInitiations.clear();
    _recentIdempotencyResults.clear();
  },

  /**
   * Release reservation when checkout fails initiation, is cancelled, or is declined.
   * Ensures reserved tickets are immediately returned to 'available' and order is marked 'failed'/'cancelled'.
   */
  async releaseReservationByOrderRef(
    orderRef: string,
    finalOrderStatus: 'cancelled' | 'failed' = 'cancelled'
  ): Promise<boolean> {
    // Purge any cached idempotency entry referencing this released orderRef
    for (const [key, entry] of _recentIdempotencyResults.entries()) {
      if (entry.result.orderRef === orderRef) {
        _recentIdempotencyResults.delete(key);
      }
    }

    const { client } = getSupabaseClient();
    if (!client || !orderRef) return false;

    const fullResetPayload = {
      status: 'available',
      payment_status: 'unpaid',
      buyer_name: null,
      buyer_email: null,
      buyer_phone: null,
      order_ref: null,
      reserved_until: null,
      relworx_internal_ref: null,
    };

    const minimalResetPayload = {
      status: 'available',
      payment_status: 'unpaid',
      buyer_name: null,
      buyer_email: null,
      buyer_phone: null,
      order_ref: null,
      reserved_until: null,
    };

    try {
      let { error: ticketErr } = await client
        .from('tickets')
        .update(fullResetPayload)
        .eq('order_ref', orderRef)
        .eq('status', 'reserved');

      if (ticketErr && (ticketErr.code === 'PGRST204' || ticketErr.code === '42703')) {
        const fallback = await client
          .from('tickets')
          .update(minimalResetPayload)
          .eq('order_ref', orderRef)
          .eq('status', 'reserved');
        ticketErr = fallback.error;
      } else if (ticketErr) {
        // Retry once after brief pause on transient network/PostgREST error so tickets do not stay locked
        await new Promise((resolve) => setTimeout(resolve, 200));
        const retry = await client
          .from('tickets')
          .update(minimalResetPayload)
          .eq('order_ref', orderRef)
          .eq('status', 'reserved');
        ticketErr = retry.error;
      }

      if (ticketErr) {
        console.error('[Supabase] Ticket reservation release error:', {
          orderRef,
          code: ticketErr.code,
          diagnostic: sanitizeDiagnosticText(ticketErr.message),
        });
      }

      const { error: orderUpdateErr } = await client
        .from('orders')
        .update({ status: finalOrderStatus })
        .eq('order_ref', orderRef)
        .eq('status', 'pending');

      if (orderUpdateErr && !isMissingRelationError(orderUpdateErr, 'orders')) {
        console.warn('[Supabase] Order status release warning:', {
          orderRef,
          code: orderUpdateErr.code,
        });
      }

      return !ticketErr;
    } catch (err: any) {
      console.error('[Supabase] Exception releasing reservation:', {
        orderRef,
        diagnostic: sanitizeDiagnosticText(err?.message || ''),
      });
      return false;
    }
  },

  /**
   * Check Order Status & Synchronize with Relworx
   * Only returns tickets (and their secure QR tokens) IF the order status is confirmed 'paid'!
   */
  async getOrderStatus(orderRef: string): Promise<{
    success: boolean;
    orderRef: string;
    status: OrderStatus;
    message?: string;
    tickets?: TicketRow[];
    buyerName?: string;
    category?: 'VIP' | 'ORDINARY';
    quantity?: number;
    totalAmountUgx?: number;
    reservedUntil?: string;
    secondsRemaining?: number;
    verificationStatus?: 'unsubmitted' | 'pending_verification' | 'verified' | 'rejected';
    mtnTransactionId?: string | null;
    rejectionReason?: string | null;
  }> {
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        orderRef,
        status: 'failed',
        message: configError || 'Ticketing database is currently offline.',
      };
    }

    try {
      let order: any = null;
      const { data: orderData, error: orderErr } = await client
        .from('orders')
        .select('*')
        .eq('order_ref', orderRef)
        .maybeSingle();

      if (!orderErr && orderData) {
        order = orderData;
      } else if (!orderData || isMissingRelationError(orderErr, 'orders')) {
        // Fallback: synthesize order state from reserved/issued rows in public.tickets when public.orders is absent
        const { data: orderTickets, error: ticketsFallbackErr } = await client
          .from('tickets')
          .select('*')
          .eq('order_ref', orderRef);

        if (!ticketsFallbackErr && orderTickets && orderTickets.length > 0) {
          const rows = orderTickets as TicketRow[];
          const allPaid = rows.every(
            (t) => t.status === 'issued' && (t.payment_status === 'paid' || t.payment_status === 'manual_paid')
          );
          const first = rows[0];
          order = {
            order_ref: orderRef,
            status: allPaid ? 'paid' : 'pending',
            buyer_name: first.buyer_name || 'Guest',
            category: first.category,
            quantity: rows.length,
            total_amount_ugx: rows.reduce((sum, t) => sum + Number(t.price_ugx || 0), 0),
            reserved_until: first.reserved_until || new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            relworx_internal_ref: first.relworx_internal_ref || null,
            _issuedTickets: allPaid ? rows : undefined,
          };
        }
      }

      if (!order) {
        return {
          success: false,
          orderRef,
          status: 'failed',
          message: 'Order reference not found.',
        };
      }

      if (order.status === 'paid') {
        const tickets =
          order._issuedTickets ||
          (
            await client
              .from('tickets')
              .select('*')
              .eq('order_ref', orderRef)
              .eq('status', 'issued')
          ).data;

        return {
          success: true,
          orderRef,
          status: 'paid',
          verificationStatus: order.verification_status || 'verified',
          mtnTransactionId: order.mtn_transaction_id || null,
          buyerName: order.buyer_name,
          category: order.category,
          quantity: order.quantity,
          totalAmountUgx: order.total_amount_ugx,
          tickets: (tickets as TicketRow[]) || [],
        };
      }

      if (order.status === 'failed' || order.verification_status === 'rejected') {
        return {
          success: false,
          orderRef,
          status: 'failed',
          verificationStatus: 'rejected',
          rejectionReason: order.rejection_reason || 'Payment was declined or rejected.',
          message: order.rejection_reason || 'Payment was declined or rejected.',
          tickets: [],
        };
      }

      const now = Date.now();
      const expiry = order.reserved_until ? new Date(order.reserved_until).getTime() : now + 600000;
      if (order.status === 'pending' && now > expiry) {
        await this.releaseReservationByOrderRef(orderRef);
        return {
          success: false,
          orderRef,
          status: 'expired',
          verificationStatus: order.verification_status || 'unsubmitted',
          message: 'Your 15-minute reservation window has expired. The tickets have been returned to available inventory.',
          tickets: [],
        };
      }

      if (order.status === 'pending' && RelworxService.isConfigured() && order.gateway === 'relworx') {
        try {
          const relCheck = await RelworxService.checkRequestStatus({
            internalReference: order.relworx_internal_ref || undefined,
            reference: orderRef,
          });

          if (relCheck.success && relCheck.status === 'success') {
            await this.markOrderAsPaid(orderRef, {
              relworx: relCheck,
              relworx_internal_ref: relCheck.internal_reference,
            });
            return await this.getOrderStatus(orderRef);
          } else if (relCheck.status === 'failed') {
            await this.releaseReservationByOrderRef(orderRef);
            return {
              success: false,
              orderRef,
              status: 'failed',
              verificationStatus: 'rejected',
              message: relCheck.message || 'Payment prompt was cancelled or declined on handset.',
              tickets: [],
            };
          }
        } catch (err) {
          console.warn('Error polling Relworx status:', err);
        }
      }

      const secondsRemaining = Math.max(0, Math.floor((expiry - now) / 1000));
      const memSub = _mtnSubmissionsByOrderRef.get(orderRef);

      return {
        success: true,
        orderRef,
        status: order.status,
        verificationStatus: order.verification_status || memSub?.verificationStatus || 'unsubmitted',
        mtnTransactionId: order.mtn_transaction_id || memSub?.mtnTransactionId || null,
        rejectionReason: order.rejection_reason || memSub?.rejectionReason || null,
        buyerName: order.buyer_name,
        category: order.category,
        quantity: order.quantity,
        totalAmountUgx: order.total_amount_ugx,
        reservedUntil: order.reserved_until,
        secondsRemaining,
        tickets: [],
      };
    } catch {
      return {
        success: false,
        orderRef,
        status: 'failed',
        message: 'Unable to check order status right now.',
      };
    }
  },

  /**
   * Idempotently mark order and its reserved tickets as PAID and ISSUED in Supabase
   */
  async markOrderAsPaid(orderRef: string, paymentData?: any): Promise<boolean> {
    const { client } = getSupabaseClient();
    if (!client) return false;

    const flwTxId = paymentData?.id ? String(paymentData.id) : null;
    const internalRef =
      paymentData?.relworx_internal_ref ||
      paymentData?.relworx?.internal_reference ||
      paymentData?.flw_ref ||
      null;

    try {
      const { data: rpcRes, error: rpcErr } = await client.rpc('mark_order_paid_atomic', {
        p_order_ref: orderRef,
        p_relworx_internal_ref: internalRef,
        p_flw_transaction_id: flwTxId,
      });

      if (!rpcErr && rpcRes && rpcRes.success) {
        return true;
      }
    } catch {
      // Fallback to direct table updates
    }

    const now = new Date().toISOString();

    try {
      const { data: existingOrder } = await client
        .from('orders')
        .select('status')
        .eq('order_ref', orderRef)
        .maybeSingle();

      if (existingOrder && existingOrder.status === 'paid') {
        return true;
      }

      const ticketUpdate: Record<string, any> = {
        status: 'issued',
        payment_status: 'paid',
        paid_at: now,
      };
      if (internalRef) ticketUpdate.relworx_internal_ref = internalRef;

      const { error: tErr } = await client
        .from('tickets')
        .update(ticketUpdate)
        .eq('order_ref', orderRef);

      if (tErr) {
        console.error('Failed to mark tickets as paid in Supabase:', tErr.code, tErr.message);
        return false;
      }

      const orderUpdate: Record<string, any> = {
        status: 'paid',
        paid_at: now,
      };
      if (internalRef) orderUpdate.relworx_internal_ref = internalRef;

      const { error: oErr } = await client
        .from('orders')
        .update(orderUpdate)
        .eq('order_ref', orderRef);

      if (oErr) {
        console.error('Failed to mark order as paid in Supabase:', oErr.code, oErr.message);
      }

      return true;
    } catch (err) {
      console.error('Error marking order as paid in Supabase:', err);
      return false;
    }
  },

  /**
   * Admin manual verification of an order with Relworx
   */
  async verifyRelworxOrderDirectly(orderRef: string): Promise<{ success: boolean; message: string }> {
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return { success: false, message: configError || 'Supabase database is not connected.' };
    }

    let order: { relworx_internal_ref?: string | null; status?: string } | null = null;
    const { data: orderRow, error: orderErr } = await client
      .from('orders')
      .select('relworx_internal_ref, status')
      .eq('order_ref', orderRef)
      .maybeSingle();

    if (!orderErr && orderRow) {
      order = orderRow;
    } else if (!orderRow || isMissingRelationError(orderErr, 'orders')) {
      const { data: ticketRows } = await client
        .from('tickets')
        .select('relworx_internal_ref, status, payment_status')
        .eq('order_ref', orderRef);

      if (ticketRows && ticketRows.length > 0) {
        const allPaid = ticketRows.every(
          (t) => t.status === 'issued' && (t.payment_status === 'paid' || t.payment_status === 'manual_paid')
        );
        order = {
          relworx_internal_ref: ticketRows[0].relworx_internal_ref,
          status: allPaid ? 'paid' : 'pending',
        };
      }
    }

    if (!order) {
      return { success: false, message: 'Order reference not found in database.' };
    }

    if (order.status === 'paid') {
      return { success: true, message: 'Order is already confirmed and paid.' };
    }

    const check = await RelworxService.checkRequestStatus({
      internalReference: order.relworx_internal_ref || undefined,
      reference: orderRef,
    });

    if (check.status === 'success') {
      await this.markOrderAsPaid(orderRef, { relworx: check, relworx_internal_ref: check.internal_reference });
      return { success: true, message: 'Relworx confirmed payment! Tickets successfully issued.' };
    }

    return {
      success: false,
      message: `Relworx status is currently "${check.status}". ${check.message || ''}`,
    };
  },

  /**
   * Lookup purchased tickets by contact phone or order reference
   * Strictly returns only ISSUED & PAID tickets from Supabase
   */
  async lookupTicketsByContact(contact: string): Promise<TicketRow[]> {
    const { client } = getSupabaseClient();
    if (!client) {
      return [];
    }

    const clean = contact.trim().replace(/[\s-]/g, '');

    try {
      const { data, error } = await client
        .from('tickets')
        .select('*')
        .or(`buyer_phone.ilike.%${clean}%,order_ref.eq.${clean}`)
        .eq('status', 'issued')
        .in('payment_status', ['paid', 'manual_paid']);

      if (!error && data) {
        return data as TicketRow[];
      }
    } catch (err) {
      console.warn('Error looking up tickets in Supabase:', err);
    }

    return [];
  },

  /**
   * Atomic Gate Check-in: Checks qr_token or ticket_number, enforces paid & unused
   */
  async verifyAndCheckIn(tokenOrNumber: string): Promise<{
    status: 'ADMITTED' | 'ALREADY_USED' | 'UNPAID' | 'NOT_ISSUED' | 'CANCELLED' | 'INVALID';
    message: string;
    ticket?: TicketRow;
    checkedInAt?: string;
  }> {
    const { client } = getSupabaseClient();
    if (!client) {
      return {
        status: 'INVALID',
        message: 'Database offline. Check-in system requires active Supabase connection.',
      };
    }

    const clean = tokenOrNumber.trim();

    try {
      const { data: rpcRes, error: rpcErr } = await client.rpc('gate_checkin_atomic', {
        p_token_or_number: clean,
      });

      if (!rpcErr && rpcRes && rpcRes.status) {
        return rpcRes;
      }
    } catch {
      // Proceed to direct table update
    }

    try {
      const { data, error } = await client
        .from('tickets')
        .select('*')
        .or(`qr_token.eq.${clean},ticket_number.eq.${clean}`)
        .maybeSingle();

      if (error || !data) {
        return {
          status: 'INVALID',
          message: 'Invalid or unrecognized QR token / ticket number.',
        };
      }

      const ticket = data as TicketRow;

      if (ticket.status === 'cancelled') {
        return {
          status: 'CANCELLED',
          message: `Ticket ${ticket.ticket_number} has been cancelled or revoked. Deny entry.`,
          ticket,
        };
      }

      if (ticket.status !== 'issued' || (ticket.payment_status !== 'paid' && ticket.payment_status !== 'manual_paid')) {
        return {
          status: 'UNPAID',
          message: `Ticket ${ticket.ticket_number} is unpaid (${ticket.status}). Payment required.`,
          ticket,
        };
      }

      if (ticket.checked_in_at) {
        return {
          status: 'ALREADY_USED',
          message: `DUPLICATE: Already used at ${new Date(ticket.checked_in_at).toLocaleTimeString()}.`,
          ticket,
          checkedInAt: ticket.checked_in_at,
        };
      }

      const now = new Date().toISOString();
      const { data: updated, error: updateErr } = await client
        .from('tickets')
        .update({ checked_in_at: now })
        .eq('id', ticket.id)
        .is('checked_in_at', null)
        .select()
        .single();

      if (updateErr || !updated) {
        return {
          status: 'ALREADY_USED',
          message: 'Duplicate scan detected. This ticket was just admitted.',
          ticket,
        };
      }

      return {
        status: 'ADMITTED',
        message: `ADMITTED: Welcome to Pool Party, ${updated.buyer_name || 'Guest'}! (${updated.category} Pass #${updated.ticket_number})`,
        ticket: updated as TicketRow,
        checkedInAt: now,
      };
    } catch {
      return {
        status: 'INVALID',
        message: 'Unable to complete check-in verification right now.',
      };
    }
  },

  /**
   * Admin Operations (Secure Server-Side with Supabase)
   */
  async getAllTicketsAdmin(): Promise<{ success: boolean; tickets: TicketRow[]; error?: string }> {
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return { success: false, tickets: [], error: configError || 'Database not connected.' };
    }

    try {
      const { data, error } = await client
        .from('tickets')
        .select('*')
        .order('ticket_number', { ascending: true });

      if (error) {
        return { success: false, tickets: [], error: 'Unable to fetch tickets from database.' };
      }

      return { success: true, tickets: (data as TicketRow[]) || [] };
    } catch {
      return { success: false, tickets: [], error: 'Database query failed.' };
    }
  },

  async getAllOrdersAdmin(): Promise<{ success: boolean; orders: OrderRow[]; error?: string }> {
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return { success: false, orders: [], error: configError || 'Database not connected.' };
    }

    try {
      const { data, error } = await client
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error && isMissingRelationError(error, 'orders')) {
        // Synthesize orders from tickets table and memory submissions
        const { data: ticketRows } = await client
          .from('tickets')
          .select('*')
          .not('order_ref', 'is', null);

        const orderMap = new Map<string, any>();
        if (ticketRows) {
          for (const t of ticketRows) {
            const ref = t.order_ref;
            if (!ref) continue;
            if (!orderMap.has(ref)) {
              const mtnSub = _mtnSubmissionsByOrderRef.get(ref);
              const isPaid = t.status === 'issued' && (t.payment_status === 'paid' || t.payment_status === 'manual_paid');
              orderMap.set(ref, {
                id: ref,
                order_ref: ref,
                category: t.category,
                quantity: 1,
                unit_price_ugx: t.price_ugx,
                total_amount_ugx: t.price_ugx,
                status: isPaid ? 'paid' : t.status === 'cancelled' ? 'cancelled' : 'pending',
                verification_status: mtnSub?.verificationStatus || (isPaid ? 'verified' : 'unsubmitted'),
                mtn_transaction_id: mtnSub?.mtnTransactionId || t.mtn_transaction_id || null,
                payer_phone: mtnSub?.payerPhone || t.buyer_phone || null,
                verified_at: mtnSub?.verifiedAt || t.paid_at || null,
                verified_by: mtnSub?.verifiedBy || null,
                rejection_reason: mtnSub?.rejectionReason || null,
                payment_method: 'mtn_momo',
                network: 'MTN',
                buyer_name: t.buyer_name || 'Guest',
                buyer_email: t.buyer_email || '',
                buyer_phone: t.buyer_phone || '',
                created_at: mtnSub?.submittedAt || t.created_at || new Date().toISOString(),
                reserved_until: t.reserved_until,
              });
            } else {
              const ord = orderMap.get(ref);
              ord.quantity += 1;
              ord.total_amount_ugx += t.price_ugx;
            }
          }
        }

        // Add any memory submissions not in query
        for (const [ref, sub] of _mtnSubmissionsByOrderRef.entries()) {
          if (!orderMap.has(ref)) {
            orderMap.set(ref, {
              id: ref,
              order_ref: ref,
              category: 'ORDINARY',
              quantity: 1,
              unit_price_ugx: 20000,
              total_amount_ugx: 20000,
              status: sub.verificationStatus === 'verified' ? 'paid' : 'pending',
              verification_status: sub.verificationStatus,
              mtn_transaction_id: sub.mtnTransactionId,
              payer_phone: sub.payerPhone,
              verified_at: sub.verifiedAt || null,
              verified_by: sub.verifiedBy || null,
              rejection_reason: sub.rejectionReason || null,
              payment_method: 'mtn_momo',
              network: 'MTN',
              buyer_name: 'Guest',
              buyer_email: '',
              buyer_phone: sub.payerPhone,
              created_at: sub.submittedAt,
            });
          }
        }

        const synthList = Array.from(orderMap.values()).sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        return { success: true, orders: synthList as OrderRow[] };
      }

      if (error) {
        return { success: false, orders: [], error: 'Unable to fetch orders from database.' };
      }

      // Enrich orders with memory submissions if columns are null
      const enriched = ((data as OrderRow[]) || []).map((ord) => {
        const sub = _mtnSubmissionsByOrderRef.get(ord.order_ref);
        if (sub) {
          return {
            ...ord,
            verification_status: ord.verification_status || sub.verificationStatus,
            mtn_transaction_id: ord.mtn_transaction_id || sub.mtnTransactionId,
            payer_phone: ord.payer_phone || sub.payerPhone,
            verified_at: ord.verified_at || sub.verifiedAt,
            verified_by: ord.verified_by || sub.verifiedBy,
            rejection_reason: ord.rejection_reason || sub.rejectionReason,
          };
        }
        return ord;
      });

      return { success: true, orders: enriched };
    } catch {
      return { success: false, orders: [], error: 'Database query failed.' };
    }
  },

  async recordPhysicalSaleAdmin(params: {
    category: 'VIP' | 'ORDINARY';
    quantity: number;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
  }): Promise<{ success: boolean; message: string; tickets?: TicketRow[] }> {
    const { category, quantity, buyerName, buyerEmail, buyerPhone } = params;

    const { client, configError } = getSupabaseClient();
    if (!client) {
      return { success: false, message: configError || 'Database is offline. Connect Supabase to record sales.' };
    }

    await this.releaseExpiredReservations();

    try {
      const { data: available, error: fetchErr } = await client
        .from('tickets')
        .select('*')
        .eq('category', category)
        .eq('status', 'available')
        .order('ticket_number', { ascending: true })
        .limit(quantity);

      if (fetchErr || !available || available.length < quantity) {
        return {
          success: false,
          message: `Sold out! Only ${available?.length || 0} ${category} ticket(s) remaining.`,
        };
      }

      const idsToUpdate = available.map((t) => t.id);
      const now = new Date().toISOString();
      const orderRef = `PP-BOX-${Date.now()}`;
      const unitPrice = category === 'VIP' ? 50000 : 20000;
      const totalAmount = unitPrice * quantity;

      const { data: updated, error: updateErr } = await client
        .from('tickets')
        .update({
          status: 'issued',
          payment_status: 'manual_paid',
          buyer_name: buyerName.trim(),
          buyer_email: buyerEmail.trim(),
          buyer_phone: buyerPhone.trim(),
          order_ref: orderRef,
          paid_at: now,
        })
        .in('id', idsToUpdate)
        .eq('status', 'available')
        .select();

      if (updateErr || !updated || updated.length < quantity) {
        return { success: false, message: 'Could not issue physical ticket(s) in database.' };
      }

      await client.from('orders').insert({
        order_ref: orderRef,
        category,
        quantity,
        unit_price_ugx: unitPrice,
        total_amount_ugx: totalAmount,
        status: 'paid',
        payment_method: 'box_office_cash',
        buyer_name: buyerName.trim(),
        buyer_email: buyerEmail.trim(),
        buyer_phone: buyerPhone.trim(),
        paid_at: now,
      });

      return {
        success: true,
        message: `Issued ${quantity} physical ${category} ticket(s).`,
        tickets: updated as TicketRow[],
      };
    } catch {
      return { success: false, message: 'Database error recording physical sale.' };
    }
  },

  async confirmPaymentAdmin(ticketId: string): Promise<boolean> {
    const { client } = getSupabaseClient();
    if (!client) return false;

    const now = new Date().toISOString();
    try {
      const { data: ticket } = await client
        .from('tickets')
        .select('order_ref')
        .eq('id', ticketId)
        .single();

      const { error } = await client
        .from('tickets')
        .update({
          status: 'issued',
          payment_status: 'paid',
          paid_at: now,
        })
        .eq('id', ticketId);

      if (!error && ticket?.order_ref) {
        await client
          .from('orders')
          .update({ status: 'paid', paid_at: now })
          .eq('order_ref', ticket.order_ref);
      }

      return !error;
    } catch {
      return false;
    }
  },

  async releaseTicketAdmin(ticketId: string): Promise<boolean> {
    const { client } = getSupabaseClient();
    if (!client) return false;

    try {
      const { error } = await client
        .from('tickets')
        .update({
          status: 'available',
          payment_status: 'unpaid',
          buyer_name: null,
          buyer_email: null,
          buyer_phone: null,
          order_ref: null,
          reserved_until: null,
          paid_at: null,
          checked_in_at: null,
        })
        .eq('id', ticketId);

      return !error;
    } catch {
      return false;
    }
  },
};
