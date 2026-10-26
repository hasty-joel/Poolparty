import { TicketRecord, TicketCategory, InventoryDashboardStats, CheckInResult, PublicInventoryCounts } from '../types/inventory';

let _adminToken: string = '';

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
    try {
      const res = await fetch('/api/inventory/counts');
      const data = await res.json();
      if (res.ok && data.success && data.counts) {
        return { success: true, counts: data.counts };
      }
      return {
        success: false,
        error: data.error || 'Failed to read inventory counts from database.',
      };
    } catch (err: any) {
      console.warn('Network error fetching public counts:', err);
      return {
        success: false,
        error: err?.message || 'Network error connecting to ticketing service.',
      };
    }
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
    try {
      const res = await fetch('/api/admin/health', {
        headers: this.getAdminHeaders(),
      });
      return await res.json();
    } catch (err: any) {
      return {
        supabaseConnected: false,
        project: 'Poolparty',
        table: 'public.tickets',
        totalRecordsFound: 0,
        relworxConfigured: false,
        error: err?.message || 'Server offline',
      };
    }
  },

  /**
   * Fetch all tickets from Supabase for authenticated Admin table
   */
  async getAllTickets(): Promise<{ success: boolean; tickets: TicketRecord[]; error?: string }> {
    try {
      const res = await fetch('/api/admin/tickets', {
        headers: this.getAdminHeaders(),
      });
      const data = await res.json();
      if (res.status === 401) {
        return { success: false, tickets: [], error: 'UNAUTHORIZED' };
      }
      if (data.success && Array.isArray(data.tickets)) {
        return { success: true, tickets: data.tickets };
      }
      return { success: false, tickets: [], error: data.error || 'Failed to fetch tickets' };
    } catch (err: any) {
      return { success: false, tickets: [], error: err?.message };
    }
  },

  /**
   * Fetch all orders from Supabase for authenticated Admin table
   */
  async getAllOrders(): Promise<{ success: boolean; orders: any[]; error?: string }> {
    try {
      const res = await fetch('/api/admin/orders', {
        headers: this.getAdminHeaders(),
      });
      const data = await res.json();
      if (res.status === 401) {
        return { success: false, orders: [], error: 'UNAUTHORIZED' };
      }
      if (data.success && Array.isArray(data.orders)) {
        return { success: true, orders: data.orders };
      }
      return { success: false, orders: [], error: data.error || 'Failed to fetch orders' };
    } catch (err: any) {
      return { success: false, orders: [], error: err?.message };
    }
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
    try {
      const res = await fetch('/api/admin/physical-sale', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify(params),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, message: err?.message || 'Network error recording physical sale' };
    }
  },

  /**
   * Admin confirms payment in Supabase (Protected)
   */
  async confirmPayment(ticketId: string): Promise<boolean> {
    try {
      const res = await fetch('/api/admin/confirm-payment', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ ticketId }),
      });
      const data = await res.json();
      return Boolean(data.success);
    } catch {
      return false;
    }
  },

  /**
   * Admin releases ticket back to inventory in Supabase (Protected)
   */
  async cancelTicket(ticketId: string, releaseToInventory: boolean = true): Promise<boolean> {
    try {
      const res = await fetch('/api/admin/release-ticket', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ ticketId, releaseToInventory }),
      });
      const data = await res.json();
      return Boolean(data.success);
    } catch {
      return false;
    }
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
  }): Promise<{
    success: boolean;
    orderRef?: string;
    message: string;
    relworxInternalRef?: string | null;
    reservedUntil?: string;
    totalAmountUgx?: number;
    tickets?: TicketRecord[];
    error?: string;
  }> {
    try {
      const res = await fetch('/api/payments/relworx-initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return await res.json();
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Network error connecting to payment gateway.',
      };
    }
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
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderRef)}/status`);
      return await res.json();
    } catch (err: any) {
      return {
        success: false,
        orderRef,
        status: 'pending',
        message: err?.message || 'Error checking payment status.',
      };
    }
  },

  /**
   * Lookup confirmed tickets by contact phone or order reference
   * Returns only issued and paid tickets from Supabase
   */
  async lookupTickets(contact: string): Promise<{ success: boolean; count: number; tickets: TicketRecord[]; message?: string }> {
    try {
      const res = await fetch('/api/orders/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact }),
      });
      return await res.json();
    } catch (err: any) {
      return {
        success: false,
        count: 0,
        tickets: [],
        message: err?.message || 'Error looking up tickets.',
      };
    }
  },

  /**
   * Admin verify Relworx transaction (Protected)
   */
  async verifyRelworxTransactionAdmin(orderRef: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch('/api/admin/verify-relworx-transaction', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ orderRef }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, message: err?.message || 'Verification error' };
    }
  },

  async verifyFlwTransactionAdmin(orderRef: string): Promise<{ success: boolean; message: string }> {
    return this.verifyRelworxTransactionAdmin(orderRef);
  },

  /**
   * Atomic Gate Check-in (Calls secure server endpoint)
   */
  async verifyAndCheckIn(tokenOrNumber: string): Promise<CheckInResult> {
    try {
      const res = await fetch('/api/tickets/verify-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenOrNumber }),
      });
      return await res.json();
    } catch (err: any) {
      return {
        status: 'INVALID',
        message: err?.message || 'Network error during gate verification',
      };
    }
  },
};
