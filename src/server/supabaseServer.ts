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
  supabaseServiceRoleKey.length > 20
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
    total: 20;
    available: number;
    priceUgx: 50000;
  };
  ORDINARY: {
    total: 50;
    available: number;
    priceUgx: 20000;
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

// In-memory atomic fallback store if SUPABASE_SERVICE_ROLE_KEY is not yet injected
function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function initFallbackInventory(): TicketRow[] {
  const list: TicketRow[] = [];
  const now = new Date().toISOString();

  // 20 VIP
  for (let i = 1; i <= 20; i++) {
    const num = `VIP-${String(i).padStart(3, '0')}`;
    list.push({
      id: generateUuid(),
      ticket_number: num,
      category: 'VIP',
      price_ugx: 50000,
      status: i === 1 ? 'issued' : i === 2 ? 'reserved' : 'available',
      payment_status: i === 1 ? 'manual_paid' : i === 2 ? 'pending' : 'unpaid',
      buyer_name: i === 1 ? 'Michael Ssemwogerere' : i === 2 ? 'Brenda Ainembabazi' : null,
      buyer_email: i === 1 ? 'michael.s@prince.ug' : i === 2 ? 'brenda.a@kampala.org' : null,
      buyer_phone: i === 1 ? '+256 775 889900' : i === 2 ? '+256 782 334455' : null,
      qr_token: generateUuid(),
      created_at: now,
      paid_at: i === 1 ? new Date(Date.now() - 3600000 * 12).toISOString() : null,
      checked_in_at: null,
      order_ref: i <= 2 ? `PP-MOCK-${i}` : null,
      reserved_until: i === 2 ? new Date(Date.now() + 600000).toISOString() : null,
    });
  }

  // 50 Ordinary
  for (let i = 1; i <= 50; i++) {
    const num = `ORD-${String(i).padStart(3, '0')}`;
    list.push({
      id: generateUuid(),
      ticket_number: num,
      category: 'ORDINARY',
      price_ugx: 20000,
      status: i === 1 ? 'issued' : i === 2 ? 'issued' : i === 3 ? 'reserved' : 'available',
      payment_status: i === 1 ? 'paid' : i === 2 ? 'paid' : i === 3 ? 'pending' : 'unpaid',
      buyer_name: i === 1 ? 'David Kigozi' : i === 2 ? 'Patricia Nansubuga' : i === 3 ? 'Joshua Kato' : null,
      buyer_email: i === 1 ? 'david.kigozi@example.ug' : i === 2 ? 'patricia.nan@example.ug' : i === 3 ? 'joshua.k@kampala.ug' : null,
      buyer_phone: i === 1 ? '+256 772 100201' : i === 2 ? '+256 701 445890' : i === 3 ? '+256 752 990011' : null,
      qr_token: generateUuid(),
      created_at: now,
      paid_at: i <= 2 ? new Date(Date.now() - 3600000 * 24).toISOString() : null,
      checked_in_at: i === 2 ? new Date(Date.now() - 3600000 * 2).toISOString() : null,
      order_ref: i <= 3 ? `PP-MOCK-ORD-${i}` : null,
      reserved_until: i === 3 ? new Date(Date.now() + 600000).toISOString() : null,
    });
  }

  return list;
}

let serverMemoryStore: TicketRow[] = initFallbackInventory();
let serverOrdersStore: OrderRow[] = [
  {
    id: generateUuid(),
    order_ref: 'PP-MOCK-1',
    category: 'VIP',
    quantity: 1,
    unit_price_ugx: 50000,
    total_amount_ugx: 50000,
    status: 'paid',
    payment_method: 'mobile_money_uganda',
    network: 'MTN',
    buyer_name: 'Michael Ssemwogerere',
    buyer_email: 'michael.s@prince.ug',
    buyer_phone: '+256 775 889900',
    reserved_until: new Date(Date.now() - 3600000).toISOString(),
    created_at: new Date(Date.now() - 3600000 * 12).toISOString(),
    paid_at: new Date(Date.now() - 3600000 * 12).toISOString(),
  },
];

export const SupabaseServerService = {
  /**
   * Health Check: Test connection to live Supabase project
   */
  async checkConnection(): Promise<{ connected: boolean; count: number; error?: string }> {
    if (!supabaseAdmin) {
      return {
        connected: false,
        count: serverMemoryStore.length,
        error: 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL not configured in environment',
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
      return { connected: false, count: 0, error: err?.message || 'Connection failed' };
    }
  },

  /**
   * Safe Atomic Cleanup: Release 10-Minute Expired Unpaid Reservations
   * Ensures capacity returns to 'available' automatically if customer doesn't pay
   */
  async releaseExpiredReservations(): Promise<number> {
    const nowIso = new Date().toISOString();

    if (supabaseAdmin) {
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
          })
          .eq('status', 'reserved')
          .in('payment_status', ['unpaid', 'pending'])
          .lt('reserved_until', nowIso)
          .select('id');

        if (!tErr && expiredTickets && expiredTickets.length > 0) {
          // Update corresponding orders
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
    }

    // Fallback in-memory release
    const now = Date.now();
    let released = 0;
    serverMemoryStore.forEach((ticket) => {
      if (
        ticket.status === 'reserved' &&
        (ticket.payment_status === 'unpaid' || ticket.payment_status === 'pending') &&
        ticket.reserved_until &&
        new Date(ticket.reserved_until).getTime() < now
      ) {
        ticket.status = 'available';
        ticket.payment_status = 'unpaid';
        ticket.buyer_name = null;
        ticket.buyer_email = null;
        ticket.buyer_phone = null;
        ticket.order_ref = null;
        ticket.reserved_until = null;
        released++;
      }
    });

    serverOrdersStore.forEach((order) => {
      if (order.status === 'pending' && new Date(order.reserved_until).getTime() < now) {
        order.status = 'expired';
      }
    });

    return released;
  },

  /**
   * Public Inventory Counts ONLY: Never exposes buyer details or QR tokens!
   */
  async getPublicCounts(): Promise<PublicInventoryCounts> {
    // Release any expired reservations first
    await this.releaseExpiredReservations();

    if (supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin
          .from('tickets')
          .select('category, status');

        if (!error && data) {
          const vipAvail = data.filter((t) => t.category === 'VIP' && t.status === 'available').length;
          const ordAvail = data.filter((t) => t.category === 'ORDINARY' && t.status === 'available').length;
          return {
            VIP: { total: 20, available: vipAvail, priceUgx: 50000 },
            ORDINARY: { total: 50, available: ordAvail, priceUgx: 20000 },
            totalAvailable: vipAvail + ordAvail,
            isLiveSupabase: true,
          };
        }
      } catch (err) {
        console.warn('Supabase count query failed, using server fallback', err);
      }
    }

    const vipAvail = serverMemoryStore.filter((t) => t.category === 'VIP' && t.status === 'available').length;
    const ordAvail = serverMemoryStore.filter((t) => t.category === 'ORDINARY' && t.status === 'available').length;
    return {
      VIP: { total: 20, available: vipAvail, priceUgx: 50000 },
      ORDINARY: { total: 50, available: ordAvail, priceUgx: 20000 },
      totalAvailable: vipAvail + ordAvail,
      isLiveSupabase: false,
    };
  },

  /**
   * Backwards-compatible delegate pointing to official Relworx payment initiation
   */
  async initiateFlutterwavePayment(params: {
    category: 'VIP' | 'ORDINARY';
    quantity: number;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
    network: PaymentNetwork;
    appUrl?: string;
  }) {
    return this.initiateRelworxPayment({
      category: params.category,
      quantity: params.quantity,
      buyerName: params.buyerName,
      buyerEmail: params.buyerEmail,
      buyerPhone: params.buyerPhone,
      network: params.network,
    });
  },

  /**
   * Relworx Uganda Mobile Money Checkout Initiation (MTN MoMo & Airtel Money)
   * 1. Validates inputs & calculates trusted server price (UGX 20,000 Ordinary, UGX 50,000 VIP)
   * 2. Atomically reserves tickets with a 10-minute expiry
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
    isSandboxTest?: boolean;
    requiresAction?: boolean;
    error?: string;
  }> {
    const { category, quantity, buyerName, buyerEmail, buyerPhone, network } = params;

    // Validate quantities
    if (quantity < 1 || quantity > 10) {
      return { success: false, message: 'Invalid ticket quantity (minimum 1, maximum 10).' };
    }

    // Trusted prices enforced strictly on server
    const unitPrice = category === 'VIP' ? 50000 : 20000;
    const totalAmount = unitPrice * quantity;

    // Release any stale expired reservations first
    await this.releaseExpiredReservations();

    // Generate unique order reference (must be 8-36 alphanumeric characters)
    const timestamp = Date.now();
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderRef = `PP-RWX-${timestamp}-${randomSuffix}`;
    const reservedUntil = new Date(timestamp + 10 * 60 * 1000).toISOString(); // 10 minutes

    // Atomically claim tickets
    let allocatedTicketIds: string[] = [];

    if (supabaseAdmin) {
      try {
        const { data: available, error: fetchErr } = await supabaseAdmin
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
            message: `Insufficient inventory! Only ${count} ${category} ticket(s) currently available.`,
          };
        }

        allocatedTicketIds = available.map((t) => t.id);

        // Lock these tickets with 10-minute expiry
        let updateRes = await supabaseAdmin
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
          .in('id', allocatedTicketIds);

        if (updateRes.error && updateRes.error.message?.includes('order_ref')) {
          updateRes = await supabaseAdmin
            .from('tickets')
            .update({
              status: 'reserved',
              payment_status: 'pending',
              buyer_name: buyerName.trim(),
              buyer_email: buyerEmail.trim(),
              buyer_phone: buyerPhone.trim(),
            })
            .in('id', allocatedTicketIds);
        }

        if (updateRes.error) {
          throw updateRes.error;
        }

        // Always store order in memory tracking store
        serverOrdersStore.unshift({
          id: generateUuid(),
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
          gateway: 'relworx',
          reserved_until: reservedUntil,
          created_at: new Date().toISOString(),
        });

        // Also record order in public.orders table if table exists
        try {
          await supabaseAdmin.from('orders').insert({
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
        } catch {
          // public.orders table optional
        }
      } catch (err: any) {
        console.error('Database reservation error for Relworx:', err);
        return {
          success: false,
          message: err?.message || 'Database error reserving tickets.',
        };
      }
    } else {
      // In-memory fallback
      const available = serverMemoryStore.filter((t) => t.category === category && t.status === 'available');
      if (available.length < quantity) {
        return {
          success: false,
          message: `Insufficient inventory! Only ${available.length} ${category} ticket(s) currently available.`,
        };
      }

      for (let i = 0; i < quantity; i++) {
        const t = available[i];
        t.status = 'reserved';
        t.payment_status = 'pending';
        t.buyer_name = buyerName.trim();
        t.buyer_email = buyerEmail.trim();
        t.buyer_phone = buyerPhone.trim();
        t.order_ref = orderRef;
        t.reserved_until = reservedUntil;
        allocatedTicketIds.push(t.id);
      }

      serverOrdersStore.unshift({
        id: generateUuid(),
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
        gateway: 'relworx',
        reserved_until: reservedUntil,
        created_at: new Date().toISOString(),
      });
    }

    // Call Relworx Payments API
    const relworxRes = await RelworxService.requestPayment({
      reference: orderRef,
      phone: buyerPhone.trim(),
      amount: totalAmount,
      description: `Pool Party 2026 - ${quantity}x ${category} Pass`,
      category,
      buyerName: buyerName.trim(),
    });

    if (!relworxRes.success) {
      // Release reservation immediately if Relworx rejected
      await this.releaseReservationByOrderRef(orderRef);
      return {
        success: false,
        message: relworxRes.message || 'Relworx could not initiate payment on this phone number.',
        error: relworxRes.error || 'RELWORX_REQUEST_FAILED',
      };
    }

    const internalRef = relworxRes.internal_reference || null;
    if (supabaseAdmin && internalRef) {
      try {
        await supabaseAdmin
          .from('orders')
          .update({
            flw_ref: internalRef,
          })
          .eq('order_ref', orderRef);
      } catch {
        // optional
      }
    }

    const ord = serverOrdersStore.find((o) => o.order_ref === orderRef);
    if (ord) {
      ord.relworx_internal_ref = internalRef;
    }

    return {
      success: true,
      orderRef,
      message: relworxRes.message || 'Payment prompt initiated. Check your phone to enter PIN.',
      relworxInternalRef: internalRef,
      reservedUntil,
      totalAmountUgx: totalAmount,
      gateway: 'relworx',
      isSandboxTest: !RelworxService.isConfigured(),
      requiresAction: true,
    };
  },

  /**
   * Release reservation when checkout is explicitly cancelled or declined
   */
  async releaseReservationByOrderRef(orderRef: string): Promise<boolean> {
    if (supabaseAdmin) {
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
          })
          .eq('order_ref', orderRef)
          .eq('status', 'reserved');

        await supabaseAdmin
          .from('orders')
          .update({ status: 'cancelled' })
          .eq('order_ref', orderRef)
          .eq('status', 'pending');

        return true;
      } catch {
        return false;
      }
    }

    serverMemoryStore.forEach((t) => {
      if (t.order_ref === orderRef && t.status === 'reserved') {
        t.status = 'available';
        t.payment_status = 'unpaid';
        t.buyer_name = null;
        t.buyer_email = null;
        t.buyer_phone = null;
        t.order_ref = null;
        t.reserved_until = null;
      }
    });

    const ord = serverOrdersStore.find((o) => o.order_ref === orderRef);
    if (ord && ord.status === 'pending') {
      ord.status = 'cancelled';
    }

    return true;
  },

  /**
   * Check Order Status & Synchronize with Flutterwave
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
    let order: OrderRow | null = null;
    let tickets: TicketRow[] = [];

    if (supabaseAdmin) {
      try {
        const { data: ord } = await supabaseAdmin
          .from('orders')
          .select('*')
          .eq('order_ref', orderRef)
          .maybeSingle();

        if (ord) order = ord as OrderRow;

        const { data: tList } = await supabaseAdmin
          .from('tickets')
          .select('*')
          .eq('order_ref', orderRef);

        if (tList) tickets = tList as TicketRow[];
      } catch (err) {
        console.warn('Error querying order from Supabase', err);
      }
    }

    if (!order) {
      order = serverOrdersStore.find((o) => o.order_ref === orderRef) || null;
    }

    if (tickets.length === 0 && order) {
      if (supabaseAdmin) {
        try {
          const { data: tList } = await supabaseAdmin
            .from('tickets')
            .select('*')
            .eq('buyer_name', order.buyer_name)
            .eq('buyer_phone', order.buyer_phone);
          if (tList) tickets = tList as TicketRow[];
        } catch {
          // fallback
        }
      }
      if (tickets.length === 0) {
        tickets = serverMemoryStore.filter((t) => t.order_ref === orderRef);
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

    // If order is already paid, return tickets immediately
    if (order.status === 'paid') {
      return {
        success: true,
        orderRef,
        status: 'paid',
        buyerName: order.buyer_name,
        category: order.category,
        quantity: order.quantity,
        totalAmountUgx: order.total_amount_ugx,
        tickets,
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

    // Check Relworx status if order was placed via Relworx or if Relworx is configured
    if (
      order.status === 'pending' &&
      (order.gateway === 'relworx' || order.order_ref.startsWith('PP-RWX-') || RelworxService.isConfigured())
    ) {
      try {
        const relCheck = await RelworxService.checkRequestStatus({
          internalReference: order.relworx_internal_ref || undefined,
          reference: orderRef,
        });

        if (relCheck.success && relCheck.status === 'success') {
          // Confirmed payment on Relworx! Mark order as paid atomically
          await this.markOrderAsPaid(orderRef, { relworx: relCheck, relworx_internal_ref: relCheck.internal_reference });
          return await this.getOrderStatus(orderRef);
        } else if (relCheck.status === 'failed') {
          await this.releaseReservationByOrderRef(orderRef);
          return {
            success: false,
            orderRef,
            status: 'failed',
            message: relCheck.message || 'Payment prompt was cancelled or declined on phone.',
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
  },

  /**
   * Idempotently mark order and its reserved tickets as PAID and ISSUED
   */
  async markOrderAsPaid(orderRef: string, paymentData?: any): Promise<boolean> {
    const now = new Date().toISOString();
    const flwTxId = paymentData?.id ? String(paymentData.id) : null;
    const flwRef = paymentData?.flw_ref || paymentData?.relworx_internal_ref || paymentData?.relworx?.internal_reference || null;

    if (supabaseAdmin) {
      try {
        // Mark tickets as issued and paid
        let { error: tErr } = await supabaseAdmin
          .from('tickets')
          .update({
            status: 'issued',
            payment_status: 'paid',
            paid_at: now,
            relworx_internal_ref: flwRef,
          })
          .eq('order_ref', orderRef);

        if (tErr && (tErr.message?.includes('order_ref') || tErr.message?.includes('relworx_internal_ref'))) {
          const ord = serverOrdersStore.find((o) => o.order_ref === orderRef);
          if (ord) {
            await supabaseAdmin
              .from('tickets')
              .update({
                status: 'issued',
                payment_status: 'paid',
                paid_at: now,
              })
              .eq('buyer_name', ord.buyer_name)
              .eq('buyer_phone', ord.buyer_phone)
              .eq('status', 'reserved');
          }
        }

        // Mark order as paid in orders table if exists
        try {
          await supabaseAdmin
            .from('orders')
            .update({
              status: 'paid',
              paid_at: now,
              relworx_internal_ref: flwRef,
              flw_transaction_id: flwTxId,
              flw_ref: flwRef,
            })
            .eq('order_ref', orderRef);
        } catch {
          // table optional
        }

        return true;
      } catch (err) {
        console.error('Error marking order as paid in Supabase:', err);
        return false;
      }
    }

    serverMemoryStore.forEach((t) => {
      if (t.order_ref === orderRef) {
        t.status = 'issued';
        t.payment_status = 'paid';
        t.paid_at = now;
        t.relworx_internal_ref = flwRef;
        t.flw_transaction_id = flwTxId;
      }
    });

    const ord = serverOrdersStore.find((o) => o.order_ref === orderRef);
    if (ord) {
      ord.status = 'paid';
      ord.paid_at = now;
      ord.relworx_internal_ref = flwRef;
      ord.flw_transaction_id = flwTxId;
      ord.flw_ref = flwRef;
    }

    return true;
  },

  /**
   * Admin manual re-check of an order with Relworx
   */
  async verifyRelworxOrderDirectly(orderRef: string): Promise<{ success: boolean; message: string }> {
    const ord = serverOrdersStore.find((o) => o.order_ref === orderRef);
    const internalRef = ord?.relworx_internal_ref || undefined;

    const check = await RelworxService.checkRequestStatus({
      internalReference: internalRef,
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
   * Only returns ISSUED & PAID tickets
   */
  async lookupTicketsByContact(contact: string): Promise<TicketRow[]> {
    const clean = contact.trim().replace(/[\s-]/g, '');

    if (supabaseAdmin) {
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
        console.warn('Error looking up tickets:', err);
      }
    }

    return serverMemoryStore.filter(
      (t) =>
        t.status === 'issued' &&
        (t.payment_status === 'paid' || t.payment_status === 'manual_paid') &&
        ((t.buyer_phone && t.buyer_phone.replace(/[\s-]/g, '').includes(clean)) || t.order_ref === clean)
    );
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
    const clean = tokenOrNumber.trim();

    if (supabaseAdmin) {
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

        // Atomically set checked_in_at
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
    }

    // Fallback store
    const ticket = serverMemoryStore.find(
      (t) => t.qr_token.toLowerCase() === clean.toLowerCase() || t.ticket_number.toLowerCase() === clean.toLowerCase()
    );

    if (!ticket) {
      return { status: 'INVALID', message: 'Invalid or unrecognized QR token / ticket number.' };
    }
    if (ticket.status === 'cancelled') {
      return { status: 'CANCELLED', message: `Ticket ${ticket.ticket_number} has been cancelled.`, ticket };
    }
    if (ticket.status !== 'issued' || (ticket.payment_status !== 'paid' && ticket.payment_status !== 'manual_paid')) {
      return { status: 'UNPAID', message: `Ticket ${ticket.ticket_number} is unpaid (${ticket.status}). Payment required.`, ticket };
    }
    if (ticket.checked_in_at) {
      return { status: 'ALREADY_USED', message: `DUPLICATE: Already used at ${new Date(ticket.checked_in_at).toLocaleTimeString()}.`, ticket, checkedInAt: ticket.checked_in_at };
    }

    const checkInTime = new Date().toISOString();
    ticket.checked_in_at = checkInTime;

    return {
      status: 'ADMITTED',
      message: `ADMITTED: Welcome to Pool Party, ${ticket.buyer_name || 'Guest'}! (${ticket.category} Pass #${ticket.ticket_number})`,
      ticket,
      checkedInAt: checkInTime,
    };
  },

  /**
   * Admin Operations (Secure Server-Side)
   */
  async getAllTicketsAdmin(): Promise<TicketRow[]> {
    if (supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin
          .from('tickets')
          .select('*')
          .order('ticket_number', { ascending: true });

        if (!error && data) {
          return data as TicketRow[];
        }
      } catch (err) {
        console.warn('Supabase admin fetch failed', err);
      }
    }
    return serverMemoryStore;
  },

  async getAllOrdersAdmin(): Promise<OrderRow[]> {
    if (supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin
          .from('orders')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data as OrderRow[];
        }
      } catch (err) {
        console.warn('Supabase admin orders fetch failed', err);
      }
    }
    return serverOrdersStore;
  },

  async recordPhysicalSaleAdmin(params: {
    category: 'VIP' | 'ORDINARY';
    quantity: number;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
  }): Promise<{ success: boolean; message: string; tickets?: TicketRow[] }> {
    const { category, quantity, buyerName, buyerEmail, buyerPhone } = params;

    // Release expired before taking inventory
    await this.releaseExpiredReservations();

    if (supabaseAdmin) {
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

        // Record box office order
        await supabaseAdmin.from('orders').insert({
          order_ref: orderRef,
          category,
          quantity,
          unit_price_ugx: category === 'VIP' ? 50000 : 20000,
          total_amount_ugx: (category === 'VIP' ? 50000 : 20000) * quantity,
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
    }

    const available = serverMemoryStore.filter((t) => t.category === category && t.status === 'available');
    if (available.length < quantity) {
      return { success: false, message: `Sold out! Only ${available.length} ${category} ticket(s) available.` };
    }

    const now = new Date().toISOString();
    const orderRef = `PP-BOX-${Date.now()}`;
    const assigned: TicketRow[] = [];
    for (let i = 0; i < quantity; i++) {
      const ticket = available[i];
      ticket.status = 'issued';
      ticket.payment_status = 'manual_paid';
      ticket.buyer_name = buyerName.trim();
      ticket.buyer_email = buyerEmail.trim();
      ticket.buyer_phone = buyerPhone.trim();
      ticket.order_ref = orderRef;
      ticket.paid_at = now;
      assigned.push({ ...ticket });
    }

    serverOrdersStore.unshift({
      id: generateUuid(),
      order_ref: orderRef,
      category,
      quantity,
      unit_price_ugx: category === 'VIP' ? 50000 : 20000,
      total_amount_ugx: (category === 'VIP' ? 50000 : 20000) * quantity,
      status: 'paid',
      payment_method: 'box_office_cash',
      buyer_name: buyerName.trim(),
      buyer_email: buyerEmail.trim(),
      buyer_phone: buyerPhone.trim(),
      reserved_until: now,
      created_at: now,
      paid_at: now,
    });

    return { success: true, message: `Issued ${quantity} physical ${category} ticket(s).`, tickets: assigned };
  },

  async confirmPaymentAdmin(ticketId: string): Promise<boolean> {
    const now = new Date().toISOString();
    if (supabaseAdmin) {
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
    }

    const ticket = serverMemoryStore.find((t) => t.id === ticketId);
    if (!ticket) return false;
    ticket.status = 'issued';
    ticket.payment_status = 'paid';
    ticket.paid_at = now;
    if (ticket.order_ref) {
      const ord = serverOrdersStore.find((o) => o.order_ref === ticket.order_ref);
      if (ord) {
        ord.status = 'paid';
        ord.paid_at = now;
      }
    }
    return true;
  },

  async releaseTicketAdmin(ticketId: string): Promise<boolean> {
    if (supabaseAdmin) {
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
    }

    const ticket = serverMemoryStore.find((t) => t.id === ticketId);
    if (!ticket) return false;
    ticket.status = 'available';
    ticket.payment_status = 'unpaid';
    ticket.buyer_name = null;
    ticket.buyer_email = null;
    ticket.buyer_phone = null;
    ticket.order_ref = null;
    ticket.reserved_until = null;
    ticket.paid_at = null;
    ticket.checked_in_at = null;
    return true;
  },
};
