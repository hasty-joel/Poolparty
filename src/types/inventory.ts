/**
 * Supabase Schema-Aligned Inventory & Ticket Types
 * Table: public.tickets
 * Total: 70 tickets (20 VIP @ UGX 50,000 & 50 ORDINARY @ UGX 20,000)
 */

export type TicketCategory = 'VIP' | 'ORDINARY';

export type TicketDbStatus = 'available' | 'reserved' | 'issued' | 'cancelled';

export type PaymentDbStatus = 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded' | 'manual_paid';

export interface TicketRecord {
  id: string; // uuid
  ticket_number: string; // 'VIP-001' to 'VIP-020' or 'ORD-001' to 'ORD-050'
  category: TicketCategory;
  price_ugx: number;
  status: TicketDbStatus;
  payment_status: PaymentDbStatus;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  qr_token: string; // uuid
  created_at: string;
  paid_at: string | null;
  checked_in_at: string | null;
  order_ref?: string | null;
  reserved_until?: string | null;
  relworx_internal_ref?: string | null;
  flw_transaction_id?: string | null;
}

export interface CategoryStats {
  category: TicketCategory;
  priceUgx: number;
  totalCapacity: number;
  available: number;
  reserved: number;
  issued: number;
  paid: number;
  unpaid: number;
  cancelled: number;
  checkedIn: number;
  revenueUgx: number;
}

export interface InventoryDashboardStats {
  ordinary: CategoryStats;
  vip: CategoryStats;
  overall: {
    totalCapacity: 70;
    totalAvailable: number;
    totalReserved: number;
    totalIssued: number;
    totalPaid: number;
    totalCheckedIn: number;
    totalRevenueUgx: number;
  };
}

export interface CheckInResult {
  status: 'ADMITTED' | 'ALREADY_USED' | 'UNPAID' | 'NOT_ISSUED' | 'CANCELLED' | 'INVALID';
  message: string;
  ticket?: TicketRecord;
  checkedInAt?: string;
}

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

