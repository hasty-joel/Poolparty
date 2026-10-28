import dotenv from 'dotenv';

dotenv.config();

/**
 * MTN Mobile Money Merchant Service & API Readiness Module
 *
 * Current mode: Manual MTN MoMo Merchant payment processing
 * - Merchant dials: *165*3# (MoMoPay) or uses MTN MoMo App
 * - Customer transfers to MTN_MERCHANT_CODE with order reference
 * - Customer submits MTN Transaction ID
 * - Admin verifies against official MTN MoMo portal/SMS and issues QR tickets
 *
 * Future mode: Ready for official MTN MoMo Open API (Collections / RequestToPay)
 */

export interface MtnMerchantConfig {
  configured: boolean;
  merchantCode?: string;
  merchantName?: string;
  currency: 'UGX';
  instructions: {
    ussdCode: string;
    ussdDialUrl: string;
    steps: string[];
  };
  warning?: string;
}

export interface MtnPaymentSubmission {
  orderRef: string;
  mtnTransactionId: string;
  payerPhone: string;
  submissionNotes?: string;
}

export const MtnMoMoService = {
  /**
   * Retrieve configured MTN Merchant code from environment.
   * NEVER hardcodes or invents a fake code.
   */
  getMerchantCode(): string | undefined {
    const raw = process.env.MTN_MERCHANT_CODE;
    if (!raw) return undefined;
    const clean = raw.trim().replace(/^["']|["']$/g, '');
    return clean.length > 0 ? clean : undefined;
  },

  getMerchantName(): string {
    const raw = process.env.MTN_MERCHANT_NAME;
    if (raw && raw.trim().length > 0) {
      return raw.trim().replace(/^["']|["']$/g, '');
    }
    return 'Prince Resort (Pool Party 2026)';
  },

  /**
   * Configurable MTN USSD entry point (defaults to *165*3#)
   */
  getUssdCode(): string {
    const raw = process.env.MTN_USSD_CODE;
    if (raw && raw.trim().length > 0 && raw.trim() !== 'undefined') {
      return raw.trim().replace(/^["']|["']$/g, '');
    }
    return '*165*3#';
  },

  /**
   * Safe tel: URL with # encoded as %23 for mobile phone dialers
   */
  getUssdDialUrl(): string {
    const code = this.getUssdCode();
    const encoded = code.replace(/#/g, '%23');
    return `tel:${encoded}`;
  },

  isConfigured(): boolean {
    const code = this.getMerchantCode();
    return Boolean(code && code.length >= 3);
  },

  /**
   * Public configuration and instructions for the checkout UI
   */
  getPublicConfig(): MtnMerchantConfig {
    const code = this.getMerchantCode();
    const name = this.getMerchantName();
    const ussdCode = this.getUssdCode();
    const ussdDialUrl = this.getUssdDialUrl();

    if (!code) {
      return {
        configured: false,
        currency: 'UGX',
        warning:
          'MTN Merchant Code is currently pending setup in environment variables (MTN_MERCHANT_CODE). Please contact event organizers.',
        instructions: {
          ussdCode,
          ussdDialUrl,
          steps: [
            'Merchant Code is currently pending configuration.',
            'Please contact the event administrator or check back shortly.',
          ],
        },
      };
    }

    return {
      configured: true,
      merchantCode: code,
      merchantName: name,
      currency: 'UGX',
      instructions: {
        ussdCode,
        ussdDialUrl,
        steps: [
          `On your MTN phone, dial ${ussdCode} (MoMoPay / Merchant Payment) or open the MTN MoMo app.`,
          `Enter Merchant Code: ${code}`,
          'Enter the exact ticket amount in UGX.',
          'Enter the Order Reference as payment reference / reason.',
          'Enter your MTN Mobile Money PIN to authorize the payment on your device.',
          'Check your MTN SMS confirmation message and copy the MTN Transaction ID.',
          'Enter the Transaction ID below and submit for admin verification.',
        ],
      },
    };
  },

  /**
   * Standardize and sanitize Ugandan phone number
   */
  formatUgandaPhone(phone: string): { msisdn: string; local: string; valid: boolean } {
    let clean = phone.replace(/[\s\-\(\)]/g, '');

    if (clean.startsWith('+256')) {
      clean = clean.substring(4);
    } else if (clean.startsWith('256')) {
      clean = clean.substring(3);
    } else if (clean.startsWith('0')) {
      clean = clean.substring(1);
    }

    // MTN Uganda numbers usually start with 77, 78, 76, or other national prefixes
    const valid = /^[73][0-9]{8}$/.test(clean);
    return {
      msisdn: `+256${clean}`,
      local: `0${clean}`,
      valid,
    };
  },

  /**
   * Sanitize and validate MTN Transaction ID format
   */
  sanitizeTransactionId(txId: string): { valid: boolean; cleaned: string; error?: string } {
    if (!txId || typeof txId !== 'string') {
      return { valid: false, cleaned: '', error: 'Transaction ID is required.' };
    }

    const cleaned = txId.trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, '');

    if (cleaned.length < 5) {
      return {
        valid: false,
        cleaned,
        error: 'MTN Transaction ID is too short (must be at least 5 characters from your MTN SMS).',
      };
    }

    if (cleaned.length > 50) {
      return {
        valid: false,
        cleaned,
        error: 'MTN Transaction ID exceeds maximum allowed length.',
      };
    }

    // Guard against placeholder / dummy submissions
    const dummyWords = ['NONE', 'TEST', 'FAKE', '12345', '00000', 'NULL', 'NA', 'N/A'];
    if (dummyWords.includes(cleaned)) {
      return {
        valid: false,
        cleaned,
        error: 'Please enter the real MTN Transaction ID from your confirmation SMS.',
      };
    }

    return { valid: true, cleaned };
  },

  // -------------------------------------------------------------
  // AUTOMATIC CONFIRMATION READINESS (MTN MoMo Open API Hook)
  // -------------------------------------------------------------
  /**
   * Hook for MTN MoMo Open API collections.
   * If MTN_MOMO_API_KEY, MTN_MOMO_USER_ID, MTN_MOMO_PRIMARY_KEY are provided in the future,
   * this method can query the official MTN API without breaking manual workflows.
   */
  isApiModeEnabled(): boolean {
    return Boolean(
      process.env.MTN_MOMO_API_KEY &&
      process.env.MTN_MOMO_USER_ID &&
      process.env.MTN_MOMO_PRIMARY_KEY
    );
  },

  async queryOfficialMtnApiStatus(_transactionId: string): Promise<{
    available: boolean;
    status?: 'SUCCESSFUL' | 'PENDING' | 'FAILED';
    message?: string;
  }> {
    if (!this.isApiModeEnabled()) {
      return {
        available: false,
        message: 'Official MTN MoMo Open API credentials not configured. Using manual merchant verification.',
      };
    }

    // Placeholder for future official MTN MoMo API call
    return {
      available: false,
      message: 'MTN MoMo API verification pending approval.',
    };
  },
};
