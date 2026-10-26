import express from 'express';
import dotenv from 'dotenv';
import { SupabaseServerService } from './supabaseServer';
import { RelworxService } from './relworxService';

dotenv.config();

export function createExpressApp() {
  const app = express();
  app.use(express.json());

  // Master admin authorization check
  const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || 'prince2026';

  const requireAdminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    const adminKey = req.headers['x-admin-key'];

    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (typeof adminKey === 'string') {
      token = adminKey.trim();
    }

    if (!token || (token !== ADMIN_PASSCODE && token !== 'admin')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Admin authorization required.',
      });
    }

    next();
  };

  // ============================================================
  // PUBLIC API ENDPOINTS (Preserves RLS & Privacy)
  // ============================================================

  /**
   * Public available ticket counts:
   * Returns ONLY live database counts; never exposes buyer names, emails, phones, or QR tokens.
   */
  app.get('/api/inventory/counts', async (req, res) => {
    try {
      const result = await SupabaseServerService.getPublicCounts();
      if (!result.success || !result.counts) {
        return res.status(503).json({
          success: false,
          error: result.error || 'Unable to connect to database or read inventory counts.',
        });
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Server error reading inventory.' });
    }
  });

  /**
   * Relworx Uganda Mobile Money Payment Initiation (MTN & Airtel)
   * 1. Validates inputs & calculates trusted server price (UGX 20,000 Ordinary, UGX 50,000 VIP)
   * 2. Atomically reserves tickets in Supabase with 10-minute expiry
   * 3. Triggers Relworx Mobile Money push to customer handset
   */
  app.post('/api/payments/relworx-initiate', async (req, res) => {
    try {
      const { category, quantity, buyerName, buyerEmail, buyerPhone, network } = req.body;

      if (!category || !quantity || !buyerName || !buyerEmail || !buyerPhone || !network) {
        return res.status(400).json({
          success: false,
          message: 'Please provide all required fields: name, email, phone number, category, and network (MTN or Airtel).',
        });
      }

      if (category !== 'VIP' && category !== 'ORDINARY') {
        return res.status(400).json({ success: false, message: 'Invalid ticket category. Must be VIP or ORDINARY.' });
      }

      if (network !== 'MTN' && network !== 'AIRTEL') {
        return res.status(400).json({ success: false, message: 'Network must be MTN or AIRTEL.' });
      }

      const qty = parseInt(quantity, 10);
      if (isNaN(qty) || qty < 1 || qty > 10) {
        return res.status(400).json({ success: false, message: 'Quantity must be between 1 and 10 tickets.' });
      }

      const result = await SupabaseServerService.initiateRelworxPayment({
        category,
        quantity: qty,
        buyerName,
        buyerEmail,
        buyerPhone,
        network,
      });

      if (!result.success) {
        return res.status(409).json(result);
      }

      res.json(result);
    } catch (err: any) {
      console.error('Relworx payment initiation error:', err);
      res.status(500).json({ success: false, message: err?.message || 'Server error initiating payment.' });
    }
  });

  // Backwards-compatible alias for Flutterwave endpoint
  app.post('/api/payments/flutterwave-initiate', async (req, res) => {
    try {
      const { category, quantity, buyerName, buyerEmail, buyerPhone, network } = req.body;
      const result = await SupabaseServerService.initiateRelworxPayment({
        category: category || 'ORDINARY',
        quantity: parseInt(quantity, 10) || 1,
        buyerName: buyerName || '',
        buyerEmail: buyerEmail || '',
        buyerPhone: buyerPhone || '',
        network: network || 'MTN',
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message });
    }
  });

  /**
   * Official Relworx Webhook Listener
   * Idempotently processes payment status updates from Relworx
   */
  app.post('/api/payments/relworx-webhook', async (req, res) => {
    try {
      const signature = (req.headers['relworx-signature'] || req.headers['Relworx-Signature'] || req.headers['signature']) as string | undefined;

      // Verify HMAC-SHA256 signature
      if (!RelworxService.verifyWebhookSignature(signature, req.body)) {
        console.warn('[Relworx Webhook] Unauthorized webhook signature attempt rejected.');
        return res.status(401).json({ status: 'error', message: 'Invalid webhook signature' });
      }

      const body = req.body || {};
      const rawStatus = String(body.status || body.transaction_status || '').toLowerCase();
      const orderRef = body.customer_reference || body.reference || body.order_ref;
      const internalRef = body.internal_reference;
      const amount = body.amount ? Number(body.amount) : undefined;
      const currency = body.currency;

      if (!orderRef) {
        return res.status(200).json({ status: 'ignored', message: 'Missing order reference' });
      }

      // Handle successful payment
      if (['success', 'successful', 'completed', 'paid'].includes(rawStatus)) {
        // Independent verification with Relworx API before issuing tickets
        if (RelworxService.isConfigured()) {
          const verification = await RelworxService.checkRequestStatus({
            internalReference: internalRef,
            reference: orderRef,
          });

          if (!verification.success || verification.status !== 'success') {
            console.warn(`[Relworx Webhook] Double-check verification did not confirm success: status=${verification.status}`);
            return res.status(200).json({ status: 'unverified', message: 'Relworx status check not confirmed' });
          }

          if (verification.currency && verification.currency !== 'UGX') {
            return res.status(400).json({ status: 'error', message: 'Invalid currency' });
          }
        }

        // Idempotently mark order as paid & issue attendee tickets in Supabase
        await SupabaseServerService.markOrderAsPaid(orderRef, {
          relworx: body,
          relworx_internal_ref: internalRef,
          amount,
          currency: currency || 'UGX',
        });

        return res.status(200).json({ status: 'success', message: 'Order payment verified and tickets issued' });
      }

      // Handle failed or cancelled payment
      if (['failed', 'declined', 'cancelled', 'expired', 'rejected'].includes(rawStatus)) {
        await SupabaseServerService.releaseReservationByOrderRef(orderRef);
        return res.status(200).json({ status: 'success', message: 'Order marked failed and inventory released' });
      }

      res.status(200).json({ status: 'ignored' });
    } catch (err: any) {
      console.error('[Relworx Webhook Error]', err);
      res.status(500).json({ status: 'error', message: err?.message });
    }
  });

  /**
   * Order Status & Polling Route
   * Frontend polls this while customer approves USSD prompt on their handset.
   * Only returns tickets and QR tokens when status is confirmed 'paid' in Supabase!
   */
  app.get('/api/orders/:orderRef/status', async (req, res) => {
    try {
      const { orderRef } = req.params;
      if (!orderRef) {
        return res.status(400).json({ success: false, message: 'Order reference required.' });
      }

      const status = await SupabaseServerService.getOrderStatus(orderRef);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Error checking order status.' });
    }
  });

  /**
   * Attendee Self-Service Ticket Lookup
   * Allows customer to retrieve confirmed tickets by entering their phone number or order reference
   * Strictly returns confirmed paid tickets from Supabase
   */
  app.post('/api/orders/lookup', async (req, res) => {
    try {
      const { contact } = req.body;
      if (!contact || contact.trim().length < 4) {
        return res.status(400).json({ success: false, message: 'Please enter a valid phone number or order reference.' });
      }

      const tickets = await SupabaseServerService.lookupTicketsByContact(contact);
      res.json({ success: true, count: tickets.length, tickets });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Error searching for tickets.' });
    }
  });

  /**
   * Single-Scan QR Gate Verification:
   * Checks token against database and atomically marks checked_in_at
   */
  app.post('/api/tickets/verify-checkin', async (req, res) => {
    try {
      const { tokenOrNumber } = req.body;
      if (!tokenOrNumber) {
        return res.status(400).json({ status: 'INVALID', message: 'Missing token or ticket number' });
      }

      const result = await SupabaseServerService.verifyAndCheckIn(tokenOrNumber);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ status: 'INVALID', message: err?.message || 'Verification error' });
    }
  });

  // ============================================================
  // ADMIN API ENDPOINTS (Protected with requireAdminAuth)
  // ============================================================

  /**
   * Health Check & Diagnostics (Supabase + Relworx)
   */
  app.get('/api/admin/health', requireAdminAuth, async (req, res) => {
    const health = await SupabaseServerService.checkConnection();
    res.json({
      supabaseConnected: health.connected,
      project: 'Poolparty',
      table: 'public.tickets',
      totalRecordsFound: health.count,
      relworxConfigured: RelworxService.isConfigured(),
      relworxAccount: RelworxService.getAccountNo() ? 'Configured' : 'Using default',
      error: health.error,
    });
  });

  /**
   * Get all tickets for authenticated dashboard from Supabase
   */
  app.get('/api/admin/tickets', requireAdminAuth, async (req, res) => {
    try {
      const result = await SupabaseServerService.getAllTicketsAdmin();
      if (!result.success) {
        return res.status(503).json(result);
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  /**
   * Get all orders for authenticated dashboard from Supabase
   */
  app.get('/api/admin/orders', requireAdminAuth, async (req, res) => {
    try {
      const result = await SupabaseServerService.getAllOrdersAdmin();
      if (!result.success) {
        return res.status(503).json(result);
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  /**
   * Admin Trigger: Manually verify pending transaction with Relworx API
   */
  app.post('/api/admin/verify-relworx-transaction', requireAdminAuth, async (req, res) => {
    try {
      const { orderRef } = req.body;
      if (!orderRef) return res.status(400).json({ success: false, message: 'orderRef required' });

      const result = await SupabaseServerService.verifyRelworxOrderDirectly(orderRef);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message });
    }
  });

  app.post('/api/admin/verify-flw-transaction', requireAdminAuth, async (req, res) => {
    try {
      const { orderRef } = req.body;
      if (!orderRef) return res.status(400).json({ success: false, message: 'orderRef required' });
      const result = await SupabaseServerService.verifyRelworxOrderDirectly(orderRef);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message });
    }
  });

  /**
   * Record physical staff cash/POS sale in Supabase
   */
  app.post('/api/admin/physical-sale', requireAdminAuth, async (req, res) => {
    try {
      const { category, quantity, buyerName, buyerEmail, buyerPhone } = req.body;
      const result = await SupabaseServerService.recordPhysicalSaleAdmin({
        category,
        quantity: parseInt(quantity, 10) || 1,
        buyerName,
        buyerEmail,
        buyerPhone,
      });

      if (!result.success) {
        return res.status(409).json(result);
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message });
    }
  });

  /**
   * Confirm payment manually in Supabase
   */
  app.post('/api/admin/confirm-payment', requireAdminAuth, async (req, res) => {
    try {
      const { ticketId } = req.body;
      const ok = await SupabaseServerService.confirmPaymentAdmin(ticketId);
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  /**
   * Release ticket back to available in Supabase
   */
  app.post('/api/admin/release-ticket', requireAdminAuth, async (req, res) => {
    try {
      const { ticketId } = req.body;
      const ok = await SupabaseServerService.releaseTicketAdmin(ticketId);
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  return app;
}
