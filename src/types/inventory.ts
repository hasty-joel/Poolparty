/**
 * Supabase Schema-Aligned Inventory & Ticket Types
 * Table: public.tickets
 * Total: 370 tickets (170 Online: 70 VIP & 100 ORDINARY; 200 Hardcopy: 50 VIP & 150 ORDINARY)
 */

export type TicketCategory = 'VIP' | 'ORDINARY';

export type TicketChannel = 'online' | 'hardcopy';

export type TicketDbStatus = 'available' | 'reserved' | 'issued' | 'cancelled';

export type PaymentDbStatus = 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded' | 'manual_paid';

export type HardcopyAuditAction =
  | 'activate_single'
  | 'activate_range'
  | 'deactivate_return'
  | 'void_cancel';

export interface TicketRecord {
  id: string; // uuid
  ticket_number: string; // Online: VIP-051..120, ORD-151..250 | Hardcopy: VIP-001..050, ORD-001..150
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
  ticket_channel?: TicketChannel;
  assigned_agent?: string | null;
  activated_by?: string | null;
  activated_at?: string | null;
  hardcopy_batch_ref?: string | null;
  order_ref?: string | null;
  reserved_until?: string | null;
  mtn_transaction_id?: string | null;
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
    totalCapacity: number;
    totalAvailable: number;
    totalReserved: number;
    totalIssued: number;
    totalPaid: number;
    totalCheckedIn: number;
    totalRevenueUgx: number;
  };
}

export interface CheckInResult {
  status: 'ADMITTED' | 'ALREADY_USED' | 'UNPAID' | 'NOT_ISSUED' | 'CANCELLED' | 'INVALID' | 'UNAUTHORIZED';
  error?: string;
  message: string;
  ticket?: TicketRecord;
  checkedInAt?: string;
}

export interface LookupTicketSummary {
  ticket_number: string;
  category: TicketCategory;
  price_ugx: number;
  status: 'issued';
  payment_status: 'paid' | 'manual_paid';
  buyer_name: string | null;
  order_ref: string | null;
  paid_at: string | null;
  checked_in_at: string | null;
}

export type PublicTicketValidityStatus =
  | 'VALID_UNUSED'
  | 'INACTIVE'
  | 'ALREADY_USED'
  | 'CANCELLED'
  | 'INVALID';

export interface PublicTicketValidityResult {
  success: boolean;
  valid: boolean;
  status: PublicTicketValidityStatus;
  message: string;
  ticketNumber?: string;
  category?: TicketCategory;
  channel?: TicketChannel;
  checkedIn?: boolean;
}

export interface HardcopyAuditLogRecord {
  id: string;
  batch_ref: string;
  action: HardcopyAuditAction;
  category: TicketCategory;
  ticket_numbers: string[];
  quantity: number;
  unit_price_ugx: number;
  total_amount_ugx: number;
  agent_or_seller: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  performed_by: string;
  notes: string | null;
  created_at: string;
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


