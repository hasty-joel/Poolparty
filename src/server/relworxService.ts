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
  code?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
}

export interface RelworxStatusCheckResult {
  success: boolean;
  status: 'pending' | 'success' | 'failed' | 'unknown';
  internal_reference?: string;
  reference?: string;
  amount?: number;
  currency?: string;
  message?: string;
  code?: string;
  raw?: any;
}

const RELWORX_TIMEOUT_MS = 8500;
const PROVIDER_DISABLED_COOLDOWN_MS = 30_000;

export const CUSTOMER_PAYMENTS_UNAVAILABLE_MESSAGE =
  'Mobile Money payments are temporarily unavailable right now. You have not been charged, and your selected passes remain available. Please try again later.';

let _providerDisabledUntilMs = 0;

function sanitizeEnvValue(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const trimmed = val.trim().replace(/^["']|["']$/g, '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Redact phone numbers, emails, account IDs, and bearer/API tokens before server logging
 */
export function sanitizeDiagnosticText(input: unknown): string {
  const raw = typeof input === 'string' ? input : '';
  if (!raw) return '';
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    .replace(/RELWORX_[A-Za-z0-9_\-]+/gi, 'RELWORX_[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\+?\d[\d\s\-()]{7,15}\d/g, '[REDACTED_PHONE]')
    .slice(0, 240);
}

/**
 * Extract normalized provider error code if present in Relworx response payload
 */
function extractProviderCode(data: any): string | undefined {
  const directCandidates = [
    data?.error_code,
    data?.code,
    typeof data?.error === 'string' ? data.error : data?.error?.code,
    data?.reason,
    data?.status_code,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      const normalized = candidate.trim().toUpperCase();
      if (/^[A-Z0-9_.\-]{2,64}$/.test(normalized)) {
        return normalized;
      }
    }
  }

  if (Array.isArray(data?.errors)) {
    for (const item of data.errors) {
      const itemCode = item?.error_code || item?.code;
      if (typeof itemCode === 'string' && itemCode.trim()) {
        return itemCode.trim().toUpperCase();
      }
    }
  }

  return undefined;
}

/**
 * Explicitly detect Relworx `API_DISABLED` responses across all v1/v2 payload variants
 */
export function isRelworxApiDisabledPayload(data: any, rawText: string = ''): boolean {
  const extractedCode = extractProviderCode(data);
  if (extractedCode === 'API_DISABLED' || (extractedCode && extractedCode.includes('API_DISABLED'))) {
    return true;
  }

  if (Array.isArray(data?.errors)) {
    for (const item of data.errors) {
      const itemText = `${item?.code || ''} ${item?.error_code || ''} ${item?.message || ''}`.toLowerCase();
      if (
        itemText.includes('api_disabled') ||
        itemText.includes('api access is disabled') ||
        itemText.includes('mobile money api is disabled')
      ) {
        return true;
      }
    }
  }

  const combinedMsg = [
    typeof data?.message === 'string' ? data.message : '',
    typeof data?.error === 'string' ? data.error : '',
    typeof data?.error_description === 'string' ? data.error_description : '',
    typeof data?.detail === 'string' ? data.detail : '',
    !rawText.trim().startsWith('<') ? rawText : '',
  ]
    .join(' ')
    .toLowerCase();

  return (
    combinedMsg.includes('api_disabled') ||
    combinedMsg.includes('mobile money api access is disabled') ||
    combinedMsg.includes('api access is disabled') ||
    combinedMsg.includes('mobile money api is disabled') ||
    combinedMsg.includes('api is disabled for this merchant')
  );
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
   * Short circuit-breaker cooldown so we never repeatedly call a disabled Relworx API
   */
  getDisabledCooldownRemainingSeconds(): number {
    const remainingMs = _providerDisabledUntilMs - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  },

  markProviderDisabled(cooldownMs: number = PROVIDER_DISABLED_COOLDOWN_MS): number {
    _providerDisabledUntilMs = Date.now() + cooldownMs;
    return Math.ceil(cooldownMs / 1000);
  },

  clearProviderDisabled(): void {
    _providerDisabledUntilMs = 0;
  },

  resetProviderStateForTests(): void {
    _providerDisabledUntilMs = 0;
  },

  getProviderHealthStatus(): 'not_configured' | 'api_disabled_cooldown' | 'configured' {
    if (!this.isConfigured()) return 'not_configured';
    if (this.getDisabledCooldownRemainingSeconds() > 0) return 'api_disabled_cooldown';
    return 'configured';
  },

  /**
   * Format phone number to Relworx MSISDN specification (+256XXXXXXXXX)
   * Supports both 07XXXXXXXX and 03XXXXXXXX Uganda prefixes
   */
  formatUgandaMsisdn(phone: string): { msisdn: string; local: string; valid: boolean } {
    let clean = String(phone || '').replace(/[\s\-()]/g, '');

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
   * Never automatically retries failed or disabled API calls.
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
        retryable: false,
      };
    }

    const apiKey = this.getApiKey();
    const accountNo = this.getAccountNo();

    if (!apiKey || !accountNo || !this.isConfigured()) {
      return {
        success: false,
        message: CUSTOMER_PAYMENTS_UNAVAILABLE_MESSAGE,
        error: 'RELWORX_NOT_CONFIGURED',
        retryable: true,
      };
    }

    // Short-circuit if Relworx recently reported API_DISABLED so we do not spam the provider
    const cooldownSecs = this.getDisabledCooldownRemainingSeconds();
    if (cooldownSecs > 0) {
      return {
        success: false,
        message: CUSTOMER_PAYMENTS_UNAVAILABLE_MESSAGE,
        error: 'PAYMENT_PROVIDER_UNAVAILABLE',
        code: 'API_DISABLED',
        retryable: true,
        retryAfterSeconds: cooldownSecs,
      };
    }

    // Relworx reference must be between 8 and 36 alphanumeric/hyphen characters
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
        const isApiDisabled = isRelworxApiDisabledPayload(data, responseText);
        const providerCode = isApiDisabled ? 'API_DISABLED' : extractProviderCode(data) || `HTTP_${response.status}`;

        // Log sanitized server-side diagnostic metadata (zero credentials, zero buyer PII)
        console.error('[Relworx Payment Initiation Rejected]', {
          orderRef: cleanRef,
          category: params.category,
          amountUgx: payload.amount,
          httpStatus: response.status,
          providerCode,
          providerDisabled: isApiDisabled,
          diagnostic: sanitizeDiagnosticText(data?.message || data?.error || ''),
        });

        if (isApiDisabled) {
          const retryAfterSeconds = this.markProviderDisabled();
          return {
            success: false,
            message: CUSTOMER_PAYMENTS_UNAVAILABLE_MESSAGE,
            error: 'PAYMENT_PROVIDER_UNAVAILABLE',
            code: 'API_DISABLED',
            retryable: true,
            retryAfterSeconds,
          };
        }

        if (response.status === 401 || response.status === 403) {
          return {
            success: false,
            message: CUSTOMER_PAYMENTS_UNAVAILABLE_MESSAGE,
            error: 'PAYMENT_PROVIDER_UNAVAILABLE',
            code: 'PROVIDER_AUTH_ERROR',
            retryable: true,
            retryAfterSeconds: 30,
          };
        }

        if (response.status === 429) {
          return {
            success: false,
            message: 'Too many payment requests were sent recently. Please wait a minute before trying again.',
            error: 'RATE_LIMITED',
            code: 'RATE_LIMITED',
            retryable: true,
            retryAfterSeconds: 60,
          };
        }

        return {
          success: false,
          message:
            'Unable to send the Mobile Money prompt right now. You have not been charged—please verify your number and try again shortly.',
          error: 'RELWORX_REQUEST_FAILED',
          code: providerCode,
          retryable: true,
        };
      }

      // Provider accepted request — clear any previous disabled state
      this.clearProviderDisabled();

      return {
        success: true,
        message: data.message || 'Payment prompt initiated. Check your phone to enter PIN.',
        internal_reference: data.internal_reference || data.id || data.reference,
      };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        console.error('[Relworx Timeout]', {
          orderRef: cleanRef,
          category: params.category,
          amountUgx: payload.amount,
        });
        return {
          success: false,
          message: 'Mobile Money provider took too long to respond. Your reservation was released; please try again.',
          error: 'RELWORX_TIMEOUT',
          code: 'PROVIDER_TIMEOUT',
          retryable: true,
        };
      }
      console.error('[Relworx Network Exception]', {
        orderRef: cleanRef,
        diagnostic: sanitizeDiagnosticText(err?.message || 'Network failure'),
      });
      return {
        success: false,
        message: 'Could not reach the Mobile Money payment service right now. You have not been charged; please try again shortly.',
        error: 'RELWORX_NETWORK_ERROR',
        code: 'PROVIDER_NETWORK_ERROR',
        retryable: true,
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

    if (this.getDisabledCooldownRemainingSeconds() > 0) {
      return {
        success: false,
        status: 'unknown',
        code: 'API_DISABLED',
        message: CUSTOMER_PAYMENTS_UNAVAILABLE_MESSAGE,
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

      if (!response.ok || data.success === false) {
        const isApiDisabled = isRelworxApiDisabledPayload(data, responseText);
        if (isApiDisabled) {
          this.markProviderDisabled();
          console.error('[Relworx Status Check Rejected: API_DISABLED]', {
            orderRef: params.reference || null,
            httpStatus: response.status,
          });
          return {
            success: false,
            status: 'unknown',
            code: 'API_DISABLED',
            message: CUSTOMER_PAYMENTS_UNAVAILABLE_MESSAGE,
          };
        }

        return {
          success: false,
          status: 'unknown',
          code: extractProviderCode(data),
          message: 'Unable to confirm payment status with provider right now.',
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
      console.error('[Relworx Check Status Exception]', {
        orderRef: params.reference || null,
        diagnostic: sanitizeDiagnosticText(err?.message || 'Status check error'),
      });
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
      console.warn('[Relworx Webhook] RELWORX_WEBHOOK_SECRET not set in environment.');
      return true;
    }

    if (!signatureHeader) {
      return false;
    }

    try {
      const bodyString = typeof payloadBody === 'string' ? payloadBody : JSON.stringify(payloadBody);

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

      if (timestamp && !isNaN(timestamp)) {
        const ageSec = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
        if (ageSec > 900) {
          console.warn(`[Relworx Webhook] Expired timestamp signature (${ageSec}s old).`);
          return false;
        }
      }

      const computedHash = crypto.createHmac('sha256', secret).update(bodyString).digest('hex');

      const sigBuf = Buffer.from(signatureHash.toLowerCase(), 'utf-8');
      const compBuf = Buffer.from(computedHash.toLowerCase(), 'utf-8');

      if (sigBuf.length !== compBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuf, compBuf);
    } catch {
      console.error('[Relworx Signature Verification Error]');
      return false;
    }
  },
};
