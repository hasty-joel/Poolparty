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

  getWebhookUrl(): string {
    const configured = process.env.RELWORX_WEBHOOK_URL;
    if (configured) return configured;
    const appUrl = process.env.APP_URL || process.env.VERCEL_URL;
    if (appUrl) {
      const origin = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`;
      return `${origin.replace(/\/$/, '')}/api/payments/relworx-webhook`;
    }
    return 'https://poolparty.ug/api/payments/relworx-webhook';
  },

  isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 5 && !key.includes('your_'));
  },

  /**
   * Format phone number to Relworx MSISDN specification (+256XXXXXXXXX)
   * Supports both 07XXXXXXXX and 03XXXXXXXX Uganda prefixes
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

    // In production, strictly reject initiation if gateway credentials are missing (never fake live payments)
    if (process.env.NODE_ENV === 'production' && !this.isConfigured() && process.env.RELWORX_SIMULATE_TEST !== 'true') {
      return {
        success: false,
        message: 'Relworx payment gateway is not configured for production. Please configure RELWORX_API_KEY and RELWORX_ACCOUNT_NO in Vercel environment variables.',
        error: 'GATEWAY_NOT_CONFIGURED',
      };
    }

    if (!this.isConfigured() || process.env.RELWORX_SIMULATE_TEST === 'true' || process.env.NODE_ENV === 'test') {
      return {
        success: true,
        message: `Relworx payment request simulated. Approve prompt on handset: ${msisdn} for UGX ${params.amount.toLocaleString()}. Set RELWORX_API_KEY in environment for live transactions.`,
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
        let errMsg = data.message || data.error || `Relworx API responded with HTTP ${response.status}`;
        if (data.error_code === 'API_DISABLED' || errMsg.includes('API disabled')) {
          errMsg = 'Relworx API is currently disabled for this business account. Please enable API access in your Relworx dashboard (https://payments.relworx.com/account/api).';
        }
        return {
          success: false,
          message: errMsg,
          error: data.error_code || errMsg,
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
      if (accountNo) {
        queryParams.append('account_no', accountNo);
      }

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
        amount: data.amount ? Number(data.amount) : undefined,
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
   * Verify official Relworx webhook signature according to documentation specifications:
   * Header: "Relworx-Signature: t=1561370460,v=..."
   *
   * 1. Extract timestamp (t) and signature (v) from the header.
   * 2. Prevent replay attacks (check timestamp age within 15 minutes).
   * 3. Construct string-to-sign:
   *    - exact registered webhook URL + timestamp t
   *    - alphabetically sorted POST variables appended consecutively with no delimiter.
   * 4. Compute HMAC-SHA256 with the secret key and compare securely.
   */
  verifyWebhookSignature(
    signatureHeader: string | undefined,
    payloadBody: Record<string, any>,
    incomingUrl?: string
  ): { valid: boolean; reason?: string } {
    const secret = this.getWebhookSecret();
    if (!secret || secret.trim().length === 0 || secret.includes('your_')) {
      // In development / testing before credentials are input into Vercel
      console.warn('[Relworx Webhook] RELWORX_WEBHOOK_SECRET not configured. Allowing test payload in sandbox.');
      return { valid: true, reason: 'SANDBOX_NO_SECRET_CONFIGURED' };
    }

    if (!signatureHeader) {
      return { valid: false, reason: 'MISSING_SIGNATURE_HEADER' };
    }

    try {
      let timestamp: number | null = null;
      let signatureValue: string | null = null;

      // Parse "t=...,v=..." or "t=...,v1=..."
      if (signatureHeader.includes('=')) {
        const parts = signatureHeader.split(',');
        for (const part of parts) {
          const [k, v] = part.split('=').map((s) => s.trim());
          if (k === 't' && v) {
            timestamp = parseInt(v, 10);
          } else if ((k === 'v' || k === 'v1' || k === 'signature') && v) {
            signatureValue = v;
          }
        }
      } else {
        // Direct raw signature fallback
        signatureValue = signatureHeader.trim();
      }

      if (!signatureValue) {
        return { valid: false, reason: 'EMPTY_SIGNATURE_VALUE' };
      }

      // Replay attack prevention: validate timestamp age if present (within 15 minutes)
      if (timestamp && !isNaN(timestamp)) {
        const nowSec = Math.floor(Date.now() / 1000);
        const ageSec = Math.abs(nowSec - timestamp);
        if (ageSec > 900) {
          return { valid: false, reason: `EXPIRED_TIMESTAMP_${ageSec}s_OLD` };
        }
      }

      // Construct canonical string-to-sign per Relworx docs:
      // URL + timestamp + sorted payload keys & values (no delimiter)
      const targetUrl = incomingUrl || this.getWebhookUrl();
      let stringToSign = targetUrl;
      if (timestamp) {
        stringToSign += String(timestamp);
      }

      if (payloadBody && typeof payloadBody === 'object') {
        const sortedKeys = Object.keys(payloadBody).sort();
        for (const k of sortedKeys) {
          const val = payloadBody[k];
          if (val !== undefined && val !== null) {
            stringToSign += `${k}${typeof val === 'object' ? JSON.stringify(val) : String(val)}`;
          }
        }
      }

      // Compute HMAC-SHA256
      const hmac = crypto.createHmac('sha256', secret).update(stringToSign);
      const computedHex = hmac.digest('hex');
      const computedBase64 = crypto.createHmac('sha256', secret).update(stringToSign).digest('base64');

      // Also compute fallback raw body HMAC for broad compatibility
      const rawBodyHmacHex = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payloadBody))
        .digest('hex');

      const cleanSig = signatureValue.trim();

      // Constant-time comparison helper
      const matches = (a: string, b: string) => {
        const bufA = Buffer.from(a.toLowerCase());
        const bufB = Buffer.from(b.toLowerCase());
        return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
      };

      if (
        matches(cleanSig, computedHex) ||
        cleanSig === computedBase64 ||
        matches(cleanSig, rawBodyHmacHex)
      ) {
        return { valid: true };
      }

      return { valid: false, reason: 'SIGNATURE_MISMATCH' };
    } catch (err: any) {
      console.error('[Relworx Signature Verification Exception]', err);
      return { valid: false, reason: err?.message || 'VERIFICATION_ERROR' };
    }
  },

  /**
   * Helper to construct canonical Relworx-Signature header for testing or provider simulation
   */
  computeWebhookSignature(
    secret: string,
    payloadBody: Record<string, any>,
    timestamp: number,
    targetUrl?: string
  ): string {
    const url = targetUrl || this.getWebhookUrl();
    let stringToSign = `${url}${timestamp}`;
    const sortedKeys = Object.keys(payloadBody).sort();
    for (const k of sortedKeys) {
      const val = payloadBody[k];
      if (val !== undefined && val !== null) {
        stringToSign += `${k}${typeof val === 'object' ? JSON.stringify(val) : String(val)}`;
      }
    }
    const hex = crypto.createHmac('sha256', secret).update(stringToSign).digest('hex');
    return `t=${timestamp},v=${hex}`;
  },
};
