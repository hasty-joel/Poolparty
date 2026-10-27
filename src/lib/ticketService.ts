import {
  TicketRecord,
  TicketCategory,
  InventoryDashboardStats,
  CheckInResult,
  PublicInventoryCounts,
  PublicTicketValidityResult,
  LookupTicketSummary,
} from '../types/inventory';

let _adminToken: string = '';
let _gateSessionToken: string = '';

const DEFAULT_API_TIMEOUT_MS = 12000;
const PAYMENT_API_TIMEOUT_MS = 20000;

export function isOnlineTicketRecord(t: {
  ticket_number?: string | null;
  ticket_channel?: string | null;
}): boolean {
  if (t.ticket_channel === 'hardcopy') return false;
  const normalized = String(t.ticket_number || '').trim().toUpperCase();
  const match = normalized.match(/^(VIP|ORD)-(\d{3,4})$/);
  if (match) {
    const prefix = match[1];
    const num = parseInt(match[2], 10);
    if (prefix === 'VIP' && num >= 21) return false;
    if (prefix === 'ORD' && num >= 51) return false;
  }
  return true;
}

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
      if (token) {
        sessionStorage.setItem('poolparty_admin_passcode', token);
      } else {
        sessionStorage.removeItem('poolparty_admin_passcode');
      }
    } catch {}
  },

  clearAdminToken() {
    this.setAdminToken('');
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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-admin-key'] = token;
    }
    return headers;
  },

  setGateSessionToken(token: string) {
    _gateSessionToken = token;
    try {
      if (token) {
        sessionStorage.setItem('poolparty_gate_session', token);
      } else {
        sessionStorage.removeItem('poolparty_gate_session');
      }
    } catch {}
  },

  getGateSessionToken(): string {
    if (_gateSessionToken) return _gateSessionToken;
    try {
      return sessionStorage.getItem('poolparty_gate_session') || '';
    } catch {
      return '';
    }
  },

  getGateSessionHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const gateToken = this.getGateSessionToken();
    if (gateToken) {
      headers['Authorization'] = `Bearer ${gateToken}`;
    }
    return headers;
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
    adminAuthConfigured?: boolean;
    relworxConfigured?: boolean;
    relworxAccount?: string;
    authErrorCode?: string;
    retryAfterSeconds?: number;
    error?: string;
  }> {
    const res = await fetchSafeJson<any>('/api/admin/health', {
      headers: this.getAdminHeaders(),
    });
    if (res.ok && res.data && typeof res.data.supabaseConnected === 'boolean') {
      return res.data;
    }
    return {
      supabaseConnected: false,
      project: 'Poolparty',
      table: 'public.tickets',
      totalRecordsFound: 0,
      relworxConfigured: false,
      authErrorCode:
        res.status === 401 || res.status === 403
          ? 'UNAUTHORIZED'
          : res.status === 429
          ? 'RATE_LIMITED'
          : res.data?.error === 'ADMIN_AUTH_NOT_CONFIGURED'
          ? 'ADMIN_AUTH_NOT_CONFIGURED'
          : undefined,
      retryAfterSeconds: res.data?.retryAfterSeconds,
      error: res.data?.message || res.data?.error || res.fallbackMessage,
    };
  },

  /**
   * Fetch all tickets from Supabase for authenticated Admin table
   */
  async getAllTickets(): Promise<{ success: boolean; tickets: TicketRecord[]; error?: string; message?: string }> {
    const res = await fetchSafeJson<any>('/api/admin/tickets', {
      headers: this.getAdminHeaders(),
    });
    if (res.status === 401 || res.status === 403) {
      return { success: false, tickets: [], error: 'UNAUTHORIZED', message: res.data?.message || res.data?.error };
    }
    if (res.status === 429) {
      return { success: false, tickets: [], error: 'RATE_LIMITED', message: res.data?.message };
    }
    if (res.status === 503 && res.data?.error === 'ADMIN_AUTH_NOT_CONFIGURED') {
      return { success: false, tickets: [], error: 'ADMIN_AUTH_NOT_CONFIGURED', message: res.data?.message };
    }
    if (res.data?.success && Array.isArray(res.data.tickets)) {
      return { success: true, tickets: res.data.tickets };
    }
    return { success: false, tickets: [], error: res.data?.error || res.fallbackMessage, message: res.data?.message };
  },

  /**
   * Fetch all orders from Supabase for authenticated Admin table
   */
  async getAllOrders(): Promise<{ success: boolean; orders: any[]; error?: string; message?: string }> {
    const res = await fetchSafeJson<any>('/api/admin/orders', {
      headers: this.getAdminHeaders(),
    });
    if (res.status === 401 || res.status === 403) {
      return { success: false, orders: [], error: 'UNAUTHORIZED', message: res.data?.message || res.data?.error };
    }
    if (res.status === 429) {
      return { success: false, orders: [], error: 'RATE_LIMITED', message: res.data?.message };
    }
    if (res.status === 503 && res.data?.error === 'ADMIN_AUTH_NOT_CONFIGURED') {
      return { success: false, orders: [], error: 'ADMIN_AUTH_NOT_CONFIGURED', message: res.data?.message };
    }
    if (res.data?.success && Array.isArray(res.data.orders)) {
      return { success: true, orders: res.data.orders };
    }
    return { success: false, orders: [], error: res.data?.error || res.fallbackMessage, message: res.data?.message };
  },

  /**
   * Calculate live 70-ticket online dashboard statistics (excludes the 300 hardcopy tickets)
   */
  async getDashboardStats(): Promise<{ stats: InventoryDashboardStats | null; error?: string }> {
    const res = await this.getAllTickets();
    if (!res.success) {
      return { stats: null, error: res.error };
    }

    const tickets = res.tickets.filter(isOnlineTicketRecord);

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
   * Admin confirms payment in Supabase (Protected — requires verified payment evidence; online tickets only)
   */
  async confirmPayment(ticketId: string): Promise<boolean> {
    const res = await this.confirmPaymentDetailed(ticketId);
    return res.success;
  },

  async confirmPaymentDetailed(ticketId: string): Promise<{ success: boolean; error?: string; message: string }> {
    const res = await fetchSafeJson<any>('/api/admin/confirm-payment', {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({ ticketId }),
    });
    return {
      success: Boolean(res.ok && res.data?.success),
      error: res.data?.error,
      message: res.data?.message || res.data?.error || res.fallbackMessage,
    };
  },

  /**
   * Admin releases ticket back to inventory in Supabase (Protected — online un-admitted tickets only)
   */
  async cancelTicket(ticketId: string, releaseToInventory: boolean = true): Promise<boolean> {
    const res = await this.releaseTicketDetailed(ticketId, releaseToInventory);
    return res.success;
  },

  async releaseTicketDetailed(
    ticketId: string,
    releaseToInventory: boolean = true
  ): Promise<{ success: boolean; error?: string; message: string }> {
    const res = await fetchSafeJson<any>('/api/admin/release-ticket', {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({ ticketId, releaseToInventory }),
    });
    return {
      success: Boolean(res.ok && res.data?.success),
      error: res.data?.error,
      message: res.data?.message || res.data?.error || res.fallbackMessage,
    };
  },

  /**
   * Fetch MTN Mobile Money Merchant configuration and instructions
   */
  async getMtnConfig(): Promise<{
    success: boolean;
    configured: boolean;
    merchantCode?: string;
    merchantName?: string;
    currency: 'UGX';
    warning?: string;
    instructions: {
      ussdCode: string;
      steps: string[];
    };
  }> {
    const res = await fetchSafeJson<any>('/api/payments/mtn-config', { method: 'GET' }, DEFAULT_API_TIMEOUT_MS);
    if (res.data && typeof res.data.configured === 'boolean') {
      return res.data;
    }
    return {
      success: false,
      configured: false,
      currency: 'UGX',
      warning: 'Could not connect to payment server to retrieve MTN configuration.',
      instructions: {
        ussdCode: '*165*3#',
        steps: ['MTN payment configuration is loading...'],
      },
    };
  },

  /**
   * Initiate MTN Mobile Money Merchant Pass Reservation
   * Enforces trusted server pricing (VIP UGX 50,000, Ordinary UGX 20,000)
   * Locks tickets for 15 minutes and returns merchant payment instructions
   */
  async initiateMtnPayment(payload: {
    category: TicketCategory;
    quantity: number;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
  }): Promise<{
    success: boolean;
    orderRef?: string;
    reservedUntil?: string;
    totalAmountUgx?: number;
    category?: TicketCategory;
    quantity?: number;
    merchantCode?: string;
    merchantName?: string;
    isConfigured?: boolean;
    message: string;
    error?: string;
  }> {
    const res = await fetchSafeJson<any>(
      '/api/payments/mtn-reserve',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      PAYMENT_API_TIMEOUT_MS
    );

    if (res.data && typeof res.data.success === 'boolean') {
      return res.data;
    }

    return {
      success: false,
      message: res.fallbackMessage || 'Network error while creating ticket reservation.',
      error: 'NETWORK_ERROR',
    };
  },

  /**
   * Submit MTN Transaction ID for Admin Verification
   * Customer submits ID from their MTN confirmation SMS.
   * Does NOT issue tickets or mark paid until admin verifies!
   */
  async submitMtnTransaction(payload: {
    orderRef: string;
    mtnTransactionId: string;
    payerPhone: string;
    notes?: string;
  }): Promise<{
    success: boolean;
    message: string;
    orderRef?: string;
    verificationStatus?: string;
    mtnTransactionId?: string;
    error?: string;
  }> {
    const res = await fetchSafeJson<any>(
      '/api/payments/mtn-submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      PAYMENT_API_TIMEOUT_MS
    );

    if (res.data && typeof res.data.success === 'boolean') {
      return res.data;
    }

    return {
      success: false,
      message: res.fallbackMessage || 'Network error while submitting transaction ID.',
      error: 'NETWORK_ERROR',
    };
  },

  /**
   * Admin Verify MTN Payment (Protected)
   * Marks order paid and generates active QR tokens
   * Calls secure backend endpoint /api/admin/mtn-verify (with fallback to /api/admin/verify-mtn-payment)
   */
  async verifyMtnPaymentAdmin(
    orderRef: string,
    adminName: string = 'Admin',
    notes?: string
  ): Promise<{ success: boolean; message: string; orderRef?: string; tickets?: TicketRecord[] }> {
    let res = await fetchSafeJson<any>(
      '/api/admin/mtn-verify',
      {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ orderRef, adminName, notes }),
      },
      PAYMENT_API_TIMEOUT_MS
    );

    if (!res.ok && res.status === 404) {
      // Fallback for legacy endpoints
      res = await fetchSafeJson<any>(
        '/api/admin/verify-mtn-payment',
        {
          method: 'POST',
          headers: this.getAdminHeaders(),
          body: JSON.stringify({ orderRef, adminName, notes }),
        },
        PAYMENT_API_TIMEOUT_MS
      );
    }

    if (res.data && typeof res.data.success === 'boolean') {
      return res.data;
    }
    return { success: false, message: res.fallbackMessage || 'Failed to verify payment.' };
  },

  /**
   * Admin Reject MTN Payment (Protected)
   * Marks order rejected and releases reserved tickets
   * Calls secure backend endpoint /api/admin/mtn-reject (with fallback to /api/admin/reject-mtn-payment)
   */
  async rejectMtnPaymentAdmin(orderRef: string, reason: string, adminName: string = 'Admin'): Promise<{ success: boolean; message: string }> {
    let res = await fetchSafeJson<any>(
      '/api/admin/mtn-reject',
      {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ orderRef, reason, adminName }),
      },
      PAYMENT_API_TIMEOUT_MS
    );

    if (!res.ok && res.status === 404) {
      // Fallback for legacy endpoints
      res = await fetchSafeJson<any>(
        '/api/admin/reject-mtn-payment',
        {
          method: 'POST',
          headers: this.getAdminHeaders(),
          body: JSON.stringify({ orderRef, reason, adminName }),
        },
        PAYMENT_API_TIMEOUT_MS
      );
    }

    if (res.data && typeof res.data.success === 'boolean') {
      return res.data;
    }
    return { success: false, message: res.fallbackMessage || 'Failed to reject payment.' };
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
    verificationStatus?: 'unsubmitted' | 'pending_verification' | 'verified' | 'rejected';
    mtnTransactionId?: string;
    rejectionReason?: string;
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
   * Verified Customer Order Lookup:
   * Requires both primary contact (Uganda phone OR exact order reference) AND ownership verification
   * (checkout email address, matching phone, or matching order reference).
   * Returns minimal pass summaries — never exposes raw QR tokens.
   */
  async lookupTickets(
    contact: string,
    verification: string
  ): Promise<{
    success: boolean;
    count: number;
    tickets: LookupTicketSummary[];
    error?: string;
    message?: string;
  }> {
    const res = await fetchSafeJson<any>(
      '/api/orders/lookup',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact, verification }),
      },
      DEFAULT_API_TIMEOUT_MS
    );

    if (res.data && typeof res.data.success === 'boolean') {
      return {
        success: res.data.success,
        count: res.data.count || 0,
        tickets: Array.isArray(res.data.tickets) ? res.data.tickets : [],
        error: res.data.error,
        message: res.data.message,
      };
    }

    return {
      success: false,
      count: 0,
      tickets: [],
      error: res.status === 429 ? 'RATE_LIMITED' : 'LOOKUP_FAILED',
      message: res.fallbackMessage,
    };
  },

  /**
   * Read-Only Public Pass Validity Check (UUID QR Token Only)
   * Safe for customer `?verify=<token>` scans — never exposes PII and never checks the pass in.
   */
  async getPublicTicketStatus(token: string): Promise<PublicTicketValidityResult> {
    const res = await fetchSafeJson<PublicTicketValidityResult>(
      `/api/tickets/public-status?token=${encodeURIComponent(token)}`,
      { method: 'GET' },
      DEFAULT_API_TIMEOUT_MS
    );

    if (res.data && res.data.status) {
      return res.data;
    }

    return {
      success: false,
      valid: false,
      status: 'INVALID',
      message: res.fallbackMessage,
    };
  },

  /**
   * Gate Staff Authentication Session Management (`POST /api/gate/session`, `GET /api/gate/session`, `POST /api/gate/logout`)
   */
  async loginGateSession(passcode: string): Promise<{
    success: boolean;
    authenticated: boolean;
    role?: 'gate_staff' | 'admin';
    expiresAt?: string;
    error?: string;
    retryAfterSeconds?: number;
    message?: string;
  }> {
    const res = await fetchSafeJson<any>(
      '/api/gate/session',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      },
      DEFAULT_API_TIMEOUT_MS
    );

    if (res.ok && res.data?.success && res.data?.authenticated) {
      if (typeof res.data.sessionToken === 'string') {
        this.setGateSessionToken(res.data.sessionToken);
      }
      return {
        success: true,
        authenticated: true,
        role: res.data.role,
        expiresAt: res.data.expiresAt,
      };
    }

    return {
      success: false,
      authenticated: false,
      error: res.data?.error || (res.status === 429 ? 'RATE_LIMITED' : 'INVALID_PASSCODE'),
      retryAfterSeconds: res.data?.retryAfterSeconds,
      message: res.data?.message || res.fallbackMessage,
    };
  },

  async checkGateSession(): Promise<{
    authenticated: boolean;
    role?: 'gate_staff' | 'admin';
    expiresAt?: string;
    reason?: string;
  }> {
    const res = await fetchSafeJson<any>(
      '/api/gate/session',
      {
        method: 'GET',
        credentials: 'same-origin',
        headers: this.getGateSessionHeaders(),
      },
      DEFAULT_API_TIMEOUT_MS
    );

    if (res.ok && res.data?.authenticated) {
      return {
        authenticated: true,
        role: res.data.role,
        expiresAt: res.data.expiresAt,
      };
    }

    this.setGateSessionToken('');
    return {
      authenticated: false,
      reason: res.data?.reason,
    };
  },

  async logoutGateSession(): Promise<void> {
    try {
      await fetchSafeJson<any>(
        '/api/gate/logout',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: this.getGateSessionHeaders(),
        },
        DEFAULT_API_TIMEOUT_MS
      );
    } finally {
      this.setGateSessionToken('');
    }
  },

  /**
   * Gate-safe Recent Check-Ins Feed (`GET /api/gate/recent-checkins`)
   * Does NOT require organizer admin access and never exposes PII or raw QR tokens.
   */
  async getRecentGateCheckIns(limit: number = 10): Promise<{
    success: boolean;
    checkIns: Array<{
      id: string;
      ticket_number: string;
      category: TicketCategory;
      buyer_name: string | null;
      checked_in_at: string | null;
      ticket_channel?: 'online' | 'hardcopy';
    }>;
    error?: string;
    unauthorized?: boolean;
  }> {
    const res = await fetchSafeJson<any>(
      `/api/gate/recent-checkins?limit=${encodeURIComponent(String(limit))}`,
      {
        method: 'GET',
        credentials: 'same-origin',
        headers: this.getGateSessionHeaders(),
      },
      DEFAULT_API_TIMEOUT_MS
    );

    if (res.status === 401) {
      this.setGateSessionToken('');
      return { success: false, checkIns: [], error: res.data?.error || 'UNAUTHORIZED', unauthorized: true };
    }

    if (res.ok && res.data?.success && Array.isArray(res.data.checkIns)) {
      const normalized = res.data.checkIns.map((item: any, idx: number) => {
        const ticketNumber = String(item.ticket_number || item.ticketNumber || '');
        const checkedInAt = item.checked_in_at ?? item.checkedInAt ?? null;
        const channel: 'online' | 'hardcopy' =
          item.ticket_channel === 'hardcopy' || item.channel === 'hardcopy' ? 'hardcopy' : 'online';
        return {
          id: String(item.id || `${ticketNumber}-${checkedInAt || idx}`),
          ticket_number: ticketNumber,
          category: (item.category === 'VIP' ? 'VIP' : 'ORDINARY') as TicketCategory,
          buyer_name: item.buyer_name ?? item.guestLabel ?? null,
          checked_in_at: checkedInAt,
          ticket_channel: channel,
        };
      });
      return { success: true, checkIns: normalized };
    }

    return {
      success: false,
      checkIns: [],
      error: res.data?.error || res.fallbackMessage,
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
   * Atomic Gate Check-in (Calls secure server endpoint with signed gate staff session credentials)
   */
  async verifyAndCheckIn(tokenOrNumber: string): Promise<CheckInResult> {
    const res = await fetchSafeJson<any>(
      '/api/tickets/verify-checkin',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: this.getGateSessionHeaders(),
        body: JSON.stringify({ tokenOrNumber }),
      },
      DEFAULT_API_TIMEOUT_MS
    );

    if (res.status === 401) {
      this.setGateSessionToken('');
      return {
        status: 'UNAUTHORIZED',
        error: res.data?.error || 'UNAUTHORIZED',
        message: res.data?.message || 'Gate staff session required. Please sign in to check tickets in.',
      };
    }

    if (res.data && res.data.status) {
      return res.data as CheckInResult;
    }
    return {
      status: 'INVALID',
      error: res.data?.error,
      message: res.data?.message || res.fallbackMessage,
    };
  },
};
