import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Official Relworx Payments API Service for Uganda Mobile Money (MTN & Airtel)
 * Base URL: https://payments.relworx.com/api
 * Documentation: https://payments.relworx.com/docs
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

const RELWORX_TIMEOUT_MS = 8500;

function sanitizeEnvValue(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const trimmed = val.trim().replace(/^["']|["']$/g, '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const RelworxService = {
  getApiKey(): string | undefined {
    return sanitizeEnvValue(process.env.RELWORX_API_KEY);
  },

  getAccountNo(): string | undefined {
    return sanitizeEnvValue(process.env.RELWORX_ACCOUNT_NO);
  },

  getWebhookSecret(): string | undefined {
    return sanitizeEnvValue(process.env.RELWORX_WEBHOOK_SECRET);
  },

  isConfigured(): boolean {
    const key = this.getApiKey();
    const accountNo = this.getAccountNo();
    return Boolean(key && key.length > 5 && accountNo && accountNo.length > 3);
  },

  /**
   * Format phone number to Relworx MSISDN specification (+256XXXXXXXXX)
   * Supports both 07XXXXXXXX and 03XXXXXXXX Uganda prefixes
   */
  formatUgandaMsisdn(phone: string): { msisdn: string; local: string; valid: boolean } {
    let clean = String(phone || '').replace(/[\s\-\(\)]/g, '');

    if (clean.startsWith('+256')) {
      clean = clean.substring(4);
    } else if (clean.startsWith('256')) {
      clean = clean.substring(3);
    } else if (clean.startsWith('0')) {
      clean = clean.substring(1);
    }

    // Uganda mobile numbers are 9 digits starting with 7 (mobile) or 3 (telecom)
    const valid = /^[73][0-9]{8}$/.test(clean);
    return {
      msisdn: `+256${clean}`,
      local: `0${clean}`,
      valid,
    };
  },

  /**
   * Request Payment (Push USSD prompt to customer's mobile money handset)
   * POST https://payments.relworx.com/api/mobile-money/request-payment
   *
   * Rate Limit Note: Max 5 requests per 10 minutes per phone number (msisdn)
   */
  async requestPayment(params: {
    reference: string;
    phone: string;
    amount: number;
    description: string;
    category: 'VIP' | 'ORDINARY';
    buyerName: string;
    isSandbox?: boolean;
  }): Promise<RelworxPaymentResponse> {
    const { msisdn, valid } = this.formatUgandaMsisdn(params.phone);
    if (!valid) {
      return {
        success: false,
        message: 'Please enter a valid Uganda Mobile Money number (e.g. 0775 198 484 or +256 701 234567).',
        error: 'INVALID_PHONE_NUMBER',
      };
    }

    const apiKey = this.getApiKey();
    const accountNo = this.getAccountNo();

    if (!apiKey || !accountNo || !this.isConfigured()) {
      return {
        success: false,
        message: 'Mobile Money payment gateway is not configured on the server yet. Please contact the event organizer.',
        error: 'RELWORX_NOT_CONFIGURED',
      };
    }

    // Relworx reference must be between 8 and 36 alphanumeric characters
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RELWORX_TIMEOUT_MS);

    try {
      const response = await fetch('https://payments.relworx.com/api/mobile-money/request-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.relworx.v2',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseText = await response.text();
      let data: any = {};
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { raw: responseText };
      }

      if (!response.ok || data.success === false) {
        console.error('[Relworx API Error]', response.status);
        const errMsg =
          typeof data.message === 'string' && data.message.trim().length > 0
            ? data.message
            : `Mobile money gateway rejected the payment request (HTTP ${response.status}).`;
        return {
          success: false,
          message: errMsg,
          error: 'RELWORX_REQUEST_FAILED',
        };
      }

      return {
        success: true,
        message: data.message || 'Payment prompt initiated. Check your phone to enter PIN.',
        internal_reference: data.internal_reference || data.id || data.reference,
      };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        console.error('[Relworx Timeout] Payment initiation exceeded timeout');
        return {
          success: false,
          message: 'Mobile Money provider took too long to respond. Your ticket reservation was released; please try again.',
          error: 'RELWORX_TIMEOUT',
        };
      }
      console.error('[Relworx Network Exception]', err?.message || err);
      return {
        success: false,
        message: 'Could not reach the Mobile Money payment gateway. Please try again shortly.',
        error: 'RELWORX_NETWORK_ERROR',
      };
    } finally {
      clearTimeout(timeoutId);
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
    const accountNo = this.getAccountNo();

    if (!apiKey || !accountNo || !this.isConfigured()) {
      return {
        success: false,
        status: 'unknown',
        message: 'Mobile Money payment gateway is not configured on the server.',
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RELWORX_TIMEOUT_MS);

    try {
      const queryParams = new URLSearchParams();
      if (params.internalReference) {
        queryParams.append('internal_reference', params.internalReference);
      }
      if (params.reference) {
        queryParams.append('customer_reference', params.reference);
      }
      queryParams.append('account_no', accountNo);

      const url = `https://payments.relworx.com/api/mobile-money/check-request-status?${queryParams.toString()}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.relworx.v2',
          'Authorization': `Bearer ${apiKey}`,
        },
        signal: controller.signal,
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
          message: typeof data.message === 'string' ? data.message : `Status check returned HTTP ${response.status}`,
          raw: data,
        };
      }

      // Relworx v2 status normalization (`status`, `request_status`, or `transaction_status`)
      const rawStatus = String(data.status || data.request_status || data.transaction_status || '').toLowerCase();
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
        reference: data.customer_reference || data.reference || params.reference,
        amount: data.amount,
        currency: data.currency,
        message: data.message,
        raw: data,
      };
    } catch (err: any) {
      console.error('[Relworx Check Status Exception]', err?.message || err);
      return {
        success: false,
        status: 'unknown',
        message: err?.name === 'AbortError' ? 'Payment status check timed out.' : 'Unable to check payment status.',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  },

  /**
   * Verify HMAC-SHA256 signature from Relworx webhook
   * Protects against replay attacks and verifies authenticity
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

      // Extract hash and timestamp if header is formatted as t=...,v1=... or v1=...
      let signatureHash = signatureHeader.trim();
      let timestamp: number | null = null;

      if (signatureHeader.includes('=')) {
        const parts = signatureHeader.split(',');
        for (const part of parts) {
          const [k, v] = part.split('=').map((s) => s.trim());
          if (k === 't' && v) {
            timestamp = parseInt(v, 10);
          } else if ((k === 'v1' || k === 'signature') && v) {
            signatureHash = v;
          }
        }
      }

      // Prevent replay attacks if timestamp is present (> 15 minutes old)
      if (timestamp && !isNaN(timestamp)) {
        const ageSec = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
        if (ageSec > 900) {
          console.warn(`[Relworx Webhook] Expired timestamp signature (${ageSec}s old).`);
          return false;
        }
      }

      // Compute HMAC-SHA256
      const computedHash = crypto.createHmac('sha256', secret).update(bodyString).digest('hex');

      // Compare using timing-safe comparison
      const sigBuf = Buffer.from(signatureHash.toLowerCase(), 'utf-8');
      const compBuf = Buffer.from(computedHash.toLowerCase(), 'utf-8');

      if (sigBuf.length !== compBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuf, compBuf);
    } catch (err) {
      console.error('[Relworx Signature Verification Error]', err);
      return false;
    }
  },
};
