import dotenv from 'dotenv';
dotenv.config();

const FLW_BASE_URL = 'https://api.flutterwave.com/v3';

export interface FlwUgandaChargePayload {
  tx_ref: string;
  amount: number;
  currency: 'UGX';
  network: 'MTN' | 'AIRTEL';
  email: string;
  phone_number: string;
  fullname: string;
  redirect_url: string;
}

export interface FlwVerifyResponse {
  success: boolean;
  status: 'successful' | 'failed' | 'pending';
  amount: number;
  currency: string;
  tx_ref: string;
  flw_ref?: string;
  id?: number | string;
  rawResponse?: any;
  message?: string;
}

export const FlutterwaveService = {
  getSecretKey(): string | undefined {
    return process.env.FLUTTERWAVE_SECRET_KEY;
  },

  getWebhookHash(): string | undefined {
    return process.env.FLUTTERWAVE_WEBHOOK_HASH;
  },

  isConfigured(): boolean {
    const key = this.getSecretKey();
    return Boolean(key && key.trim().length > 10);
  },

  isTestMode(): boolean {
    const key = this.getSecretKey();
    return Boolean(key && key.startsWith('FLWSECK_TEST'));
  },

  /**
   * Format phone number to Uganda national or international MSISDN
   * (e.g. "0775 198 484" -> "256775198484" or "0775198484")
   */
  formatUgandaPhone(phone: string): { international: string; local: string } {
    let digits = phone.replace(/[^0-9]/g, '');
    if (digits.startsWith('256')) {
      const local = '0' + digits.slice(3);
      return { international: digits, local };
    }
    if (digits.startsWith('0')) {
      const intl = '256' + digits.slice(1);
      return { international: intl, local: digits };
    }
    if (digits.length === 9) {
      return { international: '256' + digits, local: '0' + digits };
    }
    return { international: digits, local: digits };
  },

  /**
   * Initiate Uganda Mobile Money Direct Charge
   * Docs: https://developer.flutterwave.com/docs/uganda
   * Endpoint: POST https://api.flutterwave.com/v3/charges?type=mobile_money_uganda
   */
  async initiateMobileMoneyCharge(payload: FlwUgandaChargePayload): Promise<{
    success: boolean;
    data?: any;
    authUrl?: string | null;
    flwRef?: string;
    flwTransactionId?: number | string;
    message: string;
    requiresHandsetApproval: boolean;
  }> {
    const secretKey = this.getSecretKey();
    if (!secretKey) {
      return {
        success: false,
        requiresHandsetApproval: false,
        message: 'FLUTTERWAVE_SECRET_KEY is not configured on the server.',
      };
    }

    try {
      const response = await fetch(`${FLW_BASE_URL}/charges?type=mobile_money_uganda`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tx_ref: payload.tx_ref,
          amount: payload.amount,
          currency: 'UGX',
          network: payload.network.toUpperCase(),
          email: payload.email,
          phone_number: payload.phone_number,
          fullname: payload.fullname,
          redirect_url: payload.redirect_url,
        }),
      });

      const json = await response.json();

      if (json.status === 'success') {
        const authUrl = json.data?.auth_url || json.data?.meta?.authorization?.redirect || null;
        const processorMsg =
          json.data?.processor_response ||
          `Push notification sent to ${payload.phone_number} on ${payload.network}. Please authorize the transaction on your handset.`;

        return {
          success: true,
          data: json.data,
          authUrl,
          flwRef: json.data?.flw_ref,
          flwTransactionId: json.data?.id,
          message: processorMsg,
          requiresHandsetApproval: true,
        };
      }

      // If direct mobile money returned an error or requires standard hosted fallback
      return {
        success: false,
        message: json.message || 'Payment initiation was declined by Flutterwave.',
        data: json,
        requiresHandsetApproval: false,
      };
    } catch (err: any) {
      console.error('Flutterwave mobile money API call error:', err);
      return {
        success: false,
        requiresHandsetApproval: false,
        message: err?.message || 'Network error reaching Flutterwave gateway.',
      };
    }
  },

  /**
   * Verify transaction server-side by Transaction ID
   * Docs: GET https://api.flutterwave.com/v3/transactions/{id}/verify
   */
  async verifyTransactionById(id: string | number): Promise<FlwVerifyResponse> {
    const secretKey = this.getSecretKey();
    if (!secretKey) {
      return {
        success: false,
        status: 'failed',
        amount: 0,
        currency: 'UGX',
        tx_ref: '',
        message: 'Server missing FLUTTERWAVE_SECRET_KEY',
      };
    }

    try {
      const response = await fetch(`${FLW_BASE_URL}/transactions/${id}/verify`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
      });

      const json = await response.json();

      if (json.status === 'success' && json.data) {
        return {
          success: true,
          status: json.data.status, // "successful", "failed", "pending"
          amount: json.data.amount,
          currency: json.data.currency,
          tx_ref: json.data.tx_ref,
          flw_ref: json.data.flw_ref,
          id: json.data.id,
          rawResponse: json.data,
          message: json.message,
        };
      }

      return {
        success: false,
        status: 'failed',
        amount: 0,
        currency: 'UGX',
        tx_ref: '',
        message: json.message || 'Verification failed on Flutterwave.',
      };
    } catch (err: any) {
      return {
        success: false,
        status: 'failed',
        amount: 0,
        currency: 'UGX',
        tx_ref: '',
        message: err?.message || 'Failed to verify transaction with Flutterwave.',
      };
    }
  },

  /**
   * Verify transaction server-side by Transaction Reference (tx_ref)
   * Docs: GET https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref={tx_ref}
   */
  async verifyTransactionByRef(txRef: string): Promise<FlwVerifyResponse> {
    const secretKey = this.getSecretKey();
    if (!secretKey) {
      return {
        success: false,
        status: 'failed',
        amount: 0,
        currency: 'UGX',
        tx_ref: txRef,
        message: 'Server missing FLUTTERWAVE_SECRET_KEY',
      };
    }

    try {
      const response = await fetch(
        `${FLW_BASE_URL}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${secretKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const json = await response.json();

      if (json.status === 'success' && json.data) {
        return {
          success: true,
          status: json.data.status,
          amount: json.data.amount,
          currency: json.data.currency,
          tx_ref: json.data.tx_ref,
          flw_ref: json.data.flw_ref,
          id: json.data.id,
          rawResponse: json.data,
          message: json.message,
        };
      }

      return {
        success: false,
        status: 'pending',
        amount: 0,
        currency: 'UGX',
        tx_ref: txRef,
        message: json.message || 'Transaction not found or still pending.',
      };
    } catch (err: any) {
      return {
        success: false,
        status: 'pending',
        amount: 0,
        currency: 'UGX',
        tx_ref: txRef,
        message: err?.message || 'Verification request failed.',
      };
    }
  },

  /**
   * Validate Webhook Signature
   * Flutterwave sends the secret hash in the `verif-hash` request header
   */
  verifyWebhookSignature(headerHash: string | undefined): boolean {
    const configuredHash = this.getWebhookHash();
    if (!configuredHash) {
      // If no hash is configured yet in environment, log warning
      console.warn('FLUTTERWAVE_WEBHOOK_HASH is not configured.');
      return false;
    }
    return Boolean(headerHash && headerHash.trim() === configuredHash.trim());
  },
};
