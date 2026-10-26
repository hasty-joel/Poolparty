import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Official Relworx Payments API Service for Uganda Mobile Money (MTN & Airtel)
 * Base URL: https://payments.relworx.com/api
 * Docs: https://payments.relworx.com/docs
 */
export interface RelworxPaymentRequestPayload {
  account_no: string;
  reference: string; // 8 - 36 alphanumeric characters
  msisdn: string; // International format e.g. +256701345678
  currency: 'UGX';
  amount: number;
  description?: string;
}

export interface RelworxPaymentResponse {
  success: boolean;
  message: string;
  internal_reference?: string;
  error?: string;
}

export interface RelworxStatusCheckResult {
  success: boolean;
  status: 'pending' | 'success' | 'failed' | 'unknown';
  internal_reference?: string;
  reference?: string;
  amount?: number;
  currency?: string;
  message?: string;
  raw?: any;
}

export const RelworxService = {
  getApiKey(): string | undefined {
    return process.env.RELWORX_API_KEY;
  },

  getAccountNo(): string | undefined {
    return process.env.RELWORX_ACCOUNT_NO;
  },

  getWebhookSecret(): string | undefined {
    return process.env.RELWORX_WEBHOOK_SECRET;
  },

  isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 5);
  },

  /**
   * Format phone number to Relworx MSISDN specification (+256XXXXXXXXX)
   */
  formatUgandaMsisdn(phone: string): { msisdn: string; local: string; valid: boolean } {
    let clean = phone.replace(/[\s\-\(\)]/g, '');

    if (clean.startsWith('+256')) {
      clean = clean.substring(4);
    } else if (clean.startsWith('256')) {
      clean = clean.substring(3);
    } else if (clean.startsWith('0')) {
      clean = clean.substring(1);
    }

    const valid = /^[7][0-9]{8}$/.test(clean);
    return {
      msisdn: `+256${clean}`,
      local: `0${clean}`,
      valid,
    };
  },

  /**
   * Request Payment (Push USSD prompt to customer's mobile money handset)
   * POST https://payments.relworx.com/api/mobile-money/request-payment
   */
  async requestPayment(params: {
    reference: string;
    phone: string;
    amount: number;
    description: string;
    category: 'VIP' | 'ORDINARY';
    buyerName: string;
  }): Promise<RelworxPaymentResponse> {
    const apiKey = this.getApiKey();
    const accountNo = this.getAccountNo() || 'RELWORX_POOLPARTY';

    const { msisdn, valid } = this.formatUgandaMsisdn(params.phone);
    if (!valid && !msisdn.startsWith('+256')) {
      return {
        success: false,
        message: `Invalid Uganda phone number format: "${params.phone}". Expected 9-10 digits (e.g. 0771234567 or +256771234567).`,
      };
    }

    // Reference must be between 8 and 36 characters
    let cleanRef = params.reference.replace(/[^a-zA-Z0-9_\-]/g, '');
    if (cleanRef.length < 8) {
      cleanRef = `${cleanRef}_${Date.now()}`;
    }
    if (cleanRef.length > 36) {
      cleanRef = cleanRef.substring(0, 36);
    }

    const payload: RelworxPaymentRequestPayload = {
      account_no: accountNo,
      reference: cleanRef,
      msisdn,
      currency: 'UGX',
      amount: Math.round(params.amount),
      description: params.description.substring(0, 100),
    };

    if (!this.isConfigured()) {
      console.warn('[Relworx] RELWORX_API_KEY is not configured in environment. Running in sandbox simulation mode.');
      return {
        success: true,
        message: `Relworx payment request simulated. Approve prompt on handset: ${msisdn} for UGX ${params.amount.toLocaleString()}. Configure RELWORX_API_KEY in .env for production.`,
        internal_reference: `sim_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      };
    }

    try {
      const response = await fetch('https://payments.relworx.com/api/mobile-money/request-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.relworx.v2',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      let data: any = {};
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { raw: responseText };
      }

      if (!response.ok) {
        console.error('[Relworx API Error]', response.status, data);
        const errMsg = data.message || data.error || `Relworx API responded with HTTP ${response.status}`;
        return {
          success: false,
          message: errMsg,
          error: errMsg,
        };
      }

      return {
        success: Boolean(data.success !== false),
        message: data.message || 'Payment prompt initiated. Check your phone to enter PIN.',
        internal_reference: data.internal_reference || data.id || data.reference,
      };
    } catch (err: any) {
      console.error('[Relworx Network Exception]', err);
      return {
        success: false,
        message: err?.message || 'Could not connect to Relworx payment service.',
        error: err?.message,
      };
    }
  },

  /**
   * Check Transaction Status via Relworx API
   * GET https://payments.relworx.com/api/mobile-money/check-request-status
   */
  async checkRequestStatus(params: {
    internalReference?: string;
    reference?: string;
  }): Promise<RelworxStatusCheckResult> {
    const apiKey = this.getApiKey();
    const accountNo = this.getAccountNo() || 'RELWORX_POOLPARTY';

    if (!this.isConfigured()) {
      return {
        success: true,
        status: 'pending',
        message: 'Sandbox mode active. Awaiting confirmation.',
      };
    }

    try {
      const queryParams = new URLSearchParams();
      if (params.internalReference) {
        queryParams.append('internal_reference', params.internalReference);
      }
      if (params.reference) {
        queryParams.append('reference', params.reference);
      }
      queryParams.append('account_no', accountNo);

      const url = `https://payments.relworx.com/api/mobile-money/check-request-status?${queryParams.toString()}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.relworx.v2',
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      const responseText = await response.text();
      let data: any = {};
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { raw: responseText };
      }

      if (!response.ok) {
        return {
          success: false,
          status: 'unknown',
          message: data.message || `Relworx status check returned HTTP ${response.status}`,
          raw: data,
        };
      }

      // Relworx status normalization
      const rawStatus = String(data.status || data.transaction_status || '').toLowerCase();
      let normalizedStatus: 'pending' | 'success' | 'failed' | 'unknown' = 'pending';

      if (['success', 'successful', 'paid', 'completed'].includes(rawStatus)) {
        normalizedStatus = 'success';
      } else if (['failed', 'declined', 'cancelled', 'rejected', 'expired'].includes(rawStatus)) {
        normalizedStatus = 'failed';
      } else if (['pending', 'in_progress', 'processing'].includes(rawStatus)) {
        normalizedStatus = 'pending';
      }

      return {
        success: true,
        status: normalizedStatus,
        internal_reference: data.internal_reference || params.internalReference,
        reference: data.reference || params.reference,
        amount: data.amount,
        currency: data.currency,
        message: data.message,
        raw: data,
      };
    } catch (err: any) {
      console.error('[Relworx Check Status Exception]', err);
      return {
        success: false,
        status: 'unknown',
        message: err?.message,
      };
    }
  },

  /**
   * Verify HMAC-SHA256 signature from Relworx webhook
   */
  verifyWebhookSignature(signatureHeader: string | undefined, payloadBody: any): boolean {
    const secret = this.getWebhookSecret();
    if (!secret) {
      // If secret not configured in dev, log warning but allow review in sandbox
      console.warn('[Relworx Webhook] RELWORX_WEBHOOK_SECRET not set in environment.');
      return true;
    }

    if (!signatureHeader) {
      return false;
    }

    try {
      const bodyString = typeof payloadBody === 'string' ? payloadBody : JSON.stringify(payloadBody);
      const computedHash = crypto.createHmac('sha256', secret).update(bodyString).digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signatureHeader.trim().toLowerCase()),
        Buffer.from(computedHash.toLowerCase())
      );
    } catch (err) {
      console.error('[Relworx Signature Verification Error]', err);
      return false;
    }
  },
};
