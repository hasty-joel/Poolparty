import express from 'express';
import dotenv from 'dotenv';
import { SupabaseServerService } from './supabaseServer.js';
import { RelworxService, sanitizeDiagnosticText } from './relworxService.js';
import { MtnMoMoService } from './mtnMoMoService.js';

dotenv.config();

const SERVERLESS_ROUTE_PREFIXES = ['/inventory/', '/payments/', '/orders/', '/tickets/', '/admin/'];

export function createExpressApp() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // Normalize URLs if a serverless rewrite ever strips the leading `/api` prefix
  app.use((req, _res, next) => {
    if (!req.url.startsWith('/api/') && SERVERLESS_ROUTE_PREFIXES.some((p) => req.url.startsWith(p))) {
      req.url = `/api${req.url}`;
    }
    next();
  });

  // Master admin authorization check
  const getAdminPasscode = () => (process.env.ADMIN_PASSCODE || 'prince2026').trim();

  const requireAdminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    const adminKey = req.headers['x-admin-key'];

    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (typeof adminKey === 'string') {
      token = adminKey.trim();
    }

    const adminPasscode = getAdminPasscode();
    if (!token || token !== adminPasscode) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Valid Admin passcode required.',
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
  app.get('/api/inventory/counts', async (_req, res) => {
    try {
      const result = await SupabaseServerService.getPublicCounts();
      if (!result.success || !result.counts) {
        return res.status(503).json({
          success: false,
          error: result.error || 'Unable to connect to database or read inventory counts.',
        });
      }
      res.json(result);
    } catch {
      res.status(500).json({ success: false, error: 'Server error reading ticket inventory.' });
    }
  });

  /**
   * MTN Mobile Money Merchant Configuration:
   * Returns configured merchant code, name, and instructions.
   * If MTN_MERCHANT_CODE is missing, returns clear configuration notice.
   */
  app.get('/api/payments/mtn-config', (_req, res) => {
    try {
      const config = MtnMoMoService.getPublicConfig();
      res.json({ success: true, ...config });
    } catch {
      res.status(500).json({ success: false, error: 'Could not load MTN configuration' });
    }
  });

  /**
   * MTN Mobile Money Pass Reservation:
   * 1. Validates inputs & calculates trusted server price (UGX 20,000 Ordinary, UGX 50,000 VIP)
   * 2. Atomically locks tickets for 15 minutes
   * 3. Creates pending order and returns merchant payment instructions
   */
  app.post('/api/payments/mtn-reserve', async (req, res) => {
    try {
      const { category, quantity, buyerName, buyerEmail, buyerPhone } = req.body || {};
      if (!category || !quantity || !buyerName || !buyerEmail || !buyerPhone) {
        return res.status(400).json({
          success: false,
          message: 'Please provide all required fields: full name, email, phone number, category, and quantity.',
          error: 'VALIDATION_ERROR',
        });
      }

      const result = await SupabaseServerService.initiateMtnMerchantReservation({
        category,
        quantity: Number(quantity),
        buyerName: String(buyerName).trim(),
        buyerEmail: String(buyerEmail).trim(),
        buyerPhone: String(buyerPhone).trim(),
      });

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Server error while reserving passes.' });
    }
  });

  /**
   * MTN Mobile Money Transaction Submission:
   * Customer submits their MTN Transaction ID after paying to the merchant code.
   * Validates format, checks for duplicates, and sets verification_status = 'pending_verification'.
   * DOES NOT issue tickets or mark as paid!
   */
  app.post('/api/payments/mtn-submit', async (req, res) => {
    try {
      const { orderRef, mtnTransactionId, payerPhone, notes } = req.body || {};
      if (!orderRef || !mtnTransactionId || !payerPhone) {
        return res.status(400).json({
          success: false,
          message: 'Order reference, MTN Transaction ID, and payer phone number are required.',
          error: 'VALIDATION_ERROR',
        });
      }

      const txCheck = MtnMoMoService.sanitizeTransactionId(String(mtnTransactionId));
      if (!txCheck.valid) {
        return res.status(400).json({
          success: false,
          message: txCheck.error || 'Invalid MTN Transaction ID.',
          error: 'INVALID_TRANSACTION_ID',
        });
      }

      const result = await SupabaseServerService.submitMtnTransaction({
        orderRef: String(orderRef).trim(),
        mtnTransactionId: txCheck.cleaned,
        payerPhone: String(payerPhone).trim(),
        notes: notes ? String(notes).trim() : undefined,
      });

      if (!result.success) {
        const statusCode = result.error === 'DUPLICATE_TRANSACTION_ID' ? 409 : 400;
        return res.status(statusCode).json(result);
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Server error while submitting payment.' });
    }
  });

  /**
   * Shared payment initiation handler (Relworx Uganda Mobile Money - MTN & Airtel)
   * 1. Validates inputs & calculates trusted server price (UGX 20,000 Ordinary, UGX 50,000 VIP)
   * 2. Atomically reserves tickets in Supabase with 10-minute expiry
   * 3. Triggers Relworx Mobile Money push to customer handset
   */
  const handleInitiatePayment = async (req: express.Request, res: express.Response) => {
    try {
      const { category, quantity, buyerName, buyerEmail, buyerPhone, network, idempotencyKey } = req.body || {};
      const headerIdempotencyKey =
        typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'] : undefined;

      if (!category || quantity === undefined || quantity === null || !buyerName || !buyerEmail || !buyerPhone || !network) {
        return res.status(400).json({
          success: false,
          message: 'Please provide all required fields: full name, email, phone number, pass tier, quantity, and network (MTN or Airtel).',
          error: 'VALIDATION_ERROR',
        });
      }

      if (category !== 'VIP' && category !== 'ORDINARY') {
        return res.status(400).json({
          success: false,
          message: 'Invalid ticket category. Must be VIP or ORDINARY.',
          error: 'VALIDATION_ERROR',
        });
      }

      if (network !== 'MTN' && network !== 'AIRTEL') {
        return res.status(400).json({
          success: false,
          message: 'Network must be MTN or AIRTEL.',
          error: 'VALIDATION_ERROR',
        });
      }

      const qty = Number(quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
        return res.status(400).json({
          success: false,
          message: 'Quantity must be between 1 and 10 tickets.',
          error: 'VALIDATION_ERROR',
        });
      }

      if (typeof buyerName !== 'string' || buyerName.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Please enter your full name as it will appear on your pass.',
          error: 'VALIDATION_ERROR',
        });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (typeof buyerEmail !== 'string' || !emailRegex.test(buyerEmail.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address.',
          error: 'VALIDATION_ERROR',
        });
      }

      const phoneCheck = RelworxService.formatUgandaMsisdn(String(buyerPhone));
      if (!phoneCheck.valid) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid Uganda Mobile Money number (e.g. 0775 198 484 or +256 701 234567).',
          error: 'VALIDATION_ERROR',
        });
      }

      const result = await SupabaseServerService.initiateRelworxPayment({
        category,
        quantity: qty,
        buyerName: buyerName.trim(),
        buyerEmail: buyerEmail.trim(),
        buyerPhone: String(buyerPhone).trim(),
        network,
        idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : headerIdempotencyKey,
      });

      if (!result.success) {
        const errCode = result.error || '';
        const providerCode = result.code || '';

        if (result.retryAfterSeconds && result.retryAfterSeconds > 0) {
          res.setHeader('Retry-After', String(result.retryAfterSeconds));
        }

        if (errCode === 'VALIDATION_ERROR' || errCode === 'INVALID_PHONE_NUMBER') {
          return res.status(400).json(result);
        }
        if (errCode === 'INSUFFICIENT_INVENTORY') {
          return res.status(409).json(result);
        }
        if (errCode === 'RATE_LIMITED' || providerCode === 'RATE_LIMITED') {
          return res.status(429).json(result);
        }
        if (
          errCode === 'PAYMENT_PROVIDER_UNAVAILABLE' ||
          providerCode === 'API_DISABLED' ||
          errCode === 'SUPABASE_NOT_CONFIGURED' ||
          errCode === 'RELWORX_NOT_CONFIGURED' ||
          errCode === 'DATABASE_ERROR' ||
          errCode === 'SCHEMA_MISMATCH'
        ) {
          return res.status(503).json(result);
        }
        return res.status(502).json(result);
      }

      return res.status(200).json(result);
    } catch (err: any) {
      console.error('[Payment Initiation Route Error]', sanitizeDiagnosticText(err?.message || ''));
      return res.status(500).json({
        success: false,
        message: 'Unexpected server error while initiating payment. Please try again.',
        error: 'SERVER_ERROR',
      });
    }
  };

  app.post('/api/payments/relworx-initiate', handleInitiatePayment);
  app.post('/api/payments/flutterwave-initiate', handleInitiatePayment);

  /**
   * Official Relworx Webhook Listener
   * Idempotently processes payment status updates from Relworx
   */
  app.post('/api/payments/relworx-webhook', async (req, res) => {
    try {
      const signature = (req.headers['relworx-signature'] || req.headers['Relworx-Signature'] || req.headers['signature']) as string | undefined;

      if (!RelworxService.verifyWebhookSignature(signature, req.body)) {
        console.warn('[Relworx Webhook] Unauthorized webhook signature attempt rejected.');
        return res.status(401).json({ status: 'error', message: 'Invalid webhook signature' });
      }

      const body = req.body || {};
      const rawStatus = String(body.status || body.request_status || body.transaction_status || '').toLowerCase();
      const orderRef = body.customer_reference || body.reference || body.order_ref;
      const internalRef = body.internal_reference;
      const amount = body.amount ? Number(body.amount) : undefined;
      const currency = body.currency;

      if (!orderRef) {
        return res.status(200).json({ status: 'ignored', message: 'Missing order reference' });
      }

      if (['success', 'successful', 'completed', 'paid'].includes(rawStatus)) {
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

        await SupabaseServerService.markOrderAsPaid(orderRef, {
          relworx: body,
          relworx_internal_ref: internalRef,
          amount,
          currency: currency || 'UGX',
        });

        return res.status(200).json({ status: 'success', message: 'Order payment verified and tickets issued' });
      }

      if (['failed', 'declined', 'cancelled', 'expired', 'rejected'].includes(rawStatus)) {
        await SupabaseServerService.releaseReservationByOrderRef(orderRef);
        return res.status(200).json({ status: 'success', message: 'Order marked failed and inventory released' });
      }

      res.status(200).json({ status: 'ignored' });
    } catch (err: any) {
      console.error('[Relworx Webhook Error]', err?.message || err);
      res.status(500).json({ status: 'error', message: 'Webhook processing error' });
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
    } catch {
      res.status(500).json({ success: false, message: 'Error checking order status.' });
    }
  });

  /**
   * Attendee Self-Service Ticket Lookup
   * Strictly returns confirmed paid tickets from Supabase
   */
  app.post('/api/orders/lookup', async (req, res) => {
    try {
      const { contact } = req.body || {};
      if (!contact || typeof contact !== 'string' || contact.trim().length < 4) {
        return res.status(400).json({ success: false, message: 'Please enter a valid phone number or order reference.' });
      }

      const tickets = await SupabaseServerService.lookupTicketsByContact(contact);
      res.json({ success: true, count: tickets.length, tickets });
    } catch {
      res.status(500).json({ success: false, message: 'Error searching for tickets.' });
    }
  });

  /**
   * Single-Scan QR Gate Verification:
   * Checks token against database and atomically marks checked_in_at
   */
  app.post('/api/tickets/verify-checkin', async (req, res) => {
    try {
      const { tokenOrNumber } = req.body || {};
      if (!tokenOrNumber || typeof tokenOrNumber !== 'string' || !tokenOrNumber.trim()) {
        return res.status(400).json({ status: 'INVALID', message: 'Missing token or ticket number' });
      }

      const result = await SupabaseServerService.verifyAndCheckIn(tokenOrNumber);
      res.json(result);
    } catch {
      res.status(500).json({ status: 'INVALID', message: 'Verification error' });
    }
  });

  // ============================================================
  // ADMIN API ENDPOINTS (Protected with requireAdminAuth)
  // ============================================================

  app.get('/api/admin/health', requireAdminAuth, async (_req, res) => {
    const health = await SupabaseServerService.checkConnection();
    res.json({
      supabaseConnected: health.connected,
      project: 'Poolparty',
      table: 'public.tickets',
      totalRecordsFound: health.count,
      ticketsSchemaReady: health.ticketsSchemaReady,
      ordersTableReady: health.ordersTableReady,
      schemaWarning: health.schemaWarning,
      mtnMerchantConfigured: MtnMoMoService.isConfigured(),
      mtnMerchantCode: MtnMoMoService.getMerchantCode() ? 'Configured' : 'Missing (MTN_MERCHANT_CODE pending in .env)',
      mtnMerchantName: MtnMoMoService.getMerchantName(),
      relworxConfigured: RelworxService.isConfigured(),
      relworxStatus: RelworxService.getProviderHealthStatus(),
      relworxAccount: RelworxService.getAccountNo() ? 'Configured' : 'Missing',
      error: health.error,
    });
  });

  app.get('/api/admin/tickets', requireAdminAuth, async (_req, res) => {
    try {
      const result = await SupabaseServerService.getAllTicketsAdmin();
      if (!result.success) {
        return res.status(503).json(result);
      }
      res.json(result);
    } catch {
      res.status(500).json({ success: false, error: 'Error loading tickets.' });
    }
  });

  app.get('/api/admin/orders', requireAdminAuth, async (_req, res) => {
    try {
      const result = await SupabaseServerService.getAllOrdersAdmin();
      if (!result.success) {
        return res.status(503).json(result);
      }
      res.json(result);
    } catch {
      res.status(500).json({ success: false, error: 'Error loading orders.' });
    }
  });

  /**
   * Admin: Verify MTN Mobile Money Merchant Payment
   * Checks against official MTN merchant portal records and activates QR tickets
   */
  app.post('/api/admin/verify-mtn-payment', requireAdminAuth, async (req, res) => {
    try {
      const { orderRef, adminName, notes } = req.body || {};
      if (!orderRef) return res.status(400).json({ success: false, message: 'orderRef is required.' });

      const result = await SupabaseServerService.verifyMtnPaymentAdmin({
        orderRef: String(orderRef).trim(),
        adminName: typeof adminName === 'string' ? adminName : 'Admin',
        notes: typeof notes === 'string' ? notes : undefined,
      });

      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch {
      res.status(500).json({ success: false, message: 'Error verifying MTN payment.' });
    }
  });

  /**
   * Admin: Reject MTN Mobile Money Merchant Payment
   * Marks order rejected and releases reserved tickets back to inventory
   */
  app.post('/api/admin/reject-mtn-payment', requireAdminAuth, async (req, res) => {
    try {
      const { orderRef, reason, adminName } = req.body || {};
      if (!orderRef) return res.status(400).json({ success: false, message: 'orderRef is required.' });

      const result = await SupabaseServerService.rejectMtnPaymentAdmin({
        orderRef: String(orderRef).trim(),
        reason: typeof reason === 'string' ? reason : 'Unmatched transaction ID on MTN merchant account',
        adminName: typeof adminName === 'string' ? adminName : 'Admin',
      });

      res.json(result);
    } catch {
      res.status(500).json({ success: false, message: 'Error rejecting payment.' });
    }
  });

  app.post('/api/admin/verify-relworx-transaction', requireAdminAuth, async (req, res) => {
    try {
      const { orderRef } = req.body || {};
      if (!orderRef) return res.status(400).json({ success: false, message: 'orderRef required' });

      const result = await SupabaseServerService.verifyRelworxOrderDirectly(orderRef);
      res.json(result);
    } catch {
      res.status(500).json({ success: false, message: 'Error verifying transaction.' });
    }
  });

  app.post('/api/admin/verify-flw-transaction', requireAdminAuth, async (req, res) => {
    try {
      const { orderRef } = req.body || {};
      if (!orderRef) return res.status(400).json({ success: false, message: 'orderRef required' });
      const result = await SupabaseServerService.verifyRelworxOrderDirectly(orderRef);
      res.json(result);
    } catch {
      res.status(500).json({ success: false, message: 'Error verifying transaction.' });
    }
  });

  app.post('/api/admin/physical-sale', requireAdminAuth, async (req, res) => {
    try {
      const { category, quantity, buyerName, buyerEmail, buyerPhone } = req.body || {};
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
    } catch {
      res.status(500).json({ success: false, message: 'Error recording physical sale.' });
    }
  });

  app.post('/api/admin/confirm-payment', requireAdminAuth, async (req, res) => {
    try {
      const { ticketId } = req.body || {};
      const ok = await SupabaseServerService.confirmPaymentAdmin(ticketId);
      res.json({ success: ok });
    } catch {
      res.status(500).json({ success: false, error: 'Error confirming payment.' });
    }
  });

  app.post('/api/admin/release-ticket', requireAdminAuth, async (req, res) => {
    try {
      const { ticketId } = req.body || {};
      const ok = await SupabaseServerService.releaseTicketAdmin(ticketId);
      res.json({ success: ok });
    } catch {
      res.status(500).json({ success: false, error: 'Error releasing ticket.' });
    }
  });

  // Always return JSON for unmatched `/api/*` routes (never HTML)
  app.use('/api/*', (_req, res) => {
    res.status(404).json({
      success: false,
      message: 'API endpoint not found.',
      error: 'NOT_FOUND',
    });
  });

  // Sanitized JSON Express error handler (handles malformed JSON bodies, etc.)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }
    if (req.url.startsWith('/api')) {
      const status = err?.type === 'entity.parse.failed' ? 400 : 500;
      const message = status === 400 ? 'Invalid JSON request payload.' : 'Unexpected server error.';
      return res.status(status).json({ success: false, message, error: 'SERVER_ERROR' });
    }
    next(err);
  });

  return app;
}
