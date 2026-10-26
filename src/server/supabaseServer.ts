import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { RelworxService } from './relworxService';
import { OrderRecord, OrderStatus, PaymentNetwork } from '../types/order';

dotenv.config();

// Server-side environment variables (kept strictly off the client)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const isLiveSupabaseAvailable = Boolean(
  supabaseUrl &&
  supabaseServiceRoleKey &&
  !supabaseUrl.includes('your-project') &&
  !supabaseUrl.includes('placeholder') &&
  !supabaseUrl.includes('example') &&
  supabaseUrl.startsWith('https://') &&
  supabaseServiceRoleKey.length > 20 &&
  !supabaseServiceRoleKey.includes('your-supabase-service-role-key')
);

// Create Supabase Admin client with service-role key (Bypasses RLS safely on server only)
export const supabaseAdmin: SupabaseClient | null = isLiveSupabaseAvailable
  ? createClient(supabaseUrl!, supabaseServiceRoleKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

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
  relworx_internal_ref?: string | null;
  flw_transaction_id?: string | null;
}

export type OrderRow = OrderRecord;

export const SupabaseServerService = {
  /**
   * Health Check: Test connection to live Supabase project
   */
  async checkConnection(): Promise<{ connected: boolean; count: number; error?: string }> {
    if (!supabaseAdmin) {
      return {
        connected: false,
        count: 0,
        error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured with valid Supabase project credentials in environment.',
      };
    }

    try {
      const { count, error } = await supabaseAdmin
        .from('tickets')
        .select('*', { count: 'exact', head: true });

      if (error) {
        return { connected: false, count: 0, error: error.message };
      }

      return { connected: true, count: count ?? 0 };
    } catch (err: any) {
      return { connected: false, count: 0, error: err?.message || 'Connection to Supabase failed.' };
    }
  },

  /**
   * Safe Atomic Cleanup: Release 10-Minute Expired Unpaid Reservations
   * Ensures capacity returns to 'available' automatically if customer doesn't pay
   */
  async releaseExpiredReservations(): Promise<number> {
    if (!supabaseAdmin) {
      return 0;
    }

    // Try PostgreSQL stored procedure first
    try {
      const { data: rpcCount, error: rpcErr } = await supabaseAdmin.rpc('release_expired_ticket_reservations');
      if (!rpcErr && typeof rpcCount === 'number') {
        return rpcCount;
      }
    } catch {
      // Proceed to direct table update fallback
    }

    const nowIso = new Date().toISOString();

    try {
      // Update tickets whose reservation period has expired
      const { data: expiredTickets, error: tErr } = await supabaseAdmin
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

      if (!tErr && expiredTickets && expiredTickets.length > 0) {
        // Update corresponding orders to expired
        await supabaseAdmin
          .from('orders')
          .update({ status: 'expired' })
          .eq('status', 'pending')
          .lt('reserved_until', nowIso);

        return expiredTickets.length;
      }
    } catch (err) {
      console.warn('Error releasing expired reservations in Supabase:', err);
    }

    return 0;
  },

  /**
   * Public Inventory Counts ONLY: Read VIP and Ordinary availability from Supabase.
   * VIP: UGX 50,000 each; Ordinary: UGX 20,000 each.
   * Never exposes buyer details, personal phone numbers, or QR tokens.
   */
  async getPublicCounts(): Promise<{ success: boolean; counts?: PublicInventoryCounts; error?: string }> {
    if (!supabaseAdmin) {
      return {
        success: false,
        error: 'Database connection offline. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured.',
      };
    }

    // Release any expired reservations first
    await this.releaseExpiredReservations();

    try {
      const { data, error } = await supabaseAdmin
        .from('tickets')
        .select('category, status');

      if (error) {
        return { success: false, error: error.message };
      }

      if (!data) {
        return { success: false, error: 'No ticket data returned from database.' };
      }

      const vipTotal = data.filter((t) => t.category === 'VIP').length;
      const vipAvail = data.filter((t) => t.category === 'VIP' && t.status === 'available').length;

      const ordTotal = data.filter((t) => t.category === 'ORDINARY').length;
      const ordAvail = data.filter((t) => t.category === 'ORDINARY' && t.status === 'available').length;

      return {
        success: true,
        counts: {
          VIP: { total: vipTotal || 20, available: vipAvail, priceUgx: 50000 },
          ORDINARY: { total: ordTotal || 50, available: ordAvail, priceUgx: 20000 },
          totalAvailable: vipAvail + ordAvail,
          isLiveSupabase: true,
        },
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Database query error' };
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
  }): Promise<{
    success: boolean;
    orderRef?: string;
    message: string;
    relworxInternalRef?: string | null;
    reservedUntil?: string;
    totalAmountUgx?: number;
    gateway?: 'relworx';
    error?: string;
  }> {
    const { category, quantity, buyerName, buyerEmail, buyerPhone, network } = params;

    // Validate quantities strictly
    if (!quantity || quantity < 1 || quantity > 10) {
      return { success: false, message: 'Invalid ticket quantity (minimum 1, maximum 10).' };
    }

    if (category !== 'VIP' && category !== 'ORDINARY') {
      return { success: false, message: 'Invalid ticket category. Must be VIP or ORDINARY.' };
    }

    // Trusted prices enforced strictly on server — never trust client submission
    const unitPrice = category === 'VIP' ? 50000 : 20000;
    const totalAmount = unitPrice * quantity;

    if (!supabaseAdmin) {
      return {
        success: false,
        message: 'Cannot process order: Database is not connected. Please configure Supabase credentials.',
        error: 'SUPABASE_NOT_CONFIGURED',
      };
    }

    // Release any stale expired reservations first
    await this.releaseExpiredReservations();

    // Generate unique order reference (8-36 alphanumeric characters)
    const timestamp = Date.now();
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderRef = `PP-RWX-${timestamp}-${randomSuffix}`;
    const reservedUntil = new Date(timestamp + 10 * 60 * 1000).toISOString(); // 10 minutes

    // 1. Try atomic PostgreSQL RPC if provisioned
    try {
      const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('reserve_tickets_atomic', {
        p_category: category,
        p_quantity: quantity,
        p_buyer_name: buyerName.trim(),
        p_buyer_email: buyerEmail.trim(),
        p_buyer_phone: buyerPhone.trim(),
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
            message: rpcRes.message || 'Insufficient inventory.',
          };
        }
      } else {
        // Fallback to direct atomic table updates in Supabase
        await this.reserveTicketsDirect(category, quantity, buyerName, buyerEmail, buyerPhone, orderRef, reservedUntil, network, unitPrice, totalAmount);
      }
    } catch (err: any) {
      try {
        await this.reserveTicketsDirect(category, quantity, buyerName, buyerEmail, buyerPhone, orderRef, reservedUntil, network, unitPrice, totalAmount);
      } catch (directErr: any) {
        return {
          success: false,
          message: directErr?.message || 'Database error reserving tickets.',
        };
      }
    }

    // 2. Call Relworx Payments API to push mobile money prompt to customer phone
    const relworxRes = await RelworxService.requestPayment({
      reference: orderRef,
      phone: buyerPhone.trim(),
      amount: totalAmount,
      description: `Pool Party 2026 - ${quantity}x ${category} Pass`,
      category,
      buyerName: buyerName.trim(),
    });

    if (!relworxRes.success) {
      // Immediately release reservation if Relworx rejected (e.g. API disabled or network error)
      await this.releaseReservationByOrderRef(orderRef);
      return {
        success: false,
        message: relworxRes.message || 'Relworx could not initiate payment on this phone number.',
        error: relworxRes.error || 'RELWORX_REQUEST_FAILED',
      };
    }

    const internalRef = relworxRes.internal_reference || null;
    if (internalRef) {
      try {
        await supabaseAdmin
          .from('orders')
          .update({ relworx_internal_ref: internalRef })
          .eq('order_ref', orderRef);

        await supabaseAdmin
          .from('tickets')
          .update({ relworx_internal_ref: internalRef })
          .eq('order_ref', orderRef);
      } catch (err) {
        console.warn('Could not attach relworx_internal_ref to order/tickets:', err);
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
   * Direct atomic reservation against Supabase tables
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
  ): Promise<void> {
    if (!supabaseAdmin) throw new Error('Supabase client not initialized');

    // Fetch available candidate tickets
    const { data: available, error: fetchErr } = await supabaseAdmin
      .from('tickets')
      .select('id, ticket_number')
      .eq('category', category)
      .eq('status', 'available')
      .order('ticket_number', { ascending: true })
      .limit(quantity);

    if (fetchErr) throw fetchErr;

    if (!available || available.length < quantity) {
      throw new Error(`Insufficient inventory! Only ${available?.length || 0} ${category} ticket(s) currently available.`);
    }

    const allocatedTicketIds = available.map((t) => t.id);

    // Lock candidate tickets with reservation
    const { error: lockErr } = await supabaseAdmin
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
      .eq('status', 'available'); // Atomic concurrency guard

    if (lockErr) throw lockErr;

    // Create order record in public.orders
    const { error: orderErr } = await supabaseAdmin.from('orders').insert({
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
      console.warn('Orders table insert error:', orderErr);
    }
  },

  /**
   * Release reservation when checkout is explicitly cancelled or declined
   */
  async releaseReservationByOrderRef(orderRef: string): Promise<boolean> {
    if (!supabaseAdmin) return false;

    try {
      await supabaseAdmin
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
        .eq('order_ref', orderRef)
        .eq('status', 'reserved');

      await supabaseAdmin
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('order_ref', orderRef)
        .eq('status', 'pending');

      return true;
    } catch (err) {
      console.error('Error releasing reservation in Supabase:', err);
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
  }> {
    if (!supabaseAdmin) {
      return {
        success: false,
        orderRef,
        status: 'failed',
        message: 'Database offline. SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing.',
      };
    }

    try {
      const { data: order, error: orderErr } = await supabaseAdmin
        .from('orders')
        .select('*')
        .eq('order_ref', orderRef)
        .maybeSingle();

      if (orderErr || !order) {
        return {
          success: false,
          orderRef,
          status: 'failed',
          message: 'Order reference not found in database.',
        };
      }

      // If order is confirmed paid, retrieve and return the issued tickets
      if (order.status === 'paid') {
        const { data: tickets } = await supabaseAdmin
          .from('tickets')
          .select('*')
          .eq('order_ref', orderRef)
          .eq('status', 'issued');

        return {
          success: true,
          orderRef,
          status: 'paid',
          buyerName: order.buyer_name,
          category: order.category,
          quantity: order.quantity,
          totalAmountUgx: order.total_amount_ugx,
          tickets: (tickets as TicketRow[]) || [],
        };
      }

      // Check if 10-minute reservation has expired
      const now = Date.now();
      const expiry = new Date(order.reserved_until).getTime();
      if (order.status === 'pending' && now > expiry) {
        await this.releaseReservationByOrderRef(orderRef);
        return {
          success: false,
          orderRef,
          status: 'expired',
          message: 'Your 10-minute reservation window has expired. The tickets have been returned to available inventory.',
        };
      }

      // Check Relworx status if live API is configured and order is pending
      if (order.status === 'pending' && RelworxService.isConfigured()) {
        try {
          const relCheck = await RelworxService.checkRequestStatus({
            internalReference: order.relworx_internal_ref || undefined,
            reference: orderRef,
          });

          if (relCheck.success && relCheck.status === 'success') {
            // Confirmed payment on Relworx: Mark order as paid atomically in Supabase
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
              message: relCheck.message || 'Payment prompt was cancelled or declined on handset.',
            };
          }
        } catch (err) {
          console.warn('Error polling Relworx status:', err);
        }
      }

      const secondsRemaining = Math.max(0, Math.floor((expiry - now) / 1000));

      return {
        success: true,
        orderRef,
        status: order.status,
        buyerName: order.buyer_name,
        category: order.category,
        quantity: order.quantity,
        totalAmountUgx: order.total_amount_ugx,
        reservedUntil: order.reserved_until,
        secondsRemaining,
        // Never return QR tokens for unpaid/pending orders
        tickets: [],
      };
    } catch (err: any) {
      return {
        success: false,
        orderRef,
        status: 'failed',
        message: err?.message || 'Database error checking order status.',
      };
    }
  },

  /**
   * Idempotently mark order and its reserved tickets as PAID and ISSUED in Supabase
   */
  async markOrderAsPaid(orderRef: string, paymentData?: any): Promise<boolean> {
    if (!supabaseAdmin) return false;

    const flwTxId = paymentData?.id ? String(paymentData.id) : null;
    const flwRef = paymentData?.flw_ref || paymentData?.relworx_internal_ref || paymentData?.relworx?.internal_reference || null;

    // 1. Try atomic PostgreSQL function
    try {
      const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('mark_order_paid_atomic', {
        p_order_ref: orderRef,
        p_relworx_internal_ref: flwRef,
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
      // Check if already paid (idempotency check)
      const { data: existingOrder } = await supabaseAdmin
        .from('orders')
        .select('status')
        .eq('order_ref', orderRef)
        .maybeSingle();

      if (existingOrder && existingOrder.status === 'paid') {
        return true;
      }

      // Update tickets to issued and paid
      const { error: tErr } = await supabaseAdmin
        .from('tickets')
        .update({
          status: 'issued',
          payment_status: 'paid',
          paid_at: now,
          relworx_internal_ref: flwRef,
          flw_transaction_id: flwTxId,
        })
        .eq('order_ref', orderRef);

      if (tErr) {
        console.error('Failed to mark tickets as paid in Supabase:', tErr);
      }

      // Mark order as paid in orders table
      const { error: oErr } = await supabaseAdmin
        .from('orders')
        .update({
          status: 'paid',
          paid_at: now,
          relworx_internal_ref: flwRef,
          flw_transaction_id: flwTxId,
          flw_ref: flwRef,
        })
        .eq('order_ref', orderRef);

      if (oErr) {
        console.error('Failed to mark order as paid in Supabase:', oErr);
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
    if (!supabaseAdmin) {
      return { success: false, message: 'Supabase database is not connected.' };
    }

    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('relworx_internal_ref, status')
      .eq('order_ref', orderRef)
      .maybeSingle();

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
    if (!supabaseAdmin) {
      return [];
    }

    const clean = contact.trim().replace(/[\s-]/g, '');

    try {
      const { data, error } = await supabaseAdmin
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
    if (!supabaseAdmin) {
      return {
        status: 'INVALID',
        message: 'Database offline. Check-in system requires active Supabase connection.',
      };
    }

    const clean = tokenOrNumber.trim();

    // 1. Try atomic PostgreSQL RPC function
    try {
      const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('gate_checkin_atomic', {
        p_token_or_number: clean,
      });

      if (!rpcErr && rpcRes && rpcRes.status) {
        return rpcRes;
      }
    } catch {
      // Proceed to direct table update
    }

    try {
      const { data, error } = await supabaseAdmin
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

      // Atomically set checked_in_at where it is still null
      const now = new Date().toISOString();
      const { data: updated, error: updateErr } = await supabaseAdmin
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
    } catch (err: any) {
      return {
        status: 'INVALID',
        message: err?.message || 'Database error during check-in verification',
      };
    }
  },

  /**
   * Admin Operations (Secure Server-Side with Supabase)
   */
  async getAllTicketsAdmin(): Promise<{ success: boolean; tickets: TicketRow[]; error?: string }> {
    if (!supabaseAdmin) {
      return { success: false, tickets: [], error: 'Database not connected.' };
    }

    try {
      const { data, error } = await supabaseAdmin
        .from('tickets')
        .select('*')
        .order('ticket_number', { ascending: true });

      if (error) {
        return { success: false, tickets: [], error: error.message };
      }

      return { success: true, tickets: (data as TicketRow[]) || [] };
    } catch (err: any) {
      return { success: false, tickets: [], error: err?.message };
    }
  },

  async getAllOrdersAdmin(): Promise<{ success: boolean; orders: OrderRow[]; error?: string }> {
    if (!supabaseAdmin) {
      return { success: false, orders: [], error: 'Database not connected.' };
    }

    try {
      const { data, error } = await supabaseAdmin
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        return { success: false, orders: [], error: error.message };
      }

      return { success: true, orders: (data as OrderRow[]) || [] };
    } catch (err: any) {
      return { success: false, orders: [], error: err?.message };
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

    if (!supabaseAdmin) {
      return { success: false, message: 'Database is offline. Connect Supabase to record sales.' };
    }

    // Release expired before claiming inventory
    await this.releaseExpiredReservations();

    try {
      const { data: available, error: fetchErr } = await supabaseAdmin
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

      const { data: updated, error: updateErr } = await supabaseAdmin
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
        .select();

      if (updateErr) throw updateErr;

      // Record box office order in public.orders
      await supabaseAdmin.from('orders').insert({
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
    } catch (err: any) {
      return { success: false, message: err?.message || 'Database error recording physical sale' };
    }
  },

  async confirmPaymentAdmin(ticketId: string): Promise<boolean> {
    if (!supabaseAdmin) return false;

    const now = new Date().toISOString();
    try {
      const { data: ticket } = await supabaseAdmin
        .from('tickets')
        .select('order_ref')
        .eq('id', ticketId)
        .single();

      const { error } = await supabaseAdmin
        .from('tickets')
        .update({
          status: 'issued',
          payment_status: 'paid',
          paid_at: now,
        })
        .eq('id', ticketId);

      if (!error && ticket?.order_ref) {
        await supabaseAdmin
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
    if (!supabaseAdmin) return false;

    try {
      const { error } = await supabaseAdmin
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
