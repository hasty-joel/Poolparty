/**
 * Flutterwave & Order Tracking Types for Pool Party
 */
import { TicketCategory, TicketRecord } from './inventory';

export type PaymentNetwork = 'MTN' | 'AIRTEL';
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired';

export interface OrderRecord {
  id: string;
  order_ref: string; // Unique tx_ref sent to Flutterwave
  category: TicketCategory;
  quantity: number;
  unit_price_ugx: number;
  total_amount_ugx: number;
  status: OrderStatus;
  payment_method: string;
  network?: PaymentNetwork;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  flw_transaction_id?: string | null;
  flw_ref?: string | null;
  auth_url?: string | null;
  reserved_until: string;
  created_at: string;
  paid_at?: string | null;
}

export interface InitiatePaymentPayload {
  category: TicketCategory;
  quantity: number;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  network: PaymentNetwork;
}

export interface InitiatePaymentResponse {
  success: boolean;
  orderRef?: string;
  message: string;
  authUrl?: string | null;
  flwRef?: string | null;
  flwTransactionId?: string | number | null;
  reservedUntil?: string;
  totalAmountUgx?: number;
  isSandboxTest?: boolean;
  requiresAction?: boolean; // USSD prompt on user handset
  tickets?: TicketRecord[];
  error?: string;
}

export interface OrderStatusResponse {
  success: boolean;
  orderRef: string;
  status: OrderStatus;
  message?: string;
  tickets?: TicketRecord[];
  buyerName?: string;
  category?: TicketCategory;
  quantity?: number;
  totalAmountUgx?: number;
  reservedUntil?: string;
  secondsRemaining?: number;
}
