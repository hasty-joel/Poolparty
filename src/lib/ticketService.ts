import { TicketRecord, TicketCategory, InventoryDashboardStats, CheckInResult, PublicInventoryCounts } from '../types/inventory';

let _adminToken: string = '';

const DEFAULT_API_TIMEOUT_MS = 12000;
const PAYMENT_API_TIMEOUT_MS = 20000;

interface SafeJsonResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  fallbackMessage: string;
}

function getHttpFallbackMessage(status: number, isHtml: boolean): string {
  if (status === 401 || status === 403) {
    return 'Unauthorized request.';
  }
  if (status === 404 || isHtml) {
    return 'Ticketing API endpoint could not be reached. Please refresh the page and try again.';
  }
  if (status === 409) {
    return 'Requested passes are currently unavailable.';
  }
  if (status === 504) {
    return 'The ticketing server timed out while processing your request. Please try again.';
  }
  if (status >= 500) {
    return 'Ticketing service is temporarily unavailable. Please try again shortly.';
  }
  return 'Unable to complete request. Please try again.';
}

async function fetchSafeJson<T = any>(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_API_TIMEOUT_MS
): Promise<SafeJsonResult<T>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
    });

    const rawText = await res.text();
    const trimmed = rawText.trim();
    const looksLikeHtml = trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<!doctype') || trimmed.startsWith('<html');

    if (!trimmed || looksLikeHtml) {
      return {
        ok: false,
        status: res.status || 502,
        data: null,
        fallbackMessage: getHttpFallbackMessage(res.status || 502, looksLikeHtml),
      };
    }

    try {
      const parsed = JSON.parse(trimmed) as T;
      return {
        ok: res.ok,
        status: res.status,
        data: parsed,
        fallbackMessage: getHttpFallbackMessage(res.status, false),
      };
    } catch {
      return {
        ok: false,
        status: res.status || 502,
        data: null,
        fallbackMessage: getHttpFallbackMessage(res.status || 502, false),
      };
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return {
        ok: false,
        status: 408,
        data: null,
        fallbackMessage: 'Request timed out. Please check your internet connection and try again.',
      };
    }
    return {
      ok: false,
      status: 0,
      data: null,
      fallbackMessage: 'Network error connecting to ticketing service. Please check your connection and try again.',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export const TicketService = {
  setAdminToken(token: string) {
    _adminToken = token;
    try {
      sessionStorage.setItem('poolparty_admin_passcode', token);
    } catch {}
  },

  getAdminToken(): string {
    if (_adminToken) return _adminToken;
    try {
      return sessionStorage.getItem('poolparty_admin_passcode') || '';
    } catch {
      return '';
    }
  },

  getAdminHeaders(): HeadersInit {
    const token = this.getAdminToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-admin-key': token,
    };
  },

  /**
   * Public Inventory Counts (Calls secure server endpoint querying Supabase)
   * Strictly returns live counts only; no customer records or QR tokens
   */
  async getPublicCounts(): Promise<{ success: boolean; counts?: PublicInventoryCounts; error?: string }> {
    const res = await fetchSafeJson<any>('/api/inventory/counts', { method: 'GET' }, DEFAULT_API_TIMEOUT_MS);
    if (res.ok && res.data?.success && res.data?.counts) {
      return { success: true, counts: res.data.counts };
    }
    return {
      success: false,
      error: res.data?.error || res.data?.message || res.fallbackMessage,
    };
  },

  /**
   * Health Diagnostics for Admin (Database + Gateway)
   */
  async checkAdminHealth(): Promise<{
    supabaseConnected: boolean;
    project: string;
    table: string;
    totalRecordsFound: number;
    relworxConfigured?: boolean;
    relworxAccount?: string;
    error?: string;
  }> {
    const res = await fetchSafeJson<any>('/api/admin/health', {
      headers: this.getAdminHeaders(),
    });
    if (res.data && typeof res.data.supabaseConnected === 'boolean') {
      return res.data;
    }
    return {
      supabaseConnected: false,
      project: 'Poolparty',
      table: 'public.tickets',
      totalRecordsFound: 0,
      relworxConfigured: false,
      error: res.data?.error || res.fallbackMessage,
    };
  },

  /**
   * Fetch all tickets from Supabase for authenticated Admin table
   */
  async getAllTickets(): Promise<{ success: boolean; tickets: TicketRecord[]; error?: string }> {
    const res = await fetchSafeJson<any>('/api/admin/tickets', {
      headers: this.getAdminHeaders(),
    });
    if (res.status === 401) {
      return { success: false, tickets: [], error: 'UNAUTHORIZED' };
    }
    if (res.data?.success && Array.isArray(res.data.tickets)) {
      return { success: true, tickets: res.data.tickets };
    }
    return { success: false, tickets: [], error: res.data?.error || res.fallbackMessage };
  },

  /**
   * Fetch all orders from Supabase for authenticated Admin table
   */
  async getAllOrders(): Promise<{ success: boolean; orders: any[]; error?: string }> {
    const res = await fetchSafeJson<any>('/api/admin/orders', {
      headers: this.getAdminHeaders(),
    });
    if (res.status === 401) {
      return { success: false, orders: [], error: 'UNAUTHORIZED' };
    }
    if (res.data?.success && Array.isArray(res.data.orders)) {
      return { success: true, orders: res.data.orders };
    }
    return { success: false, orders: [], error: res.data?.error || res.fallbackMessage };
  },

  /**
   * Calculate live dashboard statistics from database tickets
   */
  async getDashboardStats(): Promise<{ stats: InventoryDashboardStats | null; error?: string }> {
    const res = await this.getAllTickets();
    if (!res.success) {
      return { stats: null, error: res.error };
    }

    const tickets = res.tickets;

    const computeCategory = (cat: TicketCategory, cap: number, price: number) => {
      const catTickets = tickets.filter((t) => t.category === cat);
      const available = catTickets.filter((t) => t.status === 'available').length;
      const reserved = catTickets.filter((t) => t.status === 'reserved').length;
      const issued = catTickets.filter((t) => t.status === 'issued').length;
      const paid = catTickets.filter((t) => t.payment_status === 'paid' || t.payment_status === 'manual_paid').length;
      const unpaid = catTickets.filter((t) => t.payment_status === 'unpaid' || t.payment_status === 'pending').length;
      const cancelled = catTickets.filter((t) => t.status === 'cancelled').length;
      const checkedIn = catTickets.filter((t) => t.checked_in_at !== null).length;
      const revenueUgx = paid * price;

      return {
        category: cat,
        priceUgx: price,
        totalCapacity: cap,
        available,
        reserved,
        issued,
        paid,
        unpaid,
        cancelled,
        checkedIn,
        revenueUgx,
      };
    };

    const vip = computeCategory('VIP', 20, 50000);
    const ordinary = computeCategory('ORDINARY', 50, 20000);

    return {
      stats: {
        vip,
        ordinary,
        overall: {
          totalCapacity: 70,
          totalAvailable: vip.available + ordinary.available,
          totalReserved: vip.reserved + ordinary.reserved,
          totalIssued: vip.issued + ordinary.issued,
          totalPaid: vip.paid + ordinary.paid,
          totalCheckedIn: vip.checkedIn + ordinary.checkedIn,
          totalRevenueUgx: vip.revenueUgx + ordinary.revenueUgx,
        },
      },
    };
  },

  /**
   * Staff Record Physical Sale in Supabase (Protected)
   */
  async recordPhysicalSale(params: {
    category: TicketCategory;
    quantity: number;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
  }): Promise<{ success: boolean; message: string; tickets?: TicketRecord[] }> {
    const res = await fetchSafeJson<any>(
      '/api/admin/physical-sale',
      {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify(params),
      },
      PAYMENT_API_TIMEOUT_MS
    );
    if (res.data && typeof res.data.success === 'boolean') {
      return res.data;
    }
    return { success: false, message: res.fallbackMessage };
  },

  /**
   * Admin confirms payment in Supabase (Protected)
   */
  async confirmPayment(ticketId: string): Promise<boolean> {
    const res = await fetchSafeJson<any>('/api/admin/confirm-payment', {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({ ticketId }),
    });
    return Boolean(res.data?.success);
  },

  /**
   * Admin releases ticket back to inventory in Supabase (Protected)
   */
  async cancelTicket(ticketId: string, releaseToInventory: boolean = true): Promise<boolean> {
    const res = await fetchSafeJson<any>('/api/admin/release-ticket', {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({ ticketId, releaseToInventory }),
    });
    return Boolean(res.data?.success);
  },

  /**
   * Initiate Relworx Uganda Mobile Money Checkout (MTN MoMo & Airtel Money)
   * Official Relworx API: https://payments.relworx.com/docs
   */
  async initiateRelworxPayment(payload: {
    category: TicketCategory;
    quantity: number;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
    network: 'MTN' | 'AIRTEL';
    idempotencyKey?: string;
  }): Promise<{
    success: boolean;
    orderRef?: string;
    message: string;
    relworxInternalRef?: string | null;
    reservedUntil?: string;
    totalAmountUgx?: number;
    tickets?: TicketRecord[];
    error?: string;
    code?: string;
    retryable?: boolean;
    retryAfterSeconds?: number;
    reusedExistingOrder?: boolean;
    httpStatus?: number;
  }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (payload.idempotencyKey) {
      headers['X-Idempotency-Key'] = payload.idempotencyKey;
    }

    // Single request per user submission — never automatically retries a disabled provider API
    const res = await fetchSafeJson<any>(
      '/api/payments/relworx-initiate',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      },
      PAYMENT_API_TIMEOUT_MS
    );

    if (res.data && typeof res.data.success === 'boolean') {
      return {
        ...res.data,
        httpStatus: res.status,
        message: res.data.message || res.data.error || res.fallbackMessage,
      };
    }

    return {
      success: false,
      httpStatus: res.status,
      message: res.fallbackMessage,
      error: res.status === 408 || res.status === 0 ? 'NETWORK_UNCERTAIN' : 'API_ERROR',
      retryable: true,
    };
  },

  /**
   * Backwards-compatible wrapper pointing to Relworx
   */
  async initiateFlutterwavePayment(payload: {
    category: TicketCategory;
    quantity: number;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
    network: 'MTN' | 'AIRTEL';
  }) {
    return this.initiateRelworxPayment(payload);
  },

  /**
   * Check Order Status & Synchronize with Relworx (Live Polling)
   * Only returns tickets when confirmed 'paid' in Supabase
   */
  async checkOrderStatus(orderRef: string): Promise<{
    success: boolean;
    orderRef: string;
    status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired';
    message?: string;
    tickets?: TicketRecord[];
    buyerName?: string;
    category?: TicketCategory;
    quantity?: number;
    totalAmountUgx?: number;
    reservedUntil?: string;
    secondsRemaining?: number;
  }> {
    const res = await fetchSafeJson<any>(
      `/api/orders/${encodeURIComponent(orderRef)}/status`,
      { method: 'GET' },
      DEFAULT_API_TIMEOUT_MS
    );

    if (res.data && res.data.status) {
      return res.data;
    }

    return {
      success: false,
      orderRef,
      status: 'pending',
      message: res.fallbackMessage,
    };
  },

  /**
   * Lookup confirmed tickets by contact phone or order reference
   * Returns only issued and paid tickets from Supabase
   */
  async lookupTickets(contact: string): Promise<{ success: boolean; count: number; tickets: TicketRecord[]; message?: string }> {
    const res = await fetchSafeJson<any>(
      '/api/orders/lookup',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact }),
      },
      DEFAULT_API_TIMEOUT_MS
    );

    if (res.data && typeof res.data.success === 'boolean') {
      return {
        success: res.data.success,
        count: res.data.count || 0,
        tickets: Array.isArray(res.data.tickets) ? res.data.tickets : [],
        message: res.data.message,
      };
    }

    return {
      success: false,
      count: 0,
      tickets: [],
      message: res.fallbackMessage,
    };
  },

  /**
   * Admin verify Relworx transaction (Protected)
   */
  async verifyRelworxTransactionAdmin(orderRef: string): Promise<{ success: boolean; message: string }> {
    const res = await fetchSafeJson<any>(
      '/api/admin/verify-relworx-transaction',
      {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ orderRef }),
      },
      PAYMENT_API_TIMEOUT_MS
    );
    if (res.data && typeof res.data.success === 'boolean') {
      return res.data;
    }
    return { success: false, message: res.fallbackMessage };
  },

  async verifyFlwTransactionAdmin(orderRef: string): Promise<{ success: boolean; message: string }> {
    return this.verifyRelworxTransactionAdmin(orderRef);
  },

  /**
   * Atomic Gate Check-in (Calls secure server endpoint)
   */
  async verifyAndCheckIn(tokenOrNumber: string): Promise<CheckInResult> {
    const res = await fetchSafeJson<CheckInResult>(
      '/api/tickets/verify-checkin',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenOrNumber }),
      },
      DEFAULT_API_TIMEOUT_MS
    );
    if (res.data && res.data.status) {
      return res.data;
    }
    return {
      status: 'INVALID',
      message: res.fallbackMessage,
    };
  },
};
