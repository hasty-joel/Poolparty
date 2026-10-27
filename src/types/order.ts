/**
 * Order Tracking & MTN Mobile Money Merchant Types for Pool Party
 */
import type { TicketCategory, TicketRecord } from './inventory.js';

export type PaymentNetwork = 'MTN' | 'AIRTEL';
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired';
export type VerificationStatus = 'unsubmitted' | 'pending_verification' | 'verified' | 'rejected';

export interface OrderRecord {
  id: string;
  order_ref: string; // Unique transaction reference (e.g. PP-MTN-...)
  category: TicketCategory;
  quantity: number;
  unit_price_ugx: number;
  total_amount_ugx: number;
  status: OrderStatus;
  payment_method: string; // 'mtn_momo_merchant'
  network?: PaymentNetwork;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  payer_phone?: string | null;
  mtn_transaction_id?: string | null;
  verification_status?: VerificationStatus;
  verified_at?: string | null;
  verified_by?: string | null;
  rejection_reason?: string | null;
  submission_notes?: string | null;
  relworx_internal_ref?: string | null;
  flw_transaction_id?: string | null;
  flw_ref?: string | null;
  auth_url?: string | null;
  gateway?: 'mtn_momo' | 'relworx' | 'flutterwave';
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
  network?: PaymentNetwork;
  idempotencyKey?: string;
}

export interface InitiatePaymentResponse {
  success: boolean;
  orderRef?: string;
  message: string;
  authUrl?: string | null;
  relworxInternalRef?: string | null;
  merchantCode?: string;
  merchantName?: string;
  gateway?: 'mtn_momo' | 'relworx' | 'flutterwave';
  reservedUntil?: string;
  totalAmountUgx?: number;
  tickets?: TicketRecord[];
  error?: string;
  code?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
  reusedExistingOrder?: boolean;
}

export interface MtnPaymentSubmitPayload {
  orderRef: string;
  mtnTransactionId: string;
  payerPhone: string;
  notes?: string;
}

export interface MtnPaymentSubmitResponse {
  success: boolean;
  message: string;
  orderRef: string;
  verificationStatus: VerificationStatus;
  mtnTransactionId?: string;
  error?: string;
}

export interface OrderStatusResponse {
  success: boolean;
  orderRef: string;
  status: OrderStatus;
  verificationStatus?: VerificationStatus;
  mtnTransactionId?: string | null;
  rejectionReason?: string | null;
  message?: string;
  tickets?: TicketRecord[];
  buyerName?: string;
  category?: TicketCategory;
  quantity?: number;
  totalAmountUgx?: number;
  reservedUntil?: string;
  secondsRemaining?: number;
}
