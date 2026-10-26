import { TicketRecord, TicketCategory, InventoryDashboardStats, CheckInResult, PublicInventoryCounts } from '../types/inventory';

let currentAdminPasscode: string = '';

export const TicketService = {
  /**
   * Set passcode for authorized admin dashboard requests
   */
  setAdminPasscode(code: string) {
    currentAdminPasscode = code;
  },

  getAdminPasscode(): string {
    return currentAdminPasscode;
  },

  getAdminHeaders(): Record<string, string> {
    return currentAdminPasscode ? { 'x-admin-passcode': currentAdminPasscode } : {};
  },

  /**
   * Public Inventory Counts (Calls secure server endpoint)
   * Strictly returns counts only; no customer records or QR tokens
   */
  async getPublicCounts(): Promise<PublicInventoryCounts> {
    try {
      const res = await fetch('/api/inventory/counts');
      const data = await res.json();
      if (data.success && data.counts) {
        return data.counts;
      }
    } catch (err) {
      console.warn('API getPublicCounts error, using default', err);
    }
    return {
      VIP: { total: 20, available: 20, priceUgx: 50000 },
      ORDINARY: { total: 50, available: 50, priceUgx: 20000 },
      totalAvailable: 70,
      isLiveSupabase: false,
    };
  },

  /**
   * Health Diagnostics for Admin
   */
  async checkAdminHealth(): Promise<{
    supabaseConnected: boolean;
    project: string;
    table: string;
    totalRecordsFound: number;
    relworxConfigured?: boolean;
    error?: string;
  }> {
    try {
      const res = await fetch('/api/admin/health');
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
   * Fetch all 70 tickets for authenticated Admin table
   */
  async getAllTickets(): Promise<TicketRecord[]> {
    try {
      const res = await fetch('/api/admin/tickets', {
        headers: { ...this.getAdminHeaders() },
      });
      const data = await res.json();
      if (data.success && data.tickets) {
        return data.tickets;
      }
    } catch (err) {
      console.warn('API getAllTickets error', err);
    }
    return [];
  },

  /**
   * Calculate dashboard stats
   */
  async getDashboardStats(): Promise<InventoryDashboardStats> {
    const tickets = await this.getAllTickets();

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
    };
  },

  /**
   * Customer Online Reservation (Calls secure server endpoint)
   * Prevents overselling with atomic server-side assignment
   */
  async allocateTickets(params: {
    category: TicketCategory;
    quantity: number;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
    targetStatus?: 'reserved' | 'issued';
    paymentStatus?: 'pending' | 'manual_paid' | 'paid';
  }): Promise<{ success: boolean; message: string; tickets?: TicketRecord[] }> {
    try {
      const res = await fetch('/api/tickets/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, message: err?.message || 'Network error creating reservation' };
    }
  },

  /**
   * Staff Record Physical Sale (Calls secure server endpoint)
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
        headers: {
          'Content-Type': 'application/json',
          ...this.getAdminHeaders(),
        },
        body: JSON.stringify(params),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, message: err?.message || 'Network error recording physical sale' };
    }
  },

  /**
   * Admin confirms payment
   */
  async confirmPayment(ticketId: string): Promise<boolean> {
    try {
      const res = await fetch('/api/admin/confirm-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAdminHeaders(),
        },
        body: JSON.stringify({ ticketId }),
      });
      const data = await res.json();
      return Boolean(data.success);
    } catch {
      return false;
    }
  },

  /**
   * Admin releases ticket back to inventory
   */
  async cancelTicket(ticketId: string, releaseToInventory: boolean = true): Promise<boolean> {
    try {
      const res = await fetch('/api/admin/release-ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAdminHeaders(),
        },
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
    isSandboxTest?: boolean;
    requiresAction?: boolean;
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
        message: err?.message || 'Network error connecting to Relworx payment gateway.',
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
   * Admin fetch all orders
   */
  async getAllOrders(): Promise<any[]> {
    try {
      const res = await fetch('/api/admin/orders', {
        headers: { ...this.getAdminHeaders() },
      });
      const data = await res.json();
      return data.success && data.orders ? data.orders : [];
    } catch {
      return [];
    }
  },

  /**
   * Admin verify Relworx transaction
   */
  async verifyRelworxTransactionAdmin(orderRef: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch('/api/admin/verify-relworx-transaction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAdminHeaders(),
        },
        body: JSON.stringify({ orderRef }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, message: err?.message || 'Verification error' };
    }
  },

  /**
   * Backwards-compatible admin transaction verification wrapper
   */
  async verifyFlwTransactionAdmin(orderRef: string): Promise<{ success: boolean; message: string }> {
    return this.verifyRelworxTransactionAdmin(orderRef);
  },

  /**
   * Verify Admin / Gate Staff Passcode with server
   */
  async verifyAdminPasscode(passcode: string): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const res = await fetch('/api/admin/verify-passcode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-passcode': passcode.trim(),
        },
        body: JSON.stringify({ passcode: passcode.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, message: data.message };
      }
      return { success: false, error: data.error || data.message || `HTTP ${res.status}` };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error verifying passcode' };
    }
  },

  /**
   * Atomic Gate Check-in (Calls secure server endpoint)
   * Attaches authorized gate staff / admin headers
   */
  async verifyAndCheckIn(tokenOrNumber: string): Promise<CheckInResult> {
    try {
      const res = await fetch('/api/tickets/verify-checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAdminHeaders(),
        },
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
